/**
 * The `intact` rung: are these the bytes that were committed on chain?
 *
 * `NewFeedback` carries `feedbackHash`, a bytes32 the author put on chain alongside a URI. This
 * recomputes keccak256 over what the URI actually served and compares.
 *
 * **What is hashed is the raw response, byte for byte, exactly as it arrived.** Never a re-encoded
 * copy. It is tempting to `JSON.parse` a document and hash the result, because then the hash is
 * stable against whitespace, but that is a different claim: it would prove the *meaning* survived,
 * where the author committed to *bytes*. Any re-encode changes key order, spacing, unicode escapes
 * and number formatting, so it would fail against honest documents and, worse, could be massaged
 * until it passed. `intactCheck` therefore takes `Uint8Array` and there is no string overload.
 *
 * A mismatch here is not an accusation. A document can be edited by its author for good reasons,
 * and the on-chain hash simply stops matching. The verdict says the bytes differ from the commitment
 * and stops there.
 */
import { keccak256 } from "viem";

export type IntactResult =
  | { intact: true; computed: `0x${string}` }
  | { intact: false; computed: `0x${string}`; committed: string; reason: string }
  /** The commitment itself was unusable, so nothing can be concluded either way. */
  | { intact: "unknown"; reason: string };

const BYTES32 = /^0x[0-9a-f]{64}$/;

/**
 * @param raw       the exact bytes the URI served
 * @param committed `feedbackHash` as it came off the `NewFeedback` event
 */
export function intactCheck(raw: Uint8Array, committed: string): IntactResult {
  const want = (committed ?? "").trim().toLowerCase();

  // A malformed or absent commitment is `unknown`, never `false`. There is nothing to compare
  // against and reporting that as a mismatch would blame a document for a gap in the record.
  if (!BYTES32.test(want)) {
    return { intact: "unknown", reason: `committed hash is not a bytes32: ${truncate(committed)}` };
  }
  // keccak256 of empty input is a real, well-known value, so an empty body would otherwise compare
  // as a legitimate hash. Call it out rather than let it look like a considered mismatch.
  if (raw.length === 0) {
    return { intact: "unknown", reason: "document was empty, nothing to hash" };
  }

  const computed = keccak256(raw);
  if (computed.toLowerCase() === want) return { intact: true, computed };

  return {
    intact: false,
    computed,
    committed: want,
    reason: "bytes served do not match the hash committed on chain",
  };
}

function truncate(s: string): string {
  const v = String(s ?? "");
  return v.length <= 24 ? v : `${v.slice(0, 21)}...`;
}
