/**
 * The Nansen funders worker: the budget cap, the reserve stop, growth without double-spend and the
 * funder-reach second category.
 *
 * The pure withinBudget tests run with no database. The runFunders tests run against a throwaway
 * Postgres and skip loudly when none is configured, the same posture as nansen-enrich.test.ts,
 * because a budget guard that reports green without touching a database is worse than none. An
 * injected transport answers so no socket opens, and an injected creditsFn stands in for the account
 * read so the budget cap can be proven to hold when the balance is unknown.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runFunders, withinBudget } from "./nansen-enrich.ts";
import { connectionStringFrom } from "../store/store.ts";
import type { NansenAuth, NansenTransport } from "../../../lib/nansen.ts";

/* ------------------------------------------------------------------ withinBudget, pure */

test("withinBudget: the call-based cap holds even when the credit read failed (null)", () => {
  assert.equal(withinBudget(0, 3, null, 5), true);
  assert.equal(withinBudget(2, 3, null, 5), true);
  assert.equal(withinBudget(3, 3, null, 5), false, "spent at budget stops, with no balance to lean on");
});

test("withinBudget: the reserve stops before the balance would fall under it", () => {
  assert.equal(withinBudget(0, 50, 6, 5), true); // 6 - 1 = 5, not under 5
  assert.equal(withinBudget(0, 50, 5, 5), false); // 5 - 1 = 4, under 5
});

/* ------------------------------------------------------------------ the transport and auth */

const auth: NansenAuth = { mode: "apikey", apiKey: "test" };

const foundBody = (funder: string, tx = "0xfund") =>
  JSON.stringify({ data: [{ address: funder, relation: "First Funder", transaction_hash: tx, block_timestamp: "t", order: 1, chain: "monad" }] });

const FUNDER = "0xffff000000000000000000000000000000000001";

/** Always answers one First Funder. */
const alwaysFound = (funder = FUNDER): NansenTransport => async () => ({ status: 200, headers: {}, bodyText: foundBody(funder) });

/* ------------------------------------------------------------------ the store, DB gated */

const TEST_DB = "fovea_funders_test";

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
  // The indexer owns these two tables in production (Envio drops and rebuilds that schema). The
  // worker only reads them, so the test creates the columns the queries touch and nothing else.
  await pool.query(`CREATE TABLE "AgentRecord" (id text PRIMARY KEY, uri text NOT NULL, "distinctOwners" integer NOT NULL, "chainId" integer NOT NULL)`);
  await pool.query(`CREATE TABLE "AgentRecordOwner" (record_id text NOT NULL, owner text NOT NULL)`);
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

let walletSeq = 1;
const nextAddr = () => "0x" + (walletSeq++).toString(16).padStart(40, "0");

/** Clear everything between tests so each assertion is exact (append-only is a production concern). */
async function reset() {
  await raw.query(`TRUNCATE "AgentRecord", "AgentRecordOwner"`);
  await raw.query(`DELETE FROM fovea.wallet_funder`);
}

/** A cluster with `owners` unsampled wallets. Returns the owner addresses in insert order. */
async function seedCluster(id: string, owners: number): Promise<string[]> {
  await raw.query(`INSERT INTO "AgentRecord"(id, uri, "distinctOwners", "chainId") VALUES ($1,$2,$3,143)`, [id, `https://x/${id}`, Math.max(owners, 2)]);
  const addrs: string[] = [];
  for (let i = 0; i < owners; i++) {
    const a = nextAddr();
    addrs.push(a);
    await raw.query(`INSERT INTO "AgentRecordOwner"(record_id, owner) VALUES ($1,$2)`, [id, a]);
  }
  return addrs;
}

const foundRows = (sample: string) =>
  raw.query<{ n: string }>(`SELECT count(*) AS n FROM fovea.wallet_funder WHERE sample = $1 AND status = 'found'`, [sample]);
const allRows = (sample: string) =>
  raw.query<{ n: string }>(`SELECT count(*) AS n FROM fovea.wallet_funder WHERE sample = $1`, [sample]);
const distinctAddrs = (sample: string) =>
  raw.query<{ n: string }>(`SELECT count(DISTINCT address) AS n FROM fovea.wallet_funder WHERE sample = $1`, [sample]);
const skip = adminConn ? false : reason;

