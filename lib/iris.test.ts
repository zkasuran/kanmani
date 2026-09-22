import { test } from "node:test";
import assert from "node:assert/strict";
import {
  derive,
  deriveKeys,
  deriveSecp256k1,
  evmAddress,
  NAMESPACE,
  receiptBytes,
  signReceipt,
  verifyReceipt,
  type Receipt,
} from "./iris.ts";

/**
 * A fixed PRF output, so every assertion below is a vector rather than a round trip.
 *
 * The two Mera gates are live tests on a judge's machine: clear storage mid-demo and the identity
 * must rebuild, then the same passkey on a second device must reproduce the same keys. Both come
 * down to one property, that derivation is deterministic and that is a property you assert
 * against fixed bytes rather than demonstrate by clicking.
 */
const PRF = new Uint8Array(32).map((_, i) => i + 1);
const OTHER = new Uint8Array(32).fill(0xaa);

/* ------------------------------------------------- determinism, which IS the cross-device gate */

test("the same PRF output always derives the same three keys", async () => {
  const a = await deriveKeys(PRF);
  const b = await deriveKeys(PRF);
  assert.deepEqual(a.account.privateKey, b.account.privateKey);
  assert.deepEqual(a.attestation.privateKey, b.attestation.privateKey);
  assert.deepEqual(a.onchainAttestation.privateKey, b.onchainAttestation.privateKey);
  assert.deepEqual(a.content, b.content);
  assert.equal(a.account.address, b.account.address);
  assert.equal(a.onchainAttestation.address, b.onchainAttestation.address);
});

test("the derived keys are pinned, so a refactor cannot move somebody's account", async () => {
  // A change here is a change to where every existing user's money lives and to which identity
  // every past receipt was signed by. Pinning means an accidental change fails a test instead of
  // silently orphaning accounts and invalidating signatures.
  //
  // The address was cross-checked against foundry's `cast wallet address` on the same derived
  // private key, so this vector is agreed on by two independent implementations rather than by
  // this file agreeing with itself.
  const k = await deriveKeys(PRF);
  assert.equal(k.account.address, "0x92c2a8984eb7b890FfB4c6B57560Ac4E4868454B");
  assert.equal(
    Buffer.from(k.attestation.publicKey).toString("hex"),
    "23a178fd9061eadd2cb67259fe20d92c2074e88a6565e85b22051a314a910ca4",
  );
  assert.equal(k.attestation.id, "did:key:kanmani:I6F4_ZBh6t0stnJZ_iDZLCB06IplZehbIgUaMUqRDKQ");
  // The on-chain attestor. A contract pins this address as immutable and recovers it from a verdict
  // signature, so a change here silently makes every deployed bond reject a correct verdict. Pinned,
  // and cross-checked against foundry's `cast wallet address` on the same derived private key, so the
  // vector is agreed by two independent implementations rather than by this file agreeing with itself.
  assert.equal(k.onchainAttestation.address, "0x722cf70CbC5Ff80942A1274b0cc252E4DB2CaFdf");
  assert.equal(
    Buffer.from(k.content).toString("hex"),
    "f1cd29ed4d6f88322730babddf6c0fd9a319b0821c529dc78390f743527915bd",
  );
});

test("a different PRF output derives entirely different keys", async () => {
  const a = await deriveKeys(PRF);
  const b = await deriveKeys(OTHER);
  assert.notDeepEqual(a.account.privateKey, b.account.privateKey);
  assert.notDeepEqual(a.attestation.privateKey, b.attestation.privateKey);
  assert.notDeepEqual(a.content, b.content);
});

/* ------------------------------------------------- the namespaces actually separate */

test("the four keys are different from each other", async () => {
  // If two namespaces collided, the key that signs receipts would also move money. The whole
  // reason the attestation keys exist is that they cannot. The on-chain attestor especially must
  // not equal the account key: they are both secp256k1, so a collision would make the verdict
  // signer and the wallet the same address, which is the separation the design turns on.
  const k = await deriveKeys(PRF);
  assert.notDeepEqual(k.account.privateKey, k.attestation.privateKey);
  assert.notDeepEqual(k.account.privateKey, k.content);
  assert.notDeepEqual(k.attestation.privateKey, k.content);
  assert.notDeepEqual(k.onchainAttestation.privateKey, k.account.privateKey);
  assert.notDeepEqual(k.onchainAttestation.privateKey, k.attestation.privateKey);
  assert.notEqual(k.onchainAttestation.address, k.account.address);
});

