/**
 * One comparable fingerprint per key, plus one for the whole device.
 *
 * The cross-device gate is "same passkey on a second device reproduces the same keys". A judge can
 * only check that by eye if the two screens show the same short string. The four key rows render
 * four different kinds of value (an address, a did:key, an address, a key hash), so there is no
 * single thing to compare across two devices. These functions fix that: a uniform per-row
 * fingerprint plus one combined value that changes if ANY derived key differs.
 *
 * Everything here is pure over bytes, so the determinism is asserted against a fixed vector in the
 * tests rather than demonstrated by clicking. A fingerprint is always a one-way hash, so passing the
 * secret content key is safe: the output reveals nothing about the key.
 */
import { type IrisKeys, toHex } from "./iris.ts";

const enc = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(digest);
}

/** Group a hex string into 8-char (4-byte) blocks, so a human can compare it block by block. */
function group(hex: string): string {
  return hex.match(/.{1,8}/g)?.join(" ") ?? hex;
}

/**
 * A fingerprint of one key's PUBLIC material.
 *
 * SHA-256 over the bytes (or the UTF-8 of a string), the first 16 bytes as hex, grouped. The input
 * is hashed, so this never reveals its argument: that is what makes it safe to fingerprint the
 * secret content key the same way the public ones are fingerprinted.
 */
export async function keyFp(publicMaterial: Uint8Array | string): Promise<string> {
  const bytes = typeof publicMaterial === "string" ? enc.encode(publicMaterial) : publicMaterial;
  const digest = await sha256(bytes);
  return group(toHex(digest.slice(0, 16)));
}

/**
 * One value for the whole set of derived keys.
 *
 * SHA-256 over the four public identities joined, the first 20 bytes as hex, grouped. It changes if
 * any one of the four keys differs, so two devices that derived from the same passkey show the
 * identical string and two that did not cannot. The content key is folded in as its own hash, never
 * raw, so this stays a public value.
 */
export async function deviceFp(keys: IrisKeys): Promise<string> {
  const contentHash = toHex(await sha256(keys.content));
  const material = [
    keys.account.address,
    keys.attestation.id,
    keys.onchainAttestation.address,
    contentHash,
  ].join("|");
  const digest = await sha256(enc.encode(material));
  return group(toHex(digest.slice(0, 20)));
}

/** Normalise a fingerprint for comparison: trim, lowercase, strip spaces. */
export function normalizeFp(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

/** Whether two fingerprints are the same once normalised, so spacing and case never cause a false mismatch. */
export function fpEqual(a: string, b: string): boolean {
  const na = normalizeFp(a);
  const nb = normalizeFp(b);
  return na.length > 0 && na === nb;
}
