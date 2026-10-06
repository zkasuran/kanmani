import { envelope, json, problem } from "@/lib/api.ts";
import { q, q1 } from "@/lib/db.ts";
import { actionReceiptBytes, verifyAction, verifyBinding, type ActionReceipt } from "@/lib/authority.ts";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz";

export const dynamic = "force-dynamic";

/**
 * Publish an action receipt: proof of who authorised a change to an agent's document.
 *
 * Open to anyone, no key and no payment. That is deliberate and it is not a hole, because **the
 * signature is the authorisation.** A receipt is signed by an ed25519 attestation identity derived
 * from a passkey, so anyone can submit one and only the holder of that passkey could have produced
 * it. Gating submission behind an account would add a check that proves less than the signature
 * already does.
 *
 * ## What is verified before anything is written
 *
 * `verifyAction` re-derives the canonical bytes and checks the signature against the public key
 * carried inside the receipt's own `did:key`. So a receipt cannot be verified against a key it does
 * not name and a forged or mutated one is refused with 400 rather than stored and rendered. The
 * signature is then kept alongside, the same posture as `fovea.vault`: a reader checks it themselves
 * rather than trusting that we did.
 *
 * ## What this does NOT claim
 *
 * A stored receipt says one identity authorised one document. It does **not** say the transaction
 * landed, that the signer owns the agent or that the document is good. The registry decides
 * ownership and the verdict ladder decides truth; this is neither. An endpoint that implied
 * otherwise would be manufacturing standing out of a signature, which is the shape of claim this
 * whole project exists to check rather than to produce.
 *
 * `agentId` is null for a registration, because the registry assigns the id after the fact.
 *
 * POST `{ receipt, signature }` is the exact object `/account#agents` offers to copy.
 * GET  `?agentId=<id>` returns receipts for one agent, newest first.
 */

type Body = { receipt?: unknown; signature?: unknown; binding?: unknown };

