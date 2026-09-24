import { envelope, json, problem } from "@/lib/api.ts";
import { verifyReceipt, type Receipt } from "@/lib/iris.ts";

export const dynamic = "force-dynamic";

/**
 * Check a verification receipt's signature. Open to anyone, no key and no payment.
 *
 * A receipt is a statement that a claim was checked and what was found, signed by an identity that
 * is not a wallet: an ed25519 key derived from a passkey, published as a `did:key`. The point of
 * that identity is that it reconstructs on any device and cannot move money, so a receipt can be
 * attributed without handing the signer any spending authority.
 *
 * This endpoint exists so that attribution is checkable by someone who does not trust us and does
 * not run our code. It takes the receipt, the signature and the public key and re-derives the
 * answer. It holds no key material, consults no database and has no opinion: a receipt we never
 * issued verifies here exactly as well as one we did, provided the signature is good. That is the
 * property worth having. An endpoint that only validated our own receipts would be a loyalty check,
 * not a verification.
 *
 * POST with `{ receipt, signature, publicKey }`.
 *   `signature`  64 bytes, hex, with or without 0x
 *   `publicKey`  32 bytes, hex or the `did:key:kanmani:<base64url>` form the account page shows
 *
 * The bytes that get signed are canonical and documented in `receiptBytes`: a versioned tag then
 * the fields in fixed order, newline separated. So a third party can reproduce the digest from the
 * receipt alone and does not have to take our word for the encoding.
 */

const OUTCOMES = new Set(["true", "false", "noClaim", "unknown"]);

function hexToBytes(raw: string): Uint8Array | null {
  const h = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  if (h.length === 0 || h.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(h)) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Accepts the raw hex key or the did:key form, because the account page publishes the latter. */
function parsePublicKey(raw: string): Uint8Array | null {
  const did = "did:key:kanmani:";
  if (raw.startsWith(did)) {
    const b64 = raw.slice(did.length).replace(/-/g, "+").replace(/_/g, "/");
    try {
      const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }
  return hexToBytes(raw);
}

/** Rebuilt rather than spread, so an unexpected field cannot ride along into the signed bytes. */
function parseReceipt(v: unknown): Receipt | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.claimId !== "string" || r.claimId === "") return null;
  if (typeof r.outcome !== "string" || !OUTCOMES.has(r.outcome)) return null;
  if (typeof r.checkedAt !== "string" || r.checkedAt === "") return null;
  if (r.checkedAtBlock !== null && typeof r.checkedAtBlock !== "string") return null;
  if (r.mapping !== null && r.mapping !== undefined && typeof r.mapping !== "string") return null;
  return {
    claimId: r.claimId,
    outcome: r.outcome as Receipt["outcome"],
    checkedAtBlock: (r.checkedAtBlock as string | null) ?? null,
    checkedAt: r.checkedAt,
    mapping: (r.mapping as string | null) ?? null,
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problem(400, "Body is not JSON", "Send a JSON object with receipt, signature and publicKey.");
  }

  const b = body as Record<string, unknown>;
  const receipt = parseReceipt(b.receipt);
  if (!receipt) {
    return problem(400, "Bad receipt", "receipt needs claimId, outcome, checkedAt and may carry checkedAtBlock and mapping.", {
      outcomes: [...OUTCOMES],
    });
  }
  if (typeof b.signature !== "string" || typeof b.publicKey !== "string") {
    return problem(400, "Missing fields", "signature and publicKey must both be strings.");
  }

  const signature = hexToBytes(b.signature);
  if (!signature || signature.length !== 64) {
    return problem(400, "Bad signature", "signature must be 64 bytes of hex, an ed25519 signature.");
  }

  const publicKey = parsePublicKey(b.publicKey);
  if (!publicKey || publicKey.length !== 32) {
    return problem(400, "Bad public key", "publicKey must be 32 bytes of hex or a did:key:kanmani: value.");
  }

  // The whole answer. A bad signature is `false`, never an error: a caller checking somebody
  // else's receipt is doing the right thing and deserves an answer rather than a stack trace.
  const valid = verifyReceipt(receipt, signature, publicKey);

  return json(
    envelope(
      {
        valid,
        // Echoed so a caller can see exactly which bytes were checked and reproduce them.
        checked: {
          claimId: receipt.claimId,
          outcome: receipt.outcome,
          checkedAt: receipt.checkedAt,
          checkedAtBlock: receipt.checkedAtBlock,
          mapping: receipt.mapping,
        },
        signedBytesFormat:
          "kanmani.receipt.v1\\n<claimId>\\n<outcome>\\n<checkedAtBlock>\\n<checkedAt>\\n<mapping>, UTF-8, ed25519 over exactly those bytes",
        note: valid
          ? "This signature is good for this receipt under this key. It says who attested, never that the outcome is correct."
          : "This signature does not verify for these bytes under this key. Either the receipt was altered, the key is a different identity or the signature is not ours to check.",
      },
      "ed25519 verify over receiptBytes(receipt), see lib/iris.ts receiptBytes and verifyReceipt",
    ),
  );
}

export async function GET() {
  return json(
    envelope(
      {
        how: "POST { receipt, signature, publicKey } to this URL.",
        receipt: { claimId: "143_10182_0xabc_1", outcome: "false", checkedAtBlock: "106462031", checkedAt: "2026-09-20T00:00:00.000Z", mapping: "execution-market.v1" },
        signature: "64 bytes hex, ed25519",
        publicKey: "32 bytes hex or did:key:kanmani:<base64url>",
        why: "Attribution should be checkable by someone who does not trust us. This endpoint holds no keys and verifies any receipt, not only ours.",
      },
      "static usage document",
    ),
  );
}
