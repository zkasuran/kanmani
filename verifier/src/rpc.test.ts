import test from "node:test";
import assert from "node:assert/strict";

import { readerWithFallback, settlementReaderWithFallback } from "./rpc.ts";
import type { ChainReader, Receiptish } from "./ladder/locate.ts";
import type { SettlementReader } from "./ladder/settled.ts";

/**
 * The Monad fallback reader, exercised with injected readers so no network is touched. The four
 * properties that make it correct: the primary stays primary on success, a clean null is never a
 * fallback, a thrown primary error does fall back, and a fallback on the wrong chain disables itself.
 */

const HASH = `0x${"a".repeat(64)}` as const;

function receiptReader(behaviour: () => Promise<Receiptish | null>): { reader: ChainReader; calls: () => number } {
  let n = 0;
  const reader: ChainReader = {
    async getBlockNumber() {
      return 1n;
    },
    async getTransactionReceipt() {
      n += 1;
      return behaviour();
    },
  };
  return { reader, calls: () => n };
}

test("a primary that returns a receipt keeps primary, and the fallback is never read", async () => {
  const primary = receiptReader(async () => ({ blockNumber: 10n, status: "success", from: "0xaa", to: "0xbb" }));
  const fallback = receiptReader(async () => ({ blockNumber: 99n, status: "success", from: "0xff", to: "0xff" }));
  let chainIdChecked = false;
  const reader = readerWithFallback({
    primary: primary.reader,
    fallback: fallback.reader,
    fallbackChainId: async () => {
      chainIdChecked = true;
      return 143;
    },
    expectedChainId: 143,
  });

  const r = await reader.getTransactionReceipt(HASH);
  assert.equal(r?.blockNumber, 10n);
  assert.equal(fallback.calls(), 0, "the fallback must not be consulted when the primary answers");
  assert.equal(chainIdChecked, false, "and its chain id is not even read until it is needed");
});

test("a clean null does not fall back, because absence is an answer", async () => {
  const primary = receiptReader(async () => null);
  const fallback = receiptReader(async () => ({ blockNumber: 7n, status: "success", from: "0xff", to: "0xff" }));
  const reader = readerWithFallback({
    primary: primary.reader,
    fallback: fallback.reader,
    fallbackChainId: async () => 143,
    expectedChainId: 143,
  });

  const r = await reader.getTransactionReceipt(HASH);
  assert.equal(r, null, "a not-found stays not-found");
  assert.equal(fallback.calls(), 0, "the fallback is not consulted for a clean null");
});

test("a thrown primary error falls back, and the fallback's value comes through", async () => {
  const primary = receiptReader(async () => {
    throw new Error("provider 500");
  });
  const fallback = receiptReader(async () => ({ blockNumber: 42n, status: "success", from: "0xff", to: "0xee" }));
  const reader = readerWithFallback({
    primary: primary.reader,
    fallback: fallback.reader,
    fallbackChainId: async () => 143,
    expectedChainId: 143,
  });

  const r = await reader.getTransactionReceipt(HASH);
  assert.equal(r?.blockNumber, 42n, "the fallback answered");
  assert.equal(fallback.calls(), 1);
});

test("a fallback on the wrong chain is disabled, so a mainnet read never routes to it", async () => {
  const primary = receiptReader(async () => {
    throw new Error("provider 500");
  });
  const fallback = receiptReader(async () => ({ blockNumber: 42n, status: "success", from: "0xff", to: "0xee" }));
  let disabled = "";
  const reader = readerWithFallback({
    primary: primary.reader,
    fallback: fallback.reader,
    fallbackChainId: async () => 10143, // Monad testnet, not mainnet 143
    expectedChainId: 143,
    onDisable: (r) => {
      disabled = r;
    },
  });

  await assert.rejects(() => reader.getTransactionReceipt(HASH), /provider 500/, "the primary error surfaces, not a testnet answer");
  assert.equal(fallback.calls(), 0, "the testnet fallback is never read for a mainnet request");
  assert.match(disabled, /not 143/);

  // The disable is cached: a second failure does not re-check the chain id or touch the fallback.
  await assert.rejects(() => reader.getTransactionReceipt(HASH), /provider 500/);
  assert.equal(fallback.calls(), 0);
});

test("the settlement reader falls back on the same rule", async () => {
  let fbCalls = 0;
  const primary: SettlementReader = {
    async getBlockNumber() {
      return 1n;
    },
    async getReceipt() {
      throw new Error("provider down");
    },
    async getNativeTransfer() {
      return null;
    },
  };
  const fallback: SettlementReader = {
    async getBlockNumber() {
      return 1n;
    },
    async getReceipt() {
      fbCalls += 1;
      return { blockNumber: 5n, status: "success", from: "0xaa", to: "0xbb", logs: [] };
    },
    async getNativeTransfer() {
      return null;
    },
  };
  const reader = settlementReaderWithFallback({
    primary,
    fallback,
    fallbackChainId: async () => 143,
    expectedChainId: 143,
  });
  const r = await reader.getReceipt(HASH);
  assert.equal(r?.blockNumber, 5n);
  assert.equal(fbCalls, 1);
});

/* Live, loud-skip gated on RPC_MONAD_FALLBACK: the one empirical settle of whether Alchemy serves
 * Monad mainnet. Skips with a stated reason when the key is not set, so CI without it stays green. */
const liveSkip = process.env.RPC_MONAD_FALLBACK
  ? false
  : "RPC_MONAD_FALLBACK is not set, so no live fallback probe: set it to an Alchemy Monad endpoint to run this";

test("the configured Monad fallback endpoint reports chain 143", { skip: liveSkip }, async () => {
  const { createPublicClient, http } = await import("viem");
  const client = createPublicClient({ transport: http(process.env.RPC_MONAD_FALLBACK, { timeout: 10_000 }) });
  const id = await client.getChainId();
  assert.equal(id, 143, "the fallback must be Monad mainnet, or the chain-id gate disables it by design");
});

test("every chain reads its own fallback variable, not only Monad", async () => {
  const { fallbackEnvFor } = await import("./rpc.ts");
  const { CHAINS } = await import("./chains.ts");
  const base = CHAINS.find((c) => c.key === "base")!;
  assert.equal(fallbackEnvFor(base), "RPC_BASE_FALLBACK");
  const monad = CHAINS.find((c) => c.id === 143)!;
  assert.equal(fallbackEnvFor(monad), "RPC_MONAD_FALLBACK");
});
