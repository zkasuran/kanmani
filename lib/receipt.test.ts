import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveKeys, signReceipt, verifyReceipt, receiptBytes, type Receipt } from "./iris.ts";

/**
 * The receipt-verification path, end to end, the way a stranger would exercise it.
 *
 * The point of the attestation identity is that somebody who does not trust us can check who
 * attested to a verdict. So these assert the properties that claim rests on: a good signature
 * verifies, a receipt altered by one field does not, and a different key does not. If any of those
 * three stopped holding, "signed by an identity that is not a wallet" would be decoration.
 */
const PRF = new Uint8Array(32).map((_, i) => i + 1);
const OTHER_PRF = new Uint8Array(32).fill(0xbb);

const RECEIPT: Receipt = {
  claimId: "143_10182_0x103040545AC5031A11E8C03dd11324C7333a13C7_7",
  outcome: "false",
  checkedAtBlock: "106462031",
  checkedAt: "2026-09-20T11:21:53.000Z",
  mapping: "execution-market.v1",
};

test("a receipt signed by the attestation key verifies under its public key", async () => {
  const k = await deriveKeys(PRF);
  const sig = signReceipt(RECEIPT, k.attestation.privateKey);
  assert.equal(sig.length, 64, "ed25519 signatures are 64 bytes");
  assert.equal(verifyReceipt(RECEIPT, sig, k.attestation.publicKey), true);
});

test("changing any signed field breaks the signature", async () => {
  // The whole value of a receipt is that its content cannot drift from what was attested. A
  // signature that survived an edited outcome would let somebody flip a verdict and keep the
  // attribution, which is worse than having no signature at all.
  const k = await deriveKeys(PRF);
  const sig = signReceipt(RECEIPT, k.attestation.privateKey);

  const mutations: Partial<Receipt>[] = [
    { claimId: RECEIPT.claimId + "8" },
    { outcome: "true" },
    { checkedAtBlock: "106462032" },
    { checkedAt: "2026-09-20T11:21:54.000Z" },
    { mapping: "elo-record.v1" },
  ];
  for (const m of mutations) {
    const tampered = { ...RECEIPT, ...m };
    assert.equal(
      verifyReceipt(tampered, sig, k.attestation.publicKey),
      false,
      `altering ${Object.keys(m)[0]} must break the signature`,
    );
  }
});

test("a different identity does not verify, so attribution actually attributes", async () => {
  const mine = await deriveKeys(PRF);
  const theirs = await deriveKeys(OTHER_PRF);
  const sig = signReceipt(RECEIPT, mine.attestation.privateKey);
  assert.equal(verifyReceipt(RECEIPT, sig, theirs.attestation.publicKey), false);
});

test("a malformed signature is a false, never a thrown exception", async () => {
  // A verify endpoint open to the public gets fed junk. It has to answer rather than crash.
  const k = await deriveKeys(PRF);
  assert.equal(verifyReceipt(RECEIPT, new Uint8Array(64), k.attestation.publicKey), false);
  assert.equal(verifyReceipt(RECEIPT, new Uint8Array(3), k.attestation.publicKey), false);
});

test("the signed bytes are canonical and reproducible by a third party", async () => {
  // Published in the endpoint's own response so somebody can rebuild the digest without our code.
  const bytes = receiptBytes(RECEIPT);
  const text = new TextDecoder().decode(bytes);
  assert.equal(
    text,
    [
      "kanmani.receipt.v1",
      RECEIPT.claimId,
      RECEIPT.outcome,
      RECEIPT.checkedAtBlock,
      RECEIPT.checkedAt,
      RECEIPT.mapping,
    ].join("\n"),
  );
});

test("the same passkey reproduces the same signature on any device", async () => {
  // This is the cross-device claim, asserted rather than demonstrated by clicking: derivation is
  // deterministic, so a second device signing the same receipt produces identical bytes.
  const a = await deriveKeys(PRF);
  const b = await deriveKeys(PRF);
  const sigA = signReceipt(RECEIPT, a.attestation.privateKey);
  const sigB = signReceipt(RECEIPT, b.attestation.privateKey);
  assert.deepEqual(sigA, sigB, "two devices, one passkey, byte-identical signatures");
  assert.equal(a.attestation.id, b.attestation.id, "and the same did:key");
});
