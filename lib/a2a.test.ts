import assert from "node:assert/strict";
import test from "node:test";
import { inputFromParts } from "./a2a.ts";

test("a data part is read as the call", () => {
  assert.deepEqual(inputFromParts([{ kind: "data", data: { agentId: 10182, maxAgeBlocks: 64 } }]), { agentId: 10182, maxAgeBlocks: 64 });
});
test("a JSON text part is read as the call", () => {
  assert.deepEqual(inputFromParts([{ kind: "text", text: '{"agentId":"10256"}' }]), { agentId: 10256 });
});
test("plain text yields the first number as the agent id", () => {
  assert.equal(inputFromParts([{ kind: "text", text: "is agent 10182 worth hiring?" }]).agentId, 10182);
});
test("a probe's greeting yields no agent id", () => {
  assert.deepEqual(inputFromParts([{ kind: "text", text: "hello, are you there?" }]), {});
  assert.deepEqual(inputFromParts(undefined), {});
});
