import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { induceMapping } from "./induce.ts";
import { compileMapping } from "./compile.ts";
import { shapeKey, toProposalRow, ProposalStore } from "./propose.ts";
import { ATLAS, parseDocument } from "../ladder/parse.ts";
import { connectionStringFrom } from "../store/store.ts";
import type { ChatClient, ChatRequest, ChatResponse, MappingProposal } from "./model.ts";

/** A scripted model: returns its proposals in order, repeating the last, no key and no network. */
class ScriptedModel implements ChatClient {
  readonly label: string;
  readonly calls: ChatRequest[] = [];
  private readonly script: MappingProposal[];
  constructor(script: MappingProposal[], label = "scripted-fake") {
    this.script = script;
    this.label = label;
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req);
    const idx = Math.min(this.calls.length - 1, this.script.length - 1);
    const proposal = this.script[idx]!;
    return {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: `call_${idx}`, type: "function", function: { name: "try_mapping", arguments: JSON.stringify(proposal) } }],
      },
    };
  }
}

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

// The live idx-3 tab-settlement feedback from agent 10255 (spec 19 appendix), the real unmapped shape.
const TX = "0x863e9ae50961b38e7bf12e7ae14e7384bc543725ea51c8acdd9dc8bf9f817497";
const ASSET = "0x754704bc059f8c67012fed69bc8a327a5aafb603";
const COLLECTION = "0x49472EF9ED99f30d4eaD45Ac9E1C16c31f70783A";
const AGENT = "0x3a3b60790000000000000000000000000000e7ce";
const TAB_DOC = {
  type: "tab-settlement-feedback",
  version: 1,
  chainId: 143,
  value: 100,
  valueDecimals: 0,
  tag1: "tab",
  tag2: "settled",
  meaning: "The Agent paid this Service: one entry per Settlement applied on chain",
  settlement: {
    settlementId: "0x0e85f01d3f69ae94d2c7223792ce152637482fe6959736899368a4854bd5a2cc",
    agent: AGENT,
    serviceId: "0x7461622e64656d6f",
    asset: ASSET,
    amount: "200000",
    applied: "200000",
    toPrepaid: "0",
    collection: COLLECTION,
    settledAt: "2026-09-30T17:19:26.000Z",
    txHash: TX,
    blockNumber: 109379821,
    logIndex: 251,
  },
};
const TAB_BYTES = enc(TAB_DOC);

// The mapping Qwen is expected to induce for this shape: match on type + the settlement tx hash, read
// the money fields out of the settlement object, not the top-level `value: 100` trap.
const TAB_PROPOSAL: MappingProposal = {
  name: "tab-settlement-feedback.v1",
  note: "tab settlement receipt: payment fields live under settlement, not the top-level value",
  matchKeys: ["type", "settlement.txHash"],
  claim: {
    networkPath: "chainId",
    txHashPath: "settlement.txHash",
    recipientPath: "settlement.collection",
    payerPath: "settlement.agent",
    amountPath: "settlement.amount",
    tokenPath: "settlement.asset",
  },
  predicted: { network: 143, txHash: TX },
};

const FEEDBACK_IDS = [1, 2, 3].map((i) => `143_10255_${COLLECTION}_${i}`);
const at = () => new Date("2026-10-01T00:00:00Z");

/* --------------------------------------------------------------------------- pure, no DB */

test("shapeKey is the sorted top-level keys, so N claims of one shape collapse to one key", () => {
  assert.equal(shapeKey({ b: 1, a: 2 }), "a,b");
  assert.equal(shapeKey(TAB_DOC), "chainId,meaning,settlement,tag1,tag2,type,value,valueDecimals,version");
  // Two documents of the same shape, different values, share a key.
  assert.equal(shapeKey({ ...TAB_DOC, value: 7 }), shapeKey(TAB_DOC));
});

