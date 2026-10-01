import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { connectionStringFrom } from "../verifier/src/store/store.ts";

/**
 * atlasGap() and mappingProposals() read the review queue the /writing/qwen and /method figures come
 * from. This proves those figures are queried, not typed: insert a proposal and the counts move
 * (flagship 9.2, spec 19 D.5).
 *
 * Runs in its own throwaway database, created and dropped here, never a shared one. Skipped loudly
 * when no database is configured. FOVEA_DATABASE_URL is pointed at the scratch database BEFORE the
 * queries module opens its pool, which is safe because node --test runs each test file in its own
 * process.
 */
const TEST_DB = "fovea_atlas_q_test";
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
// Imported lazily so the module's pool is built against the scratch database set in before().
let atlasGap: typeof import("./queries.ts").atlasGap;
let mappingProposals: typeof import("./queries.ts").mappingProposals;

before(async () => {
  if (!adminConn) return;
  const admin = new pg.Client({ connectionString: withDatabase(adminConn, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  conn = withDatabase(adminConn, TEST_DB);
  if (new URL(conn).pathname.replace(/^\//, "") !== TEST_DB) throw new Error("refusing a non-scratch database");
  process.env.FOVEA_DATABASE_URL = conn;

  raw = new pg.Client({ connectionString: conn });
  await raw.connect();
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  await raw.query(readFileSync(join(here, "../verifier/src/store/schema.sql"), "utf8"));

  ({ atlasGap, mappingProposals } = await import("./queries.ts"));
});

after(async () => {
  if (!conn) return;
  await raw?.end();
  const anyGlobal = globalThis as unknown as { __corneaPool?: { end: () => Promise<void> } };
  await anyGlobal.__corneaPool?.end();
  const admin = new pg.Client({ connectionString: withDatabase(adminConn!, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

async function insertUnknownIntact(id: string): Promise<void> {
  await raw.query(
    `INSERT INTO fovea.verdict (feedback_id, feedback_uri, rung, outcome, reason, checked_at)
     VALUES ($1,$2,'intact','unknown','no published mapping reads this document shape', now())`,
    [id, `https://x/${id}`],
  );
}

async function insertProposal(shape: string, ids: string[], converged: boolean, status = "pending"): Promise<void> {
  await raw.query(
    `INSERT INTO fovea.mapping_proposal
       (shape_key, feedback_ids, example_uri, model, converged, round_trip_ok,
        iterations, tool_calls, proposal, transcript, status, checked_at)
     VALUES ($1,$2,'https://x/doc','qwen3.8-max',$3,$3,2,2,$4,'[]'::jsonb,$5, now())`,
    [shape, ids, converged, converged ? JSON.stringify({ name: `${shape}.v1`, note: "n", kind: "claim" }) : null, status],
  );
}

test("atlasGap().unparsed counts the intact-unknown verdicts", { skip: adminConn ? false : reason }, async () => {
  await insertUnknownIntact("143_1_0xabc_1");
  await insertUnknownIntact("143_1_0xabc_2");
  const gap = await atlasGap();
  assert.equal(gap.unparsed, 2);
  // No proposals yet, so the pending count is a real zero from the empty table, not unknown.
  assert.equal(gap.pendingProposals, 0);
});

test("a converged pending proposal shows in the queue, covering its claims", { skip: adminConn ? false : reason }, async () => {
  await insertProposal("a,b,c", ["143_1_0xabc_1", "143_1_0xabc_2", "143_1_0xabc_3"], true);
  const q = await mappingProposals();
  const row = q.rows.find((r) => r.shapeKey === "a,b,c");
  assert.ok(row, "the proposal is in the queue");
  assert.equal(row!.coveredClaims, 3);
  assert.equal(row!.model, "qwen3.8-max");
  assert.equal(row!.converged, true);
  assert.equal(row!.proposalName, "a,b,c.v1");
  assert.equal((await atlasGap()).pendingProposals, 1);
});

test("the pending count moves when another converged proposal lands, and a give-up does not", { skip: adminConn ? false : reason }, async () => {
  await insertProposal("d,e,f", ["143_2_0xdef_1"], true);
  assert.equal((await atlasGap()).pendingProposals, 2, "a second converged proposal increments the count");
  // A non-converged proposal is stored but is not a candidate ready to close the gap.
  await insertProposal("g,h,i", ["143_3_0xghi_1"], false);
  assert.equal((await atlasGap()).pendingProposals, 2, "a give-up does not inflate the pending-converged count");
});

