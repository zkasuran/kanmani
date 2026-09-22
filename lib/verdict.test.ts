import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { deriveKeys } from "./iris.ts";
import { signVerdict, verdictDigest, VERDICT_TYPE, type Verdict } from "./verdict.ts";

/**
 * The whole point of this module is that a signature it makes is one the Sclera contract recovers to
 * the attestor. The contract is not in this test runner, so the test reproduces exactly what the
 * contract does: build the same digest, recover the signer from the 65-byte signature and assert it
 * equals the on-chain attestor address Iris derives. If the typehash, the field order or the domain
 * drifts from the contract, recovery lands on a different address and this fails.
 */
const PRF = new Uint8Array(32).map((_, i) => i + 1);
const CHAIN_ID = 143n;
// A stand-in Sclera address. The real one is set when the contract is deployed. The domain binds to
// it, which is why a signature is not portable to another deployment.
const SCLERA = "0x00000000000000000000000000000000000000cc" as const;

const V: Verdict = {
  agentId: 10182n,
  windowStart: 88_000_000n,
  windowEnd: 104_000_000n,
  sampleSize: 42n,
  trueCount: 1n,
  nonce: 1n,
};

/** Recover an EVM address from a 65-byte r||s||v signature over a digest, the way ecrecover does. */
function recover(digest: Uint8Array, sig65: `0x${string}`): string {
  const b = sig65.slice(2);
  const r = BigInt("0x" + b.slice(0, 64));
  const s = BigInt("0x" + b.slice(64, 128));
  const recovery = parseInt(b.slice(128, 130), 16) - 27;
  const point = new secp256k1.Signature(r, s).addRecoveryBit(recovery);
  const pub = point.recoverPublicKey(digest).toRawBytes(false).slice(1);
  const hash = keccak_256(pub);
  return "0x" + Buffer.from(hash.slice(12)).toString("hex");
}

test("the typehash string matches the contract's byte for byte", () => {
  // Copied here so a drift in either place is caught. If contracts/src/Sclera.sol changes the type,
  // this string must change with it, and the recover test below would fail first anyway.
  assert.equal(
    VERDICT_TYPE,
    "Verdict(uint256 agentId,uint64 windowStart,uint64 windowEnd,uint32 sampleSize,uint32 trueCount,uint64 nonce)",
  );
});

test("a verdict signed by the on-chain attestor recovers to the attestor address", async () => {
  const k = await deriveKeys(PRF);
  const sig = signVerdict(V, k.onchainAttestation.privateKey, CHAIN_ID, SCLERA);
  const digest = verdictDigest(V, CHAIN_ID, SCLERA);

  const signer = recover(digest, sig);
  assert.equal(signer.toLowerCase(), k.onchainAttestation.address.toLowerCase());
  // And that address is the pinned vector, so this is anchored to a fixed value not just to itself.
  assert.equal(signer.toLowerCase(), "0x722cf70cbc5ff80942a1274b0cc252e4db2cafdf");
});

test("the signature is 65 bytes and low-s, which is what the contract accepts", async () => {
  const k = await deriveKeys(PRF);
  const sig = signVerdict(V, k.onchainAttestation.privateKey, CHAIN_ID, SCLERA);
  assert.equal(sig.length, 2 + 130, "0x plus 65 bytes");
  const s = BigInt("0x" + sig.slice(2).slice(64, 128));
  // The exact ceiling Sclera rejects above, half the curve order.
  const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
  assert.ok(s <= HALF_N, "s must be in the low half or the contract rejects it");
  const vByte = parseInt(sig.slice(2).slice(128, 130), 16);
  assert.ok(vByte === 27 || vByte === 28, "v is 27 or 28");
});

test("changing any signed field changes the digest", () => {
  const base = verdictDigest(V, CHAIN_ID, SCLERA);
  const fields: (keyof Verdict)[] = ["agentId", "windowStart", "windowEnd", "sampleSize", "trueCount", "nonce"];
  for (const f of fields) {
    const d = verdictDigest({ ...V, [f]: V[f] + 1n }, CHAIN_ID, SCLERA);
    assert.notDeepEqual(d, base, `${f} must be inside the signed digest`);
  }
});

test("the digest binds to the chain and the contract, so a signature is not portable", () => {
  const base = verdictDigest(V, CHAIN_ID, SCLERA);
  assert.notDeepEqual(verdictDigest(V, 10143n, SCLERA), base, "chainId is bound");
  assert.notDeepEqual(
    verdictDigest(V, CHAIN_ID, "0x00000000000000000000000000000000000000dd"),
    base,
    "verifyingContract is bound",
  );
});
