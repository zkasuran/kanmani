/**
 * Authority over an agent: who may change it, and a receipt saying who did.
 *
 * The passkey layer was a showcase. `/account` demonstrated that one ceremony yields four keys and
 * `/pay` opened a scoped session to sign a payment, but the one place authority actually matters —
 * creating an agent and changing an existing one — treated the passkey as one of two equal options
 * and used it to protect nothing. This module is the missing half.
 *
 * ## What is actually at risk, stated precisely
 *
 * Not "someone repoints an agent they do not own". `setAgentURI` reverts for anyone who is not the
 * owner, so the chain already refuses that and no amount of front-end care adds to it. Three real
 * risks remain, and only the first is anybody else's fault:
 *
 *   1. **Blind signing.** A studio generates calldata and asks you to sign it. A clone of this page
 *      could preview one document and hand you calldata for another, pointing your agent at a
 *      record its author controls. The defence is that the thing you sign is derived from the thing
 *      you saw, and that a receipt exists afterwards naming the document hash you intended.
 *   2. **Paying gas to learn you are not the owner.** Sending `setAgentURI` for an agent held by
 *      another wallet costs a reverted transaction to discover. That is checkable before signing,
 *      because the registry's owner is already published by our own API.
 *   3. **A key that only exists in one browser.** An agent whose authority lives in a hot wallet on
 *      one laptop is one cleared profile away from being unmanageable. A passkey-derived key
 *      reconstructs on any device from the passkey alone.
 *
 * ## The receipt, and why the signing key owns nothing
 *
 * An action receipt is signed by the **attestation** key, which is ed25519 and deliberately cannot
 * move money. So a receipt proves "this identity authorised this change to this document" without
 * that identity being able to spend anything, and it verifies on any device that can reconstruct the
 * passkey. The account key signs the transaction; the attestation key signs the statement about it.
 * Keeping those separate is the whole reason `lib/iris.ts` derives four keys rather than one.
 *
 * Nothing here is custodial and nothing here is a gate we enforce on chain. The registry decides who
 * may write. This module makes sure the person signing knows what they are signing, learns they
 * cannot before paying for the lesson, and ends up with something they can show.
 */

import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import type { IrisKeys } from "./iris.ts";
import { toBase64url, toHex } from "./iris.ts";

/* ------------------------------------------------------------------ ownership */

export type Authority =
  /** The connected passkey account is the registry owner. This account can sign the change. */
  | { kind: "owner"; agentId: number; owner: `0x${string}` }
  /**
   * The agent exists and somebody else holds it.
   *
   * Carries both addresses so the page can say which is which rather than only refusing. A mismatch
   * is usually a reader signed in with a different passkey, not an attacker.
   */
  | { kind: "notOwner"; agentId: number; owner: `0x${string}`; connected: `0x${string}` }
  /** No such agent in the index. Registering is the action, not repointing. */
  | { kind: "noSuchAgent"; agentId: number }
  /**
   * We could not find out.
   *
   * Never collapsed into `notOwner`. A failure to look is not evidence of anything, which is the
   * same rule the verdict ladder runs on, and here it decides whether a person is told "you cannot
   * do this" on the strength of our network problem.
   */
  | { kind: "unknown"; agentId: number; reason: string };

/**
 * Ask whether the connected account owns an agent, using our own published API rather than an RPC.
 *
 * `/api/agent/<id>` already returns the registry owner, so no endpoint needs configuring in the
 * browser and there is no second source of truth to drift.
 */
export async function checkAuthority(
  agentId: number,
  connected: `0x${string}`,
  fetchFn: typeof fetch = fetch,
): Promise<Authority> {
  let res: Response;
  try {
    res = await fetchFn(`/api/agent/${agentId}`, { headers: { accept: "application/json" } });
  } catch (e) {
    return { kind: "unknown", agentId, reason: (e as Error).message || "the request failed" };
  }
  if (res.status === 404) return { kind: "noSuchAgent", agentId };
  if (!res.ok) return { kind: "unknown", agentId, reason: `HTTP ${res.status}` };

  let owner: string | undefined;
  try {
    const body = (await res.json()) as { data?: { owner?: string } };
    owner = body.data?.owner;
  } catch (e) {
    return { kind: "unknown", agentId, reason: (e as Error).message || "the response did not parse" };
  }
  if (!owner) return { kind: "unknown", agentId, reason: "the record carries no owner" };

  // Addresses are compared lowercased. EIP-55 casing is a checksum, not identity, and comparing it
  // directly would report a mismatch between two spellings of the same account.
  return owner.toLowerCase() === connected.toLowerCase()
    ? { kind: "owner", agentId, owner: owner as `0x${string}` }
    : { kind: "notOwner", agentId, owner: owner as `0x${string}`, connected };
}

/* ------------------------------------------------------------------ the receipt */

export type AgentAction = "register" | "setAgentURI";

/**
 * What the attestation key signs.
 *
 * The document is committed to by its keccak256 hash rather than by its bytes, so a receipt stays
 * small and still pins exactly one document. `agentId` is null for a registration, because the id is
 * assigned by the registry and does not exist until the transaction lands.
 */
export type ActionReceipt = {
  action: AgentAction;
  chainId: number;
  /** null when registering: the registry assigns the id. */
  agentId: number | null;
  /** keccak256 of the agentURI that was intended, hex, 0x-prefixed. */
  uriHash: string;
  /** The account that will send the transaction. */
  signer: `0x${string}`;
  /** did:key of the attestation identity. Not a wallet and cannot move money. */
  identity: string;
  at: string;
};

