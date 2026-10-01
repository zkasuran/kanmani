/**
 * Time-to-first-transaction, as a measurement rather than a claim.
 *
 * The bounty scores "taps and seconds from landing page to confirmed Monad transaction". A number
 * with no run behind it is worth nothing, so the page records a real run and this module is the one
 * definition of the per-run string and the aggregate math, shared by the widget, the API route and a
 * test. Pure, so the summary is asserted with no browser and no database.
 *
 * Two honesty rules live here. The passkey confirmation is counted separately from in-app taps,
 * because the OS prompt is a user-agent surface the page cannot see and folding it into "taps" would
 * silently undercount. And an empty set is `count: 0` with null stats, never a fake zero, because the
 * one thing this whole site refuses to do is render a number nobody has.
 */

export type RunSource = "real" | "ci";
export type RunNet = "mainnet" | "testnet";

/** One measured run. */
export type RunMetric = {
  /** Primary pointerdowns inside the app. One physical tap is one. The OS prompt is not in here. */
  appTaps: number;
  /** How many passkey ceremonies the flow invoked. Counted apart from taps. */
  passkeyPrompts: number;
  /** performance.now() at a confirmed receipt minus t0 at first mount. */
  elapsedMs: number;
};

export type RunSummary = {
  count: number;
  medianMs: number | null;
  worstMs: number | null;
  bestMs: number | null;
  medianTaps: number | null;
};

/** Continuous median, matching Postgres percentile_cont(0.5), so the route and this agree. */
function percentileCont(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0]!;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

/**
 * Reduce runs to the figures a judge reads: median, worst, best, median taps.
 *
 * An empty set is count 0 with null stats. A single run is its own median, worst and best.
 */
export function summarize(rows: RunMetric[]): RunSummary {
  if (rows.length === 0) {
    return { count: 0, medianMs: null, worstMs: null, bestMs: null, medianTaps: null };
  }
  const ms = rows.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const taps = rows.map((r) => r.appTaps).sort((a, b) => a - b);
  return {
    count: rows.length,
    medianMs: percentileCont(ms, 0.5),
    worstMs: ms[ms.length - 1]!,
    bestMs: ms[0]!,
    medianTaps: percentileCont(taps, 0.5),
  };
}

/** The exact on-screen per-run line, with the taps and the passkey confirmation stated apart. */
export function formatRun(m: RunMetric): string {
  const taps = `${m.appTaps} tap${m.appTaps === 1 ? "" : "s"}`;
  const prompts = `${m.passkeyPrompts} passkey confirmation${m.passkeyPrompts === 1 ? "" : "s"}`;
  return `${taps} plus ${prompts}, ${(m.elapsedMs / 1000).toFixed(1)} s`;
}

/** Seconds for display, one decimal, or the word for the unknown case the UI must never fake. */
export function secondsOrUnknown(ms: number | null): string {
  return ms === null ? "unknown" : `${(ms / 1000).toFixed(1)} s`;
}
