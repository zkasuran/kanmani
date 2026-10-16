/**
 * A bond's sample can be limited to a scope. The unscoped measurement must stay exactly as it was.
 *
 * Why a scope exists: the default window counts every feedback about an agent from any wallet except its
 * owner (the Reputation Registry refuses the owner with "Self-feedback not allowed"). It does not
 * check where the claimed payment went. So a stranger could publish a false claim about a bonded agent
 * and lower its rate. A scope lets a bond's public terms name the publishing wallets and the address the
 * payments must reach.
 *
 * The store-backed cases need a database holding the indexer and fovea schemas and skip without one:
 * set FOVEA_DATABASE_URL. They seed rows under an agent id nothing else uses and remove them after.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import {
  CLAIM_TRUTH_WINDOW_SQL,
  claimTruthWindow,
  normaliseScope,
  MAX_SCOPE_PUBLISHERS,
  scopedClaimTruthWindowSql,
  ScopeUnavailableError,
} from "./queries.ts";
import { CHAIN_ID } from "./db.ts";

/* ----------------------------------------------------------------- the unscoped query is frozen */

test("the unscoped claim-truth SQL is byte-identical to the one the bonds and the recorded simulation used", () => {
  // Pinned on 2026-10-16 from the text at commit a00f1d2. A change here moves every existing bond's
  // measurement, so it has to be a deliberate act and not a side effect of adding a scope.
  const h = createHash("sha256").update(CLAIM_TRUTH_WINDOW_SQL).digest("hex");
  assert.equal(h, "362908495eea7bc28f1457c927668bb0f752174a1485ad8f2e5f6e99977add1e");
});

/* ------------------------------------------------------------------------- scope normalisation */

test("an empty scope is no scope", () => {
  assert.equal(normaliseScope({}), null);
  assert.equal(normaliseScope({ publishers: [] }), null);
});

test("a scope is lowercased, deduplicated and sorted so two callers get the same rows", () => {
  const a = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
  const b = "0xbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBB";
  const n = normaliseScope({ publishers: [b, a, a.toLowerCase()], recipient: "AGENT" });
  assert.deepEqual(n, { publishers: [a.toLowerCase(), b.toLowerCase()], recipient: "agent" });
});

test("the publisher cap is a named constant", () => {
  assert.equal(MAX_SCOPE_PUBLISHERS, 8);
});

/* ----------------------------------------------------- a deployment without the settlement view */

test("a publishers-only statement never mentions the settlement view", () => {
  // Production does not keep fovea.settlement_check_latest. Postgres refuses to plan a statement that
  // names a missing relation even when the clause is unreachable, which made every scoped request a 500
  // on the first deploy. The view is only named when a recipient scope asks for it.
  assert.equal(scopedClaimTruthWindowSql(false).includes("settlement_check"), false);
  assert.equal(scopedClaimTruthWindowSql(true).includes("fovea.settlement_check_latest"), true);
});

test("a recipient-scope statement binds its sixth parameter and a publishers-only one does not", () => {
  assert.equal(scopedClaimTruthWindowSql(true).includes("$6"), true);
  assert.equal(scopedClaimTruthWindowSql(false).includes("$6"), false);
});

test("ScopeUnavailableError is a named error the route can turn into a 501", () => {
  const e = new ScopeUnavailableError("x");
  assert.equal(e instanceof Error, true);
  assert.equal(e.name, "ScopeUnavailableError");
});

/* ---------------------------------------------------------------- store-backed scope behaviour */

const URL_ = process.env.FOVEA_DATABASE_URL;
const skip = URL_ ? false : "no database configured: set FOVEA_DATABASE_URL";

const AGENT = 999001;
const AID = `${CHAIN_ID}-${AGENT}`;
const OWNER = "0x1000000000000000000000000000000000000001";
const WALLET = "0x1000000000000000000000000000000000000002";
const PUB = "0x2000000000000000000000000000000000000001";
const STRANGER = "0x3000000000000000000000000000000000000001";
const RCP = "0x4000000000000000000000000000000000000001";
const ELSE = "0x5000000000000000000000000000000000000001";

let pool: pg.Pool;

