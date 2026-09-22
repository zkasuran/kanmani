/**
 * The store, tested against a real Postgres.
 *
 * The load-bearing test here is `survivesAnEnvioResync`. The whole reason verdicts live in their
 * own schema is that Envio drops and recreates `public` on every resync, which happened twice
 * during ordinary schema work on 2026-09-18. Asserting that in a comment is worth nothing, so this
 * drops `public` for real and checks the verdicts are still there.
 *
 * Skipped with a loud reason when no database is configured, rather than passing quietly. A test
 * that reports green without touching a database is worse than one that is not written.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { VerdictStore, connectionStringFrom } from "./store.ts";
import type { Verdict } from "../ladder/verdict.ts";

/**
 * **These tests run in their own throwaway database and must never point at a shared one.**
 *
 * The resync test below drops the `public` schema for real, because asserting in a comment that
 * verdicts survive a drop is worth nothing. The first version of this file ran that against the
 * same database the indexer uses and deleted 10,252 indexed agents, which cost a full resync to
 * put back. So the connection is rewritten to a dedicated database created here and dropped
 * afterwards and `assertNotSharedDatabase` refuses to run at all if anyone points it back at the
 * indexer's database.
 */
const TEST_DB = "fovea_store_test";

let adminConn: string | null = null;
try {
  adminConn = connectionStringFrom();
} catch {
  adminConn = null;
}
const reason = "no database configured: set ENVIO_PG_PASSWORD or FOVEA_DATABASE_URL";

/** Refuses to proceed against anything that looks like a database someone else depends on. */
function assertNotSharedDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name !== TEST_DB) {
    throw new Error(
      `refusing to run destructive tests against "${name}", they only run against ${TEST_DB}`,
    );
  }
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

let conn: string | null = null;
let store: VerdictStore;
let raw: pg.Client;

before(async () => {
  if (!adminConn) return;
  // Build the scratch database from a connection to the server's default database, so nothing
  // here ever opens the indexer's one for writing.
  const admin = new pg.Client({ connectionString: withDatabase(adminConn, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  conn = withDatabase(adminConn, TEST_DB);
  assertNotSharedDatabase(conn);

  store = await VerdictStore.open(conn);
  raw = new pg.Client({ connectionString: conn });
  await raw.connect();
});

after(async () => {
  if (!conn) return;
  await raw?.end();
  await store?.close();
  const admin = new pg.Client({ connectionString: withDatabase(adminConn!, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

const v = (over: Partial<Verdict> = {}): Verdict => ({
  rung: "parsed",
  outcome: "false",
  reason: "no transaction with this hash on Monad at block 1",
  checkedAt: new Date("2026-09-19T10:00:00Z").toISOString(),
  ...over,
});

test("records a verdict and reads the tally back", { skip: adminConn ? false : reason }, async () => {
  await store.record({ ...v(), feedbackId: "f1", feedbackUri: "https://x/1" });
  await store.record({ ...v({ outcome: "true", rung: "true" }), feedbackId: "f2", feedbackUri: "https://x/2" });
  const t = await store.tally();
  assert.equal(t.false, 1);
  assert.equal(t.true, 1);
});

test("a re-check APPENDS rather than overwriting", { skip: adminConn ? false : reason }, async () => {
  const id = "f3";
  await store.record({ ...v(), feedbackId: id, feedbackUri: "https://x/3" });
  await store.record({
    ...v({ outcome: "true", rung: "true", checkedAt: new Date("2026-09-19T11:00:00Z").toISOString() }),
    feedbackId: id,
    feedbackUri: "https://x/3",
  });

  const h = await store.history(id);
  assert.equal(h.length, 2, "both verdicts survive, oldest first");
  assert.equal(h[0]!.outcome, "false");
  assert.equal(h[1]!.outcome, "true");

  const t = await store.tally();
  assert.ok((t.true ?? 0) >= 1, "the latest view shows the newer verdict");
});

test("a corrected claim shows as from -> to, which is the point", { skip: adminConn ? false : reason }, async () => {
  const changed = await store.changed();
  const f3 = changed.find((c) => c.feedbackId === "f3");
  assert.ok(f3, "f3 changed outcome and should appear");
  assert.equal(f3!.from, "false");
  assert.equal(f3!.to, "true");
});

test(
  "SURVIVES AN ENVIO RESYNC, which is the whole reason for a separate schema",
  { skip: adminConn ? false : reason },
  async () => {
    const before = await store.tally();
    assert.ok(Object.keys(before).length > 0, "there is something to lose");

    // Exactly what `envio start -r` does to its own schema. If verdicts lived in `public` this
    // line would delete every one of them.
    //
    // Guarded, because the first version of this test ran it against the indexer's own database.
    assertNotSharedDatabase(conn!);
    await raw.query("CREATE SCHEMA IF NOT EXISTS public");
    await raw.query("DROP SCHEMA public CASCADE");
    await raw.query("CREATE SCHEMA public");

    const after = await store.tally();
    assert.deepEqual(after, before, "verdicts are untouched by a public schema drop");
  },
);

test("the outcome column refuses a value the ladder cannot produce", { skip: adminConn ? false : reason }, async () => {
  // A typo in a caller should fail at the database rather than become a new outcome nobody counts.
  await assert.rejects(
    () => store.record({ ...v({ outcome: "probably" as never }), feedbackId: "f9", feedbackUri: "https://x/9" }),
    /violates check constraint/,
  );
});

test(
  "a 402 is paywalled only when it is a real x402 challenge, never a suspended host",
  { skip: adminConn ? false : reason },
  async () => {
    // The bug this guards against shipped once: 539 records answering 402 from a suspended Vercel
    // account were published as agents "alive and asking for payment", because record_state keyed
    // on the status code alone. A status code is not a protocol. Both rows below answer 402. Only
    // the one carrying a real x402 challenge is paywalled; the vendor-error one is gone.
    //
    // This fails against the old view, which classified both as paywalled. That is the point.
    const rows = [
      // A real x402 challenge: www-authenticate header plus a JSON body.
      { h: "x402-live", auth: "x402 realm=\"pay\"", mt: "application/json", vendor: null },
      // A suspended host answering 402 with a vendor error and a text body.
      { h: "vercel-dead", auth: null, mt: "text/plain; charset=utf-8", vendor: "DEPLOYMENT_DISABLED" },
      // A 402 with nothing to say for itself is treated as a dead deployment, not a live agent.
      { h: "bare-402", auth: null, mt: null, vendor: null },
    ];
    for (const r of rows) {
      await raw.query(
        `INSERT INTO fovea.record_probe
           (uri_hash, uri, scheme, reachable, http_status, media_type, www_authenticate, vendor_error, reason, checked_at)
         VALUES ($1,$2,'http',false,402,$3,$4,$5,'HTTP 402',now())`,
        [r.h, `https://${r.h}/doc.json`, r.mt, r.auth, r.vendor],
      );
    }

    const state = async (h: string): Promise<string> => {
      const q = await raw.query<{ state: string }>(
        "SELECT state FROM fovea.record_state WHERE uri_hash = $1",
        [h],
      );
      return q.rows[0]!.state;
    };

    assert.equal(await state("x402-live"), "paywalled", "a real challenge is a live agent");
    assert.equal(await state("vercel-dead"), "gone", "a vendor-error 402 is a dead host, not a paywall");
    assert.equal(await state("bare-402"), "gone", "a 402 that is not a challenge is not paywalled");
  },
);
