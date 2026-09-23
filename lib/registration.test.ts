/**
 * Tests for composing a registration document and the calldata that puts it on chain.
 *
 * The load-bearing ones are the two that protect a claim: that a payment assertion in a
 * registration document is caught, and that `data:` is what actually cannot rot. Everything else is
 * encoding.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import {
  EMPTY_DRAFT,
  IDENTITY_ABI,
  agentUri,
  buildRecord,
  byteLength,
  consequences,
  dataUri,
  problems,
  recordJson,
  registerCalldata,
  setAgentUriCalldata,
  type RegistrationDraft,
} from "./registration.ts";

const good: RegistrationDraft = {
  name: "Kanmani",
  description: "Checks whether the payment an evidence document describes actually happened.",
  url: "https://kanmani.xyz",
  skills: [{ id: "verify-payment-claim", endpoint: "https://kanmani.xyz/api/verify", x402: true }],
  refuses: ["returning false for a document we failed to fetch"],
};

test("an empty field is dropped rather than emitted as an empty string", () => {
  const rec = buildRecord({ ...EMPTY_DRAFT, name: "A" });
  assert.deepEqual(Object.keys(rec), ["name"]);
  // A field present and empty would be a claim that resolved to nothing.
  assert.equal("description" in rec, false);
  assert.equal("skills" in rec, false);
});

test("a skill with no id is not a skill", () => {
  const rec = buildRecord({ ...EMPTY_DRAFT, name: "A", skills: [{ id: "", endpoint: "https://x", x402: true }] });
  assert.equal("skills" in rec, false);
});

test("x402 becomes a payment field only when the flag is set", () => {
  const withPay = buildRecord(good).skills as Record<string, unknown>[];
  assert.equal(withPay[0]!.payment, "x402");
  const without = buildRecord({ ...good, skills: [{ ...good.skills[0]!, x402: false }] })
    .skills as Record<string, unknown>[];
  assert.equal("payment" in without[0]!, false);
});

test("key order is fixed, so the same draft always hashes to the same document", () => {
  const a = recordJson(good);
  const b = recordJson({ ...good });
  assert.equal(a, b);
  assert.deepEqual(Object.keys(JSON.parse(a)), ["name", "description", "url", "skills", "refuses"]);
});

test("a data: URI round trips and carries no host to ask", () => {
  const json = recordJson(good);
  const uri = dataUri(json);
  assert.match(uri, /^data:application\/json;base64,/);
  const decoded = atob(uri.slice("data:application/json;base64,".length));
  const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  assert.equal(new TextDecoder().decode(bytes), json);
});

test("byteLength counts UTF-8 rather than code units, because storage is paid in bytes", () => {
  assert.equal(byteLength("abc"), 3);
  assert.equal(byteLength("é"), 2);
  assert.equal(byteLength("😀"), 4);
});

test("register calldata decodes back to the exact URI, so what is shown is what is sent", () => {
  const uri = agentUri(good, "data");
  const data = registerCalldata(uri);
  const decoded = decodeFunctionData({ abi: IDENTITY_ABI, data });
  assert.equal(decoded.functionName, "register");
  assert.deepEqual(decoded.args, [uri]);
});

test("setAgentURI calldata carries the id and the new URI", () => {
  const data = setAgentUriCalldata(10252n, "data:application/json;base64,e30=");
  const decoded = decodeFunctionData({ abi: IDENTITY_ABI, data });
  assert.equal(decoded.functionName, "setAgentURI");
  assert.deepEqual(decoded.args, [10252n, "data:application/json;base64,e30="]);
});

test("a payment claim in a registration document is caught", () => {
  const sneaky: RegistrationDraft = {
    ...good,
    description: 'settled, see proof_of_payment payment_tx 0xdead and it is anchored',
  };
  const c = consequences(sneaky, "data").find((x) => x.label === "asserts no payment it has not received");
  assert.equal(c?.met, false, "a document mentioning a payment proof must not pass this consequence");

  const clean = consequences(good, "data").find((x) => x.label === "asserts no payment it has not received");
  assert.equal(clean?.met, true);
});

test("only data: satisfies the cannot-return-a-deletion consequence", () => {
  const asData = consequences(good, "data").find((x) => x.label === "cannot return a deletion");
  assert.equal(asData?.met, true);
  const asHttps = consequences(good, "https", "https://example.com/a.json").find(
    (x) => x.label === "cannot return a deletion",
  );
  assert.equal(asHttps?.met, false);
});

test("an endpoint is what separates a declared skill from a reachable one", () => {
  const declaredOnly = { ...good, skills: [{ id: "x", endpoint: "", x402: false }] };
  const c = consequences(declaredOnly, "data").find((x) => x.label === "has a callable endpoint");
  assert.equal(c?.met, false);
  assert.equal(consequences(good, "data").find((x) => x.label === "has a callable endpoint")?.met, true);
});

test("a draft with no name cannot ship", () => {
  assert.ok(problems({ ...good, name: "  " }, "data").some((p) => /name is required/i.test(p)));
  assert.deepEqual(problems(good, "data"), []);
});

test("a hosted record needs an absolute https URL", () => {
  assert.ok(problems(good, "https", "").some((p) => /Choose a URL/.test(p)));
  assert.ok(problems(good, "https", "example.com/a.json").some((p) => /absolute and https/.test(p)));
  assert.deepEqual(problems(good, "https", "https://example.com/a.json"), []);
});

test("a record over the reader's own byte cap is refused rather than silently truncated", () => {
  const huge: RegistrationDraft = { ...good, description: "x".repeat(70_000) };
  assert.ok(problems(huge, "data").some((p) => /65,536 byte cap/.test(p)));
  assert.equal(consequences(huge, "data").find((x) => x.label === "fits on chain")?.met, false);
});
