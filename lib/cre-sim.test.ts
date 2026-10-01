import test from "node:test";
import assert from "node:assert/strict";

import { creSimulation, validateCreSimulation } from "./cre-sim.ts";

/**
 * The CRE simulation shown on /bond, pinned to the real recorded values.
 *
 * These numbers are a measurement a judge can recompute at the liveCheck URL, so a later edit that
 * quietly changed them would be the exact failure this project attacks. Each test fails loudly if a
 * value drifts, and the negative test proves the loader refuses a mangled 8.1 paste rather than
 * rendering garbage.
 */

const SCLERA = "0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf";

test("the featured run carries the real 1-of-42, 238 bps measurement", () => {
  assert.deepEqual(creSimulation().featured.measured, {
    sampleSize: 42,
    trueCount: 1,
    unknownCount: 0,
    rateBps: 238,
  });
});

test("the verbatim simulation output is kept, not reworded", () => {
  assert.ok(
    creSimulation().featured.log.includes(
      "measured 1/42 claims true = 238bps (0 undecided, excluded from both sides)",
    ),
    "the real 238 bps log line must survive verbatim",
  );
});

test("the external call is named exactly: the chain read and the HTTP GET", () => {
  const call = creSimulation().externalCall;
  assert.ok(call.chainRead.includes("bonds("), "chainRead must name the bonds( call");
  assert.ok(call.chainRead.includes(SCLERA), "chainRead must carry the Sclera address");
  assert.ok(
    call.httpGet.startsWith("GET https://kanmani.xyz/api/sla/"),
    "httpGet must be the real /api/sla endpoint",
  );
});

test("the chain-half companion reads a real deployed bond's terms", () => {
  const log = creSimulation().bondRead.log;
  assert.ok(log.includes("floor 8000bps"), "the bond read must carry the real floor");
  assert.ok(log.includes("nonce 1"), "the bond read must carry the real nonce");
});

test("the validator throws on a bad paste rather than rendering garbage", () => {
  const good = creSimulation();

  // Missing featured.measured.rateBps.
  const noRate = structuredClone(good) as Record<string, unknown>;
  delete (((noRate.featured as Record<string, unknown>).measured) as Record<string, unknown>).rateBps;
  assert.throws(() => validateCreSimulation(noRate), /rateBps must be an integer/);

  // featured.log is not an array.
  const badLog = structuredClone(good) as Record<string, unknown>;
  (badLog.featured as Record<string, unknown>).log = "not an array";
  assert.throws(() => validateCreSimulation(badLog), /featured\.log must be a non-empty array/);

  // Not an object at all.
  assert.throws(() => validateCreSimulation(null), /not an object/);
});
