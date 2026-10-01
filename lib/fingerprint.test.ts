import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveKeys } from "./iris.ts";
import { deviceFp, fpEqual, keyFp, normalizeFp } from "./fingerprint.ts";

/**
 * The fingerprints are the eyeball form of the cross-device gate. Identical PRF output must give
 * identical fingerprints on any device, which is a property asserted against a fixed vector rather
 * than demonstrated by clicking. The vectors below were computed once from the pinned PRF and are
 * frozen here, so a refactor that moves anyone's keys fails loudly, same discipline as iris.test.ts.
 */
const PRF = new Uint8Array(32).map((_, i) => i + 1);
const OTHER = new Uint8Array(32).fill(0xaa);

const PINNED_DEVICE = "fa1ec8de a5d08d1b 0a261330 91fc359b 0b47a926";
const PINNED_ROWS = {
  account: "fefa8cd1 a8e2693f 4246826d b3957ffd",
  attestation: "6dfc8223 e85391ea 09aaf0a7 9efe4987",
  onchain: "7e231e07 870f0d14 140c5f5c d7427dbe",
  content: "ddbd5c0c 5ef87159 083df261 19c7be8b",
};

test("the device fingerprint is pinned, so moving any key fails here", async () => {
  const k = await deriveKeys(PRF);
  assert.equal(await deviceFp(k), PINNED_DEVICE);
});

test("the same PRF gives the same device fingerprint, which IS cross-device", async () => {
  const a = await deviceFp(await deriveKeys(PRF));
  const b = await deviceFp(await deriveKeys(PRF));
  assert.equal(a, b);
});

test("a different passkey gives a different device fingerprint", async () => {
  const a = await deviceFp(await deriveKeys(PRF));
  const b = await deviceFp(await deriveKeys(OTHER));
  assert.notEqual(a, b);
});

test("each row fingerprint is pinned, stable and distinct from the others", async () => {
  const k = await deriveKeys(PRF);
  const account = await keyFp(k.account.publicKey);
  const attestation = await keyFp(k.attestation.publicKey);
  const onchain = await keyFp(k.onchainAttestation.publicKey);
  const content = await keyFp(k.content);

  assert.equal(account, PINNED_ROWS.account);
  assert.equal(attestation, PINNED_ROWS.attestation);
  assert.equal(onchain, PINNED_ROWS.onchain);
  assert.equal(content, PINNED_ROWS.content);

  // Stable: the same input hashes the same way twice.
  assert.equal(await keyFp(k.account.publicKey), account);

  // Distinct: four different keys must not collide to one fingerprint.
  const all = new Set([account, attestation, onchain, content]);
  assert.equal(all.size, 4, "two rows share a fingerprint");
});

test("the content key fingerprint reveals nothing about the key", async () => {
  // keyFp hashes its input, so the output must not contain the key material.
  const k = await deriveKeys(PRF);
  const fp = await keyFp(k.content);
  const keyHex = Buffer.from(k.content).toString("hex");
  assert.ok(!normalizeFp(fp).includes(keyHex.slice(0, 16)), "the fingerprint leaked key bytes");
});

test("comparison ignores spacing and case but not emptiness", () => {
  const fp = PINNED_DEVICE;
  assert.ok(fpEqual(fp, fp.toUpperCase()), "case must not cause a false mismatch");
  assert.ok(fpEqual(fp, fp.replace(/ /g, "")), "spacing must not cause a false mismatch");
  assert.ok(fpEqual(fp, `  ${fp}  `), "surrounding whitespace must not cause a false mismatch");
  assert.ok(!fpEqual("", ""), "two empty strings are not a match");
  assert.ok(!fpEqual(fp, PINNED_ROWS.account), "different fingerprints are not equal");
  assert.equal(normalizeFp("FA1E C8DE"), "fa1ec8de");
});
