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

const cache = new Map<number, ChainReader | null>();

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
}
