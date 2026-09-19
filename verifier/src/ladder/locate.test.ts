import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAINS, coverageTable, resolveChain } from "../chains.ts";
import { locate, type ChainReader, type Receiptish } from "./locate.ts";


const ARBITRUM = CHAINS.find((c) => c.key === "arbitrum")!;
const HASH = `0x${"a".repeat(64)}` as const;

function reader(over: Partial<ChainReader> = {}): ChainReader {
  return {
    getBlockNumber: async () => 1000n,
    getTransactionReceipt: async () => null,
    ...over,
  };
}

const receipt = (over: Partial<Receiptish> = {}): Receiptish => ({
  blockNumber: 900n,
  status: "success",
  from: "0xaaaa",
  to: "0xbbbb",
  ...over,
});

/* ------------------------------------------------------------------ chain naming */

test("reads the network names documents actually write", () => {
  for (const [written, key] of [
    ["monad", "monad"],
    ["Monad", "monad"],
    ["MONAD  ", "monad"],
    ["monad-mainnet", "monad"],
    ["eip155:143", "monad"],
    [143, "monad"],
    ["143", "monad"],
    ["arbitrum one", "arbitrum"],
    ["eip155:42161", "arbitrum"],
    ["matic", "polygon"],
    ["bnb chain", "bsc"],
  ] as const) {
    const r = resolveChain(written);
    assert.equal(r.known, true, `${written} should resolve`);
    if (r.known) assert.equal(r.chain.key, key);
  }
});

test("an uncovered or unreadable network is not guessed at", () => {
  for (const bad of ["", null, undefined, "ethereum-goerli", "solana", "eip155:999999", 999999]) {
    const r = resolveChain(bad);
    assert.equal(r.known, false, `${String(bad)} must not resolve`);
  }
});

test("the coverage table says which chains are actually configured", () => {
  const t = coverageTable({ RPC_MONAD: "https://rpc.monad.xyz" } as NodeJS.ProcessEnv);
  const monad = t.find((r) => r.id === 143)!;
  const base = t.find((r) => r.id === 8453)!;
  assert.equal(monad.configured, true);
  assert.equal(base.configured, false, "an unconfigured chain must show as a hole, not be hidden");
  assert.equal(t.length, CHAINS.length, "every covered chain appears, configured or not");
});

/* ------------------------------------------------------------------ the happy path */

test("a cited transaction that exists resolves to found, with the block and the head", async () => {
  const r = await locate("monad", HASH, () => reader({ getTransactionReceipt: async () => receipt() }));
  assert.equal(r.found, true);
  if (r.found === true) {
    assert.equal(r.chain.id, 143);
    assert.equal(r.blockNumber, 900n);
    assert.equal(r.checkedAtBlock, 1000n, "records the head at check time");
    assert.equal(r.status, "success");
  }
});

test("the chain read is the one the document names, not a default", async () => {
  let asked = "";
  const r = await locate("arbitrum", HASH, (c) => {
    asked = c.key;
    return reader({ getTransactionReceipt: async () => receipt({ blockNumber: 503_811_127n }) });
  });
  assert.equal(asked, "arbitrum");
  assert.equal(r.found, true);
  if (r.found === true) assert.equal(r.chain.id, ARBITRUM.id);
});

test("a reverted transaction is still found and says so", async () => {
  // It happened. Whether it succeeded is a separate fact and belongs in the verdict, not here.
  const r = await locate("monad", HASH, () =>
    reader({ getTransactionReceipt: async () => receipt({ status: "reverted" }) }),
  );
  assert.equal(r.found, true);
  if (r.found === true) assert.equal(r.status, "reverted");
});

/* --------------------------------------------- the part that must never be wrong */

test("a genuine absence is false and carries the block it was checked at", async () => {
  const r = await locate("monad", HASH, () => reader({ getTransactionReceipt: async () => null }));
  assert.equal(r.found, false);
  if (r.found === false) {
    assert.equal(r.checkedAtBlock, 1000n);
    assert.match(r.reason, /no transaction with this hash on Monad/);
  }
});

test("A THROWN PROVIDER ERROR IS UNKNOWN, NEVER FALSE", async () => {
  // The property this whole file exists for. Providers signal "no such transaction" by throwing as
  // often as by returning null, so treating a throw as absence turns an outage into a wave of
  // automated accusations.
  const r = await locate("monad", HASH, () =>
    reader({
      getTransactionReceipt: async () => {
        throw new Error("429 Too Many Requests");
      },
    }),
  );
  assert.equal(r.found, "unknown");
  if (r.found === "unknown") assert.match(r.reason, /receipt read failed.*429/);
});

test("a failed head read is unknown too, rather than a lookup with no timestamp", async () => {
  const r = await locate("monad", HASH, () =>
    reader({
      getBlockNumber: async () => {
        throw new Error("upstream down");
      },
    }),
  );
  assert.equal(r.found, "unknown");
  if (r.found === "unknown") assert.match(r.reason, /head read failed/);
});

test("a chain we cover but have no endpoint for is unknown and says which", async () => {
  const r = await locate("base", HASH, () => null);
  assert.equal(r.found, "unknown");
  if (r.found === "unknown") {
    assert.match(r.reason, /no RPC configured for Base/);
    assert.equal(r.chain?.id, 8453);
  }
});

test("a network outside the covered list is unknown, so coverage never fakes a verdict", async () => {
  const r = await locate("solana", HASH, () => reader());
  assert.equal(r.found, "unknown");
  if (r.found === "unknown") assert.match(r.reason, /not in the covered list/);
});

test("a malformed transaction hash is unknown, because there is no claim to disprove", async () => {
  for (const bad of ["", "0x", "0x123", "not-a-hash", null, `0x${"z".repeat(64)}`]) {
    const r = await locate("monad", bad, () => reader());
    assert.equal(r.found, "unknown", `${String(bad)} should be unknown`);
  }
});

test("a mixed case hash is accepted, because authors paste them either way", async () => {
  const upper = `0x${"A".repeat(64)}`;
  const r = await locate("monad", upper, () =>
    reader({ getTransactionReceipt: async () => receipt() }),
  );
  assert.equal(r.found, true);
});

test("no chain is read at all when the network cannot be resolved", async () => {
  let touched = false;
  await locate("solana", HASH, () => {
    touched = true;
    return reader();
  });
  assert.equal(touched, false, "never open a connection for a chain we cannot name");
});
