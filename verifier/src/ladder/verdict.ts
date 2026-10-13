/**
 * The verdict: one claim, walked down the ladder, with the reason it stopped where it did.
 *
 * Two rules govern everything here.
 *
 * **Never let a rung exceed its evidence.** A verdict says what was checked and no more. If the
 * document could not be fetched, nothing downstream of `resolvable` gets an opinion.
 *
 * **Never state intent.** "The cited transaction was not found on the network this document names"
 * is the sentence. "This agent is lying" is not and is not ours to say. Somebody's reputation is
 * attached to these strings and the difference between an observation and an accusation is the
 * whole reason this project claims to be worth reading.
 */
import type { FetchOutcome } from "../net/guard.ts";
import { intactCheck } from "./intact.ts";
import { parseDocument, type ParseOutcome } from "./parse.ts";
import { locate, type LocateOutcome, type ReaderFor } from "./locate.ts";
import { settledCheck, type SettlementReaderFor } from "./settled.ts";
import { EXPLORER_TX_MAPPING, explorerTx } from "./explorer.ts";

/** How far down the ladder this claim got. */
export type Rung = "declared" | "resolvable" | "intact" | "parsed" | "true";

export type Outcome =
  /**
   * The described payment happened. When a settlement reader is supplied and the claim names a
   * recipient this means the value provably reached that recipient on the named chain, not merely
   * that a transaction with the cited hash exists. Without a settlement reader, or for a claim that
   * names no recipient, it means a successful transaction with that hash is on the named chain.
   */
  | "true"
  /** We read that chain successfully and the payment is not there, or the cited transaction reverted. */
  | "false"
  /** The document asserts no payment, so there is nothing to be right or wrong about. */
  | "noClaim"
  /** We could not look or could not read. Never an accusation. */
  | "unknown";

export type Verdict = {
  rung: Rung;
  outcome: Outcome;
  /** Written for a stranger. Describes what was observed, never what anyone intended. */
  reason: string;
  declaredNetwork?: string;
  declaredTx?: string;
  /** Which atlas mapping read this document, so a reader can re-run the same one. */
  mapping?: string;
  hashMatches?: boolean;
  computedHash?: string;
  foundOnChain?: { chain: string; chainId: number; blockNumber: string };
  /** True only when the settlement rung matched a transfer to the recipient: the strong `true`. A
   *  `true` from the tx-exists fallback (no recipient to match) sets this false. */
  settlementChecked?: boolean;
  /** From the settlement rung: the claimed amount was compared in atomic units. */
  amountCompared?: boolean;
  /** From the settlement rung: the value was supplied by the recipient itself, so it is not evidence
   *  of an arm's-length payment. A consumer scoring real demand must weigh a self-funded true lower. */
  selfFunded?: boolean;
  /** A verdict is a measurement at a time, so both of these are always recorded. */
  checkedAt: string;
  checkedAtBlock?: string;
};

export type VerdictInput = {
  feedbackUri: string;
  feedbackHash: string;
  /** Carries the author's declared media type, which decides whether prose is a gap or a document. */
  fetched: FetchOutcome & { mediaType?: string };
  readerFor: ReaderFor;
  /**
   * When present, a claim that names a recipient is checked for real: the receipt is read and the
   * value has to reach that recipient before the outcome is `true`. Absent, the `true` rung can only
   * establish that a successful transaction with the cited hash exists on the named chain.
   */
  settlementReaderFor?: SettlementReaderFor;
  now?: () => Date;
};

