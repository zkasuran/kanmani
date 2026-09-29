import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData } from "viem";

import { adviceFor, checkRegistration, evidenceInput, parseRegistrationInput } from "./build.ts";
import { IDENTITY_ABI, IDENTITY_REGISTRY } from "./registration.ts";

const ok = <T,>(p: { ok: true; value: T } | { ok: false; errors: string[] }): T => {
  if (!p.ok) throw new Error(p.errors.join("; "));
  return p.value;
};

test("a minimal draft gives the register() calldata for an on-chain data: URI", () => {
  const r = checkRegistration(ok(parseRegistrationInput({ draft: { name: "Scout", description: "Finds things" } })));
  assert.equal(r.ready, true);
  assert.ok(r.agentURI.startsWith("data:application/json;base64,"));
  assert.equal(r.transaction?.to, IDENTITY_REGISTRY);
  const d = decodeFunctionData({ abi: IDENTITY_ABI, data: r.transaction!.data });
  assert.equal(d.functionName, "register");
  assert.equal(d.args?.[0], r.agentURI, "the calldata commits exactly the URI reported");
  assert.match(r.send!.cast, new RegExp(r.transaction!.data));
});

test("a missing name is a problem and nothing to send is returned", () => {
  const r = checkRegistration(ok(parseRegistrationInput({ draft: { description: "no name" } })));
  assert.equal(r.ready, false);
  assert.equal(r.transaction, null);
  assert.ok(r.problems.some((p) => /name is required/i.test(p)));
});

test("agentId switches to setAgentURI for that id", () => {
  const r = checkRegistration(ok(parseRegistrationInput({ draft: { name: "Scout" }, agentId: "10256" })));
  const d = decodeFunctionData({ abi: IDENTITY_ABI, data: r.transaction!.data });
  assert.equal(d.functionName, "setAgentURI");
  assert.equal(d.args?.[0], 10256n);
});

test("a lenient shape is read, a guess that would change the registration is refused", () => {
  const v = ok(parseRegistrationInput({ name: "Flat", skills: { id: "s", endpoint: "https://x", x402: "true" } }));
  assert.equal(v.draft.name, "Flat");
  assert.equal(v.draft.skills[0]?.x402, true);
  for (const bad of [{ kind: "ipfs" }, { chainId: 1 }, { agentId: "12a" }, { sender: "0x12" }]) {
    const p = parseRegistrationInput({ draft: { name: "x" }, ...bad });
    assert.equal(p.ok, false, JSON.stringify(bad));
  }
  assert.equal(parseRegistrationInput([]).ok, false);
});

test("evidence: object, JSON string and data: URI are accepted; URLs are refused, never fetched", () => {
  assert.ok("dataUri" in evidenceInput({ document: { a: 1 } }));
  assert.ok("dataUri" in evidenceInput({ document: '{"a":1}' }));
  assert.ok("dataUri" in evidenceInput({ document: "data:application/json,%7B%7D" }));
  for (const u of ["https://evil.example/x.json", "http://127.0.0.1/", "ipfs://bafy..."]) {
    const r = evidenceInput({ document: u });
    assert.ok("error" in r && /does not fetch URLs/.test(r.error), u);
  }
  assert.ok("error" in evidenceInput({ document: "not json" }));
  assert.ok("error" in evidenceInput({}));
  assert.ok("error" in evidenceInput({ document: "x".repeat(200_001) }));
});

test("advice for a mislabelled network names the one field to change", () => {
  const a = adviceFor({ outcome: "false", rung: "parsed", reason: "", declaredNetwork: "monad" }, "The cited transaction is on arbitrum.");
  assert.ok(a.some((x) => /network field from "monad"/.test(x)));
  assert.ok(adviceFor({ outcome: null, rung: "declared", reason: "x" }, null).some((x) => /not the same as false/.test(x)));
});
