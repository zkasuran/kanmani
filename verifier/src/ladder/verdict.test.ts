import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { judge } from "./verdict.ts";
import type { ChainReader } from "./locate.ts";
import { TRANSFER_TOPIC, type SettlementReader } from "./settled.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const HASH = `0x${"a".repeat(64)}`;
const now = () => new Date("2026-09-19T12:00:00.000Z");

const claimDoc = (tx = HASH, network = "monad") =>
  enc(JSON.stringify({ network, proof_of_payment: { network, payment_tx: tx } }));

const okFetch = (bytes: Uint8Array) =>
  ({ ok: true as const, bytes, finalUrl: "https://x/doc", status: 200 });

const reader = (over: Partial<ChainReader> = {}): ChainReader => ({
  getBlockNumber: async () => 1000n,
  getTransactionReceipt: async () => null,
  ...over,
});

const found = () =>
  reader({
    getTransactionReceipt: async () => ({
      blockNumber: 900n,
      status: "success" as const,
      from: "0xa",
      to: "0xb",
    }),
  });

/* -------------------------------------------------------------- the four outcomes */

test("a cited payment that exists is true and names where it was found", async () => {
  const bytes = claimDoc();
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () => found(),
    now,
  });
  assert.equal(v.outcome, "true");
  assert.equal(v.rung, "true");
  assert.equal(v.foundOnChain?.chainId, 143);
  assert.equal(v.foundOnChain?.blockNumber, "900");
  assert.equal(v.checkedAtBlock, "1000");
  assert.equal(v.hashMatches, true);
});

test("a cited payment that is genuinely absent is false, with the block checked", async () => {
  const bytes = claimDoc();
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () => reader(),
    now,
  });
  assert.equal(v.outcome, "false");
  assert.equal(v.checkedAtBlock, "1000", "a verdict is a measurement at a time");
  assert.equal(v.declaredNetwork, "monad");
  assert.equal(v.declaredTx, HASH);
});

test("a document asserting no payment is noClaim, not false", async () => {
  const bytes = enc(JSON.stringify({ elo: 1500, game: "chess", peak_elo: 1, record: "", signal_type: "s" }));
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () => found(),
    now,
  });
  assert.equal(v.outcome, "noClaim");
  assert.equal(v.rung, "parsed");
  assert.match(v.reason, /no payment claim to check/);
});

test("a provider failure is unknown and never reaches an outcome about the claim", async () => {
  const bytes = claimDoc();
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () =>
      reader({
        getTransactionReceipt: async () => {
          throw new Error("503 upstream");
        },
      }),
    now,
  });
  assert.equal(v.outcome, "unknown");
  assert.notEqual(v.outcome, "false");
});

/* --------------------------------------------- a rung never exceeds its evidence */

test("an unreadable document stops at declared and judges nothing further", async () => {
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: HASH,
    fetched: { ok: false, reason: "timed out after 8000ms" },
    readerFor: () => found(),
    now,
  });
  assert.equal(v.rung, "declared");
  assert.equal(v.outcome, "unknown");
  assert.equal(v.hashMatches, undefined, "no opinion on a hash we never computed");
  assert.equal(v.declaredTx, undefined, "no opinion on a claim we never read");
});

test("BYTES THAT NO LONGER MATCH THE COMMITMENT STOP THE LADDER", async () => {
  // The grokandmon case, measured on the live corpus: one URL committed at several different times
  // with a different hash each time, serving one thing today. Parsing on would attribute a claim to
  // an author who committed to different bytes, so the ladder stops and says exactly that.
  const bytes = claimDoc();
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(enc("what was committed earlier")),
    fetched: okFetch(bytes),
    readerFor: () => found(),
    now,
  });
  assert.equal(v.rung, "resolvable");
  assert.equal(v.outcome, "unknown");
  assert.equal(v.hashMatches, false);
  assert.equal(v.declaredTx, undefined, "never read a claim out of uncommitted bytes");
  assert.match(v.reason, /do not match the hash committed on chain/);
});

test("an unmapped shape is unknown and says the gap is ours", async () => {
  const bytes = enc(JSON.stringify({ some: "novel", shape: true }));
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () => found(),
    now,
  });
  assert.equal(v.rung, "intact");
  assert.equal(v.outcome, "unknown");
  assert.match(v.reason, /no published mapping reads this document shape/);
  assert.equal(v.hashMatches, true, "it WAS intact, that much is established");
});

/* ------------------------------------------------------------------ the wording */

