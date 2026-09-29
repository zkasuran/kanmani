import assert from "node:assert/strict";
import test from "node:test";
import { softAuthenticator } from "./agent-passkey.fixture.ts";
import { byteIndexOf, derToRs, p256FromSpki, toAssertion, userVerified } from "./agent-passkey.ts";

test("the public key is read from SPKI and a non-P256 key is refused", () => {
  const a = softAuthenticator();
  const k = p256FromSpki(a.spki);
  assert.equal(k.x, BigInt("0x" + Buffer.from(a.pub.slice(1, 33)).toString("hex")));
  assert.equal(k.y, BigInt("0x" + Buffer.from(a.pub.slice(33)).toString("hex")));
  const ed = Buffer.from("302a300506032b6570032100" + "11".repeat(32), "hex");
  assert.throws(() => p256FromSpki(ed), /not a P-256/);
});

test("DER signatures decode to r and s, including leading-zero integers", () => {
  const a = softAuthenticator();
  const { signature } = a.get(new Uint8Array(32));
  const { r, s } = derToRs(signature);
  assert.ok(r > 0n && s > 0n);
  const padded = new Uint8Array([0x30, 0x08, 0x02, 0x02, 0x00, 0x81, 0x02, 0x02, 0x00, 0x82]);
  assert.deepEqual(derToRs(padded), { r: 0x81n, s: 0x82n });
  assert.throws(() => derToRs(new Uint8Array([0x31, 0])), /not DER/);
});

test("indices are byte offsets, so a non-ASCII origin does not shift them", () => {
  const json = '{"origin":"https://ké.example","type":"webauthn.get","challenge":"x"}';
  assert.equal(byteIndexOf(json, '"type":"webauthn.get"'), json.indexOf('"type"') + 1);
});

test("an assertion converts with both indices and the UV flag is read", () => {
  const a = softAuthenticator();
  const raw = a.get(new Uint8Array(32).fill(7));
  const x = toAssertion(raw);
  assert.equal(x.typeIndex, 1n);
  assert.ok(x.challengeIndex > 0n);
  assert.equal(userVerified(raw.authenticatorData), true);
  assert.equal(userVerified(a.get(new Uint8Array(32), 0x01).authenticatorData), false);
  assert.throws(() => toAssertion({ ...raw, clientDataJSON: new TextEncoder().encode('{"type":"webauthn.create"}') }), /not a WebAuthn assertion/);
});
