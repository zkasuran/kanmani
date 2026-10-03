import assert from "node:assert/strict";
import test from "node:test";

import { chargeFor } from "./metering.ts";
import type { AssayAnswer, SentinelAnswer } from "./agents.ts";

const sentinelAnswer = (o: Partial<SentinelAnswer>): SentinelAnswer => ({
  agentId: 1, verdict: "true", rung: null, measuredAtBlock: 1, ageBlocks: 1, ageSeconds: 1,
  withinBound: true, sampleSize: 0, note: null, reproduce: "", rederive: null, ...o,
});
const assayAnswer = (o: Partial<AssayAnswer>): AssayAnswer => ({
  agentId: 1, floorBps: null, premiumBps: null, sampleSize: 0, rate: null, quotedAtBlock: 1, refusalReason: null, reproduce: "", rederive: null, ...o,
});

test("sentinel refused on freshness costs nothing", () => {
  const c = chargeFor("sentinel", sentinelAnswer({ withinBound: false, sampleSize: 40 }), 10_000n);
  assert.equal(c.chargeAtomic, 0n);
  assert.equal(c.meter.used, 0);
});

test("a delivered answer costs the base plus one unit per decided claim read", () => {
  assert.equal(chargeFor("sentinel", sentinelAnswer({ sampleSize: 0 }), 10_000n).chargeAtomic, 2_000n);
  assert.equal(chargeFor("sentinel", sentinelAnswer({ sampleSize: 3 }), 10_000n).chargeAtomic, 5_000n);
  assert.equal(chargeFor("assay", assayAnswer({ sampleSize: 4 }), 10_000n).chargeAtomic, 6_000n);
});

test("the charge never exceeds the ceiling, however large the sample", () => {
  assert.equal(chargeFor("assay", assayAnswer({ sampleSize: 500 }), 10_000n).chargeAtomic, 10_000n);
});

test("the published meter recomputes to the charge", () => {
  const { meter, chargeAtomic } = chargeFor("assay", assayAnswer({ sampleSize: 3 }), 10_000n);
  const re = BigInt(meter.baseAtomic ?? "0") + BigInt(meter.used) * BigInt(meter.pricePerUnitAtomic);
  assert.equal(re, chargeAtomic);
});
