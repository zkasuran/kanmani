/**
 * Real chain readers, built from the chain list plus environment.
 *
 * Deliberately thin. `locate` is written against the two reads it needs rather than against a
 * client library, so the decision logic is testable with no network and this file is the only place
 * that knows a provider exists.
 *
 * **A chain with no endpoint configured returns null rather than a client pointed at a default.**
 * A silent fallback would make an unconfigured chain look checked, which is the difference between
 * "not found" and "not looked for".
 *
 * ## The fallback reader (read only)
 *
 * Each chain may configure a second endpoint in `<rpcEnv>_FALLBACK`. The primary stays primary
 * and unchanged. The fallback fires only on a thrown provider error, never on a clean null: a "receipt
 * not found" is an answer, not a failure, so it must not route to a second provider that might answer
 * differently. The fallback self-gates on `eth_chainId`: if the endpoint is not the chain it is configured for,
 * it disables itself, so a testnet endpoint can never answer a mainnet read. The fallback is read only, never a signer.
 */
import { createPublicClient, http } from "viem";
import type { Chain } from "./chains.ts";
import type { ChainReader, Receiptish } from "./ladder/locate.ts";
import { effectiveNativeCalls } from "./ladder/settled.ts";
import type {
  CallFrame,
  NativeTransfer,
  SettlementReader,
  SettlementReceipt,
} from "./ladder/settled.ts";

const cache = new Map<number, ChainReader | null>();
const settlementCache = new Map<number, SettlementReader | null>();

/**
 * Any chain may carry a second endpoint in `<rpcEnv>_FALLBACK` (RPC_MONAD_FALLBACK, RPC_BASE_FALLBACK,
 * ...). It was Monad only until 2026-10-06. The fallback must report that same chain's id, so a
 * misconfigured endpoint disables itself rather than answering for the wrong chain.
 */
export function fallbackEnvFor(chain: Chain): string {
  return `${chain.rpcEnv}_FALLBACK`;
}

type RpcClient = ReturnType<typeof createPublicClient>;

/** The locate-rung reader over one viem client, with the absence-vs-error split that rung depends on. */
function chainReaderOf(client: RpcClient): ChainReader {
  return {
    async getBlockNumber() {
      return await client.getBlockNumber();
    },
    async getTransactionReceipt(hash) {
      // viem throws TransactionReceiptNotFoundError for a hash the chain does not have. That is an
      // absence rather than a failure, so it is translated to null here and every OTHER error is
      // rethrown for `locate` to record as unknown. The match is on the error name rather than on a
      // substring of a message that a provider is free to reword.
      try {
        const r = await client.getTransactionReceipt({ hash });
        return { blockNumber: r.blockNumber, status: r.status, from: r.from, to: r.to } satisfies Receiptish;
      } catch (e) {
        const name = (e as { name?: string })?.name ?? "";
        if (name === "TransactionReceiptNotFoundError") return null;
        throw e;
      }
    },
  };
}

/** The settled-rung reader over one viem client. Same null-is-absence, thrown-is-unknown rule. */
function settlementReaderOf(client: RpcClient): SettlementReader {
  return {
    async getBlockNumber() {
      return await client.getBlockNumber();
    },
    async getReceipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return {
          blockNumber: r.blockNumber,
          status: r.status,
          from: r.from,
          to: r.to,
          logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })),
        } satisfies SettlementReceipt;
      } catch (e) {
        const name = (e as { name?: string })?.name ?? "";
        if (name === "TransactionReceiptNotFoundError") return null;
        throw e;
      }
    },
    async getNativeTransfer(hash) {
      try {
        const t = await client.getTransaction({ hash });
        return { to: t.to, value: t.value, hasInput: t.input !== "0x" } satisfies NativeTransfer;
      } catch (e) {
        const name = (e as { name?: string })?.name ?? "";
        if (name === "TransactionNotFoundError") return null;
        throw e;
      }
    },
    // Internal native transfers, from the node's call trace. Any failure, including a provider that
    // does not offer debug_traceTransaction, is null: the rung then answers unknown rather than guessing.
    async getInternalNativeTransfers(hash) {
      try {
        const trace = (await (client as unknown as { request(a: { method: string; params: unknown[] }): Promise<unknown> }).request({
          method: "debug_traceTransaction",
          params: [hash, { tracer: "callTracer" }],
        })) as CallFrame | null;
        if (!trace || typeof trace !== "object") return null;
        return effectiveNativeCalls(trace);
      } catch {
        return null;
      }
    },
  };
}
/* RPC_FALLBACK_PLACEHOLDER */

export type FallbackParts<R> = {
  primary: R;
  fallback: R;
  /** The fallback's `eth_chainId`, checked once before the fallback is ever used. */
  fallbackChainId: () => Promise<number | bigint>;
  expectedChainId: number;
  /** Called once if the fallback is disabled for reporting the wrong chain. */
  onDisable?: (reason: string) => void;
};

/**
 * The fallback decision, made once per reader and cached.
 *
 * Runs the primary call. On a clean resolve, including a null, returns it and never touches the
 * fallback: a null is an answer. On a thrown error, consults the fallback only if its chain id matches
 * the expected one. A chain-id read that itself fails is treated as "not usable this time" and is not
 * cached, so a transient blip does not permanently disable a healthy fallback.
 */
