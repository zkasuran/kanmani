/**
 * The Sclera oracle attestor: a dedicated signing identity, derived from the house key.
 *
 * Why this exists. Sclera recovers a signer from the verdict payload and requires it to equal an
 * attestor fixed at construction. That signature is the only authorisation, because the CRE
 * forwarder on Monad mainnet is a permissionless mock and `msg.sender` proves nothing. So the
 * attestor key has to be a real secret.
 *
 * Three keys that are easy to confuse, kept apart on purpose:
 *
 *   1. The house wallet. Pays gas, owns the deployment, holds funds. Must NOT be the attestor: one
 *      compromised key should not both own the contract and be able to sign slashing verdicts.
 *   2. A user's Iris attestation key, derived in the browser from their own passkey PRF. That one
 *      never leaves the device, which is the whole point, so a server-side oracle cannot hold it.
 *      It signs a user's verification receipts, never a slashing verdict.
 *   3. This one. The oracle's attestor, held by the workflow that computes claim-truth rates.
 *
 * The demo attestor in `contracts/test/fixtures/sign-verdict.mjs` is derived from the pinned PRF
 * vector `bytes [1..32]`, hardcoded in a committed file. That is correct for a cross-check test and
 * it is public the moment this repository is, so it must never be the attestor on a live
 * deployment. `DeploySclera.s.sol` refuses that address by name.
 *
 * Derived rather than generated, so there is no new secret to store, back up or leak. The house key
 * already lives in exactly one place and is sourced at the point of use. Deterministic means the
 * same address comes back on any machine that holds the house key, which is what lets a redeploy
 * or a workflow restart agree with a contract deployed months earlier.
 */
import { keccak256, concat, toHex, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Domain label. Changing this string changes the identity, so it is versioned: a future rotation
 * bumps the suffix rather than editing in place. An old deployment keeps recovering to the key
 * it was built to trust.
 */
export const ATTESTOR_LABEL = "kanmani.sclera.attestor.v1";

/** secp256k1 group order. A private key must be in [1, n-1]. */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * Derive the oracle attestor from the house private key.
 *
 * @param {string} housePrivateKey 0x-prefixed 32 byte hex
 * @returns {{ address: `0x${string}`, privateKey: `0x${string}` }}
 */
export function deriveOracleAttestor(housePrivateKey) {
  if (typeof housePrivateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(housePrivateKey)) {
    throw new Error("house private key must be 0x-prefixed 32 byte hex");
  }

  // keccak over the house key plus the label, with a counter for the vanishing case where the
  // result is not a valid scalar. The counter is in the preimage rather than added afterwards, so
  // every candidate is an independent draw instead of a neighbour of the last one.
  //
  // Everything is converted to hex first: viem's `concat` needs one representation throughout and
  // silently fails on a mix of hex strings and byte arrays.
  const labelHex = toHex(stringToBytes(ATTESTOR_LABEL));
  for (let counter = 0; counter < 256; counter++) {
    const candidate = keccak256(
      concat([housePrivateKey, labelHex, toHex(new Uint8Array([counter]))]),
    );
    const scalar = BigInt(candidate);
    if (scalar === 0n || scalar >= N) continue;
    const privateKey = toHex(scalar, { size: 32 });
    return { address: privateKeyToAccount(privateKey).address, privateKey };
  }
  // 256 consecutive misses is not reachable in practice. Throwing beats returning something weaker.
  throw new Error("could not derive a valid scalar in 256 attempts");
}