export async function judge(input: VerdictInput): Promise<Verdict> {
  const checkedAt = (input.now?.() ?? new Date()).toISOString();
  const base = { checkedAt };

  // Evidence that is a block explorer link to one transaction. The URI is the commitment, so there is
  // no document to fetch or hash: read the chain the explorer belongs to for that hash. See explorer.ts.
  const ex = explorerTx(input.feedbackUri);
  if (ex) {
    const declared = {
      declaredNetwork: ex.network,
      declaredTx: ex.txHash,
      mapping: EXPLORER_TX_MAPPING,
    };
    const loc: LocateOutcome = await locate(ex.network, ex.txHash, input.readerFor);
    if (loc.found === "unknown") return { ...base, ...declared, rung: "parsed", outcome: "unknown", reason: loc.reason };
    if (loc.found === false) {
      return {
        ...base, ...declared, rung: "parsed", outcome: "false", checkedAtBlock: loc.checkedAtBlock.toString(),
        reason: `the evidence is a ${ex.host} link to a transaction that is not on ${loc.chain.displayName}: ${loc.reason}`,
      };
    }
    if (loc.status === "reverted") {
      return {
        ...base, ...declared, rung: "parsed", outcome: "false", checkedAtBlock: loc.checkedAtBlock.toString(),
        reason: `the evidence is a ${ex.host} link to a transaction that reverted on ${loc.chain.displayName} at block ${loc.blockNumber}, so no payment was effected`,
      };
    }
    return {
      ...base, ...declared, rung: "true", outcome: "true", checkedAtBlock: loc.checkedAtBlock.toString(),
      foundOnChain: { chain: loc.chain.displayName, chainId: loc.chain.id, blockNumber: loc.blockNumber.toString() },
      settlementChecked: false,
      reason:
        `the evidence is a ${ex.host} link to a successful transaction on ${loc.chain.displayName} at block ` +
        `${loc.blockNumber}. The link names no recipient, so who was paid is not checked`,
    };
  }

  // resolvable
  if (!input.fetched.ok) {
    return {
      ...base,
      rung: "declared",
      outcome: "unknown",
      reason: `evidence document could not be read: ${input.fetched.reason}`,
    };
  }

  // intact
  const i = intactCheck(input.fetched.bytes, input.feedbackHash);
  if (i.intact === "unknown") {
    return { ...base, rung: "resolvable", outcome: "unknown", reason: i.reason };
  }
  if (i.intact === false) {
    // Stop here deliberately. The bytes served are not the bytes committed, so any claim read out
    // of them is a claim about a different document than the one on chain. Parsing on would be
    // attributing words to an author who did not commit them.
    return {
      ...base,
      rung: "resolvable",
      outcome: "unknown",
      hashMatches: false,
      computedHash: i.computed,
      reason:
        "the bytes served now do not match the hash committed on chain, so this document cannot be " +
        "checked against what its author committed to",
    };
  }

  // parsed
  const p: ParseOutcome = parseDocument(input.fetched.bytes, undefined, input.fetched.mediaType);
  if (p.kind === "unparsed") {
    return {
      ...base,
      rung: "intact",
      outcome: "unknown",
      hashMatches: true,
      computedHash: i.computed,
      reason: `no published mapping reads this document shape: ${p.reason}`,
    };
  }
  if (p.kind === "noClaim") {
    return {
      ...base,
      rung: "parsed",
      outcome: "noClaim",
      mapping: p.mapping,
      hashMatches: true,
      computedHash: i.computed,
      reason: `${p.note}, so there is no payment claim to check`,
    };
  }

  // true / false / unknown: the payment either happened as described or it did not.
  const declared = {
    declaredNetwork: p.claim.network === undefined ? undefined : String(p.claim.network),
    declaredTx: p.claim.txHash === undefined ? undefined : String(p.claim.txHash),
    mapping: p.mapping,
    hashMatches: true,
    computedHash: i.computed,
  };

  // When a settlement reader is available and the claim names a recipient, run the real check: the
  // receipt has to exist, not revert, and move value to the claimed recipient. That is the whole
  // thesis, "a transaction with this hash exists" is not "this payment happened", so the web path and
  // the sweep run it rather than only the CLI. locate stays the fallback for a claim with no
  // recipient to match a payment against.
  const recipient = typeof p.claim.recipient === "string" ? p.claim.recipient.trim() : "";
  if (input.settlementReaderFor && /^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    const s = await settledCheck(
      {
        txHash: p.claim.txHash,
        network: p.claim.network,
        recipient,
        asset: p.claim.token,
        amount: p.claim.amount,
        payer: p.claim.payer,
      },
      input.settlementReaderFor,
    );
    if (s.settled === "unknown") {
      return { ...base, ...declared, rung: "parsed", outcome: "unknown", reason: s.reason };
    }
    if (s.settled === false) {
      return {
        ...base,
        ...declared,
        rung: "parsed",
        outcome: "false",
        checkedAtBlock: s.checkedAtBlock.toString(),
        reason: s.reason,
      };
    }
    return {
      ...base,
      ...declared,
      rung: "true",
      outcome: "true",
      checkedAtBlock: s.checkedAtBlock.toString(),
      foundOnChain: { chain: s.chain.displayName, chainId: s.chain.id, blockNumber: s.blockNumber.toString() },
      settlementChecked: true,
      amountCompared: s.amountCompared,
      selfFunded: s.selfFunded,
      reason: s.reason,
    };
  }

  const loc: LocateOutcome = await locate(p.claim.network, p.claim.txHash, input.readerFor);
  if (loc.found === "unknown") {
    return { ...base, ...declared, rung: "parsed", outcome: "unknown", reason: loc.reason };
  }
  if (loc.found === false) {
    return {
      ...base,
      ...declared,
      rung: "parsed",
      outcome: "false",
      checkedAtBlock: loc.checkedAtBlock.toString(),
      reason: loc.reason,
    };
  }
  // The transaction is on chain. A revert moved nothing, so it is a `false` rather than a `true`:
  // reading a reverted receipt as a settled payment is exactly the overclaim this rung exists against.
  if (loc.status === "reverted") {
    return {
      ...base,
      ...declared,
      rung: "parsed",
      outcome: "false",
      checkedAtBlock: loc.checkedAtBlock.toString(),
      reason: `cited transaction reverted on ${loc.chain.displayName} at block ${loc.blockNumber}, so no payment was effected`,
    };
  }
  return {
    ...base,
    ...declared,
    rung: "true",
    outcome: "true",
    checkedAtBlock: loc.checkedAtBlock.toString(),
    foundOnChain: {
      chain: loc.chain.displayName,
      chainId: loc.chain.id,
      blockNumber: loc.blockNumber.toString(),
    },
    settlementChecked: false,
    reason: `a successful transaction with this hash is on ${loc.chain.displayName} at block ${loc.blockNumber}`,
  };
}
