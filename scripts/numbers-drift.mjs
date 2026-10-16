/**
 * How far the live index may sit from the committed numbers snapshot before the canary calls the docs stale.
 *
 * The first rule was a flat 0.5% on population counts and exact on everything else. It failed every
 * scheduled run from 13 October on, for a reason that had nothing to do with the site being wrong: the
 * registry gains a few agents and a few dozen documents a day. A sweep also re-decides a handful of
 * "unknown" documents each time. A check that is red whenever the world moves teaches everyone to ignore
 * it, which is the failure its own comment warns about.
 *
 * So the allowance grows with the age of the snapshot. The figures that move because people register
 * are separated from the figures a sentence is built on:
 *
 * - Population counts (`GROWING`) may rise by 0.5% plus 1% for each day since the snapshot, capped at 25%.
 *   `agents` and `feedbacks` only ever grow, so a fall in either is not drift and always fails.
 * - Sweep state (`SWEEP_STATE`) is how many documents were last undecidable. It moves in both directions as
 *   new documents arrive and rate-limited hosts recover. It may move by the same relative allowance or by
 *   15, whichever is larger.
 * - Everything else is held exact: the claim and settlement figures and the test counts. If one of those
 *   moves, a sentence built on it may have stopped being true.
 */
export const GROWING = ["agents", "documents", "feedbacks", "withPointer", "goneAgents", "oneDocAgents", "oneDocWallets"];
export const APPEND_ONLY = ["agents", "feedbacks"];
export const SWEEP_STATE = ["unknown", "unknownHash", "unknownMapping", "unknownRateLimited"];

export const BASE_ALLOWANCE = 0.005;
export const PER_DAY_ALLOWANCE = 0.01;
export const MAX_ALLOWANCE = 0.25;
export const SWEEP_FLOOR = 15;

/** The relative allowance for a snapshot of this age. A negative age (a clock skew) counts as zero. */
export function allowance(ageDays) {
  const d = Number.isFinite(ageDays) && ageDays > 0 ? ageDays : 0;
  return Math.min(MAX_ALLOWANCE, BASE_ALLOWANCE + PER_DAY_ALLOWANCE * d);
}

/**
 * @param {string} key the snapshot key
 * @param {number} was the committed value
 * @param {number} now the live value
 * @param {number} ageDays days since the snapshot was taken
 * @returns {{ ok: boolean, within?: number }} ok when the difference is tolerated, with the allowance used
 */
export function driftVerdict(key, was, now, ageDays) {
  if (was === now) return { ok: true };
  const a = allowance(ageDays);
  if (GROWING.includes(key)) {
    if (APPEND_ONLY.includes(key) && now < was) return { ok: false };
    const rel = was === 0 ? Infinity : Math.abs(now - was) / was;
    return rel <= a ? { ok: true, within: a } : { ok: false };
  }
  if (SWEEP_STATE.includes(key)) {
    const room = Math.max(SWEEP_FLOOR, Math.ceil(was * a));
    return Math.abs(now - was) <= room ? { ok: true, within: a } : { ok: false };
  }
  return { ok: false };
}
