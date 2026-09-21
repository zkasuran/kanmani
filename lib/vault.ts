/**
 * Vitreous: storage the server cannot read.
 *
 * AES-256-GCM under `kanmani.vitreous.v1`, which comes out of the same ceremony that derived the
 * account key. Signing in once gives you the content key, so opening your own data costs zero
 * extra prompts. That is the whole reason the namespace exists.
 *
 * ## Why not Mera's own secret vault
 *
 * Mera ships `createSecretVaultWithNewPasskey` and `decryptSecretVaultWithPasskey` and they are
 * good. They are also the wrong shape for this: each call generates a fresh random `prfSalt`
 * internally and stores it in the vault, so decrypting runs its own assertion ceremony. That is
 * one more prompt every time somebody opens their own data, on top of the one they already paid
 * to sign in.
 *
 * Their format also stores a `credentialId` and a `prfSalt` alongside the ciphertext. We store
 * neither, anywhere, on purpose and a format that requires them would quietly reintroduce the
 * state the stateless gate is looking for.
 *
 * Their construction is still the one being followed: an AES-256-GCM key from a PRF output via
 * HKDF with a fixed info string. Same idea, one ceremony instead of two.
 *
 * ## Every blob is bound to its purpose
 *
 * The context string goes in as AES-GCM additional authenticated data, so a job brief cannot be
 * opened as agent memory even though both use the same content key. Without it, one key opens
 * everything that key ever sealed and a server that can move blobs between slots can change what
 * a client believes a blob is. AAD is free and it removes that entirely.
 */

export type Sealed = {
  /** Format version. A change here is a new format, never a silent reinterpretation. */
  readonly v: 1;
  /** What this blob is for. Authenticated, not merely stored, so it cannot be relabelled. */
  readonly context: string;
  /** 12-byte GCM nonce, base64url. */
  readonly nonce: string;
  /** Ciphertext with its 16-byte tag, base64url. */
  readonly ct: string;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64u(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64u(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(contentKey: Uint8Array): Promise<CryptoKey> {
  if (contentKey.length !== 32) {
    throw new Error(`content key must be 32 bytes for AES-256, got ${contentKey.length}`);
  }
  return crypto.subtle.importKey("raw", contentKey as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt.
 *
 * A fresh random nonce every time, never a counter. GCM loses everything on a nonce reuse under
 * the same key and a counter needs state to be correct. There is no state here by design, so a
 * counter would be exactly the wrong choice: 96 random bits is the version that cannot be got
 * wrong by clearing local storage.
 */
export async function seal(
  contentKey: Uint8Array,
  context: string,
  plaintext: Uint8Array | string,
): Promise<Sealed> {
  if (!context) throw new Error("a blob with no context could be opened as anything else");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const bytes = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;

  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, additionalData: enc.encode(context) as BufferSource },
    await key(contentKey),
    bytes as BufferSource,
  );
  return { v: 1, context, nonce: b64u(nonce), ct: b64u(new Uint8Array(ct)) };
}

export type OpenResult =
  | { ok: true; bytes: Uint8Array; text: string }
  /**
   * A failure to open is never "the data is corrupt" and never "you are not authorised". Those
   * are guesses. It says what was attempted and that authentication failed, which is all anyone
   * actually knows.
   */
  | { ok: false; reason: string };

export async function open(
  contentKey: Uint8Array,
  sealed: Sealed,
  expectedContext?: string,
): Promise<OpenResult> {
  if (sealed.v !== 1) return { ok: false, reason: `unknown vault format version ${sealed.v}` };

  // Checked before decrypting as well as authenticated by GCM. The AAD check would catch a
  // relabelled blob anyway and failing early with a specific reason beats a generic auth error
  // that gives a caller nothing to act on.
  if (expectedContext !== undefined && sealed.context !== expectedContext) {
    return {
      ok: false,
      reason: `this blob is labelled ${sealed.context} and was opened as ${expectedContext}`,
    };
  }

  let nonce: Uint8Array;
  let ct: Uint8Array;
  try {
    nonce = unb64u(sealed.nonce);
    ct = unb64u(sealed.ct);
  } catch {
    return { ok: false, reason: "nonce or ciphertext is not valid base64url" };
  }
  if (nonce.length !== 12) return { ok: false, reason: `nonce must be 12 bytes, got ${nonce.length}` };

  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: enc.encode(sealed.context) as BufferSource,
      },
      await key(contentKey),
      ct as BufferSource,
    );
    const bytes = new Uint8Array(plain);
    return { ok: true, bytes, text: dec.decode(bytes) };
  } catch {
    return {
      ok: false,
      reason:
        "authentication failed: this ciphertext was not produced by this key for this context or it has been altered",
    };
  }
}

/**
 * Validate something that arrived from a server or a URL.
 *
 * The server holds these blobs and the server is not trusted. Parsing before decrypting means a
 * malformed blob fails with a reason rather than throwing somewhere inside WebCrypto.
 */
export function parseSealed(value: unknown): Sealed | null {
  if (typeof value === "string") {
    try {
      return parseSealed(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return null;
  if (typeof v.context !== "string" || v.context === "") return null;
  if (typeof v.nonce !== "string" || typeof v.ct !== "string") return null;
  // Unknown fields are dropped rather than carried, so a server cannot smuggle anything through
  // a blob a client round-trips.
  return { v: 1, context: v.context, nonce: v.nonce, ct: v.ct };
}

/** The contexts in use. Named here so two callers cannot pick slightly different strings. */
export const CONTEXT = {
  /** A buyer's brief, which often cannot be published. */
  jobBrief: "kanmani.vault.job-brief.v1",
  /** An agent's working context, surviving any device. */
  agentMemory: "kanmani.vault.agent-memory.v1",
  /** Work product handed to a buyer without passing readable through us. */
  deliverable: "kanmani.vault.deliverable.v1",
} as const;

/* ------------------------------------------------------------------ authorising a write */

/**
 * Exactly what a client signs to store a blob.
 *
 * Defined here, once and imported by both the browser that signs it and the route that checks
 * it. Two copies of this would be two things that can disagree and the symptom would be writes
 * silently rejected with a correct-looking signature.
 *
 * Fixed order, newline separated, with a domain prefix so a signature over these bytes cannot be
 * replayed as anything else. `JSON.stringify` would depend on whoever built the object, so two
 * correct clients could produce different bytes for the same write.
 */
export function writeMessage(address: string, s: Sealed): Uint8Array {
  return enc.encode(
    ["kanmani.vault.write.v1", address.toLowerCase(), s.context, String(s.v), s.nonce, s.ct].join("\n"),
  );
}
