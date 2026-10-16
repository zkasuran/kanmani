/**
 * The canary's tolerance for a snapshot that is behind the live index.
 *
 * It exists because the flat 0.5% rule failed every scheduled run from 13 October. The cases below are the
 * readings that run actually saw, so the rule is held against the evidence that changed it, plus the cases
 * it must still refuse: a figure a sentence is built on moving. It must also refuse a count that can only grow, falling.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowance, driftVerdict, MAX_ALLOWANCE } from "../scripts/numbers-drift.mjs";

test("the allowance starts at half a percent and grows a percent a day to a cap", () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} is not ${b}`);
  near(allowance(0), 0.005);
  near(allowance(1), 0.015);
  near(allowance(3), 0.035);
  assert.equal(allowance(500), MAX_ALLOWANCE);
});

test("a clock skew or a missing age is treated as a fresh snapshot, never a negative allowance", () => {
  assert.equal(allowance(-4), allowance(0));
  assert.equal(allowance(Number.NaN), allowance(0));
});

test("identical values always pass", () => {
  assert.deepEqual(driftVerdict("agents", 10_390, 10_390, 0), { ok: true });
  assert.deepEqual(driftVerdict("claimsFalse", 123, 123, 99), { ok: true });
});

/* The readings the failing scheduled runs saw against the 13 October snapshot (documents 2,119 etc.). */
test("the 13 October to 16 October readings are tolerated at the age they were taken", () => {
  // 21:26 on the 13th, about 0.4 day after a snapshot read at 11:06.
  assert.equal(driftVerdict("documents", 2_119, 2_137, 0.43).ok, true, "0.85% in under half a day");
  assert.equal(driftVerdict("feedbacks", 9_328, 9_392, 0.43).ok, true);
  assert.equal(driftVerdict("unknown", 15, 24, 0.43).ok, true, "nine more undecided documents");
  // 3 days on, on the 16th.
  assert.equal(driftVerdict("documents", 2_119, 2_141, 2.7).ok, true);
  assert.equal(driftVerdict("unknown", 15, 26, 2.7).ok, true);
  assert.equal(driftVerdict("unknownMapping", 0, 9, 2.7).ok, true, "a new document shape appearing");
});

test("a population count that grew far more than any registry day is still refused", () => {
  assert.equal(driftVerdict("agents", 10_390, 13_000, 1).ok, false, "25% in a day is not organic growth");
});

test("agents and feedbacks only grow, so a fall is never drift", () => {
  assert.equal(driftVerdict("agents", 10_390, 10_389, 30).ok, false);
  assert.equal(driftVerdict("feedbacks", 9_328, 9_000, 30).ok, false);
});

test("documents may fall, because an agent can change its registration document", () => {
  assert.equal(driftVerdict("documents", 2_119, 2_110, 1).ok, true);
});

test("the figures a sentence is built on get no tolerance at all", () => {
  for (const k of ["claimsFalse", "claimsTrue", "claimsElsewhere", "jobsSettled", "noClaim", "testsApp", "testsPassing", "testsVerifierTotal"]) {
    assert.equal(driftVerdict(k, 100, 101, 5).ok, false, k);
    assert.equal(driftVerdict(k, 100, 99, 5).ok, false, k);
  }
});

test("sweep state may move either way by the larger of fifteen or the allowance", () => {
  assert.equal(driftVerdict("unknown", 15, 30, 0).ok, true, "exactly fifteen");
  assert.equal(driftVerdict("unknown", 15, 31, 0).ok, false, "sixteen is past it");
  assert.equal(driftVerdict("unknownRateLimited", 7, 0, 0).ok, true, "hosts recovering");
  assert.equal(driftVerdict("unknown", 1_000, 1_200, 10).ok, false, "past ten percent of a thousand");
  assert.equal(driftVerdict("unknown", 1_000, 1_090, 10).ok, true);
});

test("a zero baseline on a population count is refused rather than divided", () => {
  assert.equal(driftVerdict("goneAgents", 0, 1, 1).ok, false);
});

test("however old the snapshot, growth past the cap is refused", () => {
  assert.equal(driftVerdict("agents", 10_000, 12_400, 500).ok, true, "24% is inside the 25% cap");
  assert.equal(driftVerdict("agents", 10_000, 13_000, 500).ok, false, "30% is past it");
});
