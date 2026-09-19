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

/** How far down the ladder this claim got. */
export type Rung = "declared" | "resolvable" | "intact" | "parsed" | "true";

export type Outcome =
  /** The described payment is on the chain the document names. */
  | "true"
  /** We read that chain successfully and it is not there. */
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
  now?: () => Date;
};

export async function judge(input: VerdictInput): Promise<Verdict> {
  const checkedAt = (input.now?.() ?? new Date()).toISOString();
  const base = { checkedAt };

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

  // true
  const loc: LocateOutcome = await locate(p.claim.network, p.claim.txHash, input.readerFor);
  const declared = {
    declaredNetwork: p.claim.network === undefined ? undefined : String(p.claim.network),
    declaredTx: p.claim.txHash === undefined ? undefined : String(p.claim.txHash),
    mapping: p.mapping,
    hashMatches: true,
    computedHash: i.computed,
  };

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
    reason: `cited transaction is on ${loc.chain.displayName} at block ${loc.blockNumber}`,
  };
}