test("a converged run becomes a pending row that round-trips and carries its covered claims", async () => {
  const r = await induceMapping({ client: new ScriptedModel([TAB_PROPOSAL]), document: TAB_BYTES, now: at });
  assert.equal(r.converged, true);
  const row = toProposalRow({
    shapeKey: shapeKey(TAB_DOC),
    feedbackIds: FEEDBACK_IDS,
    exampleUri: "https://gateway-mainnet-production.up.railway.app/reputation/0x0e85f01d",
    model: "qwen3.8-max",
    result: r,
  });
  assert.equal(row.status, "pending");
  assert.equal(row.converged, true);
  assert.equal(row.roundTripOk, true);
  assert.equal(row.giveUpReason, null);
  assert.equal(row.proposal?.name, "tab-settlement-feedback.v1");
  assert.equal(row.model, "qwen3.8-max");
  assert.deepEqual(row.feedbackIds, FEEDBACK_IDS);
  assert.ok(row.transcript.length > 0, "the agentic transcript is carried");
});

test("a non-converged run is still written, with round_trip_ok false and a give-up reason", async () => {
  // Matches the shape but reads the hash from the wrong key, so the parser extracts the timestamp,
  // not the predicted hash. The round-trip guard rejects it and the loop gives up in one turn.
  const bad: MappingProposal = {
    ...TAB_PROPOSAL,
    name: "tab-settlement-feedback.bad",
    claim: { ...TAB_PROPOSAL.claim!, txHashPath: "settlement.settledAt" },
  };
  const r = await induceMapping({ client: new ScriptedModel([bad]), document: TAB_BYTES, maxTurns: 1, now: at });
  assert.equal(r.converged, false);
  const row = toProposalRow({ shapeKey: shapeKey(TAB_DOC), feedbackIds: FEEDBACK_IDS, exampleUri: "u", model: "qwen3.8-max", result: r });
  assert.equal(row.converged, false);
  assert.equal(row.roundTripOk, false);
  assert.equal(row.proposal, null);
  assert.ok(row.giveUpReason && row.giveUpReason.length > 0, "the gap stays an honest number with a reason");
});

test("the verdict pipeline imports nothing from the proposer or the review queue (never auto-applied)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const parse = readFileSync(join(here, "../ladder/parse.ts"), "utf8");
  const verdict = readFileSync(join(here, "../ladder/verdict.ts"), "utf8");
  for (const [name, src] of [["parse.ts", parse], ["verdict.ts", verdict]] as const) {
    assert.ok(!/mapping_proposal/.test(src), `${name} must not reference mapping_proposal`);
    assert.ok(!/from ["'].*propose\.ts["']/.test(src), `${name} must not import the proposer`);
  }
  // The shipped atlas is exactly five mappings; a proposal row cannot change that count.
  assert.equal(ATLAS.length, 5);
});

test("the only way a proposal moves a verdict is adding its mapping to ATLAS in code", () => {
  // Today the shape is unmapped: the hand atlas returns unparsed, which the ladder turns into
  // unknown/intact (the noMappingReadTheShape count).
  const before = parseDocument(TAB_BYTES, ATLAS);
  assert.equal(before.kind, "unparsed");

  // Promotion is a code diff. Add the mapping to the atlas and the same document resolves to a real
  // claim with the money fields read out of the settlement object, never the top-level value trap.
  const compiled = compileMapping(TAB_PROPOSAL, "2026-10-01");
  const after = parseDocument(TAB_BYTES, [...ATLAS, compiled]);
  assert.equal(after.kind, "claim");
  if (after.kind === "claim") {
    assert.equal(after.mapping, "tab-settlement-feedback.v1");
    assert.equal(after.claim.txHash, TX);
    assert.equal(after.claim.network, 143);
    assert.equal(after.claim.recipient, COLLECTION);
    assert.equal(after.claim.payer, AGENT);
    // The trap: top-level value is 100, the real amount is the settlement amount.
    assert.equal(after.claim.amount, "200000");
    assert.notEqual(after.claim.amount, 100);
  }
});

/* ------------------------------------------------------- DB-gated, throwaway database only
 *
 * These write to a dedicated database created and dropped here, never a shared one, the same safety
 * posture as verifier/src/store/store.test.ts. Skipped loudly when no database is configured.
 */
const TEST_DB = "fovea_proposal_test";
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
function assertNotShared(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name !== TEST_DB) throw new Error(`refusing to run destructive tests against "${name}", only ${TEST_DB}`);
}

