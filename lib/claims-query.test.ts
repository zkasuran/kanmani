/**
 * The claims query was rewritten to be index friendly. It has to return exactly what it returned before.
 *
 * Found by profiling the agent page after two bursts of database timeouts (14 and 19 October). One call,
 * `claims({ agentId, withUri: false, limit: 100 })`, took 1.4 seconds and held a pool connection for all
 * of it, while every other call on the page took under 110 ms. With eight connections that is the ceiling
 * on how many agent pages the site can serve at once, and a crawler reaches it. The cause was the agent
 * filter, `f.agent_id = x OR a."agentId"::text = x`, which no index can serve, plus a join against
 * `fovea.verdict_latest`, a DISTINCT ON over the whole verdict table that was sorted on disk each time.
 *
 * The old SQL is kept below as the oracle. The store-backed cases run the old and the new statement
 * against the same database and compare every row, so a rewrite that is fast and wrong cannot pass. They
 * skip without a database (set FOVEA_DATABASE_URL). The cases that need no database check the shape of
 * the new statement.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { CHAIN_ID } from "./db.ts";
import { CLAIM_COLUMNS, LATEST_VERDICT_JOIN, claimSource, type ClaimFilter } from "./queries.ts";

/* ----------------------------------------------------------------------------- the old statement */

/** `claimSource` exactly as it stood before the rewrite. */
function legacySource(f: ClaimFilter, params: unknown[]): string {
  const where: string[] = [`f."chainId" = $${params.push(CHAIN_ID)}`];
  const p = (v: unknown) => `$${params.push(v)}`;
  if (f.withUri !== false) where.push(`f."feedbackUri" <> ''`);
  if (f.outcome) where.push(`v.outcome = ${p(f.outcome)}`);
  if (f.rung) where.push(`v.rung = ${p(f.rung)}`);
  if (f.network) where.push(`v.declared_network = ${p(f.network)}`);
  if (f.mapping) where.push(`v.mapping = ${p(f.mapping)}`);
  if (f.agentId) { const x = p(f.agentId); where.push(`(f.agent_id = ${x} OR a."agentId"::text = ${x})`); }
  return `
FROM "Feedback" f
JOIN "Agent" a ON a.id = f.agent_id
LEFT JOIN fovea.verdict_latest v ON v.feedback_id = f.id
WHERE ${where.join(" AND ")}`;
}

const listSql = (source: string, params: unknown[], f: ClaimFilter) => {
  const limit = `$${params.push(Math.min(f.limit ?? 50, 1000))}`;
  const offset = `$${params.push(f.offset ?? 0)}`;
  return `${CLAIM_COLUMNS}${source}\nORDER BY f."blockNumber" DESC, f.id\nLIMIT ${limit} OFFSET ${offset}`;
};
const countSql = (source: string) => `SELECT count(*) AS count${source}`;

/* --------------------------------------------------------------------- the shape of the new one */

test("the new statement never joins the whole-table latest-verdict view", () => {
  const params: unknown[] = [];
  const sql = claimSource({ agentId: "10223", withUri: false }, params);
  assert.equal(sql.includes("verdict_latest"), false);
  assert.equal(sql.includes("LATERAL"), true);
  assert.equal(LATEST_VERDICT_JOIN.includes("ORDER BY checked_at DESC, id DESC LIMIT 1"), true, "the view's own ordering");
});

test("the agent filter resolves agents first and has no OR across the two tables", () => {
  const params: unknown[] = [];
  const sql = claimSource({ agentId: "143_10223" }, params);
  assert.equal(/f\.agent_id = \$\d+ OR/.test(sql), false, "the old OR is gone");
  assert.equal(sql.includes('f.agent_id IN (SELECT id FROM "Agent"'), true);
  assert.deepEqual(params, [CHAIN_ID, "143_10223"]);
});

test("a count joins the verdict only when a verdict filter needs it", () => {
  assert.equal(claimSource({}, [], { forCount: true }).includes("LATERAL"), false);
  assert.equal(claimSource({ agentId: "10223" }, [], { forCount: true }).includes("LATERAL"), false);
  for (const f of [{ outcome: "false" }, { rung: "true" }, { network: "base" }, { mapping: "m" }] as ClaimFilter[]) {
    assert.equal(claimSource(f, [], { forCount: true }).includes("LATERAL"), true, JSON.stringify(f));
  }
  assert.equal(claimSource({}, []).includes("LATERAL"), true, "a list always joins it: it returns the verdict's columns");
});

