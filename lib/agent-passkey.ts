/**
 * The browser half of AgentPasskey (contracts/src/AgentPasskey.sol, Monad mainnet
 * 0x1E30531CD3ea6DE2958DB363418a5382C419dC24): turn what WebAuthn returns into what the contract takes.
 *
 * Pure, so every conversion is tested. The contract then runs the one check that matters, on Monad's
 * P256 precompile at 0x0100.
 *
 * What never leaves the device: the private key. WebAuthn does not expose it and nothing here asks.
 * What goes on chain: the public key (x, y) and one signed assertion. Nothing is stored in the browser.
 */
import { encodeFunctionData, type Hex } from "viem";

export const AGENT_PASSKEY_ADDRESS = "0x1E30531CD3ea6DE2958DB363418a5382C419dC24" as const;

const ASSERTION = {
  type: "tuple",
  name: "a",
  components: [
    { name: "authenticatorData", type: "bytes" },
    { name: "clientDataJSON", type: "string" },
    { name: "challengeIndex", type: "uint256" },
    { name: "typeIndex", type: "uint256" },
    { name: "r", type: "uint256" },
    { name: "s", type: "uint256" },
  ],
} as const;

export const AGENT_PASSKEY_ABI = [
  { type: "function", name: "bindChallenge", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }, { name: "qx", type: "uint256" }, { name: "qy", type: "uint256" }, { name: "owner", type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "bind", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }, { name: "qx", type: "uint256" }, { name: "qy", type: "uint256" }, ASSERTION], outputs: [] },
  { type: "function", name: "unbind", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }], outputs: [] },
  { type: "function", name: "keyOf", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "bound", type: "bool" }, { name: "qx", type: "uint256" }, { name: "qy", type: "uint256" }, { name: "boundAtBlock", type: "uint64" }] },
  { type: "function", name: "verify", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }, { name: "challenge", type: "bytes32" }, ASSERTION], outputs: [{ type: "bool" }] },
  { type: "function", name: "verifyWith", stateMutability: "view", inputs: [{ name: "challenge", type: "bytes32" }, { name: "qx", type: "uint256" }, { name: "qy", type: "uint256" }, ASSERTION], outputs: [{ type: "bool" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

export type P256Key = { x: bigint; y: bigint };
export type Assertion = { authenticatorData: Hex; clientDataJSON: string; challengeIndex: bigint; typeIndex: bigint; r: bigint; s: bigint };

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const hex = (b: Uint8Array): Hex => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const big = (b: Uint8Array) => (b.length ? BigInt(hex(b)) : 0n);

/**
 * The P-256 public key from `response.getPublicKey()`, an SPKI DER blob. For P-256 it always ends in
 * 0x04 || x || y. The algorithm and curve OIDs are checked so a different key type is refused, not
 * misread.
 */
export function p256FromSpki(spki: Uint8Array): P256Key {
  const EC_OID = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
  const P256_OID = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
  const has = (needle: number[]) => {
    outer: for (let i = 0; i + needle.length <= spki.length; i++) {
      for (let j = 0; j < needle.length; j++) if (spki[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  };
  if (!has(EC_OID) || !has(P256_OID)) throw new Error("not a P-256 public key");
  const pt = spki.slice(spki.length - 65);
  if (pt[0] !== 0x04) throw new Error("not an uncompressed P-256 point");
  return { x: big(pt.slice(1, 33)), y: big(pt.slice(33, 65)) };
}

/** WebAuthn signatures are ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }`. */
export function derToRs(der: Uint8Array): { r: bigint; s: bigint } {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("signature is not DER");
  const seqLen = der[i++]!;
  if (seqLen & 0x80) throw new Error("unexpected long-form DER length");
  const int = () => {
    if (der[i++] !== 0x02) throw new Error("DER integer expected");
    const len = der[i++]!;
    const v = der.slice(i, i + len);
    i += len;
    return big(v);
  };
  const r = int();
  const s = int();
  if (r === 0n || s === 0n || r >= P256_N || s >= P256_N) throw new Error("signature out of range");
  return { r, s };
}

/** Byte offset of `needle` in the UTF-8 bytes of `json`. The contract compares bytes, not characters. */
export function byteIndexOf(json: string, needle: string): number {
  const h = new TextEncoder().encode(json);
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + n.length <= h.length; i++) {
    for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

export function toAssertion(o: { authenticatorData: Uint8Array; clientDataJSON: Uint8Array; signature: Uint8Array }): Assertion {
  const cd = new TextDecoder().decode(o.clientDataJSON);
  const challengeIndex = byteIndexOf(cd, '"challenge":"');
  const typeIndex = byteIndexOf(cd, '"type":"webauthn.get"');
  if (challengeIndex < 0 || typeIndex < 0) throw new Error("clientDataJSON is not a WebAuthn assertion");
  const { r, s } = derToRs(o.signature);
  return { authenticatorData: hex(o.authenticatorData), clientDataJSON: cd, challengeIndex: BigInt(challengeIndex), typeIndex: BigInt(typeIndex), r, s };
}

/** User verified (biometric or PIN) is bit 2 of the flags byte; the contract requires it. */
export function userVerified(authenticatorData: Uint8Array): boolean {
  return authenticatorData.length >= 37 && (authenticatorData[32]! & 0x04) !== 0;
}

export function hexToBytes(h: Hex): Uint8Array {
  const s = h.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bindCalldata(agentId: bigint, key: P256Key, a: Assertion): Hex {
  return encodeFunctionData({ abi: AGENT_PASSKEY_ABI, functionName: "bind", args: [agentId, key.x, key.y, a] });
}
export function unbindCalldata(agentId: bigint): Hex {
  return encodeFunctionData({ abi: AGENT_PASSKEY_ABI, functionName: "unbind", args: [agentId] });
}