test("the budget cap stops the run even when the credit read fails", { skip }, async () => {
  await reset();
  await seedCluster("c-budget", 10);
  await runFunders(pool, ["--funders", "--clusters", "1", "--per-cluster", "10", "--budget", "3", "--reserve", "5"], auth, alwaysFound(), 0, false, { creditsFn: async () => null });
  assert.equal(Number((await foundRows("cluster:c-budget")).rows[0]!.n), 3, "exactly budget billed calls, no more, with a null balance");
});

test("the reserve stops the run before the balance would fall under it", { skip }, async () => {
  await reset();
  await seedCluster("c-reserve", 10);
  await runFunders(pool, ["--funders", "--clusters", "1", "--per-cluster", "10", "--budget", "50", "--reserve", "5"], auth, alwaysFound(), 0, false, { creditsFn: async () => 7 });
  assert.equal(Number((await foundRows("cluster:c-reserve")).rows[0]!.n), 2, "7 down to 5 is two calls, not the budget of 50");
});

test("the sample grows across runs and never re-asks a wallet", { skip }, async () => {
  await reset();
  await seedCluster("c-grow", 10);
  await runFunders(pool, ["--funders", "--clusters", "1", "--per-cluster", "10", "--budget", "3", "--reserve", "5"], auth, alwaysFound(), 0, false, { creditsFn: async () => null });
  await runFunders(pool, ["--funders", "--clusters", "1", "--per-cluster", "10", "--budget", "3", "--reserve", "5"], auth, alwaysFound(), 0, false, { creditsFn: async () => null });
  assert.equal(Number((await allRows("cluster:c-grow")).rows[0]!.n), 6, "a second run adds three more rows");
  assert.equal(Number((await distinctAddrs("cluster:c-grow")).rows[0]!.n), 6, "all six are different wallets, nothing double-spent");
});

test("funder-reach writes the funder's own funder once, under its own tag", { skip }, async () => {
  await reset();
  const owners = await seedCluster("c-reach", 3);
  // Mark those same owners answered with one shared top funder, so the sample loop skips them and
  // only the reach loop spends.
  const F = "0xeeee000000000000000000000000000000000009";
  for (const o of owners) {
    await raw.query(`INSERT INTO fovea.wallet_funder (address, chain, status, funder, tx, sample) VALUES ($1,'monad','found',$2,'0xt','cluster:c-reach')`, [o, F]);
  }
  const G = "0xdddd000000000000000000000000000000000007";
  await runFunders(pool, ["--funders", "--funder-reach", "--clusters", "1", "--per-cluster", "10", "--budget", "5", "--reserve", "5"], auth, alwaysFound(G), 0, false, { creditsFn: async () => null });
  const reach = await raw.query<{ address: string; funder: string }>(`SELECT address, funder FROM fovea.wallet_funder WHERE sample = $1`, [`funder:${F}`]);
  assert.equal(reach.rows.length, 1, "one reach row for the top funder");
  assert.equal(reach.rows[0]!.address, F, "the subject is the funder");
  assert.equal(reach.rows[0]!.funder, G, "and its own first funder is recorded");
  await runFunders(pool, ["--funders", "--funder-reach", "--clusters", "1", "--per-cluster", "10", "--budget", "5", "--reserve", "5"], auth, alwaysFound(G), 0, false, { creditsFn: async () => null });
  const after2 = await raw.query(`SELECT 1 FROM fovea.wallet_funder WHERE sample = $1`, [`funder:${F}`]);
  assert.equal(after2.rows.length, 1, "a second run skips the funder that already has a reach row");
});

test("a 429 is not counted against the budget", { skip }, async () => {
  await reset();
  await seedCluster("c-429", 5);
  let n = 0;
  const transport: NansenTransport = async () => {
    n += 1;
    if (n === 1) return { status: 429, headers: {}, bodyText: '{"message":"rate limited"}' };
    return { status: 200, headers: {}, bodyText: foundBody(FUNDER) };
  };
  await runFunders(pool, ["--funders", "--clusters", "1", "--per-cluster", "10", "--budget", "2", "--reserve", "5"], auth, transport, 0, false, { creditsFn: async () => null });
  assert.equal(Number((await foundRows("cluster:c-429")).rows[0]!.n), 2, "two billed calls land despite the 429 taking a turn");
  assert.equal(Number((await allRows("cluster:c-429")).rows[0]!.n), 3, "the 429 wrote one unknown row and did not count toward budget");
});


