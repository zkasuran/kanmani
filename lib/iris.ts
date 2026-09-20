/**
 * Iris: three independent keys from one passkey ceremony.
 *
 * The account you sign in with, the identity that signs verification receipts, and the key that
 * encrypts anything private. One user-verification prompt for all three.
 *
 * ## Why HKDF rather than three PRF salts, settled rather than assumed
 *
 * Mera's own source is explicit that a salt costs a ceremony: `getPasskeyPrfOutput` *"runs one
 * assertion ceremony and shows one user-verification prompt"* and takes exactly one 32-byte
 * `prfSalt`. Three namespaces as three salts is three prompts, which contradicts one-prompt
 * onboarding outright.
 *
 * So: one ceremony, one PRF output, then HKDF-SHA256 expanded with a distinct `info` per
 * namespace. Asked Category Labs, who build Mera and wrote both bounties, whether that counts as
 * salts being genuinely namespaced. **Answered 2026-09-18: yes.** That is an organizer-reviewed
 * ruling from the team that wrote the gate, so it outranks our own reasoning about it.
 *
 * Reading the library afterwards showed it is also Mera's own pattern rather than a concession to
 * us. `createSecretVault` derives its AES key from the PRF output *"with fixed HKDF info
 * (`mera.v1.encrypt.secret`), which separates it from other keys derived from the same PRF
 * output"*. Same construction, same reason.
 *
 * ## What HKDF actually buys
 *
 * The three keys are independent in the sense that matters: recovering one gives no information
 * about the others, because HKDF-Expand is a PRF over the extracted pseudorandom key and the
 * `info` strings are distinct and length-prefixed by their own content. What it does NOT buy is
 * independence from the PRF output itself. Anyone holding the 32-byte PRF output holds all three
 * keys. That is true of per-salt derivation too, at a different point, and it is the honest thing
 * to say rather than implying a compartmentalisation that does not exist.
 *
 * ## Nothing here touches the network or the DOM
 *
 * Every function is pure over bytes. The ceremony happens elsewhere and hands this file 32 bytes.
 * That is what makes the whole derivation testable against fixed vectors with no browser, which
 * matters because the two Mera gates are live tests on a judge's machine and "it worked when I
 * clicked it" is not evidence.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { ed25519 } from "@noble/curves/ed25519";
import { keccak_256 } from "@noble/hashes/sha3";

/**
 * The namespaces, versioned in their own names.
 *
 * A version lives in the string rather than in a constant beside it, so a derived key can never
 * silently change meaning: changing the version changes the bytes, which changes the address,
 * which is loud. `v1` is frozen. A `v2` would be a new key, not a migration.
 */
export const NAMESPACE = {
  /** Signs in and owns listings. A wallet. */
  account: "kanmani.iris.v1",
  /**
   * Signs verification receipts.
   *
   * Deliberately NOT a wallet, which is the whole point. A receipt saying "this claim was checked
   * and here is what was found" should be attributable to a stable identity that reconstructs on
   * any device, without that identity also being able to move money.
   */
  attestation: "kanmani.optic.v1",
  /** Encrypts anything the server must not be able to read. */
  content: "kanmani.vitreous.v1",
} as const;

export type Namespace = (typeof NAMESPACE)[keyof typeof NAMESPACE];

const enc = new TextEncoder();

/** Guard every entry point, because a short PRF output would silently weaken all three keys. */
function require32(bytes: Uint8Array, what: string): void {
  if (bytes.length !== 32) {
    throw new Error(`${what} must be exactly 32 bytes, got ${bytes.length}`);
  }
}

/**
 * HKDF-SHA256 over the PRF output.
 *
 * Extract uses a fixed, non-secret salt. RFC 5869 allows a zero salt and this is stronger than
 * that: a constant that names what the extraction is for, so two protocols that both extract from
 * the same passkey output land in different key spaces even before `info` separates them.
 */
const HKDF_SALT = enc.encode("kanmani.hkdf.salt.v1");

