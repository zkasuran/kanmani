import { describeWebhook, handleAlchemyWebhook } from "@/lib/rehydrate.ts";

export const dynamic = "force-dynamic";

/**
 * Alchemy's webhook, which is what turns a repaired document into a moved verdict on its own.
 *
 * The verdict store has always been append-only and `/status` has always listed every verdict that
 * changed. What was missing was anything to start a re-check, so one had to be run by hand. This is
 * the trigger: Alchemy watches the ERC-8004 Identity Registry on Monad, an agent updates its
 * metadata, we re-run the same ladder over that agent's claims and append a new verdict each time.
 * A `false` that was a broken document becomes a `true` with both timestamps kept.
 *
 * Everything this route does lives in `lib/rehydrate.ts` and is tested there. This file is the
 * Next.js surface and nothing else, which is the same split `/api/verify` and `lib/check.ts` use.
 *
 * ## Confirmed against Alchemy's own documentation on 2026-09-23, not from memory
 *
 * The header is `X-Alchemy-Signature`. The digest is a hex HMAC SHA-256 over the **raw** body under
 * the webhook's signing key. Alchemy's own note says the input "must be raw string body, not json
 * transformed version of the body", so the handler reads `req.text()` before anything parses JSON.
 * Alchemy's samples compare with `===`. We use `timingSafeEqual`. Top-level payload fields are
 * `webhookId`, `id`, `createdAt`, `type` plus `event`, where `id` is the delivery id the
 * idempotency guard keys on. Both the custom (`GRAPHQL`) and `ADDRESS_ACTIVITY` shapes are read.
 *
 * ## The posture, because this is an unauthenticated public endpoint
 *
 * A bad signature is 401 and reads nothing out of the body. A missing signing key is 503 for every
 * request, never a skipped check. A delivery carrying no event we act on is 200 with the reason each
 * log was passed over, because a 200 that says nothing cannot be told apart from a broken endpoint.
 * A retry appends nothing. A failure is 5xx with the delivery recorded as failed, so the next retry
 * is processed instead of being mistaken for a replay.
 */
export async function POST(req: Request) {
  return handleAlchemyWebhook(req);
}

/** A human opens this in a browser long before Alchemy posts to it, so it answers. */
export async function GET() {
  return describeWebhook();
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
