/**
 * The `settled` rung: has a payment to this agent provably cleared?
 *
 * `locate` answers whether a cited transaction exists on the chain a document names. That is not
 * the same question. A transaction can exist, sit on the right chain and still have moved nothing
 * to the agent: it can revert, it can pay somebody else, it can move a different token. So this
 * rung reads the receipt rather than its existence, finds the transfer then checks who got what.
 *
 * ## What has to be true for a `true`
 *
 * | | why it is not enough on its own |
 * |---|---|
 * | the receipt exists | a reverted transaction has a receipt |
 * | it did not revert | a successful transaction can pay a different address |
 * | a transfer to the claimed recipient | it can be a different token or a token id |
 * | deep enough to rely on | a receipt one block old can still be reorganised away |
 *
 * ## Two rails, because both are live on Monad
 *
 * An ERC-20 payment leaves a `Transfer` log. A native payment leaves no log at all, so its value
 * has to be read off the transaction. `prooflines.org` prices its own endpoints in native MON under
 * a `monad-native-exact` scheme while offering USDC `exact` beside it, measured 2026-09-23, so
 * handling only the token rail would report half of one agent's offers as unsettled.
 *
 * ## The amount is compared only when it can be
 *
 * **A claimed amount is compared only when the document wrote it in atomic units.** A document
 * saying `"0.1"` cannot be checked against `100000` on chain without reading `decimals()` from the
 * token. This module does not read it. AUSD on Monad is 6 decimals where the same code on BSC
 * met 18, so a guessed conversion is wrong by 1e12 and wrong in the direction of a confident false.
 * When the amount cannot be compared the check says so in the reason and records
 * `amountCompared: false` rather than quietly passing or quietly failing.
 *
 * ## The payer is recorded, never required
 *
 * Under the x402 `exact` scheme a facilitator submits the transaction on the buyer's behalf, so the
 * sender is routinely not the buyer. Requiring the payer to match would fail every settlement that
 * used the rail the way it is designed.
 */
import { keccak256, toHex } from "viem";
import { resolveChain, type Chain } from "../chains.ts";

/**
 * `Transfer(address,address,uint256)`.
 *
 * Derived rather than pasted, so it cannot be a remembered constant that is subtly wrong. Value at
 * load: `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`.
 */
export const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));

/**
 * How deep a receipt has to be before it counts as settled.
 *
 * **This is our own floor, not a claim about Monad's consensus.** A receipt in the head block is on
 * chain and can still be reorganised away, so calling it settled would publish a claim that a later
 * read could contradict. Two is deliberately small, because the cost of waiting is a later answer
 * and the cost of not waiting is a wrong one.
 */
export const MIN_CONFIRMATIONS = 2n;

/** One log, as little of it as this rung needs. */
export type Log = {
  /** The contract that emitted it. For a token payment this is the token. */
  address: string;
  topics: readonly string[];
  data: string;
};

export type SettlementReceipt = {
  blockNumber: bigint;
  status: "success" | "reverted";
  from: string;
  to: string | null;
  logs: readonly Log[];
};

/** A native transfer has no log, so its value comes off the transaction itself. */
export type NativeTransfer = { to: string | null; value: bigint };

/** Just the reads this rung needs, so a test can supply them without a chain. */
export type SettlementReader = {
  getBlockNumber(): Promise<bigint>;
  getReceipt(hash: `0x${string}`): Promise<SettlementReceipt | null>;
  getNativeTransfer(hash: `0x${string}`): Promise<NativeTransfer | null>;
};

export type SettlementReaderFor = (chain: Chain) => SettlementReader | null;

/**
 * What is being checked. Built either from a parsed payment claim or from an agent's own
 * `x402Support` object, which on Monad carries a self-declared settlement transaction.
 */