let conn: string | null = null;
let store: ProposalStore;
let raw: pg.Client;

before(async () => {
  if (!adminConn) return;
  const admin = new pg.Client({ connectionString: withDatabase(adminConn, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  conn = withDatabase(adminConn, TEST_DB);
  assertNotShared(conn);
  store = await ProposalStore.open(conn);
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

async function convergedRow() {
  const r = await induceMapping({ client: new ScriptedModel([TAB_PROPOSAL], "qwen3.8-max"), document: TAB_BYTES, now: at });
  return toProposalRow({
    shapeKey: shapeKey(TAB_DOC),
    feedbackIds: FEEDBACK_IDS,
    exampleUri: "https://gateway-mainnet-production.up.railway.app/reputation/0x0e85f01d",
    model: "qwen3.8-max",
    result: r,
  });
}

test("records a converged proposal covering the three tab claims, as qwen3.8-max", { skip: adminConn ? false : reason }, async () => {
  await store.record(await convergedRow());
  const rows = await store.latest();
  const tab = rows.find((x) => x.shapeKey === shapeKey(TAB_DOC));
  assert.ok(tab, "the tab-shape proposal is in the queue");
  assert.equal(tab!.model, "qwen3.8-max");
  assert.equal(tab!.converged, true);
  assert.equal(tab!.roundTripOk, true);
  assert.equal(tab!.status, "pending");
  for (const id of FEEDBACK_IDS) assert.ok(tab!.feedbackIds.includes(id), `covers ${id}`);
  assert.equal(tab!.proposal?.name, "tab-settlement-feedback.v1");
});

test("a non-converged proposal is stored with round_trip_ok false and never marked accepted on its own", { skip: adminConn ? false : reason }, async () => {
  const bad: MappingProposal = { ...TAB_PROPOSAL, name: "wrong.v1", claim: { ...TAB_PROPOSAL.claim!, txHashPath: "settlement.settledAt" } };
  const r = await induceMapping({ client: new ScriptedModel([bad], "qwen3.8-max"), document: TAB_BYTES, maxTurns: 1, now: at });
  const row = { ...toProposalRow({ shapeKey: "nonconverged,shape", feedbackIds: ["143_9_0xabc_1"], exampleUri: "u", model: "qwen3.8-max", result: r }) };
  await store.record(row);
  const stored = (await store.latest()).find((x) => x.shapeKey === "nonconverged,shape");
  assert.ok(stored);
  assert.equal(stored!.converged, false);
  assert.equal(stored!.roundTripOk, false);
  assert.equal(stored!.proposal, null);
  assert.equal(stored!.status, "pending");
  assert.ok(stored!.giveUpReason && stored!.giveUpReason.length > 0);
});

test("even a hand-forced accepted row changes no verdict: the parser still returns unparsed", { skip: adminConn ? false : reason }, async () => {
  // Insert a fully-formed accepted proposal for the tab shape, the worst case for the invariant.
  await store.record({ ...(await convergedRow()), status: "accepted" });
  const tab = (await store.latest()).find((x) => x.shapeKey === shapeKey(TAB_DOC));
  assert.equal(tab!.status, "accepted", "the accepted write landed, so the no-effect below is real");

  // The verdict pipeline reads only ATLAS. An accepted queue row is invisible to it: the document is
  // still unparsed, which the ladder renders as unknown/intact. Only a code diff to ATLAS moves it.
  assert.equal(parseDocument(TAB_BYTES, ATLAS).kind, "unparsed");
});

test("the status column refuses a value the queue cannot produce", { skip: adminConn ? false : reason }, async () => {
  const bogus = { ...(await convergedRow()), shapeKey: "bogus,status,shape", status: "live" as never };
  await assert.rejects(() => store.record(bogus), /violates check constraint/);
});