function makeFallbackRunner(
  fallbackChainId: () => Promise<number | bigint>,
  expected: number,
  onDisable?: (reason: string) => void,
) {
  let state: "unchecked" | "enabled" | "disabled" = "unchecked";
  async function usable(): Promise<boolean> {
    if (state === "enabled") return true;
    if (state === "disabled") return false;
    let id: number;
    try {
      id = Number(await fallbackChainId());
    } catch {
      return false;
    }
    if (id === expected) {
      state = "enabled";
      return true;
    }
    state = "disabled";
    onDisable?.(`fallback RPC reports chain ${id}, not ${expected}, so it is disabled`);
    return false;
  }
  return async function run<T>(primaryCall: () => Promise<T>, fallbackCall: () => Promise<T>): Promise<T> {
    try {
      return await primaryCall();
    } catch (primaryErr) {
      if (!(await usable())) throw primaryErr;
      return await fallbackCall();
    }
  };
}

/** Compose a locate-rung reader that falls back on a thrown primary error, chain-id gated. */
export function readerWithFallback(parts: FallbackParts<ChainReader>): ChainReader {
  const run = makeFallbackRunner(parts.fallbackChainId, parts.expectedChainId, parts.onDisable);
  const { primary, fallback } = parts;
  return {
    getBlockNumber: () => run(() => primary.getBlockNumber(), () => fallback.getBlockNumber()),
    getTransactionReceipt: (hash) =>
      run(() => primary.getTransactionReceipt(hash), () => fallback.getTransactionReceipt(hash)),
  };
}

/** Compose a settled-rung reader with the same fallback discipline. */
export function settlementReaderWithFallback(parts: FallbackParts<SettlementReader>): SettlementReader {
  const run = makeFallbackRunner(parts.fallbackChainId, parts.expectedChainId, parts.onDisable);
  const { primary, fallback } = parts;
  return {
    getBlockNumber: () => run(() => primary.getBlockNumber(), () => fallback.getBlockNumber()),
    getReceipt: (hash) => run(() => primary.getReceipt(hash), () => fallback.getReceipt(hash)),
    getNativeTransfer: (hash) => run(() => primary.getNativeTransfer(hash), () => fallback.getNativeTransfer(hash)),
    getInternalNativeTransfers: async (hash) => {
      // A trace gap on the primary is a null, not an error, so ask the fallback explicitly before giving up.
      const a = primary.getInternalNativeTransfers ? await primary.getInternalNativeTransfers(hash).catch(() => null) : null;
      if (a !== null) return a;
      return fallback.getInternalNativeTransfers ? await fallback.getInternalNativeTransfers(hash).catch(() => null) : null;
    },
  };
}

export function readerFor(chain: Chain, env: NodeJS.ProcessEnv = process.env): ChainReader | null {
  if (cache.has(chain.id)) return cache.get(chain.id)!;

  const url = env[chain.rpcEnv];
  if (!url) {
    cache.set(chain.id, null);
    return null;
  }

  const client = createPublicClient({ transport: http(url, { timeout: 10_000, retryCount: 1 }) });
  const primary = chainReaderOf(client);

  const fallbackUrl = env[fallbackEnvFor(chain)];
  let reader = primary;
  if (fallbackUrl) {
    const fbClient = createPublicClient({ transport: http(fallbackUrl, { timeout: 10_000, retryCount: 1 }) });
    reader = readerWithFallback({
      primary,
      fallback: chainReaderOf(fbClient),
      fallbackChainId: () => fbClient.getChainId(),
      expectedChainId: chain.id,
      onDisable: (r) => console.warn(`[rpc] ${r}`),
    });
  }

  cache.set(chain.id, reader);
  return reader;
}

/** Test seam: readers are cached per chain id, so a test changing env needs this. */
export function resetReaderCache(): void {
  cache.clear();
  settlementCache.clear();
}

/**
 * A reader for the `settled` rung, which needs more than existence: the receipt with its logs, and
 * the transaction itself for a native transfer's value. Same null-means-not-configured rule as
 * `readerFor`, the same "a thrown error is unknown, absence is null" translation, and the same Monad
 * fallback on chain 143.
 */
export function settlementReaderFor(chain: Chain, env: NodeJS.ProcessEnv = process.env): SettlementReader | null {
  if (settlementCache.has(chain.id)) return settlementCache.get(chain.id)!;

  const url = env[chain.rpcEnv];
  if (!url) {
    settlementCache.set(chain.id, null);
    return null;
  }

  const client = createPublicClient({ transport: http(url, { timeout: 10_000, retryCount: 1 }) });
  const primary = settlementReaderOf(client);

  const fallbackUrl = env[fallbackEnvFor(chain)];
  let reader = primary;
  if (fallbackUrl) {
    const fbClient = createPublicClient({ transport: http(fallbackUrl, { timeout: 10_000, retryCount: 1 }) });
    reader = settlementReaderWithFallback({
      primary,
      fallback: settlementReaderOf(fbClient),
      fallbackChainId: () => fbClient.getChainId(),
      expectedChainId: chain.id,
      onDisable: (r) => console.warn(`[rpc] ${r}`),
    });
  }

  settlementCache.set(chain.id, reader);
  return reader;
}
