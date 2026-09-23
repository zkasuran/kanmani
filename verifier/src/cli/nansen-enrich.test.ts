/**
 * The Nansen enrich CLI: the guarded transport and the append-only store.
 *
 * The transport tests prove the SSRF guard actually refuses, using an injected resolver so no
 * socket opens. The store tests run against a throwaway Postgres and skip loudly when none is
 * configured, the same posture as store.test.ts, because a test that reports green without touching
 * a database is worse than one not written.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { guardedTransport, parseArgs, writeLabel } from "./nansen-enrich.ts";
import { connectionStringFrom } from "../store/store.ts";
import type { Resolver } from "../net/guard.ts";
import type { WalletEnrichment } from "../../../lib/nansen.ts";

/* ------------------------------------------------------------------ the guard */

test("the transport refuses a host that resolves to a private address, before any socket", async () => {
  // An injected resolver stands in for DNS. api.nansen.ai answering 10.0.0.5 is exactly the
  // rebinding shape the guard exists to stop, so the transport must refuse rather than connect.
  const resolver: Resolver = async () => ["10.0.0.5"];
  const transport = guardedTransport({ resolver, timeoutMs: 200 });
  await assert.rejects(
    () => transport({ url: "https://api.nansen.ai/api/v1/profiler/address/labels", method: "POST", headers: {}, body: "{}" }),
    /SSRF guard refused/,
  );
});

test("the transport refuses a URL whose literal host is a private address", async () => {
  const transport = guardedTransport({ timeoutMs: 200 });
  await assert.rejects(
    () => transport({ url: "http://169.254.169.254/latest/meta-data/", method: "POST", headers: {}, body: "{}" }),
    /SSRF guard refused/,
  );
});

test("the transport refuses a non-http scheme", async () => {
  const transport = guardedTransport({ timeoutMs: 200 });
  await assert.rejects(
    () => transport({ url: "file:///etc/passwd", method: "POST", headers: {}, body: "{}" }),
    /SSRF guard refused/,
  );
});

/* ------------------------------------------------------------------ args */

test("parseArgs reads the flags and holds sane defaults", () => {
  const a = parseArgs(["--limit", "200", "--gap", "400", "--dry", "--only", "0xABC"]);
  assert.equal(a.limit, 200);
  assert.equal(a.gapMs, 400);
  assert.equal(a.dry, true);
  assert.equal(a.only, "0xABC");
  const d = parseArgs([]);
  assert.equal(d.gapMs, 300);
  assert.equal(d.dry, false);
});

/* ------------------------------------------------------------------ the store, DB gated */

const TEST_DB = "fovea_nansen_test";

let adminConn: string | null = null;
try {
  adminConn = connectionStringFrom();
} catch {
  adminConn = null;
}
const reason = "no database configured: set ENVIO_PG_PASSWORD or FOVEA_DATABASE_URL";

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

let conn: string | null = null;
let raw: pg.Client;
let pool: pg.Pool;

before(async () => {
  if (!adminConn) return;
  const admin = new pg.Client({ connectionString: withDatabase(adminConn, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  conn = withDatabase(adminConn, TEST_DB);
  pool = new pg.Pool({ connectionString: conn, max: 4 });
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  await pool.query(readFileSync(join(here, "../store/schema.sql"), "utf8"));
  raw = new pg.Client({ connectionString: conn });
  await raw.connect();
});

after(async () => {
  if (!conn) return;
  await raw?.end();
  await pool?.end();
  const admin = new pg.Client({ connectionString: withDatabase(adminConn!, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

const enrichment = (over: Partial<WalletEnrichment> = {}): WalletEnrichment => ({
  address: "0xabc",
  chain: "monad",
  status: "labeled",
  category: "cefi",
  labels: ["Binance 14"],
  labelCount: 1,
  source: "nansen:profiler/address/labels",
  authMode: "apikey",
  reason: "1 label, primary category cefi",
  httpStatus: 200,
  checkedAt: new Date("2026-09-23T10:00:00Z").toISOString(),
  ...over,
});

test("writes a label and reads the latest back", { skip: adminConn ? false : reason }, async () => {
  await writeLabel(pool, enrichment());
  const r = await raw.query<{ status: string; category: string; labels: string[] }>(
    "SELECT status, category, labels FROM fovea.wallet_label_latest WHERE address = $1 AND chain = $2",
    ["0xabc", "monad"],
  );
  assert.equal(r.rows[0]!.status, "labeled");
  assert.equal(r.rows[0]!.category, "cefi");
  assert.deepEqual(r.rows[0]!.labels, ["Binance 14"]);
});

test("a re-check APPENDS and the latest view shows the newer row", { skip: adminConn ? false : reason }, async () => {
  await writeLabel(pool, enrichment({ address: "0xdef", status: "unlabeled", category: null, labels: [], labelCount: 0 }));
  await writeLabel(
    pool,
    enrichment({
      address: "0xdef",
      status: "labeled",
      category: "smart_money",
      labels: ["Smart Trader"],
      labelCount: 1,
      checkedAt: new Date("2026-09-23T12:00:00Z").toISOString(),
    }),
  );
  const all = await raw.query("SELECT status FROM fovea.wallet_label WHERE address = $1", ["0xdef"]);
  assert.equal(all.rows.length, 2, "both rows survive, nothing overwritten");
  const latest = await raw.query<{ status: string; category: string }>(
    "SELECT status, category FROM fovea.wallet_label_latest WHERE address = $1",
    ["0xdef"],
  );
  assert.equal(latest.rows[0]!.status, "labeled");
  assert.equal(latest.rows[0]!.category, "smart_money");
});

test("the category column refuses a bucket the classifier cannot produce", { skip: adminConn ? false : reason }, async () => {
  await assert.rejects(
    () => writeLabel(pool, enrichment({ category: "whale" as never })),
    /violates check constraint/,
  );
});

test("an unknown lookup stores no category, so our outage is never a label", { skip: adminConn ? false : reason }, async () => {
  await writeLabel(
    pool,
    enrichment({ address: "0x999", status: "unknown", category: null, labels: [], labelCount: 0, reason: "HTTP 429: rate limited", httpStatus: 429 }),
  );
  const r = await raw.query<{ status: string; category: string | null }>(
    "SELECT status, category FROM fovea.wallet_label_latest WHERE address = $1",
    ["0x999"],
  );
  assert.equal(r.rows[0]!.status, "unknown");
  assert.equal(r.rows[0]!.category, null);
});