test("no verdict reason states intent about a person", async () => {
  const cases = [
    { bytes: claimDoc(), hash: keccak256(claimDoc()), readerFor: () => reader() },
    { bytes: claimDoc(), hash: keccak256(enc("other")), readerFor: () => found() },
    { bytes: enc("{bad"), hash: keccak256(enc("{bad")), readerFor: () => found() },
  ];
  const banned = /\b(lying|lied|fraud|fake|scam|dishonest|malicious)\b/i;
  for (const c of cases) {
    const v = await judge({
      feedbackUri: "https://x/doc",
      feedbackHash: c.hash,
      fetched: okFetch(c.bytes),
      readerFor: c.readerFor,
      now,
    });
    assert.doesNotMatch(v.reason, banned, `reason states intent: ${v.reason}`);
    assert.ok(v.reason.length > 10, "a reason has to actually say something");
  }
});

test("every verdict carries when it was checked", async () => {
  const bytes = claimDoc();
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () => found(),
    now,
  });
  assert.equal(v.checkedAt, "2026-09-19T12:00:00.000Z");
});

/* --------------------------- a reverted transaction is never a settled payment (fallback path) */

test("a cited transaction that reverted is false, not true", async () => {
  const bytes = claimDoc();
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () =>
      reader({
        getTransactionReceipt: async () => ({
          blockNumber: 900n,
          status: "reverted" as const,
          from: "0xa",
          to: "0xb",
        }),
      }),
    now,
  });
  assert.equal(v.outcome, "false", "a revert moved nothing, so it cannot be true");
  assert.notEqual(v.outcome, "true");
  assert.match(v.reason, /reverted/);
});

/* --------------------------- the true rung matches the recipient when a settlement reader is given */

const RECIPIENT = `0x${"11".repeat(20)}`;
const OTHER = `0x${"33".repeat(20)}`;
const TOKEN = `0x${"ab".repeat(20)}`;
const topicAddr = (a: string) => `0x${"0".repeat(24)}${a.slice(2)}`;
const transferLog = (to: string, value: bigint) => ({
  address: TOKEN,
  topics: [TRANSFER_TOPIC, topicAddr(`0x${"22".repeat(20)}`), topicAddr(to)],
  data: `0x${value.toString(16).padStart(64, "0")}`,
});
const claimWithRecipient = (to: string = RECIPIENT) =>
  new TextEncoder().encode(
    JSON.stringify({
      network: "monad",
      proof_of_payment: { network: "monad", payment_tx: HASH },
      rating: { target_address: to },
    }),
  );
const settleReader = (over: Partial<SettlementReader> = {}): SettlementReader => ({
  getBlockNumber: async () => 1000n,
  getReceipt: async () => ({
    blockNumber: 900n,
    status: "success" as const,
    from: `0x${"22".repeat(20)}`,
    to: TOKEN,
    logs: [transferLog(RECIPIENT, 1000n)],
  }),
  getNativeTransfer: async () => null,
  ...over,
});

test("true only when the value actually reached the claimed recipient", async () => {
  const bytes = claimWithRecipient(RECIPIENT);
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () => found(),
    settlementReaderFor: () => settleReader(),
    now,
  });
  assert.equal(v.outcome, "true");
  assert.equal(v.rung, "true");
  assert.equal(v.foundOnChain?.chainId, 143);
});

test("a real transaction paying a DIFFERENT address is false, not true", async () => {
  // The exact overclaim the audit proved: a cited transaction that exists and succeeds but pays
  // someone else must not read as true. This test fails against the existence-only rung.
  const bytes = claimWithRecipient(RECIPIENT);
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () => found(),
    settlementReaderFor: () => settleReader({ getReceipt: async () => ({
      blockNumber: 900n,
      status: "success" as const,
      from: `0x${"22".repeat(20)}`,
      to: TOKEN,
      logs: [transferLog(OTHER, 1000n)],
    }) }),
    now,
  });
  assert.equal(v.outcome, "false");
  assert.match(v.reason, /none of them to/);
});

test("a reverted transaction with a recipient claim is false through the settled rung too", async () => {
  const bytes = claimWithRecipient(RECIPIENT);
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () => found(),
    settlementReaderFor: () => settleReader({ getReceipt: async () => ({
      blockNumber: 900n,
      status: "reverted" as const,
      from: `0x${"22".repeat(20)}`,
      to: TOKEN,
      logs: [],
    }) }),
    now,
  });
  assert.equal(v.outcome, "false");
  assert.match(v.reason, /reverted/);
});

test("a provider failure in the settled rung is unknown, never a false accusation", async () => {
  const bytes = claimWithRecipient(RECIPIENT);
  const v = await judge({
    feedbackUri: "https://x/doc",
    feedbackHash: keccak256(bytes),
    fetched: okFetch(bytes),
    readerFor: () => found(),
    settlementReaderFor: () => settleReader({ getReceipt: async () => { throw new Error("503 upstream"); } }),
    now,
  });
  assert.equal(v.outcome, "unknown");
  assert.notEqual(v.outcome, "false");
});