/**
 * Canonical bytes for a receipt.
 *
 * Fixed field order, newline separated, every field present even when empty, exactly as
 * `lib/iris.ts` does for verification receipts. `JSON.stringify` would be shorter and its key order
 * is an implementation detail of whoever built the object, so two correct implementations could
 * produce different bytes for the same receipt and neither could verify the other.
 */
export function actionReceiptBytes(r: ActionReceipt): Uint8Array {
  return new TextEncoder().encode(
    [
      "kanmani.agent-action.v1",
      r.action,
      String(r.chainId),
      r.agentId === null ? "" : String(r.agentId),
      r.uriHash,
      r.signer.toLowerCase(),
      r.identity,
      r.at,
    ].join("\n"),
  );
}

/** keccak256 of the URI that is about to go on chain, which is what the receipt commits to. */
export function hashUri(agentURI: string): string {
  return `0x${toHex(keccak_256(new TextEncoder().encode(agentURI)))}`;
}

/**
 * Build and sign a receipt for an action about to be taken.
 *
 * Signed with `keys.attestation`, never with the account key. A receipt is a statement, and the key
 * that makes statements here is the one that cannot move money, so possessing a receipt grants
 * nothing.
 */
export function signAction(
  input: { action: AgentAction; chainId: number; agentId: number | null; agentURI: string },
  keys: IrisKeys,
  now = new Date(),
): { receipt: ActionReceipt; signature: string; binding: string } {
  const receipt: ActionReceipt = {
    action: input.action,
    chainId: input.chainId,
    agentId: input.agentId,
    uriHash: hashUri(input.agentURI),
    signer: keys.account.address,
    identity: keys.attestation.id,
    at: now.toISOString(),
  };
  const bytes = actionReceiptBytes(receipt);
  const sig = ed25519.sign(bytes, keys.attestation.privateKey);
  // Bind the two identities. The ed25519 signature proves the attestation identity made this receipt.
  // The account key signs the same bytes so a verifier can also prove the EVM signer named in the
  // receipt is controlled by the same person. Without this a receipt can name any address as its
  // signer, since the attestation signature says nothing about that address.
  const binding = bindingSignature(receipt, keys.account.privateKey);
  return { receipt, signature: toBase64url(sig), binding };
}

/**
 * The account key's signature over the canonical receipt bytes, as `0x` + r + s + v.
 *
 * secp256k1 rather than ed25519, because this half proves control of the EVM `signer` address. No
 * `Buffer`, because this file is imported by the browser studio and a Node global would throw there.
 */
export function bindingSignature(receipt: ActionReceipt, accountPrivateKey: Uint8Array): string {
  const digest = keccak_256(actionReceiptBytes(receipt));
  const sig = secp256k1.sign(digest, accountPrivateKey);
  const recovery = (sig.recovery ?? 0).toString(16).padStart(2, "0");
  return `0x${sig.toCompactHex()}${recovery}`;
}

/**
 * Verify the account-key binding: recover the EVM address that signed the receipt bytes and require
 * it equals the receipt's `signer`. Combined with `verifyAction`, this proves one person controls
 * both the attestation identity and the signer address, so a receipt cannot name someone else's
 * address as its signer.
 */
export function verifyBinding(receipt: ActionReceipt, binding: string): boolean {
  try {
    const hex = binding.startsWith("0x") ? binding.slice(2) : binding;
    if (hex.length !== 130) return false;
    const recovery = parseInt(hex.slice(128, 130), 16);
    if (recovery !== 0 && recovery !== 1) return false;
    const digest = keccak_256(actionReceiptBytes(receipt));
    const pub = secp256k1.Signature.fromCompact(hex.slice(0, 128))
      .addRecoveryBit(recovery)
      .recoverPublicKey(digest)
      .toRawBytes(false);
    const recovered = `0x${toHex(keccak_256(pub.slice(1)).slice(-20))}`;
    return recovered.toLowerCase() === receipt.signer.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verify a receipt against the public key inside its own `identity`.
 *
 * Self-contained on purpose: a holder needs nothing from us to check one. The did:key carries the
 * base64url public key, so this reads it back out rather than being told it separately, which means
 * a receipt cannot be verified against a key it does not name.
 */
export function verifyAction(receipt: ActionReceipt, signature: string): boolean {
  try {
    const prefix = "did:key:kanmani:";
    if (!receipt.identity.startsWith(prefix)) return false;
    const pub = fromBase64url(receipt.identity.slice(prefix.length));
    return ed25519.verify(fromBase64url(signature), actionReceiptBytes(receipt), pub);
  } catch {
    // A malformed signature, key or identity is a failed verification, never an exception a caller
    // might catch and treat as "could not check, so probably fine".
    return false;
  }
}

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The scope a session must carry to sign an agent change.
 *
 * Reuses `lib/session.ts` rather than inventing a second gate. `maxAmountAtomic` is 0 because a
 * registration moves no token: the session is being scoped to an authority, not to a spend, and a
 * session opened to pay for a verification must not silently also be able to repoint an agent.
 */
export function agentScope(action: AgentAction, host: string) {
  return {
    label:
      action === "register"
        ? "Register one agent. Moves no token."
        : "Repoint one agent you own. Moves no token.",
    maxAmountAtomic: 0n,
    resourceHost: host,
  };
}
