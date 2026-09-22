/**
 * Sign a Sclera verdict the way the contract recovers it.
 *
 * The bond contract's `report` path is reached through a forwarder whose `report` is permissionless,
 * so the contract trusts nothing about the caller. Authorisation is the signature: it recovers a
 * secp256k1 signer over an EIP-712 digest and requires it equals an immutable `attestor`. This module
 * produces exactly that signature, so a CRE workflow can read the claim-truth rate, sign the verdict
 * with the Iris on-chain attestor key and write it through the forwarder.
 *
 * Every constant here is copied from `contracts/src/Sclera.sol`, not remembered. The typehash string,
 * the field order, the domain name and version, and the low-s rule all match the deployed contract,
 * because a signature that recovers to the wrong address or is rejected as high-s is silently useless.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { encodeAbiParameters, parseAbiParameters } from "viem";

/**
 * The claim, exactly as `Sclera.Verdict` declares it. `windowStart` and `windowEnd` are block numbers
 * on Monad, `sampleSize` is the count of the agent's payment claims decided in that window and
 * `trueCount` how many resolved true. `nonce` is per-agent and strictly increasing, which is what
 * blocks a verdict being replayed.
 */
export type Verdict = {
  agentId: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  sampleSize: bigint;
  trueCount: bigint;
  nonce: bigint;
};

// Copied verbatim from Sclera.sol `_VERDICT_TYPEHASH`. The field list and the types are load-bearing:
// a single reordered field or a uint32 written where the contract reads uint64 changes the struct
// hash and the signature recovers to nothing.
export const VERDICT_TYPE =
  "Verdict(uint256 agentId,uint64 windowStart,uint64 windowEnd,uint32 sampleSize,uint32 trueCount,uint64 nonce)";

const enc = new TextEncoder();
const VERDICT_TYPEHASH = keccak_256(enc.encode(VERDICT_TYPE));
const DOMAIN_TYPEHASH = keccak_256(
  enc.encode("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): `0x${string}` {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return `0x${s}`;
}

/**
 * The EIP-712 domain separator Sclera builds in its constructor.
 *
 * `verifyingContract` is the deployed Sclera address on `chainId`, so the caller must pass both. A
 * signature made against the wrong address or chain recovers to a real but wrong key and the bond
 * rejects it, which is the replay protection across deployments working as intended.
 */
export function domainSeparator(chainId: bigint, verifyingContract: `0x${string}`): Uint8Array {
  const encoded = encodeAbiParameters(
    parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
    [
      bytesToHex(DOMAIN_TYPEHASH),
      bytesToHex(keccak_256(enc.encode("Sclera"))),
      bytesToHex(keccak_256(enc.encode("1"))),
      chainId,
      verifyingContract,
    ],
  );
  return keccak_256(hexToBytes(encoded));
}

/** The 32-byte digest the contract runs `ecrecover` over: keccak(0x1901 || domain || structHash). */
export function verdictDigest(v: Verdict, chainId: bigint, verifyingContract: `0x${string}`): Uint8Array {
  const structHash = keccak_256(
    hexToBytes(
      encodeAbiParameters(
        // uint32 fields are typed as `number` by viem, so narrow the two that are, and keep the
        // uint256/uint64 fields as bigint. The struct-hash bytes are identical either way.
        parseAbiParameters("bytes32, uint256, uint64, uint64, uint32, uint32, uint64"),
        [
          bytesToHex(VERDICT_TYPEHASH),
          v.agentId,
          v.windowStart,
          v.windowEnd,
          Number(v.sampleSize),
          Number(v.trueCount),
          v.nonce,
        ],
      ),
    ),
  );
  const domain = domainSeparator(chainId, verifyingContract);
  const preimage = new Uint8Array(2 + 32 + 32);
  preimage[0] = 0x19;
  preimage[1] = 0x01;
  preimage.set(domain, 2);
  preimage.set(structHash, 34);
  return keccak_256(preimage);
}

/**
 * Sign a verdict with the on-chain attestor private key. Returns 65 bytes, `r || s || v`, the layout
 * `_signedByAttestor` reads.
 *
 * Low-s is enforced (noble does this by default), because the contract rejects the high-s half of the
 * curve outright: it is a second valid encoding of the same signature and accepting both would let one
 * verdict arrive twice. `v` is normalised to 27 or 28, which is what `ecrecover` expects and what the
 * contract's redundant `{27,28}` guard checks.
 */
export function signVerdict(
  v: Verdict,
  privateKey: Uint8Array,
  chainId: bigint,
  verifyingContract: `0x${string}`,
): `0x${string}` {
  const digest = verdictDigest(v, chainId, verifyingContract);
  const sig = secp256k1.sign(digest, privateKey, { lowS: true });
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const vByte = (sig.recovery + 27).toString(16).padStart(2, "0");
  return `0x${r}${s}${vByte}`;
}