export async function derive(
  prfOutput: Uint8Array,
  info: string,
  length = 32,
): Promise<Uint8Array> {
  require32(prfOutput, "PRF output");
  if (info.length === 0) throw new Error("an empty info string would not namespace anything");

  const ikm = await crypto.subtle.importKey("raw", prfOutput as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT as BufferSource, info: enc.encode(info) as BufferSource },
    ikm,
    length * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Derive a secp256k1 private key, retrying until the result is a valid scalar.
 *
 * **This is the part that is easy to get wrong and it is not theoretical.** HKDF returns 32
 * uniform bytes, which is a number in [0, 2^256). A secp256k1 private key must be in [1, n) where
 * n is just under 2^256. Roughly one in 2^128 outputs falls outside, so a naive implementation is
 * correct on every test you will ever run and wrong for somebody, once, permanently, with no way
 * to tell them why.
 *
 * The fix is RFC 6979's shape: append a counter to `info` and derive again. It terminates with
 * overwhelming probability on the first attempt and stays deterministic, so the same passkey
 * always produces the same key on every device. That last property is the cross-device gate.
 *
 * `deriveFn` exists only so a test can force the rare branch. Waiting for a natural out-of-range
 * output means waiting for about 2^128 derivations, so without a seam this retry would be code
 * that has never once executed and is asserted to work. A test that cannot fail proves nothing,
 * and injecting a function is cheaper than pretending otherwise.
 */
export async function deriveSecp256k1(
  prfOutput: Uint8Array,
  info: string,
  deriveFn: typeof derive = derive,
): Promise<Uint8Array> {
  for (let counter = 0; counter < 256; counter++) {
    // Counter 0 uses the bare info, so the common path is the simple one and a reader checking
    // the derivation by hand does not need to know about the retry to reproduce it.
    const candidate = await deriveFn(prfOutput, counter === 0 ? info : `${info}.retry.${counter}`);
    if (secp256k1.utils.isValidPrivateKey(candidate)) return candidate;
  }
  // Unreachable short of a broken hash. Throwing beats returning something invalid.
  throw new Error("could not derive a valid secp256k1 scalar in 256 attempts");
}

export type IrisKeys = {
  /** secp256k1. Signs in, owns listings, and is an ordinary EVM address. */
  account: { privateKey: Uint8Array; publicKey: Uint8Array; address: `0x${string}` };
  /** Ed25519. Signs receipts. Not a wallet and cannot move money. */
  attestation: { privateKey: Uint8Array; publicKey: Uint8Array; id: string };
  /** Raw 32 bytes for AES-256-GCM. */
  content: Uint8Array;
};

/**
 * One PRF output in, three keys out.
 *
 * Deterministic: the same 32 bytes always produce the same three keys, on any device, in any
 * browser, forever. That determinism IS the cross-device gate, so it is asserted against fixed
 * vectors in the tests rather than demonstrated by clicking.
 */
export async function deriveKeys(prfOutput: Uint8Array): Promise<IrisKeys> {
  require32(prfOutput, "PRF output");

  const [accountKey, attestationKey, content] = await Promise.all([
    deriveSecp256k1(prfOutput, NAMESPACE.account),
    derive(prfOutput, NAMESPACE.attestation),
    derive(prfOutput, NAMESPACE.content),
  ]);

  const accountPub = secp256k1.getPublicKey(accountKey, false);
  const attestationPub = ed25519.getPublicKey(attestationKey);

  return {
    account: { privateKey: accountKey, publicKey: accountPub, address: evmAddress(accountPub) },
    attestation: {
      privateKey: attestationKey,
      publicKey: attestationPub,
      id: `did:key:kanmani:${toBase64url(attestationPub)}`,
    },
    content,
  };
}

/**
 * EIP-55 checksummed address from an uncompressed public key.
 *
 * Written out rather than imported so the checksum is visible: the mixed case is not decoration,
 * it is a typo check, and an address rendered in flat lowercase loses it.
 */
export function evmAddress(uncompressedPublicKey: Uint8Array): `0x${string}` {
  const body = uncompressedPublicKey.length === 65 ? uncompressedPublicKey.slice(1) : uncompressedPublicKey;
  const hash = keccak_256(body);
  const hex = Array.from(hash.slice(-20), (b) => b.toString(16).padStart(2, "0")).join("");
  const checksumSource = Array.from(keccak_256(enc.encode(hex)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

  let out = "";
  for (let i = 0; i < hex.length; i++) {
    out += parseInt(checksumSource[i]!, 16) >= 8 ? hex[i]!.toUpperCase() : hex[i]!;
  }
  return `0x${out}`;
}

/**
 * base64url and hex, written out rather than reached for.
 *
 * `Buffer` is a Node global. These functions run in the browser, where it does not exist unless
 * something polyfills it, and a bundler that happens to polyfill it today is a dependency on a
 * build setting rather than on the language. The failure mode is the worst kind: everything
 * passes in Node, every test is green, and the page throws on a judge's machine during a live
 * gate. So: no Buffer below this line.
 */
export function toBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/* ------------------------------------------------------------------ receipts */

/**
 * What the attestation key signs.
 *
 * Deliberately not free-form. A receipt states what was checked, what was found and when, in a
 * canonical form both sides can rebuild byte for byte. A signature over a JSON string whose key
 * order can vary is a signature over nothing you can re-verify.
 */
export type Receipt = {
  /** The claim this is about. */
  claimId: string;
  /** One of the four outcomes. Never a score. */
  outcome: "true" | "false" | "noClaim" | "unknown";
  /** The chain head when the check ran, so a negative is falsifiable. */
  checkedAtBlock: string | null;
  checkedAt: string;
  /** Which published atlas mapping read the document. */
  mapping: string | null;
};

/**
 * Canonical bytes for a receipt.
 *
 * Fixed field order, newline separated, every field present even when empty. `JSON.stringify`
 * would be shorter and its key order is an implementation detail of whoever built the object, so
 * two correct implementations could produce different bytes for the same receipt and neither
 * would be able to verify the other.
 */
export function receiptBytes(r: Receipt): Uint8Array {
  return enc.encode(
    [
      "kanmani.receipt.v1",
      r.claimId,
      r.outcome,
      r.checkedAtBlock ?? "",
      r.checkedAt,
      r.mapping ?? "",
    ].join("\n"),
  );
}

export function signReceipt(r: Receipt, attestationPrivateKey: Uint8Array): Uint8Array {
  require32(attestationPrivateKey, "attestation private key");
  return ed25519.sign(receiptBytes(r), attestationPrivateKey);
}

/**
 * Sign a vault write with the account key.
 *
 * Returns 65 bytes as hex: r || s || recovery. The recovery byte is what lets the server get the
 * address back from the signature without being told the public key, which is the same trick
 * ecrecover uses and the reason the address in the request can be checked rather than trusted.
 *
 * `prehash: false` because the caller already hashed. Letting the library hash again would sign
 * keccak(keccak(m)), which verifies fine against itself and against nothing else, so the bug
 * would only appear when a second implementation tried to check it.
 */
export function signVaultWrite(message: Uint8Array, accountPrivateKey: Uint8Array): string {
  const sig = secp256k1.sign(keccak_256(message), accountPrivateKey, { prehash: false });
  const compact = sig.toCompactRawBytes();
  const rec = sig.recovery;
  return `0x${toHex(compact)}${rec.toString(16).padStart(2, "0")}`;
}

export function verifyReceipt(
  r: Receipt,
  signature: Uint8Array,
  attestationPublicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, receiptBytes(r), attestationPublicKey);
  } catch {
    // A malformed signature or key is a failed verification, never an exception that a caller
    // might catch and treat as "could not check, so probably fine".
    return false;
  }
}
