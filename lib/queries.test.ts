import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import {
  CHAIN_STATUS_SQL,
  CROSS_CHAIN_DETAIL_SQL,
  CROSS_CHAIN_SUMMARY_SQL,
  ENTITY_COUNTS_SQL,
  HANDLER_ACTIVITY_SQL,
  chainStatus,
  crossChainMerge,
  entityCounts,
  handlerActivity,
} from "./queries.ts";

/**
 * The indexer panel's four reads (spec 17, flagship 7.1).
 *
 * The cheap half runs anywhere: each query string must name the right table, so a renamed Envio
 * table fails here rather than on a judge's screen. The DB half seeds a scratch Postgres with the
 * same tables Envio writes, two chains sharing one document, and asserts the real numbers plus the
 * one invariant the whole site rests on: a dropped `public` reads unknown, never zero.
 */

/* -------------------------------------------------------------- the SQL, checked without a DB */

test("chainStatus reads Envio's chain_metadata view, head and processed", () => {
  assert.ok(CHAIN_STATUS_SQL.trim().length > 0);
  assert.match(CHAIN_STATUS_SQL, /public\.chain_metadata/);
  assert.match(CHAIN_STATUS_SQL, /block_height/);
  assert.match(CHAIN_STATUS_SQL, /latest_processed_block/);
});

test("entityCounts names every entity table, per-chain and cross-chain", () => {
  for (const table of [
    '"Agent"',
    '"AgentRecord"',
    '"AgentRecordOwner"',
    '"Feedback"',
    '"Validation"',
    '"ChiasmRecord"',
    '"ChiasmPresence"',
  ]) {
    assert.ok(ENTITY_COUNTS_SQL.includes(table), `ENTITY_COUNTS_SQL must count ${table}`);
  }
});

test("handlerActivity counts off the real Agent counters", () => {
  assert.match(HANDLER_ACTIVITY_SQL, /"transferCount"/);
  assert.match(HANDLER_ACTIVITY_SQL, /"metadataUpdateCount"/);
  for (const table of ['"Agent"', '"Feedback"', '"Validation"']) {
    assert.ok(HANDLER_ACTIVITY_SQL.includes(table), `must read ${table}`);
  }
});

test("crossChainMerge reads ChiasmRecord and joins ChiasmPresence on record_id", () => {
  assert.match(CROSS_CHAIN_SUMMARY_SQL, /"ChiasmRecord"/);
  assert.match(CROSS_CHAIN_SUMMARY_SQL, /"chainCount"/);
  assert.match(CROSS_CHAIN_SUMMARY_SQL, /"uriConflict"/);
  assert.match(CROSS_CHAIN_DETAIL_SQL, /"ChiasmPresence"/);
  assert.match(CROSS_CHAIN_DETAIL_SQL, /p\.record_id = r\.id/);
});

/* -------------------------------------------------------------- against a real Postgres */

const TEST_DB = "fovea_queries_test";
const SKIP = "no database configured: set ENVIO_PG_PASSWORD or FOVEA_DATABASE_URL";

