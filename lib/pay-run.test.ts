import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRun, secondsOrUnknown, summarize, type RunMetric } from "./pay-run.ts";

const run = (appTaps: number, passkeyPrompts: number, elapsedMs: number): RunMetric => ({
  appTaps,
  passkeyPrompts,
  elapsedMs,
});

test("an empty set is count 0 with null stats, never a fake zero", () => {
  assert.deepEqual(summarize([]), {
    count: 0,
    medianMs: null,
    worstMs: null,
    bestMs: null,
    medianTaps: null,
  });
});

test("a single run is its own median, worst and best", () => {
  assert.deepEqual(summarize([run(2, 1, 4200)]), {
    count: 1,
    medianMs: 4200,
    worstMs: 4200,
    bestMs: 4200,
    medianTaps: 2,
  });
});

test("the median matches percentile_cont, so the page and the SQL agree", () => {
  // Odd count: the middle value.
  assert.equal(summarize([run(2, 1, 1000), run(2, 1, 3000), run(2, 1, 9000)]).medianMs, 3000);
  // Even count: the interpolated midpoint of the two middle values.
  const s = summarize([run(2, 1, 1000), run(2, 1, 2000), run(2, 1, 4000), run(2, 1, 10000)]);
  assert.equal(s.medianMs, 3000);
  assert.equal(s.worstMs, 10000);
  assert.equal(s.bestMs, 1000);
});

test("median taps is reported alongside the seconds", () => {
  const s = summarize([run(2, 1, 1000), run(3, 1, 2000), run(4, 1, 3000)]);
  assert.equal(s.medianTaps, 3);
});

test("the per-run line states taps and the passkey confirmation apart", () => {
  assert.equal(formatRun(run(2, 1, 4210)), "2 taps plus 1 passkey confirmation, 4.2 s");
  assert.equal(formatRun(run(1, 1, 1000)), "1 tap plus 1 passkey confirmation, 1.0 s");
  assert.equal(formatRun(run(3, 2, 5990)), "3 taps plus 2 passkey confirmations, 6.0 s");
});

test("seconds render to one decimal, or the word for the unknown case", () => {
  assert.equal(secondsOrUnknown(4200), "4.2 s");
  assert.equal(secondsOrUnknown(null), "unknown");
});