export type SettlementClaim = {
  txHash: unknown;
  network: unknown;
  /** The address the payment is claimed to have reached. Without it there is nothing to match. */
  recipient: unknown;
  /** A token address or `native`. Absent means both rails get checked. */
  asset?: unknown;
  /** Atomic units, when the document wrote them that way. See the note on decimals above. */
  amount?: unknown;
  /** The address the document says SENT the payment, when it states one. Used to flag self-funding. */
  payer?: unknown;
};

/** One transfer read off the chain, normalised across the token rail and the native one. */
export type ObservedTransfer = {
  asset: string;
  from: string;
  to: string;
  value: bigint;
};

export type SettledOutcome =
  | {
      settled: true;
      chain: Chain;
      blockNumber: bigint;
      confirmations: bigint;
      transfer: ObservedTransfer;
      /** False when the claim wrote an amount this rung refused to convert. Read the reason. */
      amountCompared: boolean;
      /**
       * True when the value reaching the recipient came from the recipient itself (a self-transfer)
       * or from a payer the document itself names as the recipient. A self-funded transfer clears a
       * transfer but is NOT evidence of an arm's-length payment, so a consumer that scores "real
       * demand" must weigh it lower. It does NOT catch a two-wallet sybil wash, which is undetectable
       * on chain without external identity.
       */
      selfFunded: boolean;
      checkedAtBlock: bigint;
      reason: string;
    }
  /** We read the chain successfully and the value did not reach the claimed recipient. */
  | {
      settled: false;
      chain: Chain;
      checkedAtBlock: bigint;
      /** Present when a receipt was found and it simply does not say what was claimed. */
      blockNumber?: bigint;
      /** Every transfer the transaction did make, so a reader can see what it actually did. */
      transfers: ObservedTransfer[];
      reason: string;
    }
  /** We could not look or it is too early to say. Never an accusation. */
  | { settled: "unknown"; reason: string; chain?: Chain };

const TX_HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const NATIVE = "native";

/**
 * Decode one `Transfer` log by hand.
 *
 * **A four-topic `Transfer` is skipped and that is load bearing.** ERC-721 shares the exact same
 * event signature with `tokenId` indexed as a third topic, so its `data` is empty and its topic
 * count is four. Reading a token id as an amount would let an NFT move settle a payment claim for
 * any number at all.
 */
export function decodeTransfer(log: Log): ObservedTransfer | null {
  const topics = log.topics ?? [];
  if ((topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) return null;
  if (topics.length !== 3) return null;

  const from = addressFromTopic(topics[1]!);
  const to = addressFromTopic(topics[2]!);
  if (from === null || to === null) return null;

  const data = (log.data ?? "").trim();
  // A fungible Transfer carries a 32 byte value. Anything else is a log wearing the signature of
  // one, so it is not read rather than being read optimistically.
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(data)) return null;

  let value: bigint;
  try {
    value = BigInt(data);
  } catch {
    return null;
  }
  return { asset: (log.address ?? "").toLowerCase(), from, to, value };
}

function addressFromTopic(topic: string): string | null {
  const t = (topic ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(t)) return null;
  const addr = `0x${t.slice(26)}`;
  return ADDRESS.test(addr) ? addr : null;
}

/**
 * Read a claimed amount as atomic units or refuse.
 *
 * Refusing is the point. A decimal string, a float, a value with a symbol attached: none of those
 * can be compared to an on chain integer without the token's own `decimals()`, so they come back
 * null and the caller records that the amount was not compared.
 */
export function atomicAmount(v: unknown): bigint | null {
  if (typeof v === "bigint") return v >= 0n ? v : null;
  if (typeof v === "number") {
    return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d+$/.test(s)) return null;
  return BigInt(s);
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Normalise a claimed asset to a token address, the native marker or undefined.
 *
 * Undefined means the document did not say, which is not the same as saying native. Both rails get
 * checked in that case, because guessing one and reporting no value moved would be a false built
 * on our own assumption.
 */
export function normaliseAsset(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "") return undefined;
  if (s === NATIVE || s === "mon" || s === "eth" || s === "0x0" || /^0x0{40}$/.test(s)) return NATIVE;
  return ADDRESS.test(s) ? s : undefined;
}

