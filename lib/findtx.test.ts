import assert from "node:assert/strict";
import test from "node:test";

import { endpointFor, explain, findTransaction, type SearchResult } from "./findtx.ts";

const HASH = `0x${"a".repeat(64)}` as const;

/** A fetch that answers per host, so a test can put a transaction on exactly one chain. */
function fakeFetch(found: Record<string, { blockNumber: string; from: string; to: string | null } | null>) {
  return async (url: string) => {
    const key = Object.keys(found).find((k) => url.includes(k));
    return {
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: key ? found[key] : null }),
    };
  };
}

test("endpointFor prefers the env endpoint over the public one", () => {
  const c = { id: 1, key: "ethereum", rpcEnv: "RPC_ETHEREUM", publicRpc: "https://public.example" } as never;
  assert.equal(endpointFor(c, { RPC_ETHEREUM: "https://paid.example" }), "https://paid.example");
  assert.equal(endpointFor(c, {}), "https://public.example");
});

test("endpointFor refuses a non-https endpoint rather than downgrading", () => {
  const c = { id: 1, key: "ethereum", rpcEnv: "RPC_ETHEREUM", publicRpc: null } as never;
  assert.equal(endpointFor(c, { RPC_ETHEREUM: "http://insecure.example" }), null);
});

test("the declared chain is never searched, because it was already checked", async () => {
  const r = await findTransaction(HASH, 143, { env: {}, fetchImpl: fakeFetch({}) as never });
  assert.ok(!r.searched.includes(143));
  assert.ok(!r.unreachable.some((u) => u.chainId === 143));
});

test("a mined transaction on another chain is found and named", async () => {
  const r = await findTransaction(HASH, 143, {
    env: { RPC_BASE: "https://base.example" },
    fetchImpl: fakeFetch({ "base.example": { blockNumber: "0x1e8480", from: "0xabc", to: "0xdef" } }) as never,
  });
  assert.equal(r.found?.chainId, 8453);
  assert.equal(r.found?.blockNumber, 2_000_000);
  assert.match(explain(r), /mislabelled network/);
});

test("a pending transaction is not a found transaction", async () => {
  const r = await findTransaction(HASH, 143, {
    env: { RPC_BASE: "https://base.example" },
    // A real node returns the transaction with a null blockNumber before it is mined.
    fetchImpl: fakeFetch({ "base.example": { blockNumber: "", from: "0xabc", to: null } }) as never,
  });
  assert.equal(r.found, null);
});

test("an unreachable chain makes a null INCONCLUSIVE, never a denial", async () => {
  // Nothing configured, so every chain is unreachable and the search proves nothing.
  const r = await findTransaction(HASH, 143, { env: {}, fetchImpl: fakeFetch({}) as never });
  assert.equal(r.found, null);
  assert.ok(r.unreachable.length > 0);
  const said = explain(r);
  assert.match(said, /inconclusive/);
  assert.ok(!/does not exist anywhere/.test(said), "must not claim absence it cannot support");
});

test("only with every chain reachable may the wording become conclusive", async () => {
  const env: Record<string, string> = {};
  for (const v of ["RPC_ETHEREUM", "RPC_OPTIMISM", "RPC_BASE", "RPC_ARBITRUM", "RPC_POLYGON", "RPC_BSC", "RPC_MONAD"]) {
    env[v] = `https://${v.toLowerCase()}.example`;
  }
  const r = await findTransaction(HASH, 143, { env, fetchImpl: fakeFetch({}) as never });
  assert.equal(r.unreachable.length, 0, "every chain should be reachable in this fixture");
  assert.match(explain(r), /does not correspond to a mined transaction/);
});

test("a failing provider is not evidence of absence", async () => {
  const r = await findTransaction(HASH, 143, {
    env: { RPC_BASE: "https://base.example" },
    fetchImpl: (async () => ({ ok: false, json: async () => ({}) })) as never,
  });
  // Searched but errored: found stays null and the chain is still listed as searched, which is honest
  // about what was attempted rather than silently dropping it.
  assert.equal(r.found, null);
  assert.ok(r.searched.includes(8453));
});

test("a malformed hash is refused rather than searched", async () => {
  await assert.rejects(() => findTransaction("0xnope", 143, { env: {} }), /64 hex/);
});

test("explain never reports a chain it did not search", async () => {
  const r: SearchResult = await findTransaction(HASH, 143, {
    env: { RPC_BASE: "https://base.example" },
    fetchImpl: fakeFetch({}) as never,
  });
  const said = explain(r);
  assert.ok(said.includes(String(r.searched.length)));
});
