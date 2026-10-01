/**
 * The funder's own funder: a second Nansen fact per cluster, one step up the funding graph.
 *
 * The first-funder sample (lib/funders.ts) says the sampled wallets in a cluster trace to one top
 * funder. This reads the next question back: who first funded that funder, and so how far up the
 * chain the setup reaches. It is the same 1-credit related-wallets endpoint applied to a new subject
 * (the funder, not the sampled wallets), written by the Nansen worker under the sample tag
 * `funder:<address>` so it never collides with the `cluster:<id>` sample rows.
 *
 * Read from the base table (not wallet_funder_latest) filtered to the funder tag, because a funder
 * address can also appear as a sampled wallet and the latest view keeps only one row per address.
 * Append-only like every fovea read: guarded try/catch to null, so a read before the first run or
 * before the rows exist shows nothing rather than erroring.
 */
import { q } from "./db.ts";

export type FunderReach = {
  /** The funder whose own funder we looked up (the subject of this row). */
  funder: string;
  status: "found" | "none" | "unknown";
  /** Who first funded the funder, when status is found. */
  reachFunder: string | null;
  reachFunderLabel: string | null;
  reachTx: string | null;
  checkedAt: string | null;
};

export const FUNDER_REACH_SQL = `
SELECT DISTINCT ON (address)
  address AS funder, status, funder AS reach_funder, funder_label AS reach_label,
  tx AS reach_tx, checked_at
FROM fovea.wallet_funder
WHERE sample LIKE 'funder:%' AND chain = 'monad'
ORDER BY address, checked_at DESC`;

export async function funderReach(): Promise<FunderReach[] | null> {
  try {
    const rows = await q<Record<string, string | null>>(FUNDER_REACH_SQL);
    return rows.map((r) => ({
      funder: r.funder!,
      status: (r.status as FunderReach["status"]) ?? "unknown",
      reachFunder: r.reach_funder,
      reachFunderLabel: r.reach_label || null,
      reachTx: r.reach_tx,
      checkedAt: r.checked_at ? new Date(r.checked_at).toISOString() : null,
    }));
  } catch {
    return null;
  }
}

/** The reach row for one funder address, or null. Case-insensitive on the address. */
export async function funderReachFor(funder: string): Promise<FunderReach | null> {
  const all = await funderReach();
  if (!all) return null;
  const want = funder.toLowerCase();
  return all.find((r) => r.funder.toLowerCase() === want) ?? null;
}
