/**
 * Internal native payouts: the settled rung must read them, and must say unknown when it cannot.
 *
 * Found by Dissent's reviewer on 2026-10-15. A DissentCore withdrawal is a zero-value call that pays
 * the challenger with an internal CALL, and the rung used to answer `settled: false` ("moved no native
 * token at all") for it. A transaction that ran contract code can pay through calls its own value never
 * shows, so "I could not see a payment" has to be `unknown`, never `false`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveNativeCalls, settledCheck, type CallFrame, type SettlementReader, type SettlementReceipt } from "./settled.ts";

const HASH = `0x${"b".repeat(64)}` as const;
const CORE = "0x9d673a8b5efe76d42593b45972fa0426648967e1";
const CHALLENGER = "0x00cf6cec697e3dcb88a5972ef083b423dfc00a02";
const OTHER = "0x1111111111111111111111111111111111111111";
const WEI = 850_000_000_000_000_000n; // 0.85 MON

const receipt = (): SettlementReceipt => ({ blockNumber: 900n, status: "success", from: CHALLENGER, to: CORE, logs: [] });
const hex = (n: bigint) => `0x${n.toString(16)}`;
const call = (over: Partial<CallFrame>): CallFrame => ({ type: "CALL", from: CORE, to: CHALLENGER, value: hex(WEI), ...over });
const root = (calls: CallFrame[]): CallFrame => ({ type: "CALL", from: CHALLENGER, to: CORE, value: "0x0", calls });

function reader(over: Partial<SettlementReader> = {}): SettlementReader {
  return {
    getBlockNumber: async () => 1000n,
    getReceipt: async () => receipt(),
    // A zero-value call into a contract: the shape of a Dissent withdrawal.
    getNativeTransfer: async () => ({ to: CORE, value: 0n, hasInput: true }),
    ...over,
  };
}
const claim = (over: Record<string, unknown> = {}) => ({ txHash: HASH, network: "monad", recipient: CHALLENGER, asset: "native", amount: String(WEI), ...over });

test("an internal CALL that paid the recipient settles, with the amount compared", async () => {
  const r = await settledCheck(claim(), () => reader({ getInternalNativeTransfers: async () => effectiveNativeCalls(root([call({})])) }));
  assert.equal(r.settled, true);
  if (r.settled !== true) return;
  assert.equal(r.transfer.value, WEI);
  assert.equal(r.transfer.from, CORE);
  assert.equal(r.amountCompared, true);
});

test("no trace means unknown, never false", async () => {
  for (const internal of [undefined, async () => null]) {
    const r = await settledCheck(claim(), () => reader(internal ? { getInternalNativeTransfers: internal } : {}));
    assert.equal(r.settled, "unknown", String(internal));
    if (r.settled === "unknown") assert.match(r.reason, /could not read its internal native transfers/);
  }
});

test("a trace call that throws is a gap, so unknown", async () => {
  const r = await settledCheck(claim(), () => reader({ getInternalNativeTransfers: async () => { throw new Error("trace timeout"); } }));
  assert.equal(r.settled, "unknown");
});

test("a visible trace that shows no payment to the recipient is a real false", async () => {
  const r = await settledCheck(claim(), () => reader({ getInternalNativeTransfers: async () => effectiveNativeCalls(root([call({ to: OTHER })])) }));
  assert.equal(r.settled, false);
});

test("a plain transaction with no calldata still answers false without needing a trace", async () => {
  const r = await settledCheck(claim(), () => reader({ getNativeTransfer: async () => ({ to: OTHER, value: 5n, hasInput: false }) }));
  assert.equal(r.settled, false);
});

test("a stated amount that differs from the traced one is false, not unknown", async () => {
  const r = await settledCheck(claim({ amount: String(WEI + 1n) }), () => reader({ getInternalNativeTransfers: async () => effectiveNativeCalls(root([call({})])) }));
  assert.equal(r.settled, false);
});

test("a payout inside a failed call is not a payment: the whole subtree reverted", () => {
  const failed: CallFrame = { type: "CALL", from: CORE, to: OTHER, value: "0x0", error: "execution reverted", calls: [call({})] };
  assert.deepEqual(effectiveNativeCalls(root([failed])), []);
});

test("a frame carrying a value without moving it does not count", () => {
  assert.deepEqual(effectiveNativeCalls(root([call({ type: "DELEGATECALL" }), call({ type: "STATICCALL" })])), []);
});

test("the top-level frame is skipped because the transaction's own value is read separately", () => {
  assert.deepEqual(effectiveNativeCalls({ type: "CALL", from: OTHER, to: CHALLENGER, value: hex(WEI) }), []);
});

test("zero-value and malformed internal calls are ignored", () => {
  assert.deepEqual(effectiveNativeCalls(root([call({ value: "0x0" }), call({ value: "not hex" }), call({ value: undefined })])), []);
});

test("nested payouts under a successful parent are found", () => {
  const nested = root([{ type: "CALL", from: CORE, to: OTHER, value: "0x0", calls: [call({ from: OTHER })] }]);
  const got = effectiveNativeCalls(nested);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.to, CHALLENGER);
});

// Alnitak's two withdrawals, read from mainnet. Skipped unless a Monad RPC with debug_traceTransaction is set.
const LIVE = process.env.RPC_MONAD ? test : test.skip;
for (const [name, hash, amount] of [
  ["D-001, 3.10 MON", "0xf2378b1d2b3bb6420c0894c6d760576c35adb393bc71d0fce69852a4ddf8e336", "3100000000000000000"],
  ["Aqueous case, 0.85 MON", "0x76525e54404a680d50e1ecdf7f3e0c4836684eb5831c98da7fcdcda92b42be53", "850000000000000000"],
] as const) {
  LIVE(`live: the Dissent withdrawal ${name} settles through the real reader`, async () => {
    const { settlementReaderFor } = await import("../rpc.ts");
    const r = await settledCheck(claim({ txHash: hash, amount }), settlementReaderFor);
    assert.equal(r.settled, true, JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? String(v) : v)));
  });
}
