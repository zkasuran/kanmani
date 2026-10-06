/**
 * When a cited transaction is not on the chain the document named, find out where it actually is.
 *
 * ## Why this is the difference between a dead end and a repair
 *
 * A `false` verdict currently says one thing: we read the chain this document named and the transaction
 * was not there. True, checkable and it leaves the operator with nowhere to go. Two very different
 * situations produce the identical verdict:
 *
 *   the transaction exists nowhere        the claim is fabricated
 *   the transaction is on Base and the document says monad   a mislabelled network, fixable in one edit
 *
 * All 73 false verdicts in the corpus declare `monad` and carry `found_chain_id = NULL`. That column has
 * existed since the schema was written and has never been fed, because the chains a mislabelled claim
 * would live on are exactly the ones we cannot reach: `publicRpc` is null for Ethereum, Optimism, Base,
 * Arbitrum and Polygon. One multi-chain provider closes that, which is what Alchemy is for.
 *
 * ## The honesty rule this module exists under
 *
 * "Not found on any chain we can read" is NOT "does not exist". The result therefore always reports
 * which chains were actually searched and which were skipped for want of an endpoint. A caller that
 * wants to say "nowhere" has to look at `unreachable` first and decide whether it has the standing.
 * Collapsing that into a bare negative is how a measurement layer starts lying.
 */

import { CHAINS, type Chain } from "./chains.ts";

export type FoundAt = {
  chainId: number;
  key: string;
  blockNumber: number;
  /** The address that sent it, so a caller can see whether the agent's own wallet paid. */
  from: string;
  to: string | null;
};

export type SearchResult = {
  txHash: string;
  /** The chain the document claimed. Excluded from the search: we already know it is not there. */
  declaredChainId: number | null;
  found: FoundAt | null;
  /** Chains actually queried. Evidence for how much weight `found: null` can carry. */
  searched: number[];
  /** Chains skipped because no endpoint is configured. The reason a null is not a conclusion. */
  unreachable: { chainId: number; key: string; needs: string }[];
  checkedAt: string;
};

const TX_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Resolve a chain to an endpoint.
 *
 * `rpcEnv` wins over `publicRpc` because an operator-supplied endpoint is the one with archive depth and
 * no rate limit. A public endpoint is a fallback, not a default, since a rate-limited miss looks
 * identical to a genuine absence and that is the one confusion this module must not introduce.
 */
export function endpointFor(c: Chain, env: Record<string, string | undefined> = process.env): string | null {
  const fromEnv = c.rpcEnv ? env[c.rpcEnv] : undefined;
  if (fromEnv && fromEnv.startsWith("https://")) return fromEnv;
  if (c.publicRpc && c.publicRpc.startsWith("https://")) return c.publicRpc;
  return null;
}

/**
 * A second endpoint for the same chain, tried only when the first fails to answer. Set as
 * `<rpcEnv>_FALLBACK`. A provider that answers "no such transaction" is an answer, so the fallback is
 * never asked to second-guess it; it only covers an outage or a rate limit.
 */
export function fallbackFor(c: Chain, env: Record<string, string | undefined> = process.env): string | null {
  const v = c.rpcEnv ? env[`${c.rpcEnv}_FALLBACK`] : undefined;
  return v && v.startsWith("https://") ? v : null;
}

type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

/**
 * One chain's answer. `absent` is a real answer: the provider replied and has no mined transaction
 * with this hash. `failed` is not an answer at all, and must never be counted as having searched.
 *
 * Before this split both came back as `null`. When the Alchemy endpoints hit their monthly cap and
 * answered every call with HTTP 429, Ethereum went on being listed under `searched`, so a reader was
 * told a transaction was not on Ethereum when nobody had been able to look.
 */
type ChainAnswer =
  | { kind: "found"; blockNumber: number; from: string; to: string | null }
  | { kind: "absent" }
  | { kind: "failed"; reason: string };

