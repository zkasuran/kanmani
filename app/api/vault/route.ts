import { envelope, json, problem } from "@/lib/api.ts";
import { q, q1 } from "@/lib/db.ts";
import { parseSealed, writeMessage, type Sealed } from "@/lib/vault.ts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

export const dynamic = "force-dynamic";

/**
 * Ciphertext in, ciphertext out. The server never holds a key.
 *
 * This endpoint is the difference between claiming the cross-device property and demonstrating
 * it. A second device signs in with the same passkey, derives the same address, GETs this row and
 * decrypts it with a key that never left either browser.
 *
 * ## Reads are open and that is deliberate
 *
 * Anyone can fetch anyone's blob. It is AES-256-GCM ciphertext and the key is derived from a
 * passkey we never see, so there is nothing here to protect with an access check. Gating it would
 * imply the confidentiality comes from us saying no, which would be a worse claim than the true
 * one.
 *
 * ## Writes are not open
 *
 * A write carries a secp256k1 signature from the account key over the exact bytes being stored,
 * recovered and checked against the address in the request. Without it anyone could overwrite
 * anyone's blob: they still could not read it and destroying somebody's only copy is damage
 * enough on its own.
 *
 * The signature is stored alongside, so a reader can check it themselves rather than trusting
 * that we did.
 */

/** Recover the signer and compare. A mismatch is a refusal, never a warning. */
function signedBy(address: string, s: Sealed, signature: string): boolean {
  try {
    const sig = signature.startsWith("0x") ? signature.slice(2) : signature;
    // 64 bytes of r||s plus one recovery byte.
    if (sig.length !== 130) return false;
    const compact = Uint8Array.from(Buffer.from(sig.slice(0, 128), "hex"));
    const recovery = parseInt(sig.slice(128, 130), 16);
    if (recovery !== 0 && recovery !== 1) return false;

    const pub = secp256k1.Signature.fromCompact(compact)
      .addRecoveryBit(recovery)
      .recoverPublicKey(keccak_256(writeMessage(address, s)))
      .toRawBytes(false);

    const hash = keccak_256(pub.slice(1));
    const recovered = `0x${Array.from(hash.slice(-20), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    return recovered === address.toLowerCase();
  } catch {
    // A malformed signature is a failed check. Never an exception that a caller upstream might
    // catch and treat as "could not verify, so allow it".
    return false;
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Ceilings so a self-signed write cannot store an unbounded blob or an unbounded number of them. */
const MAX_BODY_BYTES = 65_536;
const MAX_CT_LEN = 32_768;
const MAX_CONTEXT_LEN = 128;
const MAX_CONTEXTS_PER_ADDRESS = 100;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const address = u.searchParams.get("address");
  const context = u.searchParams.get("context");

  if (!address || !ADDRESS.test(address)) {
    return problem(400, "Bad address", "Give ?address=0x… as a 20-byte hex address.");
  }

  const rows = await q<Record<string, unknown>>(
    context
      ? `SELECT context, version, nonce, ciphertext, signature, updated_at
           FROM fovea.vault WHERE lower(address) = lower($1) AND context = $2`
      : `SELECT context, version, nonce, ciphertext, signature, updated_at
           FROM fovea.vault WHERE lower(address) = lower($1) ORDER BY context`,
    context ? [address, context] : [address],
  );

  return json(
    envelope(
      {
        address,
        // Said in the response rather than only in a doc, because an agent reading this will not
        // read the doc.
        note: "These are AES-256-GCM blobs. Reads are open because there is nothing here that access control could protect: the key is derived from a passkey this server never sees.",
        blobs: rows.map((r) => ({
          context: r.context,
          sealed: { v: Number(r.version), context: r.context, nonce: r.nonce, ct: r.ciphertext },
          signature: r.signature,
          updatedAt: new Date(r.updated_at as string).toISOString(),
        })),
      },
      `curl -sS '${u.origin}/api/vault?address=${address}'`,
    ),
  );
}

export async function PUT(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return problem(413, "Body too large", `The request body must be under ${MAX_BODY_BYTES} bytes.`);
  }
  let body: { address?: string; sealed?: unknown; signature?: string };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return problem(400, "Body is not JSON", 'Send {"address", "sealed", "signature"}.');
  }

  const { address, signature } = body;
  if (!address || !ADDRESS.test(address)) {
    return problem(400, "Bad address", "address must be a 20-byte hex address.");
  }
  const sealed = parseSealed(body.sealed);
  if (!sealed) {
    return problem(400, "Bad envelope", "sealed must be {v:1, context, nonce, ct} with string fields.");
  }
  if (sealed.context.length > MAX_CONTEXT_LEN || sealed.ct.length > MAX_CT_LEN) {
    return problem(413, "Envelope too large", `context must be under ${MAX_CONTEXT_LEN} and ct under ${MAX_CT_LEN} characters.`);
  }
  if (!signature) {
    return problem(401, "Unsigned write", "A write must be signed by the account key for this address.", {
      sign: "keccak256 of: kanmani.vault.write.v1 \\n address \\n context \\n version \\n nonce \\n ct",
    });
  }

  if (!signedBy(address, sealed, signature)) {
    return problem(
      403,
      "Signature does not match this address",
      "The signature did not recover to the address given. Nothing was written.",
      {
        // Named so a client can find its own bug rather than guessing at ours.
        check: "Sign the keccak256 digest of the newline-joined fields in the order the docs give, with the account key derived under kanmani.iris.v1.",
      },
    );
  }

  // A signature proves control of the address, not that the address is scarce: anyone can make a
  // keypair and sign their own blobs. So an address is capped on how many distinct contexts it can
  // hold, and a new context over the cap is refused while updates to existing ones still work.
  const counts = await q1<{ has: string; n: string }>(
    `SELECT count(*) FILTER (WHERE context = $2)::text AS has, count(*)::text AS n
       FROM fovea.vault WHERE lower(address) = lower($1)`,
    [address, sealed.context],
  );
  if (counts && Number(counts.has) === 0 && Number(counts.n) >= MAX_CONTEXTS_PER_ADDRESS) {
    return problem(429, "Too many vault entries for this address", `Each address may hold up to ${MAX_CONTEXTS_PER_ADDRESS} contexts.`);
  }

  await q1(
    `INSERT INTO fovea.vault (address, context, version, nonce, ciphertext, signature, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (address, context) DO UPDATE
       SET version = EXCLUDED.version, nonce = EXCLUDED.nonce,
           ciphertext = EXCLUDED.ciphertext, signature = EXCLUDED.signature,
           updated_at = now()`,
    [address.toLowerCase(), sealed.context, sealed.v, sealed.nonce, sealed.ct, signature],
  );

  return json(
    envelope(
      {
        stored: true,
        address: address.toLowerCase(),
        context: sealed.context,
        bytes: sealed.ct.length,
        note: "Stored as ciphertext. This server cannot read it and holds nothing that could.",
      },
      `curl -sS '${new URL(req.url).origin}/api/vault?address=${address}&context=${encodeURIComponent(sealed.context)}'`,
    ),
  );
}
