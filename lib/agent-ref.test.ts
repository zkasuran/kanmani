import assert from "node:assert/strict";
import test from "node:test";
import { AgentRefError, parseAgentRef, resolveAgentRef } from "./agent-ref.ts";

const EX = '{ "agentId": 10252 }';
const REG = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const known = async (id: number) => id === 10252;

test("a bare agentId means Monad", () => {
  assert.deepEqual(parseAgentRef({ agentId: 10252 }, EX), { chainId: 143, agentId: 10252 });
  assert.deepEqual(parseAgentRef({ agentId: "10252" }, EX), { chainId: 143, agentId: 10252 });
});

test("the ERC-8004 reference forms carry their chain", () => {
  assert.deepEqual(parseAgentRef({ agent: `eip155:8453:${REG}:42` }, EX), { chainId: 8453, agentId: 42 });
  assert.deepEqual(parseAgentRef({ agentRegistry: `eip155:8453:${REG}`, agentId: 42 }, EX), { chainId: 8453, agentId: 42 });
  assert.deepEqual(parseAgentRef({ chainId: 8453, agentId: 42 }, EX), { chainId: 8453, agentId: 42 });
});

test("a Base agent is refused as not measured, never answered with Monad's agent of the same number", async () => {
  await assert.rejects(resolveAgentRef({ chainId: 8453, agentId: 10252 }, EX, known), (e: unknown) => {
    assert.ok(e instanceof AgentRefError);
    assert.equal(e.notMeasured, true);
    assert.match(e.message, /chain 8453 is not measured here/);
    return true;
  });
});

test("an id missing from the Monad index is refused, not answered unknown", async () => {
  await assert.rejects(resolveAgentRef({ agentId: 99999999 }, EX, known), (e: unknown) => e instanceof AgentRefError && e.notMeasured);
  assert.deepEqual(await resolveAgentRef({ agentId: 10252 }, EX, known), { chainId: 143, agentId: 10252 });
});

test("malformed references are input errors, not 'not measured'", () => {
  for (const bad of [{ agentId: 0 }, { agentId: "x" }, { agent: "8453:42" }, { agentRegistry: "base", agentId: 1 }, { chainId: -1, agentId: 1 }]) {
    assert.throws(() => parseAgentRef(bad, EX), (e: unknown) => e instanceof AgentRefError && !e.notMeasured);
  }
});

test("A2A prose: an ERC-8004 reference wins over the first number, which is the chain id", async () => {
  const { inputFromParts } = await import("./a2a.ts");
  const got = inputFromParts([{ kind: "text", text: `check agent eip155:8453:${REG}:42 before I hire it` }]);
  assert.equal(got.agent, `eip155:8453:${REG}:42`);
  assert.equal(got.agentId, undefined);
  assert.equal(inputFromParts([{ kind: "text", text: "check agent 10252" }]).agentId, 10252);
});
