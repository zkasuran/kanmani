import assert from "node:assert/strict";
import test from "node:test";

import { endpointFor, explain, findTransaction, providerOf, searchedChains, searchedVia, type SearchResult, type SearchedChain } from "./findtx.ts";

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
    fetchImpl: (async () => ({ ok: false, status: 429, json: async () => ({}) })) as never,
  });
  // A provider that errored did not look. It is unreachable for this search, with the reason, and is
  // never listed as searched, so explain cannot report the transaction as absent from that chain.
  assert.equal(r.found, null);
  assert.equal(r.searched.includes(8453), false);
  assert.ok(r.unreachable.some((u) => u.chainId === 8453 && /429/.test(u.needs)));
  assert.match(explain(r), /inconclusive|could not|not every/i);
});

test("a JSON-RPC error sent with HTTP 200, the way a capacity limit arrives, is a failure too", async () => {
  const r = await findTransaction(HASH, 143, {
    env: { RPC_BASE: "https://base.example" },
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: 429, message: "Monthly capacity limit exceeded" } }),
    })) as never,
  });
  assert.equal(r.searched.includes(8453), false);
  assert.ok(r.unreachable.some((u) => u.chainId === 8453));
});

test("a provider that answers with a null result did search, and found nothing", async () => {
  const r = await findTransaction(HASH, 143, {
    env: { RPC_BASE: "https://base.example" },
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: null }) })) as never,
  });
  assert.ok(r.searched.includes(8453));
  assert.equal(r.found, null);
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

/* ------------------------------------------------------------------ searched-via (Alchemy visibility) */

const ALCHEMY_ENV = {
  RPC_ETHEREUM: "https://eth-mainnet.g.alchemy.com/v2/KEY",
  RPC_BASE: "https://base-mainnet.g.alchemy.com/v2/KEY",
  RPC_OPTIMISM: "https://opt-mainnet.g.alchemy.com/v2/KEY",
  RPC_ARBITRUM: "https://arb-mainnet.g.alchemy.com/v2/KEY",
  RPC_POLYGON: "https://polygon-mainnet.g.alchemy.com/v2/KEY",
};

test("providerOf reads the label off the endpoint, so a public node never reads as Alchemy", () => {
  assert.equal(providerOf("https://eth-mainnet.g.alchemy.com/v2/KEY"), "Alchemy");
  assert.equal(providerOf("https://opt-mainnet.g.alchemy.com/v2/KEY"), "Alchemy");
  assert.equal(providerOf("https://eth.llamarpc.com"), "eth.llamarpc.com");
  assert.equal(providerOf("https://bsc-dataseed.bnbchain.org"), "bsc-dataseed.bnbchain.org");
});

test("searchedChains labels the five non-Monad chains as Alchemy and never includes the declared chain", () => {
  const list = searchedChains(143, ALCHEMY_ENV);
  const viaAlchemy = list.filter((c) => c.provider === "Alchemy").map((c) => c.key).sort();
  assert.deepEqual(viaAlchemy, ["arbitrum", "base", "ethereum", "optimism", "polygon"]);
  assert.ok(!list.some((c) => c.chainId === 143), "the declared chain is never searched");
});

test("searchedChains drops a chain with no endpoint and no public RPC", () => {
  // With nothing configured, only chains that carry a publicRpc remain. Ethereum has none, so it is out.
  const list = searchedChains(143, {});
  assert.ok(!list.some((c) => c.key === "ethereum"), "ethereum has no endpoint, so it is not searched");
});

test("searchedVia renders one provider inline and a mixed set honestly", () => {
  const allAlchemy: SearchedChain[] = ["ethereum", "base", "arbitrum", "optimism", "polygon"].map((key, i) => ({
    chainId: i,
    key,
    displayName: key,
    provider: "Alchemy",
  }));
  assert.equal(searchedVia(allAlchemy), "searched via Alchemy: ethereum, base, arbitrum, optimism, polygon");

  const mixed: SearchedChain[] = [
    { chainId: 1, key: "ethereum", displayName: "Ethereum", provider: "Alchemy" },
    { chainId: 8453, key: "base", displayName: "Base", provider: "Alchemy" },
    { chainId: 137, key: "polygon", displayName: "Polygon", provider: "polygon-rpc.com" },
  ];
  assert.equal(searchedVia(mixed), "searched via Alchemy (ethereum, base) and polygon-rpc.com (polygon)");
});
