import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { jobsLabel, plan, rowOf, SETTLED_TOPIC } from "./settled-jobs.ts";

const word = (n: number) => n.toString(16).padStart(64, "0");

test("the topic is the Settled event signature, computed rather than pasted", () => {
  assert.equal(SETTLED_TOPIC, keccak256(toHex("Settled(bytes32,address,address,uint256,uint256,uint256,address)")));
});

test("a Settled log reads paid from the second data word and the agent from topic 2", () => {
  const r = rowOf({
    transactionHash: "0xAB" + "cd".repeat(31),
    blockNumber: "0x69abc07",
    topics: [SETTLED_TOPIC, "0x" + "11".repeat(32), "0x" + "00".repeat(12) + "D68937ed886243bf5A44Bb0A9338Ee91bB8D2016"],
    data: "0x" + word(1) + word(500000) + word(0) + word(10) + word(2),
  });
  assert.equal(r.paidAtomic, 500000n);
  assert.equal(r.agent, "0xd68937ed886243bf5a44bb0a9338ee91bb8d2016");
  assert.equal(r.block, 0x69abc07);
});

test("scan ranges stay inside the provider's 1,000-block cap and stop at the head", () => {
  const p = plan(100, 2600);
  assert.deepEqual(p, [[101, 1100], [1101, 2100], [2101, 2600]]);
  assert.ok(p.every(([a, b]) => b - a + 1 <= 1000));
  assert.deepEqual(plan(500, 500), []);
  assert.equal(plan(0, 10_000_000, 1000, 40).length, 40);
});

test("label is singular for one", () => {
  assert.equal(jobsLabel(1), "1 job");
  assert.equal(jobsLabel(2), "2 jobs");
});