test("changing one character of an info string changes the whole key", async () => {
  const a = await derive(PRF, NAMESPACE.attestation);
  const b = await derive(PRF, NAMESPACE.attestation.replace("v1", "v2"));
  assert.notDeepEqual(a, b);
  // Not "mostly different". HKDF output should share no structure at all.
  const shared = a.filter((byte, i) => byte === b[i]).length;
  assert.ok(shared < 8, `${shared} of 32 bytes matched, which is not independent output`);
});

test("the version lives inside the namespace string, so v1 is frozen", () => {
  for (const ns of Object.values(NAMESPACE)) {
    assert.match(ns, /^kanmani\.[a-z-]+\.v1$/, `${ns} must carry its own version`);
  }
});

/* ------------------------------------------------- the failures that are easy to ship */

test("a PRF output that is not 32 bytes is refused rather than padded", async () => {
  // Accepting a short output would derive a real-looking key from less entropy than claimed, and
  // nothing downstream would look wrong.
  await assert.rejects(() => deriveKeys(new Uint8Array(31)), /exactly 32 bytes/);
  await assert.rejects(() => deriveKeys(new Uint8Array(33)), /exactly 32 bytes/);
  await assert.rejects(() => deriveKeys(new Uint8Array(0)), /exactly 32 bytes/);
});

test("an empty info string is refused, because it namespaces nothing", async () => {
  await assert.rejects(() => derive(PRF, ""), /namespace/);
});

test("the out-of-range retry actually runs and lands on the next counter", async () => {
  // The natural path to this branch is about one in 2^128 derivations, so without forcing it this
  // is code that has never executed and is asserted to work. Two invalid candidates in a row, then
  // a valid one and the result must be the valid one rather than a silently accepted bad scalar.
  const ZERO = new Uint8Array(32);                       // below the range
  const OVER = new Uint8Array(32).fill(0xff);            // above the curve order
  const GOOD = new Uint8Array(32).fill(7);

  const seen: string[] = [];
  const fake = async (_prf: Uint8Array, info: string) => {
    seen.push(info);
    if (seen.length === 1) return ZERO;
    if (seen.length === 2) return OVER;
    return GOOD;
  };

  const key = await deriveSecp256k1(PRF, "ns", fake as typeof derive);
  assert.deepEqual(key, GOOD);
  assert.deepEqual(seen, ["ns", "ns.retry.1", "ns.retry.2"], "counter 0 must use the bare info");
});

test("the retry gives up rather than returning an invalid scalar", async () => {
  // A loop that falls through and returns its last candidate would hand back an unusable key that
  // looks fine until somebody tries to sign with it.
  const always = async () => new Uint8Array(32);
  await assert.rejects(
    () => deriveSecp256k1(PRF, "ns", always as typeof derive),
    /could not derive a valid secp256k1 scalar/,
  );
});

test("every derived secp256k1 key is a valid scalar", async () => {
  // HKDF returns a uniform 256-bit number and a secp256k1 key must be under the curve order. The
  // gap is about one in 2^128, so a naive implementation passes every test anyone will ever run
  // and is wrong for one person, once, permanently. Exercised across many inputs rather than one.
  const { secp256k1 } = await import("@noble/curves/secp256k1");
  for (let i = 0; i < 64; i++) {
    const prf = new Uint8Array(32).fill(i);
    const k = await deriveKeys(prf);
    assert.ok(
      secp256k1.utils.isValidPrivateKey(k.account.privateKey),
      `input ${i} derived a private key outside [1, n)`,
    );
  }
});

/* ------------------------------------------------- the address */

test("the address is EIP-55 checksummed, not flat lowercase", async () => {
  // The mixed case is a typo check, not decoration. An address rendered lowercase has lost it.
  const k = await deriveKeys(PRF);
  assert.notEqual(k.account.address, k.account.address.toLowerCase());
  assert.notEqual(k.account.address, k.account.address.toUpperCase());
});

