import { envelope, json } from "@/lib/api.ts";

export const dynamic = "force-dynamic";

/**
 * An index for the bare /api/receipt path, so a reader who guesses it lands somewhere real.
 *
 * There is no verifier here. Verification lives at /api/receipt/verify (holds no key, checks any
 * receipt) and action receipts live at /api/receipt/action. A second POST verifier would be a
 * second thing that can drift, so this path only points at the two that do the work.
 */
export async function GET() {
  return json(
    envelope(
      {
        verify: {
          url: "/api/receipt/verify",
          how: "POST { receipt, signature, publicKey }. Holds no key, verifies any receipt, not only ours.",
        },
        action: {
          url: "/api/receipt/action",
          how: "POST { receipt, signature, binding } to publish who authorised a change. GET ?agentId=<id> to read them.",
        },
        note: "The attestation key signs these off chain as a did:key. It owns nothing and cannot move money.",
      },
      "static index of the receipt sub-routes",
    ),
  );
}
