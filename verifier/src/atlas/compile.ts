/**
 * Compile a declarative `MappingProposal` into a real `Mapping` the parser can run.
 *
 * The proposal is paths, not code. `compileMapping` turns those paths into `matches` and `extract`
 * exactly matching the `Mapping` interface in the ladder, so the parser treats an induced mapping
 * the same way it treats a hand-written one. Nothing here is evaluated as code, so a hostile or
 * wrong proposal can at worst read the wrong field, which the round-trip check then rejects.
 */

import type { Mapping, ParseOutcome, PaymentClaim } from "../ladder/parse.ts";
import type { MappingProposal } from "./model.ts";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Walk a dotted path. "a.b.c" reads doc.a.b.c, returning undefined at the first miss. */
export function getPath(doc: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = doc;
  for (const part of parts) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** True when every listed path resolves to a value that is present. */
function allPresent(doc: Record<string, unknown>, keys: readonly string[]): boolean {
  if (keys.length === 0) return false; // a mapping that matches everything is never specific enough
  return keys.every((k) => getPath(doc, k) !== undefined);
}

export function compileMapping(p: MappingProposal, induced: string): Mapping {
  const paths = p.claim;
  return {
    name: p.name,
    induced,
    note: p.note,
    matches: (d) => allPresent(d, p.matchKeys),
    extract: (d): ParseOutcome => {
      if (paths === null) {
        return { kind: "noClaim", mapping: p.name, note: p.note };
      }
      const claim: PaymentClaim = {
        network: paths.networkPath === undefined ? undefined : getPath(d, paths.networkPath),
        txHash: paths.txHashPath === undefined ? undefined : getPath(d, paths.txHashPath),
      };
      if (paths.recipientPath !== undefined) claim.recipient = getPath(d, paths.recipientPath);
      if (paths.payerPath !== undefined) claim.payer = getPath(d, paths.payerPath);
      if (paths.amountPath !== undefined) claim.amount = getPath(d, paths.amountPath);
      if (paths.tokenPath !== undefined) claim.token = getPath(d, paths.tokenPath);
      return { kind: "claim", mapping: p.name, claim };
    },
  };
}