type Seed = { n: number; client: string; outcome: "true" | "false" | "unknown" | "noClaim"; recipient?: string };
const SEEDS: Seed[] = [
  { n: 1, client: PUB, outcome: "true", recipient: RCP },
  { n: 2, client: PUB, outcome: "false", recipient: RCP },
  { n: 3, client: STRANGER, outcome: "false", recipient: ELSE },
  { n: 4, client: PUB, outcome: "true", recipient: ELSE },
  { n: 5, client: PUB, outcome: "unknown" },
  { n: 6, client: STRANGER, outcome: "true", recipient: WALLET },
];

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: URL_ });
  await cleanup();
  await pool.query(
    `INSERT INTO "Agent" (id,"agentId",owner,"agentWallet","tokenUri","uriHash",name,endpoints,"declaresX402","registeredAtBlock","registeredAt","lastSeenBlock",rung,"transferCount","metadataUpdateCount","chainId")
     VALUES ($1,$2,$3,$4,'','','scope-test','[]',0,1,1,1,'declared',0,0,$5)`,
    [AID, AGENT, OWNER, WALLET, CHAIN_ID],
  );
  for (const s of SEEDS) {
    const fid = `${AID}-${s.n}`;
    await pool.query(
      `INSERT INTO "Feedback" (id,agent_id,"clientAddress","feedbackIndex",value,"valueDecimals",tag1,tag2,endpoint,"feedbackUri","feedbackHash",revoked,"blockNumber",timestamp,"txHash","chainId")
       VALUES ($1,$2,$3,$4,1,0,'','','',$5,'0x',0,$6,1,'0x',$7)`,
      [fid, AID, s.client, s.n, `https://example.test/${fid}`, 1000 + s.n, CHAIN_ID],
    );
    await pool.query(
      `INSERT INTO fovea.verdict (feedback_id,feedback_uri,rung,outcome,reason,checked_at) VALUES ($1,$2,'true',$3,'seed',now())`,
      [fid, `https://example.test/${fid}`, s.outcome],
    );
    if (s.recipient) {
      await pool.query(
        `INSERT INTO fovea.settlement_check (subject,subject_kind,tx_hash,recipient,settled,reason,checked_at)
         VALUES ($1,'feedback',$2,$3,$4,'seed',now())`,
        [fid, `0x${String(s.n).padStart(64, "0")}`, s.recipient, s.outcome === "true" ? "true" : "false"],
      );
    }
  }
});

after(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

async function cleanup() {
  await pool.query(`DELETE FROM fovea.settlement_check WHERE subject LIKE $1`, [`${AID}-%`]);
  await pool.query(`DELETE FROM fovea.verdict WHERE feedback_id LIKE $1`, [`${AID}-%`]);
  await pool.query(`DELETE FROM "Feedback" WHERE agent_id = $1`, [AID]);
  await pool.query(`DELETE FROM "Agent" WHERE id = $1`, [AID]);
}

const win = (scope?: Parameters<typeof claimTruthWindow>[3]) => claimTruthWindow(String(AGENT), 0n, 10_000n, scope).then((w) => w.rows);

test("unscoped: every feedback counts and the answer carries no scope keys", { skip }, async () => {
  const w = await win();
  assert.equal(w.sampleSize, 5, "true, false, false, true, true");
  assert.equal(w.trueCount, 3);
  assert.equal(w.falseCount, 2);
  assert.equal(w.unknownCount, 1);
  assert.equal("scope" in w, false);
  assert.equal("excludedByScope" in w, false);
});

test("an empty scope object is the unscoped answer", { skip }, async () => {
  assert.deepEqual(await win({}), await win());
});

test("publishers: a stranger's false claim no longer counts against the agent", { skip }, async () => {
  const w = await win({ publishers: [PUB] });
  assert.equal(w.sampleSize, 3, "n1 true, n2 false, n4 true");
  assert.equal(w.trueCount, 2);
  assert.equal(w.falseCount, 1);
  assert.equal(w.unknownCount, 1);
  assert.equal(w.excludedByScope, 2, "the stranger's two feedbacks");
});

test("publishers match without regard to case", { skip }, async () => {
  const w = await win({ publishers: [PUB.toUpperCase().replace("0X", "0x")] });
  assert.equal(w.sampleSize, 3);
});

test("recipient by address: only claims that name that address count", { skip }, async () => {
  const w = await win({ recipient: RCP });
  assert.equal(w.sampleSize, 2, "n1 and n2");
  assert.equal(w.trueCount, 1);
  assert.equal(w.excludedByScope, 4);
});

test("recipient agent: claims paid to the agent's owner or registered wallet count", { skip }, async () => {
  const w = await win({ recipient: "agent" });
  assert.equal(w.sampleSize, 1, "n6, paid to the registered wallet");
  assert.equal(w.trueCount, 1);
});

test("publishers and recipient together narrow to the intersection", { skip }, async () => {
  const w = await win({ publishers: [PUB], recipient: RCP });
  assert.equal(w.sampleSize, 2);
  assert.equal(w.trueCount, 1);
  assert.equal(w.falseCount, 1);
  assert.equal(w.unknownCount, 0, "n5 names no recipient, so a recipient scope leaves it out");
});

test("a scope that matches nothing is an empty sample with a null rate, never a zero", { skip }, async () => {
  const w = await win({ publishers: ["0x9999999999999999999999999999999999999999"] });
  assert.equal(w.sampleSize, 0);
  assert.equal(w.rateBps, null);
});

test("the block window still bounds a scoped sample", { skip }, async () => {
  const w = await claimTruthWindow(String(AGENT), 1003n, 1004n, { publishers: [PUB, STRANGER] }).then((x) => x.rows);
  assert.equal(w.feedbacks, 2, "blocks 1003 and 1004 only");
});