test("without an agent filter the statement carries no agent subquery", () => {
  const sql = claimSource({}, []);
  assert.equal(sql.includes("IN (SELECT"), false);
});

/* -------------------------------------------------------------------- old versus new, row for row */

const URL_ = process.env.FOVEA_DATABASE_URL;
const skip = URL_ ? false : "no database configured: set FOVEA_DATABASE_URL";
const pool = URL_ ? new pg.Pool({ connectionString: URL_, max: 2, statement_timeout: 60_000 }) : null;
after(async () => { await pool?.end(); });

async function compare(f: ClaimFilter) {
  const a: unknown[] = [];
  const b: unknown[] = [];
  const oldList = listSql(legacySource(f, a), a, f);
  const newList = listSql(claimSource(f, b), b, f);
  const [o, n] = await Promise.all([pool!.query(oldList, a), pool!.query(newList, b)]);
  assert.deepEqual(n.rows, o.rows, `rows differ for ${JSON.stringify(f)}`);
  const c: unknown[] = [];
  const d: unknown[] = [];
  const [oc, nc] = await Promise.all([pool!.query(countSql(legacySource(f, c)), c), pool!.query(countSql(claimSource(f, d, { forCount: true })), d)]);
  assert.equal(nc.rows[0].count, oc.rows[0].count, `count differs for ${JSON.stringify(f)}`);
  return o.rows.length;
}

test("no filter and the default page", { skip }, async () => {
  assert.ok((await compare({})) > 0);
  await compare({ limit: 200, offset: 50 });
  await compare({ withUri: false, limit: 300 });
});

test("every outcome, rung and mapping that exists", { skip }, async () => {
  for (const outcome of ["true", "false", "unknown", "noClaim"] as const) await compare({ outcome, limit: 500 });
  for (const rung of ["declared", "resolvable", "intact", "parsed", "true"] as const) await compare({ rung, limit: 500 });
  const m = await pool!.query(`SELECT DISTINCT mapping FROM fovea.verdict_latest WHERE mapping IS NOT NULL LIMIT 12`);
  for (const r of m.rows) await compare({ mapping: r.mapping, limit: 500 });
  const nets = await pool!.query(`SELECT DISTINCT declared_network FROM fovea.verdict_latest WHERE declared_network IS NOT NULL LIMIT 12`);
  for (const r of nets.rows) await compare({ network: r.declared_network, limit: 500 });
});

test("agents by internal id and by public number, including ones with many feedbacks and none", { skip }, async () => {
  const top = await pool!.query(
    `SELECT a.id, a."agentId" FROM "Agent" a LEFT JOIN "Feedback" f ON f.agent_id = a.id
     WHERE a."chainId" = $1 GROUP BY a.id, a."agentId" ORDER BY count(f.*) DESC LIMIT 8`, [CHAIN_ID]);
  const none = await pool!.query(
    `SELECT a.id, a."agentId" FROM "Agent" a WHERE a."chainId" = $1 AND NOT EXISTS (SELECT 1 FROM "Feedback" f WHERE f.agent_id = a.id) LIMIT 3`, [CHAIN_ID]);
  for (const r of [...top.rows, ...none.rows]) {
    await compare({ agentId: String(r.id), withUri: false, limit: 100 });
    await compare({ agentId: String(r.agentId), withUri: false, limit: 100 });
    await compare({ agentId: String(r.agentId), limit: 100, offset: 1 });
  }
});

test("an agent that does not exist, and a malformed id, both return nothing from both statements", { skip }, async () => {
  assert.equal(await compare({ agentId: "99999999" }), 0);
  assert.equal(await compare({ agentId: "'; select 1 --" }), 0);
});

test("agent and outcome together", { skip }, async () => {
  const r = await pool!.query(`SELECT f.agent_id FROM "Feedback" f WHERE f."chainId" = $1 AND f."feedbackUri" <> '' GROUP BY f.agent_id ORDER BY count(*) DESC LIMIT 4`, [CHAIN_ID]);
  for (const row of r.rows) for (const outcome of ["true", "false", "unknown"] as const) await compare({ agentId: String(row.agent_id), outcome, limit: 100 });
});