function adminConnection(): string | null {
  const env = process.env;
  if (env.FOVEA_DATABASE_URL) return env.FOVEA_DATABASE_URL;
  if (!env.ENVIO_PG_PASSWORD) return null;
  const host = env.ENVIO_PG_HOST ?? "127.0.0.1";
  const port = env.ENVIO_PG_PORT ?? "5434";
  const user = env.ENVIO_PG_USER ?? "postgres";
  const db = env.ENVIO_PG_DATABASE ?? "envio-dev";
  return `postgres://${user}:${encodeURIComponent(env.ENVIO_PG_PASSWORD)}@${host}:${port}/${db}`;
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

const admin = adminConnection();
let scratch: string | null = null;

// The minimal shape of Envio's own tables, enough for the four reads under test. Column names and
// quoting match what Envio writes, so a drift in either fails the real query rather than a fake.
const SETUP_SQL = `
CREATE TABLE public.chain_metadata (
  chain_id int,
  block_height bigint,
  latest_processed_block bigint,
  latest_fetched_block_number bigint,
  num_events_processed float4,
  is_hyper_sync bool,
  timestamp_caught_up_to_head_or_endblock timestamptz
);
CREATE TABLE "Agent" ("id" text, "chainId" int, "transferCount" int, "metadataUpdateCount" int);
CREATE TABLE "AgentRecord" ("id" text, "chainId" int);
CREATE TABLE "AgentRecordOwner" ("id" text, "chainId" int);
CREATE TABLE "Feedback" ("id" text, "chainId" int, revoked bool, "responseUri" text);
CREATE TABLE "Validation" ("id" text, "chainId" int, response int);
CREATE TABLE "ChiasmRecord" (
  id text, uri text, "chainCount" int, "chainIds" int[], "agentCount" int,
  "firstSeenChainId" int, "uriConflict" bool
);
CREATE TABLE "ChiasmPresence" (
  id text, record_id text, "chainId" int, "agentCount" int, "firstAgentId" bigint
);

INSERT INTO public.chain_metadata VALUES
  (143, 107000000, 107000000, 107000000, 52000, true, now()),
  (56,  100,       90,        95,        30000, true, null);

INSERT INTO "Agent" ("id","chainId","transferCount","metadataUpdateCount") VALUES
  ('a1',143,0,1),('a2',143,2,0),('a3',143,0,0),('b1',56,1,0),('b2',56,0,0);
INSERT INTO "AgentRecord" ("id","chainId") VALUES ('r1',143),('r2',143),('r3',56);
INSERT INTO "AgentRecordOwner" ("id","chainId") VALUES ('o1',143);
INSERT INTO "Feedback" ("id","chainId",revoked,"responseUri") VALUES
  ('f1',143,false,'ipfs://resp'),('f2',143,true,null),('f3',56,false,null);
INSERT INTO "Validation" ("id","chainId",response) VALUES ('v1',143,7),('v2',143,null);
INSERT INTO "ChiasmRecord" VALUES
  ('hashA','ipfs://A',2,'{56,143}',5,143,false),
  ('hashB','ipfs://B',1,'{143}',3,143,false);
INSERT INTO "ChiasmPresence" VALUES
  ('hashA_143','hashA',143,3,10182),
  ('hashA_56','hashA',56,2,20001);
`;

before(async () => {
  if (!admin) return;
  const client = new pg.Client({ connectionString: withDatabase(admin, "postgres") });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await client.query(`CREATE DATABASE ${TEST_DB}`);
  await client.end();

  scratch = withDatabase(admin, TEST_DB);
  if (new URL(scratch).pathname !== `/${TEST_DB}`) {
    throw new Error(`refusing to write test rows anywhere but ${TEST_DB}`);
  }
  // The functions read their connection through lib/db.ts, so pointing that at the scratch database
  // keeps these tests off the real indexer's one. The pool is lazy, so nothing above connects.
  process.env.FOVEA_DATABASE_URL = scratch;

  const setup = new pg.Client({ connectionString: scratch });
  await setup.connect();
  await setup.query(SETUP_SQL);
  await setup.end();
});

after(async () => {
  if (!admin || !scratch) return;
  const pool = (globalThis as { __corneaPool?: pg.Pool }).__corneaPool;
  await pool?.end();
  (globalThis as { __corneaPool?: pg.Pool }).__corneaPool = undefined;
  const client = new pg.Client({ connectionString: withDatabase(admin, "postgres") });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await client.end();
});

test("chainStatus returns one row per chain, with lag as head minus processed", { skip: admin ? false : SKIP }, async () => {
  const cs = await chainStatus();
  assert.ok(cs.rows !== null, "a live read is not null");
  const rows = cs.rows!;
  assert.equal(rows.length, 2, "one row per configured chain");
  const monad = rows.find((r) => r.chainId === 143)!;
  const bsc = rows.find((r) => r.chainId === 56)!;
  assert.equal(monad.lag, 0, "Monad is caught up");
  assert.equal(bsc.lag, 10, "BSC is 10 blocks behind, head 100 minus processed 90");
  assert.ok(monad.head! >= monad.processed!, "head is never behind processed");
  assert.equal(monad.events, 52000, "float4 events rounded to the integer count");
  assert.notEqual(monad.caughtUpAt, null, "Monad has caught up");
  assert.equal(bsc.caughtUpAt, null, "BSC is still syncing, which is null not a timestamp");
});

test("entityCounts counts each entity per chain and the cross-chain tables whole", { skip: admin ? false : SKIP }, async () => {
  const ec = await entityCounts();
  assert.ok(ec.rows !== null);
  const at = (entity: string, chainId: number | null) =>
    ec.rows!.find((r) => r.entity === entity && r.chainId === chainId)?.n ?? null;
  assert.equal(at("Agent", 143), 3);
  assert.equal(at("Agent", 56), 2);
  assert.equal(at("Feedback", 143), 2);
  assert.equal(at("Validation", 143), 2);
  // The two cross-chain tables carry no chainId, so they land under null and are counted whole.
  assert.equal(at("ChiasmRecord", null), 2);
  assert.equal(at("ChiasmPresence", null), 2);
});

test("handlerActivity counts the rows each handler wrote, folding the counterless events", { skip: admin ? false : SKIP }, async () => {
  const ha = await handlerActivity();
  assert.ok(ha.rows !== null);
  const monad = ha.rows!.perChain.find((r) => r.chainId === 143)!;
  assert.equal(monad.registered, 3, "three Agent rows on Monad");
  assert.equal(monad.laterTransfers, 2, "sum of transferCount");
  assert.equal(monad.metadataUpdates, 1, "sum of metadataUpdateCount");
  assert.equal(monad.newFeedback, 2);
  assert.equal(monad.feedbackRevoked, 1);
  assert.equal(monad.responses, 1);
  assert.equal(monad.validationResponses, 1, "one Validation row carries a response");
  assert.deepEqual(ha.rows!.foldedIntoAgent, ["MetadataSet", "URIUpdated"]);
});

test("crossChainMerge finds the one document on both chains, no key collision", { skip: admin ? false : SKIP }, async () => {
  const cc = await crossChainMerge();
  assert.ok(cc.rows !== null);
  assert.deepEqual(cc.rows!.summary, { documents: 2, onBothChains: 1, keyCollisions: 0 });
  // Only hashA qualifies (chainCount >= 2, no conflict), one detail row per chain it is present on.
  assert.equal(cc.rows!.detail.length, 2);
  for (const d of cc.rows!.detail) {
    assert.equal(d.uriHash, "hashA");
    assert.equal(d.uriConflict, false);
  }
  const chains = cc.rows!.detail.map((d) => d.chainId).sort((a, b) => a - b);
  assert.deepEqual(chains, [56, 143]);
});

test("a dropped public schema reads unknown, never zero", { skip: admin ? false : SKIP }, async () => {
  // The invariant the whole site rests on. A resync drops public mid-flight, and the read must fail
  // closed to null (rendered "unknown") rather than to a row of zeros that would read as a fact.
  const drop = new pg.Client({ connectionString: scratch! });
  await drop.connect();
  await drop.query('DROP TABLE public.chain_metadata, "ChiasmRecord", "ChiasmPresence", "Agent", "Feedback", "Validation" CASCADE');
  await drop.end();

  assert.equal((await chainStatus()).rows, null, "chainStatus is unknown when the view is gone");
  assert.equal((await crossChainMerge()).rows, null, "crossChainMerge is unknown when the tables are gone");
  assert.equal((await handlerActivity()).rows, null, "handlerActivity is unknown when the tables are gone");
  assert.equal((await entityCounts()).rows, null, "entityCounts is unknown when the tables are gone");
});


