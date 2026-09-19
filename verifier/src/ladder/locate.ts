/**
 * The `true` rung: did the transaction this document cites actually happen, on the chain it names?
 *
 * This is the rung that does not exist anywhere else. Every other check in the ladder asks whether
 * the paperwork is well formed. This one asks whether the event described in the paperwork occurred.
 *
 * **The single most important property in this file is that a provider failure is `unknown`, never
 * `false`.** A timeout, a rate limit, a chain we do not cover: none of those are evidence that a
 * transaction did not happen. They are evidence that we did not look successfully. Collapsing the
 * two would let an outage manufacture accusations against people, at scale, automatically.
 *
 * So `LocateOutcome` has four cases and the code never takes a shortcut between them.
 */
import { resolveChain, type Chain } from "../chains.ts";

export type Receiptish = {
  /** Block the transaction landed in. */
  blockNumber: bigint;
  status: "success" | "reverted";
  from: string;
  to: string | null;
};

/** Just the reads `locate` needs, so a test can supply them without a chain. */
export type ChainReader = {
  getTransactionReceipt(hash: `0x${string}`): Promise<Receiptish | null>;
  getBlockNumber(): Promise<bigint>;
};

export type LocateOutcome =
  | {
      found: true;
      chain: Chain;
      blockNumber: bigint;
      status: "success" | "reverted";
      from: string;
      to: string | null;
      /** The chain's head when we looked. A verdict is a measurement at a time. */
      checkedAtBlock: bigint;
    }
  /** We read the chain successfully and the transaction is not on it. */
  | { found: false; chain: Chain; checkedAtBlock: bigint; reason: string }
  /** We could not look. Says why and it is never an accusation. */
  | { found: "unknown"; reason: string; chain?: Chain };

const TX_HASH = /^0x[0-9a-f]{64}$/;

export type ReaderFor = (chain: Chain) => ChainReader | null;

/**
 * @param declaredNetwork whatever the document called the chain
 * @param declaredTx      the transaction hash the document cites
 * @param readerFor       supplies a reader per chain or null when that chain is not configured
 */
export async function locate(
  declaredNetwork: unknown,
  declaredTx: unknown,
  readerFor: ReaderFor,
): Promise<LocateOutcome> {
  const hash = String(declaredTx ?? "").trim().toLowerCase();
  if (!TX_HASH.test(hash)) {
    // A malformed hash is a defect in the document rather than a failed lookup, but it still is not
    // a `false`: there is no claim well formed enough to disprove.
    return { found: "unknown", reason: `cited transaction is not a 32 byte hash: ${short(declaredTx)}` };
  }

  const lookup = resolveChain(declaredNetwork);
  if (!lookup.known) return { found: "unknown", reason: lookup.reason };
  const chain = lookup.chain;

  const reader = readerFor(chain);
  if (!reader) {
    // Covered in the list but with no endpoint configured. Honest answer: we did not look.
    return { found: "unknown", chain, reason: `no RPC configured for ${chain.displayName}` };
  }

  let head: bigint;
  try {
    head = await reader.getBlockNumber();
  } catch (e) {
    return { found: "unknown", chain, reason: `${chain.displayName} head read failed: ${msg(e)}` };
  }

  let receipt: Receiptish | null;
  try {
    receipt = await reader.getTransactionReceipt(hash as `0x${string}`);
  } catch (e) {
    // Providers signal "no such transaction" by throwing as often as by returning null and the
    // two are indistinguishable from the shape of the error alone. Treating a thrown error as
    // absence is exactly the mistake that turns an outage into a wave of false accusations, so
    // anything thrown is `unknown`.
    return {
      found: "unknown",
      chain,
      reason: `${chain.displayName} receipt read failed: ${msg(e)}`,
    };
  }

  if (receipt === null) {
    return {
      found: false,
      chain,
      checkedAtBlock: head,
      reason: `no transaction with this hash on ${chain.displayName} at block ${head}`,
    };
  }

  return {
    found: true,
    chain,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    from: receipt.from,
    to: receipt.to,
    checkedAtBlock: head,
  };
}

function msg(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return m.length > 160 ? `${m.slice(0, 157)}...` : m;
}

function short(v: unknown): string {
  const s = String(v ?? "");
  return s.length <= 24 ? s : `${s.slice(0, 21)}...`;
}
