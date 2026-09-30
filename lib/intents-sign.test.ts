import assert from "node:assert/strict";
import test from "node:test";
import { base58 } from "@scure/base";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress, bytesToHex } from "viem";
import { findMessageToSign, toIntentsSignature } from "./intents.ts";

const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

test("messageToSign is found wherever the service nests it", () => {
  assert.equal(findMessageToSign({ result: { details: { messageToSign: "m1" } } }), "m1");
  assert.equal(findMessageToSign({ messageToSign: "" , x: { messageToSign: "m2" } }), "m2");
  assert.equal(findMessageToSign({ result: {} }), null);
});

test("the Intents signature is secp256k1:base58(r||s||v01) and recovers to the signer", async () => {
  const msg = '{"deadline":"2026-10-02","intents":[{"intent":"auth_call"}]}';
  const hex = await acct.signMessage({ message: msg });
  const s = toIntentsSignature(hex);
  assert.match(s, /^secp256k1:[1-9A-HJ-NP-Za-km-z]+$/);
  const raw = base58.decode(s.slice("secp256k1:".length));
  assert.equal(raw.length, 65);
  assert.ok(raw[64] === 0 || raw[64] === 1, "v normalised to 0/1");
  const back = new Uint8Array(raw); back[64] += 27;
  assert.equal(await recoverMessageAddress({ message: msg, signature: bytesToHex(back) }), acct.address);
});

test("a malformed signature is refused, never sent", () => {
  assert.throws(() => toIntentsSignature("0x1234"));
});
