/**
 * Running the ladder from a page or an API call.
 *
 * The important property here is that this file contains **no verification logic at all**. It
 * resolves a document, hands the bytes to the same `judge` the sweep and the CLI use, and hands
 * back what came out. Website and command line cannot disagree about a verdict, because there is
 * only one of them.
 *
 * A second copy of the ladder "for the web, but simpler" is the exact way a site ends up showing
 * a different answer from its own tool, so there is not one.
 */
import { judge, type Verdict } from "../verifier/src/ladder/verdict.ts";
import { resolveEvidence } from "../verifier/src/ladder/resolve.ts";
import { readerFor } from "../verifier/src/rpc.ts";
import { coverageTable } from "../verifier/src/chains.ts";
import { keccak256 } from "viem";

export type CheckInput = {
  /** What to fetch. A `data:` URI, an https URL or an `ipfs://` reference. */
  uri: string;
  /**
   * The hash committed on chain, when the caller has one.
   *
   * Without it the `intact` rung cannot be decided, so the check runs with the hash of whatever
   * was served. The response says which of those two happened, because "the bytes match the
   * commitment" and "we hashed what we got" are very different statements and only one of them
   * is evidence.
   */
  feedbackHash?: string;
};

export type CheckResult = {
  verdict: Verdict;
  /** True when the caller supplied a commitment, so `intact` means something. */
  hashWasSupplied: boolean;
  bytesRead: number | null;
  mediaType: string | null;
  source: string | null;
  /** The chains a `false` was tested against. A negative means nothing without this list. */
  coverage: { chain: string; id: number; configured: boolean }[];
  /** Exactly what a reader can run to get the same answer. */
  reproduce: string;
};

export async function check(input: CheckInput): Promise<CheckResult> {
  const fetched = await resolveEvidence(input.uri);

  // When no commitment is supplied we hash what we were served, which makes `intact` trivially
  // true. That is not a verification and the flag below is how the response says so.
  const hashWasSupplied = Boolean(input.feedbackHash && /^0x[0-9a-fA-F]{64}$/.test(input.feedbackHash));
  const feedbackHash =
    hashWasSupplied && input.feedbackHash
      ? input.feedbackHash.toLowerCase()
      : fetched.ok
        ? keccak256(fetched.bytes)
        : "0x".padEnd(66, "0");

  const verdict = await judge({
    feedbackUri: input.uri,
    feedbackHash,
    fetched,
    readerFor: (c) => readerFor(c),
  });

  return {
    verdict,
    hashWasSupplied,
    bytesRead: fetched.ok ? fetched.bytes.length : null,
    mediaType: fetched.ok ? (fetched.mediaType ?? null) : null,
    source: fetched.ok ? (fetched.source ?? null) : null,
    coverage: coverageTable(),
    reproduce:
      verdict.declaredNetwork && verdict.declaredTx
        ? `node --experimental-strip-types verifier/src/cli/locate.ts ${verdict.declaredNetwork} ${verdict.declaredTx}`
        : `curl -sS '${input.uri.slice(0, 200)}'`,
  };
}