/**
 * @param claim     what the document says happened
 * @param readerFor supplies a reader per chain or null when that chain is not configured
 */
export async function settledCheck(
  claim: SettlementClaim,
  readerFor: SettlementReaderFor,
  opts: { minConfirmations?: bigint } = {},
): Promise<SettledOutcome> {
  const minConfirmations = opts.minConfirmations ?? MIN_CONFIRMATIONS;

  const hash = String(claim.txHash ?? "").trim().toLowerCase();
  if (!TX_HASH.test(hash)) {
    // Not a failed lookup and not a false either. There is no claim well formed enough to check.
    return { settled: "unknown", reason: `cited transaction is not a 32 byte hash: ${short(claim.txHash)}` };
  }

  const recipient = String(claim.recipient ?? "").trim().toLowerCase();
  if (!ADDRESS.test(recipient)) {
    // The rung is "a payment to THIS agent". With no recipient there is nothing to match against
    // and any answer would be about a different question.
    return { settled: "unknown", reason: `no recipient address to check against: ${short(claim.recipient)}` };
  }

  const lookup = resolveChain(claim.network);
  if (!lookup.known) return { settled: "unknown", reason: lookup.reason };
  const chain = lookup.chain;

  const reader = readerFor(chain);
  if (!reader) {
    return { settled: "unknown", chain, reason: `no RPC configured for ${chain.displayName}` };
  }

  let head: bigint;
  try {
    head = await reader.getBlockNumber();
  } catch (e) {
    return { settled: "unknown", chain, reason: `${chain.displayName} head read failed: ${msg(e)}` };
  }

  let receipt: SettlementReceipt | null;
  try {
    receipt = await reader.getReceipt(hash as `0x${string}`);
  } catch (e) {
    // Providers signal "no such transaction" by throwing as often as by returning null, so a throw
    // is unknown. Treating it as absence is how an outage becomes a wave of automated accusations.
    return { settled: "unknown", chain, reason: `${chain.displayName} receipt read failed: ${msg(e)}` };
  }

  if (receipt === null) {
    return {
      settled: false,
      chain,
      checkedAtBlock: head,
      transfers: [],
      reason: `no transaction with this hash on ${chain.displayName} at block ${head}`,
    };
  }

  // Depth is checked before the receipt is interpreted, not after. A receipt too shallow to rely on
  // gives the same answer whatever it says, because a reorg would take the revert and the transfer
  // away together.
  const confirmations = head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n;
  if (confirmations < minConfirmations) {
    return {
      settled: "unknown",
      chain,
      reason:
        `the cited transaction is ${confirmations} ${confirmations === 1n ? "block" : "blocks"} deep on ` +
        `${chain.displayName}, below the ${minConfirmations} this check requires before calling a payment settled`,
    };
  }

  if (receipt.status === "reverted") {
    return {
      settled: false,
      chain,
      checkedAtBlock: head,
      blockNumber: receipt.blockNumber,
      transfers: [],
      reason:
        `the cited transaction reverted on ${chain.displayName} at block ` +
        `${receipt.blockNumber}, so no value moved`,
    };
  }

  const wantAsset = normaliseAsset(claim.asset);
  const transfers: ObservedTransfer[] = [];

  // The token rail. Skipped only when the claim explicitly names native, so a claim that says
  // nothing still gets its logs read.
  if (wantAsset !== NATIVE) {
    for (const log of receipt.logs ?? []) {
      const t = decodeTransfer(log);
      if (t === null) continue;
      if (wantAsset !== undefined && !sameAddress(t.asset, wantAsset)) continue;
      transfers.push(t);
    }
  }

  // The native rail. Read when the claim names native. Read too when it named nothing and no
  // log matched, because a claim with no asset could be on either rail.
  const needNative = wantAsset === NATIVE || (wantAsset === undefined && transfers.length === 0);
  if (needNative) {
    let native: NativeTransfer | null;
    try {
      native = await reader.getNativeTransfer(hash as `0x${string}`);
    } catch (e) {
      return {
        settled: "unknown",
        chain,
        reason: `${chain.displayName} transaction read failed: ${msg(e)}`,
      };
    }
    if (native && native.to !== null && native.value > 0n) {
      transfers.push({ asset: NATIVE, from: receipt.from, to: native.to.toLowerCase(), value: native.value });
    }
  }

  const toRecipient = transfers.filter((t) => sameAddress(t.to, recipient));
  if (toRecipient.length === 0) {
    return {
      settled: false,
      chain,
      checkedAtBlock: head,
      blockNumber: receipt.blockNumber,
      transfers,
      reason:
        transfers.length === 0
          ? `the cited transaction succeeded on ${chain.displayName} at block ` +
            `${receipt.blockNumber} and moved no ` +
            `${wantAsset === undefined ? "value" : describeAsset(wantAsset)} at all`
          : `the cited transaction moved ${transfers.length} ` +
            `${transfers.length === 1 ? "transfer" : "transfers"} on ${chain.displayName} at ` +
            `block ${receipt.blockNumber}, none of them to ${recipient}`,
    };
  }

  const want = claim.amount === undefined || claim.amount === null ? null : atomicAmount(claim.amount);
  const amountStated = claim.amount !== undefined && claim.amount !== null && String(claim.amount).trim() !== "";

  // Sum rather than pick. A single payment is occasionally split across two transfers in one
  // transaction and picking the first would under-read it.
  const received = toRecipient.reduce((n, t) => n + t.value, 0n);
  const observed: ObservedTransfer = {
    asset: toRecipient[0]!.asset,
    from: toRecipient[0]!.from,
    to: recipient,
    value: received,
  };

  // Self-funded: the value reaching the recipient came from the recipient itself (every matched
  // transfer was sent by it), or the document names the payer as the recipient. The transfer is real
  // but it is not evidence that an independent party paid, so it is surfaced for a consumer to weigh.
  const declaredPayer = String(claim.payer ?? "").trim().toLowerCase();
  const selfFunded =
    toRecipient.every((t) => sameAddress(t.from, recipient)) ||
    (ADDRESS.test(declaredPayer) && sameAddress(declaredPayer, recipient));

  if (want !== null && received !== want) {
    return {
      settled: false,
      chain,
      checkedAtBlock: head,
      blockNumber: receipt.blockNumber,
      transfers,
      reason:
        `a transfer to ${recipient} cleared on ${chain.displayName} at block ${receipt.blockNumber} ` +
        `for ${received} atomic units where the document states ${want}`,
    };
  }

  // An amount that was stated but could not be read as atomic units leaves a real gap, so it is
  // named in the reason instead of being passed over. The transfer is still settled; the size of it
  // is what went unchecked.
  const amountCompared = want !== null;
  const gap =
    amountStated && !amountCompared
      ? `, amount ${short(claim.amount)} not compared because it is not in atomic units`
      : "";

  return {
    settled: true,
    chain,
    blockNumber: receipt.blockNumber,
    confirmations,
    transfer: observed,
    amountCompared,
    selfFunded,
    checkedAtBlock: head,
    reason:
      `${received} atomic units of ${describeAsset(observed.asset)} reached ${recipient} on ` +
      `${chain.displayName} at block ${receipt.blockNumber}, ${confirmations} blocks deep${gap}` +
      (selfFunded
        ? ", self-funded: the recipient supplied the value, so this is not evidence of an arm's-length payment"
        : ""),
  };
}

/* ------------------------------------------------------------------ helpers */

function describeAsset(asset: string): string {
  return asset === NATIVE ? `the ${NATIVE} token` : asset;
}

function msg(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return m.length > 160 ? `${m.slice(0, 157)}...` : m;
}

function short(v: unknown): string {
  const s = String(v ?? "");
  return s.length <= 24 ? s : `${s.slice(0, 21)}...`;
}
