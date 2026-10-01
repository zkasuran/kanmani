import assert from "node:assert/strict";
import test from "node:test";
import { firstFunder, funderSummary, summarizeCounterparties } from "./nansen.ts";

const ok = (data: unknown[]) => ({ ok: true as const, data: { data } as never, authMode: "apikey" as const, httpStatus: 200, paid: false });

test("the first First Funder relation is taken, lowercased, with its tx", () => {
  const f = firstFunder(ok([
    { address: "0xAAAA000000000000000000000000000000000002", relation: "First Funder", transaction_hash: "0x2", block_timestamp: "t2", order: 2, chain: "monad" },
    { address: "0xAAAA000000000000000000000000000000000001", address_label: "Binance 14", relation: "First Funder", transaction_hash: "0x1", block_timestamp: "t1", order: 1, chain: "monad" },
  ]));
  assert.deepEqual(f, { status: "found", funder: "0xaaaa000000000000000000000000000000000001", funderLabel: "Binance 14", tx: "0x1", fundedAt: "t1" });
});

test("no funder relation is none, a failed call is unknown, never a guess", () => {
  assert.equal(firstFunder(ok([{ address: "0xAAAA000000000000000000000000000000000001", relation: "Deployed Via", transaction_hash: "0x", block_timestamp: "", order: 1, chain: "monad" }])).status, "none");
  assert.equal(firstFunder(ok([])).status, "none");
  assert.equal(firstFunder({ ok: false, reason: "HTTP 403", authMode: "apikey", httpStatus: 403 }).status, "unknown");
  assert.equal(firstFunder(ok([{ address: "not-an-address", relation: "First Funder", transaction_hash: "0x", block_timestamp: "", order: 1, chain: "monad" }])).status, "none");
});

/* ------------------------------------------------------------------ funderSummary (display) */

const row = (over: Partial<Parameters<typeof funderSummary>[0] & object> = {}) => ({
  sampled: 62,
  found: 62,
  distinctFunders: 2,
  topFunder: "0x97cd97cfe21799bacbf39d0a53469e5f82f30996",
  topFunderLabel: null,
  topFunderWallets: 60,
  exampleTx: "0xabc",
  ...over,
});

test("a sampled row carries topFunderWallets of found and keeps the funder and the tx", () => {
  const s = funderSummary(row({ distinctFunders: 1 }));
  assert.equal(s.status, "sampled");
  if (s.status !== "sampled") return;
  assert.equal(s.topFunderWallets, 60);
  assert.equal(s.found, 62);
  assert.equal(s.topFunder, "0x97cd97cfe21799bacbf39d0a53469e5f82f30996");
  assert.equal(s.exampleTx, "0xabc");
  assert.match(s.sentence, /60 of 62 sampled wallets share one first funder\./);
});

test("more than one funder appends the distinct-funder clause", () => {
  const s = funderSummary(row({ distinctFunders: 2 }));
  assert.equal(s.status, "sampled");
  assert.match(s.sentence, /2 distinct funders across the sample\.$/);
});

test("null, found:0 and a null top funder are all unsampled, never a 0", () => {
  for (const r of [null, row({ found: 0 }), row({ topFunder: null })]) {
    const s = funderSummary(r);
    assert.equal(s.status, "unsampled");
    assert.doesNotMatch(s.sentence, /\b0\b/, "an unsampled cluster never says 0 of 0");
    assert.match(s.sentence, /No wallet in this cluster has been sampled/);
  }
});

/* ------------------------------------------------------------------ summarizeCounterparties (deferred) */

test("the top counterparty is the one with the most interactions, lowercased, with its label", () => {
  const s = summarizeCounterparties(
    ok([
      { counterparty_address: "0xBBBB000000000000000000000000000000000002", interaction_count: 3 },
      { counterparty_address: "0xAAAA000000000000000000000000000000000001", counterparty_address_label: "Binance", interaction_count: 9, total_volume_usd: 1234 },
    ]) as never,
  );
  assert.equal(s.status, "found");
  if (s.status !== "found") return;
  assert.equal(s.topCounterparty, "0xaaaa000000000000000000000000000000000001");
  assert.equal(s.topCounterpartyLabel, "Binance");
  assert.equal(s.distinctCounterparties, 2);
  assert.equal(s.topVolumeUsd, 1234);
});

test("an empty answer is none and a failed call is unknown, never an invented entity", () => {
  assert.equal(summarizeCounterparties(ok([]) as never).status, "none");
  assert.equal(summarizeCounterparties(ok([{ counterparty_address: "nope", interaction_count: 1 }]) as never).status, "none");
  assert.equal(
    summarizeCounterparties({ ok: false, reason: "HTTP 403", authMode: "apikey", httpStatus: 403 } as never).status,
    "unknown",
  );
});
