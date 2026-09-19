import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATLAS,
  agentCard,
  executionMarket,
  executionMarketTransactions,
  parseDocument,
  type Mapping,
} from "./parse.ts";

const doc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

/* ------------------------------------------------- the shapes that claim a payment */

test("execution.market proof_of_payment yields the cited hash", () => {
  const r = parseDocument(
    doc({
      network: "monad",
      proof_of_payment: { network: "monad", payment_tx: `0x${"a".repeat(64)}`, status: "anchored" },
      rating: { target_address: "0xbeef", score: 70 },
    }),
  );
  assert.equal(r.kind, "claim");
  if (r.kind === "claim") {
    assert.equal(r.mapping, "execution-market.v1");
    assert.equal(r.claim.txHash, `0x${"a".repeat(64)}`);
    assert.equal(r.claim.recipient, "0xbeef");
  }
});

test("the network attached to the PAYMENT wins over the document's own", () => {
  // A document is free to be about one chain while citing a transaction on another. Preferring the
  // outer field would quietly rewrite what the author said and the rewritten version is the one we
  // would then go and check.
  const r = parseDocument(
    doc({
      network: "monad",
      proof_of_payment: { network: "arbitrum", payment_tx: `0x${"b".repeat(64)}` },
    }),
  );
  assert.equal(r.kind, "claim");
  if (r.kind === "claim") assert.equal(r.claim.network, "arbitrum");
});

test("the older transactions.payment_tx shape is read too", () => {
  const r = parseDocument(
    doc({
      network: "monad",
      type: "execution_market_feedback",
      version: "1.0",
      transactions: { payment_tx: `0x${"c".repeat(64)}`, reputation_tx: "" },
      task: { bounty_usd: 0.1 },
    }),
  );
  assert.equal(r.kind, "claim");
  if (r.kind === "claim") {
    assert.equal(r.mapping, "execution-market-transactions.v1");
    assert.equal(r.claim.txHash, `0x${"c".repeat(64)}`);
  }
});

test("an empty payment_tx stays a claim, so locate decides rather than the parser", () => {
  // Deciding here that an empty hash means "asserted nothing" would hide a malformed claim inside
  // the noClaim bucket, where nobody counts it.
  const r = parseDocument(doc({ network: "monad", transactions: { payment_tx: "" } }));
  assert.equal(r.kind, "claim");
  if (r.kind === "claim") assert.equal(r.claim.txHash, "");
});

/* ------------------------------------------------- the shapes that claim nothing */

test("documents that assert no payment are noClaim, which is not a coverage gap", () => {
  const elo = parseDocument(doc({ elo: 1500, game: "chess", peak_elo: 1600, record: "", signal_type: "x" }));
  assert.equal(elo.kind, "noClaim");

  const convo = parseDocument(
    doc({ score: 100, conversation_success: true, responseTime: 25191, conversationLogId: "x" }),
  );
  assert.equal(convo.kind, "noClaim");

  const card = parseDocument(doc({ protocolVersion: "0.3.0", name: "agent", skills: [], url: "https://x" }));
  assert.equal(card.kind, "noClaim");
});

/* ------------------------------------------------- gaps are reported, never hidden */

test("an unrecognised shape is unparsed AND hands back its keys", () => {
  const r = parseDocument(doc({ some: 1, novel: 2, shape: 3 }));
  assert.equal(r.kind, "unparsed");
  if (r.kind === "unparsed") {
    assert.match(r.reason, /no mapping matches/);
    assert.deepEqual(r.keys, ["novel", "shape", "some"], "keys come back so the shape can be added");
  }
});

test("two mappings matching one document is refused rather than resolved by array order", () => {
  // An ambiguous atlas would make the verdict depend on declaration order, which is invisible to a
  // reader and changes silently when someone appends a mapping.
  const greedyA: Mapping = {
    name: "a", induced: "x", note: "", matches: () => true,
    extract: () => ({ kind: "noClaim", mapping: "a", note: "" }),
  };
  const greedyB: Mapping = { ...greedyA, name: "b" };
  const r = parseDocument(doc({ anything: 1 }), [greedyA, greedyB]);
  assert.equal(r.kind, "unparsed");
  if (r.kind === "unparsed") assert.match(r.reason, /ambiguous, a and b both match/);
});

test("malformed input is unparsed with the reason, never a silent empty claim", () => {
  assert.equal(parseDocument(new TextEncoder().encode("{not json")).kind, "unparsed");
  assert.equal(parseDocument(new Uint8Array([0xff, 0xfe, 0xfd])).kind, "unparsed");

  const arr = parseDocument(doc([1, 2, 3]));
  assert.equal(arr.kind, "unparsed");
  if (arr.kind === "unparsed") assert.match(arr.reason, /top level is an array/);

  const str = parseDocument(doc("hello"));
  assert.equal(str.kind, "unparsed");
});

/* ------------------------------------------------- the atlas itself */

test("no two shipped mappings claim the same real document", () => {
  // The live corpus in miniature. If any of these matched two mappings the sweep numbers would
  // depend on order, so this is checked rather than assumed.
  const realShapes = [
    { network: "monad", proof_of_payment: { payment_tx: "0x1" }, rating: {} },
    { network: "monad", transactions: { payment_tx: "0x2" }, type: "execution_market_feedback" },
    { elo: 1, game: "g", peak_elo: 2, record: "", signal_type: "s" },
    { score: 1, conversation_success: true, responseTime: 1, conversationLogId: "c" },
    { protocolVersion: "0.3.0", capabilities: {}, skills: [], name: "n" },
  ];
  for (const s of realShapes) {
    const hits = ATLAS.filter((m) => m.matches(s as Record<string, unknown>));
    assert.equal(hits.length, 1, `${JSON.stringify(s).slice(0, 50)} matched ${hits.length} mappings`);
  }
});

test("every mapping carries the date it was induced, because a mapping can move a verdict", () => {
  for (const m of ATLAS) {
    assert.match(m.induced, /^\d{4}-\d{2}-\d{2}$/, `${m.name} needs an induced date`);
    assert.ok(m.note.length > 0, `${m.name} needs a note`);
  }
});

test("a payment-bearing shape is not swallowed by the agent-card matcher", () => {
  // agentCard matches loosely on capability-ish keys, so prove a real claim still lands on the
  // right mapping even when it carries a name or a url.
  const r = parseDocument(
    doc({ name: "thing", url: "https://x", proof_of_payment: { payment_tx: "0xabc" } }),
  );
  assert.equal(r.kind, "claim");
  if (r.kind === "claim") assert.equal(r.mapping, executionMarket.name);
  assert.ok(executionMarketTransactions.name !== agentCard.name);
});
