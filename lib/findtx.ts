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

type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/** One `eth_getTransactionByHash`. Returns null on any failure, because a broken read is not a finding. */
async function txOn(
  url: string,
  txHash: string,
  fetchImpl: Fetcher,
  timeoutMs: number,
): Promise<{ blockNumber: number; from: string; to: string | null } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [txHash] }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { blockNumber?: string; from?: string; to?: string | null } | null };
    const r = body?.result;
    // A pending transaction has a null blockNumber. Not mined is not found.
    if (!r || !r.blockNumber || !r.from) return null;
    return { blockNumber: Number(BigInt(r.blockNumber)), from: r.from, to: r.to ?? null };
  } catch {
    return null;
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
  const searched: number[] = [];
  const unreachable: SearchResult["unreachable"] = [];
  const jobs: Promise<FoundAt | null>[] = [];

  for (const c of candidates) {
    const url = endpointFor(c, env);
    if (!url) {
      unreachable.push({ chainId: c.id, key: c.key, needs: c.rpcEnv ?? "an endpoint" });
      continue;
    }
    searched.push(c.id);
    jobs.push(
      txOn(url, txHash, fetchImpl, timeoutMs).then((t) =>
        t ? { chainId: c.id, key: c.key, blockNumber: t.blockNumber, from: t.from, to: t.to } : null,
      ),
    );
  }

  const results = await Promise.all(jobs);
  return {
    txHash,
    declaredChainId,
    found: results.find((r) => r !== null) ?? null,
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
