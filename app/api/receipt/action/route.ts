import { envelope, json, problem } from "@/lib/api.ts";
import { q, q1 } from "@/lib/db.ts";
import { actionReceiptBytes, verifyAction, type ActionReceipt } from "@/lib/authority.ts";

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
 * not name, and a forged or mutated one is refused with 400 rather than stored and rendered. The
 * signature is then kept alongside, the same posture as `fovea.vault`: a reader checks it themselves
 * rather than trusting that we did.
 *
 * ## What this does NOT claim
 *
 * A stored receipt says one identity authorised one document. It does **not** say the transaction
 * landed, that the signer owns the agent, or that the document is good. The registry decides
 * ownership and the verdict ladder decides truth; this is neither. An endpoint that implied
 * otherwise would be manufacturing standing out of a signature, which is the shape of claim this
 * whole project exists to check rather than to produce.
 *
 * `agentId` is null for a registration, because the registry assigns the id after the fact.
 *
 * POST `{ receipt, signature }` — the exact object `/studio` offers to copy.
 * GET  `?agentId=<id>` — receipts for one agent, newest first.
 */

type Body = { receipt?: unknown; signature?: unknown };

function isReceipt(x: unknown): x is ActionReceipt {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    (r.action === "register" || r.action === "setAgentURI") &&
    typeof r.chainId === "number" &&
    (r.agentId === null || typeof r.agentId === "number") &&
    typeof r.uriHash === "string" &&
    typeof r.signer === "string" &&
    typeof r.identity === "string" &&
    typeof r.at === "string"
  );
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return problem(400, "Not JSON", "The body must be a JSON object with `receipt` and `signature`.");
  }

  if (!isReceipt(body.receipt)) {
    return problem(
      400,
      "Malformed receipt",
      "`receipt` must carry action, chainId, agentId, uriHash, signer, identity and at. `agentId` is null for a registration.",
    );
  }
  if (typeof body.signature !== "string" || body.signature.length === 0) {
    return problem(400, "Missing signature", "`signature` must be the base64url ed25519 signature over the canonical bytes.");
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

  let at: Date;
  try {
    at = new Date(receipt.at);
    if (Number.isNaN(at.getTime())) throw new Error("unparseable");
  } catch {
    return problem(400, "Bad timestamp", "`at` must be an ISO 8601 instant.");
  }

  // A replay is the same row rather than a second one. The uniqueness is the database's, not a flag
  // we remember to set.
  const row = await q1<{ id: string; received_at: string; fresh: boolean }>(
    `INSERT INTO fovea.agent_action
       (action, chain_id, agent_id, uri_hash, signer, identity, signature, signed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
        note: "A receipt says one identity authorised one document. It does not say the transaction landed, that the signer owns the agent, or that the document is good.",
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
    signed_at: string;
    received_at: string;
  }>(
    raw === null
      ? `SELECT action, chain_id, agent_id::text, uri_hash, signer, identity, signature, signed_at, received_at
           FROM fovea.agent_action ORDER BY signed_at DESC LIMIT 100`
      : `SELECT action, chain_id, agent_id::text, uri_hash, signer, identity, signature, signed_at, received_at
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
          signedAt: r.signed_at,
          receivedAt: r.received_at,
        })),
        note: "Signatures are included so a reader can verify them without trusting us. POST /api/receipt/verify, or check offline against the did:key in each identity.",
      },
      `curl -sS ${SITE}/api/receipt/action${raw ? `?agentId=${raw}` : ""}`,
    ),
  );
}