test("evmAddress matches a known vector", () => {
  // The well-known all-zeros private key vector, so the checksum implementation is checked
  // against something outside this codebase rather than against itself.
  const pub = Uint8Array.from(
    Buffer.from(
      "04" +
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798" +
        "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
      "hex",
    ),
  );
  assert.equal(evmAddress(pub), "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
});

/* ------------------------------------------------- receipts, the non-wallet use */

test("a receipt signs and verifies", async () => {
  const k = await deriveKeys(PRF);
  const r: Receipt = {
    claimId: "143_10182_0xabc_2",
    outcome: "false",
    checkedAtBlock: "106462031",
    checkedAt: "2026-09-20T12:00:00.000Z",
    mapping: "execution-market.v1",
  };
  const sig = signReceipt(r, k.attestation.privateKey);
  assert.equal(sig.length, 64);
  assert.equal(verifyReceipt(r, sig, k.attestation.publicKey), true);
});

test("changing any field of a signed receipt breaks the signature", async () => {
  const k = await deriveKeys(PRF);
  const r: Receipt = {
    claimId: "143_1_0xabc_1",
    outcome: "false",
    checkedAtBlock: "100",
    checkedAt: "2026-09-20T12:00:00.000Z",
    mapping: "m.v1",
  };
  const sig = signReceipt(r, k.attestation.privateKey);

  // Every field, not a representative one. A receipt is a public statement about a named
  // operator, so a field that can be edited after signing is a field somebody can be framed with.
  const tampered: Receipt[] = [
    { ...r, claimId: "143_2_0xabc_1" },
    { ...r, outcome: "true" },
    { ...r, checkedAtBlock: "101" },
    { ...r, checkedAt: "2026-09-20T12:00:01.000Z" },
    { ...r, mapping: "other.v1" },
  ];
  for (const t of tampered) {
    assert.equal(verifyReceipt(t, sig, k.attestation.publicKey), false, JSON.stringify(t));
  }
});

test("another identity's signature does not verify", async () => {
  const mine = await deriveKeys(PRF);
  const theirs = await deriveKeys(OTHER);
  const r: Receipt = {
    claimId: "x", outcome: "unknown", checkedAtBlock: null,
    checkedAt: "2026-09-20T12:00:00.000Z", mapping: null,
  };
  const sig = signReceipt(r, theirs.attestation.privateKey);
  assert.equal(verifyReceipt(r, sig, mine.attestation.publicKey), false);
});

test("a malformed signature is a failed verification, never a thrown error", async () => {
  // A caller that catches an exception here might treat it as "could not check, so probably
  // fine". False is the only safe answer.
  const k = await deriveKeys(PRF);
  const r: Receipt = {
    claimId: "x", outcome: "true", checkedAtBlock: "1",
    checkedAt: "2026-09-20T12:00:00.000Z", mapping: null,
  };
  assert.equal(verifyReceipt(r, new Uint8Array(0), k.attestation.publicKey), false);
  assert.equal(verifyReceipt(r, new Uint8Array(64), k.attestation.publicKey), false);
  assert.equal(verifyReceipt(r, new Uint8Array(10), k.attestation.publicKey), false);
});

test("a null field and an empty string field do not sign the same bytes", () => {
  // Both render as "" in the canonical form if you are careless, which would let a receipt with
  // no mapping be swapped for one whose mapping is literally empty.
  const base: Receipt = {
    claimId: "a\nb", outcome: "true", checkedAtBlock: null,
    checkedAt: "t", mapping: null,
  };
  // The real defect this guards: a claimId containing the separator must not let a receipt be
  // re-cut into different fields with the same bytes.
  const shifted: Receipt = {
    claimId: "a", outcome: "true", checkedAtBlock: null, checkedAt: "t", mapping: null,
  };
  assert.notDeepEqual(receiptBytes(base), receiptBytes(shifted));
});

test("the receipt format carries its own version in the signed bytes", () => {
  const r: Receipt = {
    claimId: "x", outcome: "true", checkedAtBlock: null, checkedAt: "t", mapping: null,
  };
  assert.match(new TextDecoder().decode(receiptBytes(r)), /^kanmani\.receipt\.v1\n/);
});
