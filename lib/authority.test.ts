/**
 * Tests for authority over an agent.
 *
 * The load-bearing ones are the two that protect a person rather than a number: that a failure to
 * reach the API is `unknown` and never `notOwner`, and that a receipt cannot be verified against a
 * key it does not name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveKeys } from "./iris.ts";
import {
  actionReceiptBytes,
  agentScope,
  checkAuthority,
  hashUri,
  signAction,
  verifyAction,
  verifyBinding,
  type ActionReceipt,
} from "./authority.ts";

const PRF = new Uint8Array(32).fill(7);
const OTHER_PRF = new Uint8Array(32).fill(9);

/** A fetch stand-in, so these run with no network and no server. */
function fakeFetch(status: number, body?: unknown): typeof fetch {
  return (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

/* ------------------------------------------------------------------ ownership */

test("the owner is recognised regardless of address casing", async () => {
  const mixed = "0x350Ef06F11e87731476D567b3e5E5d865dcd6657";
  const a = await checkAuthority(10182, mixed.toLowerCase() as `0x${string}`, fakeFetch(200, { data: { owner: mixed } }));
  assert.equal(a.kind, "owner", "EIP-55 casing is a checksum, not an identity");
});

test("a different owner is reported with both addresses, not just refused", async () => {
  const a = await checkAuthority(
    10182,
    "0x1111111111111111111111111111111111111111",
    fakeFetch(200, { data: { owner: "0x2222222222222222222222222222222222222222" } }),
  );
  assert.equal(a.kind, "notOwner");
  if (a.kind === "notOwner") {
    // A mismatch is usually the wrong passkey, not an attack, so the page must be able to say which
    // account it expected.
    assert.equal(a.owner, "0x2222222222222222222222222222222222222222");
    assert.equal(a.connected, "0x1111111111111111111111111111111111111111");
  }
});

test("a 404 means there is no such agent, which is a different action rather than a refusal", async () => {
  const a = await checkAuthority(999999, "0x1111111111111111111111111111111111111111", fakeFetch(404));
  assert.equal(a.kind, "noSuchAgent");
});

test("a failure to look is unknown and never notOwner", async () => {
  const boom = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const a = await checkAuthority(10182, "0x1111111111111111111111111111111111111111", boom);
  assert.equal(a.kind, "unknown", "our outage must not tell somebody they do not own their agent");
  if (a.kind === "unknown") assert.match(a.reason, /network down/);

  const five = await checkAuthority(10182, "0x1111111111111111111111111111111111111111", fakeFetch(500));
  assert.equal(five.kind, "unknown");

  const noOwner = await checkAuthority(10182, "0x1111111111111111111111111111111111111111", fakeFetch(200, { data: {} }));
  assert.equal(noOwner.kind, "unknown", "a record with no owner field is unknown, not unowned");
});

/* ------------------------------------------------------------------ receipts */

test("a receipt signs and verifies against the identity it names", async () => {
  const keys = await deriveKeys(PRF);
  const { receipt, signature } = signAction(
    { action: "register", chainId: 143, agentId: null, agentURI: "data:application/json;base64,e30=" },
    keys,
  );
  assert.equal(verifyAction(receipt, signature), true);
  assert.equal(receipt.agentId, null, "a registration has no id until the registry assigns one");
  assert.equal(receipt.signer, keys.account.address);
  assert.equal(receipt.identity, keys.attestation.id);
});

test("the signing identity is not the wallet, so a receipt grants no spending power", async () => {
  const keys = await deriveKeys(PRF);
  const { receipt } = signAction(
    { action: "setAgentURI", chainId: 143, agentId: 10252, agentURI: "data:x" },
    keys,
  );
  // The identity is a did:key over ed25519. The EVM cannot recover it, which is the point.
  assert.match(receipt.identity, /^did:key:kanmani:/);
  assert.notEqual(receipt.identity as string, receipt.signer as string);
});

test("a receipt cannot be verified against a key it does not name", async () => {
  const mine = await deriveKeys(PRF);
  const theirs = await deriveKeys(OTHER_PRF);
  const { receipt, signature } = signAction(
    { action: "setAgentURI", chainId: 143, agentId: 10252, agentURI: "data:x" },
    mine,
  );
  const forged: ActionReceipt = { ...receipt, identity: theirs.attestation.id };
  assert.equal(verifyAction(forged, signature), false);
});

test("changing any field breaks the signature", async () => {
  const keys = await deriveKeys(PRF);
  const { receipt, signature } = signAction(
    { action: "setAgentURI", chainId: 143, agentId: 10252, agentURI: "data:one" },
    keys,
  );
  for (const mutate of [
    (r: ActionReceipt) => ({ ...r, action: "register" as const }),
    (r: ActionReceipt) => ({ ...r, chainId: 56 }),
    (r: ActionReceipt) => ({ ...r, agentId: 10253 }),
    (r: ActionReceipt) => ({ ...r, uriHash: hashUri("data:two") }),
    (r: ActionReceipt) => ({ ...r, at: new Date(0).toISOString() }),
  ]) {
    assert.equal(verifyAction(mutate(receipt), signature), false, "every field must be covered");
  }
});

test("a malformed signature or identity is a failed verification, never a throw", async () => {
  const keys = await deriveKeys(PRF);
  const { receipt } = signAction({ action: "register", chainId: 143, agentId: null, agentURI: "d" }, keys);
  assert.equal(verifyAction(receipt, "not-base64-!!"), false);
  assert.equal(verifyAction({ ...receipt, identity: "nonsense" }, "AAAA"), false);
});

test("the receipt commits to the document by hash, so two documents cannot share one receipt", () => {
  assert.notEqual(hashUri("data:one"), hashUri("data:two"));
  assert.match(hashUri("data:one"), /^0x[0-9a-f]{64}$/);
});

test("canonical bytes are stable and fully ordered", async () => {
  const keys = await deriveKeys(PRF);
  const { receipt } = signAction({ action: "register", chainId: 143, agentId: null, agentURI: "d" }, keys);
  const a = new TextDecoder().decode(actionReceiptBytes(receipt));
  assert.equal(a.split("\n")[0], "kanmani.agent-action.v1");
  assert.equal(a.split("\n").length, 8, "every field is present even when empty");
  // A null agentId is an empty line rather than the string "null", so it cannot collide with an id.
  assert.equal(a.split("\n")[3], "");
});

/* ------------------------------------------------------------------ scope */

test("an agent action is scoped to authority rather than to a spend", () => {
  const s = agentScope("register", "kanmani.xyz");
  assert.equal(s.maxAmountAtomic, 0n, "a registration moves no token");
  assert.match(s.label, /Moves no token/);
  assert.equal(s.resourceHost, "kanmani.xyz");
  assert.notEqual(agentScope("setAgentURI", "kanmani.xyz").label, s.label);
});

test("the account-key binding proves the signer, and a swapped signer address fails it", async () => {
  const keys = await deriveKeys(PRF);
  const signed = signAction(
    { action: "register", chainId: 143, agentId: null, agentURI: "ipfs://doc" },
    keys,
  );
  // Both halves check out for a genuine receipt: the identity signed it and the signer address is
  // proven controlled by the same person.
  assert.equal(verifyAction(signed.receipt, signed.signature), true);
  assert.equal(verifyBinding(signed.receipt, signed.binding), true);
  assert.equal(signed.receipt.signer, keys.account.address);

  // The attack: name someone else's address as the signer. The binding no longer recovers to it,
  // so a receipt cannot claim an address its author does not control.
  const forged: ActionReceipt = { ...signed.receipt, signer: "0x1111111111111111111111111111111111111111" };
  assert.equal(verifyBinding(forged, signed.binding), false);
})