/** Ceilings so an anonymous signed write cannot store unbounded rows or oversized fields. */
const MAX_BODY_BYTES = 8_192;
const MAX_SIGNATURE_LEN = 200;
const MAX_IDENTITY_LEN = 200;
const MAX_ROWS_PER_IDENTITY = 500;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function isReceipt(x: unknown): x is ActionReceipt {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  // Every field is bounded in shape and size, not just type. Without this a stranger can vary the
  // uriHash to defeat the ON CONFLICT dedup and store an unbounded number of oversized rows, since
  // the signature is their own and costs them nothing to make.
  return (
    (r.action === "register" || r.action === "setAgentURI") &&
    typeof r.chainId === "number" &&
    Number.isInteger(r.chainId) &&
    r.chainId > 0 &&
    r.chainId <= 1_000_000_000_000 &&
    (r.agentId === null ||
      (typeof r.agentId === "number" && Number.isInteger(r.agentId) && r.agentId >= 0 && r.agentId <= Number.MAX_SAFE_INTEGER)) &&
    typeof r.uriHash === "string" &&
    HASH.test(r.uriHash) &&
    typeof r.signer === "string" &&
    ADDRESS.test(r.signer) &&
    typeof r.identity === "string" &&
    r.identity.length <= MAX_IDENTITY_LEN &&
    typeof r.at === "string" &&
    r.at.length <= 40
  );
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return problem(413, "Body too large", `The request body must be under ${MAX_BODY_BYTES} bytes.`);
  }
  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return problem(400, "Not JSON", "The body must be a JSON object with `receipt` and `signature`.");
  }

  if (!isReceipt(body.receipt)) {
    return problem(
      400,
      "Malformed receipt",
      "`receipt` must carry action, a positive integer chainId, a null or non-negative agentId, a 0x keccak uriHash, a 0x address signer, a did:key identity and an ISO timestamp. `agentId` is null for a registration.",
    );
  }
  if (typeof body.signature !== "string" || body.signature.length === 0 || body.signature.length > MAX_SIGNATURE_LEN) {
    return problem(400, "Missing or oversized signature", "`signature` must be the base64url ed25519 signature over the canonical bytes.");
  }

  const receipt = body.receipt;

  // Verified before storage, never after. A receipt that does not check out is refused rather than
  // kept with a flag, because a stored-but-invalid row is one query away from being rendered as if
  // it were good.
  if (!verifyAction(receipt, body.signature)) {
    return problem(
      400,
      "Signature does not verify",
      "The signature does not match the canonical bytes for this receipt under the key named in its own identity. Nothing was stored.",
      { canonical: new TextDecoder().decode(actionReceiptBytes(receipt)) },
    );
  }

  // The account-key binding proves the EVM `signer` in the receipt is controlled by the same person
  // as the attestation identity. Without it a receipt can name any address as its signer, since the
  // ed25519 signature says nothing about that address. Required, so a stored receipt's signer is real.
  if (typeof body.binding !== "string" || body.binding.length === 0 || body.binding.length > MAX_SIGNATURE_LEN) {
    return problem(400, "Missing or oversized binding", "`binding` must be the account-key signature (0x r||s||v) over the canonical bytes.");
  }
  if (!verifyBinding(receipt, body.binding)) {
    return problem(
      400,
      "Binding does not verify",
      "The binding did not recover to the signer named in the receipt, so the signer address is not proven controlled by whoever holds this identity. Nothing was stored.",
    );
  }

  let at: Date;
  try {
    at = new Date(receipt.at);
    if (Number.isNaN(at.getTime())) throw new Error("unparseable");
  } catch {
    return problem(400, "Bad timestamp", "`at` must be an ISO 8601 instant.");
  }

  // A cap per identity, so a single passkey cannot fill the table by varying the uriHash. The
  // identity is authenticated by the signature just checked, so this counts real rows for a real key.
  const count = await q1<{ n: string }>(
    `SELECT count(*)::text AS n FROM fovea.agent_action WHERE identity = $1`,
    [receipt.identity],
  );
  if (count && Number(count.n) >= MAX_ROWS_PER_IDENTITY) {
    return problem(429, "Too many receipts for this identity", `Each identity may publish up to ${MAX_ROWS_PER_IDENTITY} receipts.`);
  }

  // A replay is the same row rather than a second one. The uniqueness is the database's, not a flag
  // we remember to set.
  const row = await q1<{ id: string; received_at: string; fresh: boolean }>(
    `INSERT INTO fovea.agent_action
       (action, chain_id, agent_id, uri_hash, signer, identity, signature, binding, signed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (identity, uri_hash, action) DO UPDATE SET identity = fovea.agent_action.identity
     RETURNING id::text, received_at, (xmax = 0) AS fresh`,
    [
      receipt.action,
      receipt.chainId,
      receipt.agentId,
      receipt.uriHash,
      receipt.signer.toLowerCase(),
      receipt.identity,
      body.signature,
      body.binding,
      at.toISOString(),
    ],
  );

  return json(
    envelope(
      {
        stored: true,
        // False when this exact receipt was already published. Said plainly rather than reported as
        // a fresh write, because "we already had this" is the honest answer.
        firstTime: row?.fresh ?? false,
        id: row?.id ?? null,
        receivedAt: row?.received_at ?? null,
        note: "A receipt says one identity authorised one document. It does not say the transaction landed, that the signer owns the agent or that the document is good.",
      },
      `curl -sS ${SITE}/api/receipt/action?agentId=${receipt.agentId ?? ""}`,
    ),
    { status: row?.fresh ? 201 : 200 },
  );
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const raw = u.searchParams.get("agentId");
  if (raw !== null && !/^\d+$/.test(raw)) {
    return problem(400, "Bad agent id", "agentId must be a decimal registry id.");
  }

  const rows = await q<{
    action: string;
    chain_id: number;
    agent_id: string | null;
    uri_hash: string;
    signer: string;
    identity: string;
    signature: string;
    binding: string | null;
    signed_at: string;
    received_at: string;
  }>(
    raw === null
      ? `SELECT action, chain_id, agent_id::text, uri_hash, signer, identity, signature, binding, signed_at, received_at
           FROM fovea.agent_action ORDER BY signed_at DESC LIMIT 100`
      : `SELECT action, chain_id, agent_id::text, uri_hash, signer, identity, signature, binding, signed_at, received_at
           FROM fovea.agent_action WHERE agent_id = $1 ORDER BY signed_at DESC LIMIT 100`,
    raw === null ? [] : [Number(raw)],
  );

  return json(
    envelope(
      {
        agentId: raw === null ? null : Number(raw),
        total: rows.length,
        items: rows.map((r) => ({
          action: r.action,
          chainId: r.chain_id,
          agentId: r.agent_id === null ? null : Number(r.agent_id),
          uriHash: r.uri_hash,
          signer: r.signer,
          identity: r.identity,
          signature: r.signature,
          binding: r.binding,
          signedAt: r.signed_at,
          receivedAt: r.received_at,
        })),
        note: "Signatures are included so a reader can verify them without trusting us. POST /api/receipt/verify or check offline against the did:key in each identity.",
      },
      `curl -sS ${SITE}/api/receipt/action${raw ? `?agentId=${raw}` : ""}`,
    ),
  );
}
