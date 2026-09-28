import { json, problem, SITE } from "@/lib/api.ts";
import { AGENTS, assay, type AgentSlug, MONAD_BLOCK_MS, sentinel } from "@/lib/agents.ts";
import {
  challenge,
  confirmPaymentNonce,
  paymentFrom,
  paymentResponseHeader,
  releasePaymentNonce,
  requirements,
  reservePaymentNonce,
  settlePayment,
  verifyPayment,
} from "@/lib/x402.ts";

export const dynamic = "force-dynamic";

/**
 * The endpoint both shipped agents answer on.
 *
 * One route rather than two, because the agents differ in what they compute and not in how they are
 * paid, reached or described. Duplicating the payment handshake per agent is how two copies drift
 * until one of them takes money without doing work.
 *
 * ## Work first, settle second
 *
 * The answer is computed before the payment is settled, matching `/api/verify`. If the computation
 * throws, nothing has been taken. The reverse order is more convenient and occasionally charges for
 * a failure, which on a site about honest receipts would be indefensible.
 *
 * ## Free preview
 *
 * GET returns the agent's card, its price and the reason it needs Monad, unpaid. A caller cannot
 * consent to a price without seeing what it buys.
 */

function spec(slug: string) {
  return (AGENTS as Record<string, (typeof AGENTS)[AgentSlug]>)[slug];
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const s = spec(slug);
  if (!s) return problem(404, "No such agent", `Known agents: ${Object.keys(AGENTS).join(", ")}.`);
  const resource = `${SITE}/api/service/${s.slug}`;
  return json(
    {
      agent: s.name,
      sells: s.sells,
      needsMonad: s.needsMonad,
      blockMs: MONAD_BLOCK_MS,
      input: s.input,
      output: s.output,
      price: { atomic: s.priceAtomic, asset: requirements().asset, network: requirements().network },
      howToPay: challenge(resource, "POST with an X-PAYMENT header. This body is the price and the reason."),
    },
    { status: 402 },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const s = spec(slug);
  if (!s) return problem(404, "No such agent", `Known agents: ${Object.keys(AGENTS).join(", ")}.`);
  const resource = `${SITE}/api/service/${s.slug}`;

  let body: { agentId?: number | string; maxAgeBlocks?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return problem(400, "Body is not JSON", `Send ${s.input}`);
  }

  const agentId = Number(body.agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return problem(400, "agentId must be a positive integer", `Send ${s.input}`);
  }

  const payment = paymentFrom(req.headers);
  if (!payment.ok) return json(challenge(resource, payment.reason), { status: 402 });

  const verified = await verifyPayment(payment.payload);
  if (!verified.valid) {
    // Whose fault it is decides the status code. A facilitator outage answered as 402 would make the
    // caller re-sign, which burns a nonce for a failure that was never theirs.
    if (verified.ours) {
      return problem(503, "We could not check your payment", verified.reason, {
        retryable: true,
        note: "Your payment was not rejected. Nothing was charged and your authorization is untouched.",
      });
    }
    return json(challenge(resource, verified.reason), { status: 402 });
  }

  // Reserve the authorization before any priced work, so one signature cannot drive many parallel
  // computations for a single eventual settle.
  const reservation = reservePaymentNonce(payment.payload);
  if (!reservation.ok) return json(challenge(resource, reservation.reason), { status: 402 });

  // Work before money. If this throws, the verified authorization is deliberately not settled.
  let answer: Awaited<ReturnType<typeof sentinel>> | Awaited<ReturnType<typeof assay>>;
  try {
    answer =
      s.slug === "sentinel"
        ? await sentinel(agentId, Number.isFinite(Number(body.maxAgeBlocks)) ? Number(body.maxAgeBlocks) : 64)
        : await assay(agentId);
  } catch (e) {
    releasePaymentNonce(reservation.key);
    console.error(`[/api/service/${s.slug}] agent failed:`, (e as Error).message);
    return problem(500, "The agent did not complete", "The agent could not produce a result. Nothing was charged.", {
      charged: false,
      retryable: true,
      note: "Your payment was verified and deliberately not settled, because we did not deliver.",
    });
  }

  const settled = await settlePayment(payment.payload);

  // Delivery is gated on settlement. A verified-but-unsettled payment does not get the paid answer,
  // or the settle step is optional. The authorization is untouched, so a genuine payer retries.
  if (!settled.settled) {
    releasePaymentNonce(reservation.key);
    return problem(402, "Payment did not settle", settled.reason ?? "settlement did not confirm", {
      charged: false,
      retryable: true,
      note: "The payment verified but settlement did not confirm, so nothing was delivered and nothing was charged. Your authorization is untouched.",
    });
  }

  confirmPaymentNonce(reservation.key);

  return json(
    {
      agent: s.name,
      chainId: 143,
      blockMs: MONAD_BLOCK_MS,
      payment: {
        settled: settled.settled,
        transaction: settled.transaction,
        reason: settled.reason,
        payer: settled.payer ?? (verified.payer || null),
        note: "Paid over x402 on Monad, so this settlement is itself checkable by /api/verify.",
      },
      answer,
    },
    { headers: settled.transaction ? { "x-payment-response": paymentResponseHeader(settled) } : {} },
  );
}
