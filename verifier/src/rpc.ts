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
 */
import { createPublicClient, http } from "viem";
import type { Chain } from "./chains.ts";
import type { ChainReader, Receiptish } from "./ladder/locate.ts";
import type {
  NativeTransfer,
  SettlementReader,
  SettlementReceipt,
} from "./ladder/settled.ts";

const cache = new Map<number, ChainReader | null>();
const settlementCache = new Map<number, SettlementReader | null>();

export function readerFor(chain: Chain, env: NodeJS.ProcessEnv = process.env): ChainReader | null {
  if (cache.has(chain.id)) return cache.get(chain.id)!;

  const url = env[chain.rpcEnv];
  if (!url) {
    cache.set(chain.id, null);
    return null;
  }

  const client = createPublicClient({
    transport: http(url, { timeout: 10_000, retryCount: 1 }),
  });

  const reader: ChainReader = {
    async getBlockNumber() {
      return await client.getBlockNumber();
    },
    async getTransactionReceipt(hash) {
      // viem throws TransactionReceiptNotFoundError for a hash the chain does not have. That is an
      // absence rather than a failure, so it is translated to null here and every OTHER error is
      // rethrown for `locate` to record as unknown. Getting this backwards is how an outage turns
      // into a wave of false accusations, so the match is on the error name rather than on a
      // substring of a message that a provider is free to reword.
      try {
        const r = await client.getTransactionReceipt({ hash });
        return {
          blockNumber: r.blockNumber,
          status: r.status,
          from: r.from,
          to: r.to,
        } satisfies Receiptish;
      } catch (e) {
        const name = (e as { name?: string })?.name ?? "";
        if (name === "TransactionReceiptNotFoundError") return null;
        throw e;
      }
    },
  };

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
 * `readerFor`, and the same "a thrown error is unknown, absence is null" translation, because the
 * settled rung draws the same line between "we did not look" and "it is not there".
 */
export function settlementReaderFor(
  chain: Chain,
  env: NodeJS.ProcessEnv = process.env,
): SettlementReader | null {
  if (settlementCache.has(chain.id)) return settlementCache.get(chain.id)!;

  const url = env[chain.rpcEnv];
  if (!url) {
    settlementCache.set(chain.id, null);
    return null;
  }

  const client = createPublicClient({
    transport: http(url, { timeout: 10_000, retryCount: 1 }),
  });

  const reader: SettlementReader = {
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
        return { to: t.to, value: t.value } satisfies NativeTransfer;
      } catch (e) {
        const name = (e as { name?: string })?.name ?? "";
        if (name === "TransactionNotFoundError") return null;
        throw e;
      }
    },
  };

  settlementCache.set(chain.id, reader);
  return reader;
}