async function txOn(url: string, txHash: string, fetchImpl: Fetcher, timeoutMs: number): Promise<ChainAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [txHash] }),
      signal: controller.signal,
    });
    if (!res.ok) return { kind: "failed", reason: res.status ? `HTTP ${res.status}` : "HTTP error" };
    const body = (await res.json()) as {
      result?: { blockNumber?: string; from?: string; to?: string | null } | null;
      error?: { code?: number; message?: string };
    };
    // A JSON-RPC error is the provider refusing, often a rate or capacity limit sent with HTTP 200.
    if (body?.error) return { kind: "failed", reason: `rpc error ${body.error.code ?? ""}`.trim() };
    if (!body || !("result" in body)) return { kind: "failed", reason: "no result in the response" };
    const r = body.result;
    // A pending transaction has a null blockNumber. Not mined is not found.
    if (!r || !r.blockNumber || !r.from) return { kind: "absent" };
    return { kind: "found", blockNumber: Number(BigInt(r.blockNumber)), from: r.from, to: r.to ?? null };
  } catch (e) {
    return { kind: "failed", reason: (e as Error).name === "AbortError" ? "timed out" : "request failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search every reachable chain except the one already checked.
 *
 * Queries run in parallel, since they are independent reads against different providers and doing them
 * serially would make a page wait on the slowest. The first mined match wins: a hash collision across
 * two chains is not a thing that happens and if it did, reporting one with the chain id named is still
 * honest.
 */
export async function findTransaction(
  txHash: string,
  declaredChainId: number | null,
  opts: {
    env?: Record<string, string | undefined>;
    fetchImpl?: Fetcher;
    timeoutMs?: number;
  } = {},
): Promise<SearchResult> {
  if (!TX_RE.test(txHash)) throw new Error("txHash must be 0x followed by 64 hex characters");

  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as Fetcher);
  const timeoutMs = opts.timeoutMs ?? 8000;

  const candidates = CHAINS.filter((c) => c.id !== declaredChainId);
  const unreachable: SearchResult["unreachable"] = [];
  const asked: { c: (typeof CHAINS)[number]; answer: Promise<ChainAnswer> }[] = [];

  for (const c of candidates) {
    const url = endpointFor(c, env);
    if (!url) {
      unreachable.push({ chainId: c.id, key: c.key, needs: c.rpcEnv ?? "an endpoint" });
      continue;
    }
    const fallback = fallbackFor(c, env);
    const answer = txOn(url, txHash, fetchImpl, timeoutMs).then((first) =>
      first.kind === "failed" && fallback ? txOn(fallback, txHash, fetchImpl, timeoutMs) : first,
    );
    asked.push({ c, answer });
  }

  // A chain is only `searched` when its provider actually answered. One that failed is unreachable
  // for this search, with the reason, so `explain` reports the result as inconclusive.
  const searched: number[] = [];
  let found: FoundAt | null = null;
  for (const { c, answer } of asked) {
    const a = await answer;
    if (a.kind === "failed") {
      unreachable.push({ chainId: c.id, key: c.key, needs: `${c.rpcEnv ?? "an endpoint"} (${a.reason})` });
      continue;
    }
    searched.push(c.id);
    if (a.kind === "found" && !found) found = { chainId: c.id, key: c.key, blockNumber: a.blockNumber, from: a.from, to: a.to };
  }

  return {
    txHash,
    declaredChainId,
    found,
    searched,
    unreachable,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * The sentence a reader should see. Deliberately refuses to say "nowhere" when it cannot.
 *
 * Three outcomes and the third is the one that matters most for honesty: if anything was unreachable,
 * a null result is reported as inconclusive rather than negative.
 */
export function explain(r: SearchResult): string {
  if (r.found) {
    return `The cited transaction is on ${r.found.key} (chain ${r.found.chainId}) at block ${r.found.blockNumber.toLocaleString()}, not on the chain this document names. That is a mislabelled network rather than a missing payment and it is fixable by correcting one field.`;
  }
  if (r.unreachable.length > 0) {
    const need = r.unreachable.map((u) => u.key).join(", ");
    return `Not found on ${r.searched.length} chain${r.searched.length === 1 ? "" : "s"} we can read. ${r.unreachable.length} could not be searched at all (${need}), so this is inconclusive rather than a conclusion that the transaction does not exist.`;
  }
  return `Searched every chain we can read (${r.searched.length}) and the transaction is on none of them. Combined with the declared chain, that is the whole set, so the hash does not correspond to a mined transaction anywhere we cover.`;
}

/* ------------------------------------------------------------------ which provider actually answered */

/**
 * The provider name derived from an endpoint, never hardcoded.
 *
 * This is the honesty valve on "searched via Alchemy". A chain still pointed at a public node reads as
 * its own host, so the label on every surface tracks what the search actually hits rather than a string
 * an operator forgot to update. An Alchemy multichain endpoint is `<network>.g.alchemy.com`, a QuickNode
 * one is `<name>.<network>.quiknode.pro`. The path carries the key, so only the host is ever read.
 */
export function providerOf(url: string): string {
  try {
    const host = new URL(url).host.toLowerCase();
    if (host.endsWith(".g.alchemy.com")) return "Alchemy";
    if (host.endsWith(".quiknode.pro")) return "QuickNode";
    if (host.endsWith(".n.dwellir.com")) return "Dwellir";
    return host;
  } catch {
    return url;
  }
}

export type SearchedChain = { chainId: number; key: string; displayName: string; provider: string };

/**
 * The chains a mislabelled claim is searched on, with the provider behind each, derived from config.
 *
 * Same filter as `findTransaction` (exclude the declared chain, require an https endpoint), so the
 * string shown on `/claims`, on the claim page and in the Locator answer cannot drift from what the
 * search actually hits. The provider comes from the live endpoint through `providerOf`, never a
 * constant, which is what keeps "searched via Alchemy" true only while those endpoints are Alchemy.
 */
export function searchedChains(
  declaredChainId: number | null,
  env: Record<string, string | undefined> = process.env,
): SearchedChain[] {
  const out: SearchedChain[] = [];
  for (const c of CHAINS) {
    if (c.id === declaredChainId) continue;
    const url = endpointFor(c, env);
    if (!url) continue;
    out.push({ chainId: c.id, key: c.key, displayName: c.displayName, provider: providerOf(url) });
  }
  return out;
}

/**
 * One sentence naming the provider that backs the search. Groups by provider, so the common case of a
 * single provider reads cleanly and a mixed set names each host honestly.
 */
export function searchedVia(list: SearchedChain[]): string {
  if (list.length === 0) return "no chains are reachable for the cross-chain search";
  const byProvider = new Map<string, string[]>();
  for (const c of list) {
    const keys = byProvider.get(c.provider) ?? [];
    keys.push(c.key);
    byProvider.set(c.provider, keys);
  }
  if (byProvider.size === 1) {
    const [provider, keys] = [...byProvider.entries()][0];
    return `searched via ${provider}: ${keys.join(", ")}`;
  }
  const parts = [...byProvider.entries()].map(([provider, keys]) => `${provider} (${keys.join(", ")})`);
  return `searched via ${parts.join(" and ")}`;
}
