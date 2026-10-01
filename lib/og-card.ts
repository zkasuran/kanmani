/**
 * The figures on the link card, read live and held for ten minutes.
 *
 * The card used to be a PNG with the figures typed in on 2026-09-25, so every share kept saying
 * "85 checked, 73 did not resolve" long after the site said otherwise. Now the card is drawn from
 * the same query as the home page. `version` goes into the image URL, so a platform that caches
 * previews per URL fetches a new card when the figures or the day change rather than keeping the
 * old one forever.
 */
import { measurement } from "./queries.ts";

export type CardFigures = { claims: number; notOnNamedChain: number; day: string } | null;

let memo: { at: number; v: CardFigures } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function cardFigures(now = Date.now()): Promise<CardFigures> {
  if (memo && now - memo.at < TTL_MS) return memo.v;
  let v: CardFigures = null;
  try {
    const m = (await measurement()).rows;
    if (Number.isFinite(m.paymentClaims) && m.paymentClaims > 0) {
      v = { claims: m.paymentClaims, notOnNamedChain: m.doNotResolve, day: new Date(now).toISOString().slice(0, 10) };
    }
  } catch {
    // Unknown is not a number. A card without figures is better than a card with wrong ones.
    v = null;
  }
  memo = { at: now, v };
  return v;
}

/** The line under the headline. With no live figures it says only where to look. */
export function cardLine(f: CardFigures): string {
  if (!f) return "kanmani.xyz";
  return `${f.claims.toLocaleString("en-US")} payment claims checked, ${f.notOnNamedChain.toLocaleString("en-US")} not on the chain they name · ${f.day}`;
}

/** Changes whenever what the card says changes, so cached previews are replaced. */
export function cardVersion(f: CardFigures): string {
  return f ? `${f.claims}-${f.notOnNamedChain}-${f.day}` : "none";
}
