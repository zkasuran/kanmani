/**
 * The `parse` rung: find the payment claim inside a document somebody else designed.
 *
 * **These mappings are induced from real documents, then published.** A reader re-running the
 * pipeline executes them deterministically, with no model anywhere in the loop and gets the same
 * numbers. The model's job is to propose a mapping for a shape nobody has seen; the chain decides
 * every verdict. A proposal that cannot be confirmed against chain state is discarded rather than
 * trusted, so a wrong proposal costs a retry and can never produce a wrong `true`.
 *
 * ## What the documents on Monad actually look like, measured 2026-09-19
 *
 * Over all 1,192 feedbacks carrying a URI:
 *
 * | shape | count | cites a payment? |
 * |---|---|---|
 * | `data:` inline JSON | 1,095 | **no** |
 * | `https://execution.market/...` | 85 | yes |
 * | `https://grokandmon.com/...` | 10 | no, these are agent cards |
 * | `ipfs://` | 2 | not yet read |
 *
 * Decoding all 1,095 `data:` URIs gave 1,029 valid documents in exactly **two** shapes, a game ELO
 * record and a conversation score and **zero** of them contain a transaction hash, a network or
 * any payment field. That is the single most important fact about this corpus and it is stated
 * here rather than buried: **most ERC-8004 feedback on Monad is not a payment claim at all.**
 *
 * So `noClaim` is a first-class outcome, distinct from a claim we failed to read. A document that
 * never asserted a payment cannot be wrong about one and counting it as unparsed would inflate our
 * own gap number.
 */

export type PaymentClaim = {
  network: unknown;
  txHash: unknown;
  /** Present only in shapes that carry them. Absent is normal, not a defect. */
  payer?: unknown;
  recipient?: unknown;
  amount?: unknown;
  token?: unknown;
};

export type ParseOutcome =
  | { kind: "claim"; mapping: string; claim: PaymentClaim }
  /** Read fine and it simply does not claim a payment. Not a gap in our coverage. */
  | { kind: "noClaim"; mapping: string; note: string }
  /** We could not read it. This IS a gap and it gets reported as one. */
  | { kind: "unparsed"; reason: string; keys?: string[] };

export type Mapping = {
  readonly name: string;
  readonly induced: string;
  readonly note: string;
  /** Cheap structural test. Must be specific enough that two shapes never both match. */
  matches(doc: Record<string, unknown>): boolean;
  extract(doc: Record<string, unknown>): ParseOutcome;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * execution.market, the only shape on Monad that asserts a payment.
 *
 * ```json
 * { "network": "monad",
 *   "proof_of_payment": { "network": "monad", "payment_tx": "0x...", "status": "anchored" },
 *   "rating": { "target_address": "0x...", "score": 70 } }
 * ```
 *
 * The inner `proof_of_payment.network` wins over the outer `network` when both exist. The claim
 * being checked is the one attached to the payment and a document is free to be about one chain
 * while citing a transaction on another. Preferring the outer field would quietly rewrite what the
 * author said.
 */
export const executionMarket: Mapping = {
  name: "execution-market.v1",
  induced: "2026-09-19",
  note: "proof_of_payment.payment_tx, network from the inner object first",
  matches: (d) => isObj(d.proof_of_payment) && "payment_tx" in (d.proof_of_payment as object),
  extract(d) {
    const pop = d.proof_of_payment as Record<string, unknown>;
    const rating = isObj(d.rating) ? d.rating : undefined;
    return {
      kind: "claim",
      mapping: this.name,
      claim: {
        network: pop.network ?? d.network,
        txHash: pop.payment_tx,
        recipient: rating?.target_address,
      },
    };
  },
};

/**
 * execution.market again, an older shape putting the hash under `transactions` rather than
 * `proof_of_payment`. Same publisher, same claim, different key.
 *
 * ```json
 * { "network": "monad", "type": "execution_market_feedback", "version": "1.0",
 *   "transactions": { "payment_tx": "0x...", "reputation_tx": "" } }
 * ```
 *
 * Found by running the atlas over the live corpus and reading the 23 documents it could not place,
 * which is the point of reporting unparsed as a number rather than rounding it into noClaim. An
 * empty `payment_tx` stays a claim with an empty hash, so `locate` calls it unknown rather than
 * this file deciding the document asserted nothing.
 */
export const executionMarketTransactions: Mapping = {
  name: "execution-market-transactions.v1",
  induced: "2026-09-19",
  note: "older execution.market shape, hash under transactions.payment_tx",
  matches: (d) =>
    isObj(d.transactions) && "payment_tx" in (d.transactions as object) && !isObj(d.proof_of_payment),
  extract(d) {
    const txs = d.transactions as Record<string, unknown>;
    const rating = isObj(d.rating) ? d.rating : undefined;
    return {
      kind: "claim",
      mapping: this.name,
      claim: { network: d.network, txHash: txs.payment_tx, recipient: rating?.target_address },
    };
  },
};

/** The bulk of the corpus. A game rating, with no payment asserted. */
export const eloRecord: Mapping = {
  name: "elo-record.v1",
  induced: "2026-09-19",
  note: "1,026 of 1,029 decoded data: documents. Game rating, asserts no payment",
  matches: (d) => "elo" in d && "signal_type" in d,
  extract() {
    return { kind: "noClaim", mapping: eloRecord.name, note: "game rating, no payment asserted" };
  },
};

/** A conversation score. Also asserts no payment. */
export const conversationScore: Mapping = {
  name: "conversation-score.v1",
  induced: "2026-09-19",
  note: "3 of 1,029 decoded data: documents. Conversation rating, asserts no payment",
  matches: (d) => "conversationLogId" in d && "conversation_success" in d,
  extract() {
    return {
      kind: "noClaim",
      mapping: conversationScore.name,
      note: "conversation rating, no payment asserted",
    };
  },
};

/** An ERC-8004 agent card. Describes an agent rather than an event, so it claims nothing. */
export const agentCard: Mapping = {
  name: "agent-card.v1",
  induced: "2026-09-19",
  note: "grokandmon.com well-known cards. Capability description, asserts no payment",
  matches: (d) =>
    ("protocolVersion" in d || "capabilities" in d) && ("skills" in d || "url" in d || "name" in d),
  extract() {
    return { kind: "noClaim", mapping: agentCard.name, note: "agent card, no payment asserted" };
  },
};

/**
 * Prose. Not matched structurally, because it never reaches the atlas: a plain-text document fails
 * `JSON.parse` first. Declared here so the mapping has a name, a date and a note like every other,
 * and so coverage reporting can account for it rather than showing a blank.
 */
export const plainTextComment: Mapping = {
  name: "plain-text-comment.v1",
  induced: "2026-09-19",
  note: "66 data:text/plain documents on Monad. Free text, asserts no payment",
  matches: () => false,
  extract: () => ({ kind: "noClaim", mapping: "plain-text-comment.v1", note: "plain text" }),
};

/** The atlas. Order matters only in that a claim-bearing shape is tried before the generic ones. */
export const ATLAS: readonly Mapping[] = [
  executionMarket,
  executionMarketTransactions,
  eloRecord,
  conversationScore,
  agentCard,
];

export function parseDocument(
  raw: Uint8Array,
  atlas: readonly Mapping[] = ATLAS,
  mediaType?: string,
): ParseOutcome {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return { kind: "unparsed", reason: "not valid UTF-8" };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    // Not JSON. Whether that is a gap in our atlas or a perfectly good document depends entirely
    // on what the author said they were writing.
    //
    // 66 documents on Monad are `data:text/plain,Excellent%20service...`. Those are prose somebody
    // chose to write and prose asserts no payment, so they are noClaim. Counting them as unparsed
    // would inflate our own published coverage gap with documents that are not broken at all.
    //
    // Anything declaring itself JSON and failing to parse stays unparsed, because there the author
    // and the bytes genuinely disagree.
    if ((mediaType ?? "").startsWith("text/")) {
      return {
        kind: "noClaim",
        mapping: plainTextComment.name,
        note: `plain text the author wrote as ${mediaType}, no payment asserted`,
      };
    }
    return { kind: "unparsed", reason: `not valid JSON, declared as ${mediaType ?? "an unstated type"}` };
  }
  if (!isObj(doc)) return { kind: "unparsed", reason: `top level is ${Array.isArray(doc) ? "an array" : typeof doc}` };

  const hits = atlas.filter((m) => m.matches(doc));
  if (hits.length === 0) {
    // An unrecognised shape is a published gap, not a rounding error. The keys come back so the
    // shape can be added to the atlas rather than guessed at.
    return { kind: "unparsed", reason: "no mapping matches this shape", keys: Object.keys(doc).sort() };
  }
  if (hits.length > 1) {
    // Two mappings claiming one document means the atlas is ambiguous, which would make the
    // verdict depend on array order. Refuse rather than pick.
    return {
      kind: "unparsed",
      reason: `ambiguous, ${hits.map((m) => m.name).join(" and ")} both match`,
      keys: Object.keys(doc).sort(),
    };
  }
  return hits[0]!.extract(doc);
}
