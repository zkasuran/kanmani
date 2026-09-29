import { json, problem, SITE } from "@/lib/api.ts";
import { AGENTS, assay, type AgentSlug, MONAD_BLOCK_MS, sentinel } from "@/lib/agents.ts";
import { chargeFor } from "@/lib/metering.ts";
import { settlementRequirements, type UptoPayload, type UptoRequirements } from "@/lib/upto.ts";
import {
  challenge,
  confirmPaymentNonce,
  paymentFrom,
  paymentResponseHeader,
  releasePaymentNonce,
  requirements,
  reservePaymentNonce,
  settlePayment,
  uptoFacilitatorAddress,
  uptoServiceRequirements,
  verifyPayment,
  type PaymentRequirements,
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
 * ## Paid by usage, capped by a signature
 *
 * `upto` is offered first. The buyer signs a Permit2 maximum equal to the listed price. We verify at
 * that maximum, run the work, compute the charge from the meter in lib/metering and settle only that.
 * The rest never leaves the buyer. `exact` is still accepted for clients without Permit2 and pays the
 * listed price as before. Every answer states which scheme was used, the ceiling, the charge and the
 * meter, so the charge can be recomputed rather than trusted.
 *
 * ## Free preview
 *
 * GET returns the agent's card, its price and the reason it needs Monad, unpaid. A caller cannot
 * consent to a price without seeing what it buys.
 */

function spec(slug: string) {
  return (AGENTS as Record<string, (typeof AGENTS)[AgentSlug]>)[slug];
}

/** What this agent accepts right now. Upto only when the facilitator's address could be read. */
async function offers(priceAtomic: string): Promise<{ upto: UptoRequirements | null; exact: PaymentRequirements; accepts: (UptoRequirements | PaymentRequirements)[] }> {
  const fac = await uptoFacilitatorAddress();
  const upto = fac ? uptoServiceRequirements(priceAtomic, fac) : null;
  const exact = { ...requirements(), amount: priceAtomic };
  return { upto, exact, accepts: upto ? [upto, exact] : [exact] };
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const s = spec(slug);
  if (!s) return problem(404, "No such agent", `Known agents: ${Object.keys(AGENTS).join(", ")}.`);
  const resource = `${SITE}/api/service/${s.slug}`;
  const o = await offers(s.priceAtomic);
  return json(
    {
      agent: s.name,
      sells: s.sells,
      needsMonad: s.needsMonad,
      blockMs: MONAD_BLOCK_MS,
      input: s.input,
      output: s.output,
      price: {
        ceilingAtomic: s.priceAtomic,
        asset: requirements().asset,
        network: requirements().network,
        schemes: o.accepts.map((a) => a.scheme),
        meter: "upto charges min(ceiling, 2000 + 1000 per decided claim read). Sentinel refused on freshness charges 0. exact always charges the ceiling.",
      },
      howToPay: challenge(resource, "POST with a PAYMENT-SIGNATURE header. This body is the price and the reason.", o.accepts),
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
  const o = await offers(s.priceAtomic);
  const ask = (reason: string) => json(challenge(resource, reason, o.accepts), { status: 402 });

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

  const payment = paymentFrom(req.headers, o.upto ? ["upto", "exact"] : ["exact"]);
  if (!payment.ok) return ask(payment.reason);
  const isUpto = payment.payload.accepted.scheme === "upto";
  // The requirements WE set, never the ones the client echoes. Verify-time amount is the ceiling.
  const asked: UptoRequirements | PaymentRequirements = isUpto ? o.upto! : o.exact;

  const verified = await verifyPayment(payment.payload, asked);
  if (!verified.valid) {
    // Whose fault it is decides the status code. A facilitator outage answered as 402 would make the
    // caller re-sign, which burns a nonce for a failure that was never theirs.
    if (verified.ours) {
      return problem(503, "We could not check your payment", verified.reason, {
        retryable: true,
        note: "Your payment was not rejected. Nothing was charged and your authorization is untouched.",
      });
    }
    return ask(verified.reason);
  }

  // Reserve the authorization before any priced work, so one signature cannot drive many parallel
  // computations for a single eventual settle.
  const reservation = reservePaymentNonce(payment.payload);
  if (!reservation.ok) return ask(reservation.reason);

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

  // What the work cost. For exact the scheme fixes it at the ceiling.
  const ceiling = BigInt(s.priceAtomic);
  const metered = chargeFor(s.slug, answer, ceiling);
  const chargeAtomic = isUpto ? metered.chargeAtomic : ceiling;

  let settleReqs: UptoRequirements | PaymentRequirements = asked;
  if (isUpto) {
    const g = settlementRequirements(o.upto!, payment.payload.payload as UptoPayload, chargeAtomic);
    if (!g.ok) {
      releasePaymentNonce(reservation.key);
      return problem(402, "Payment cannot be settled for this charge", g.reason, { charged: false, retryable: true });
    }
    settleReqs = g.requirements;
  }

  // Nothing owed: no transaction at all. The signature is marked spent here so it cannot be replayed
  // for another call. It lapses on chain at its deadline without ever moving funds.
  if (isUpto && chargeAtomic === 0n) {
    confirmPaymentNonce(reservation.key);
    return json({
      agent: s.name,
      chainId: 143,
      blockMs: MONAD_BLOCK_MS,
      payment: {
        scheme: "upto",
        settled: true,
        transaction: null,
        ceilingAtomic: s.priceAtomic,
        chargedAtomic: "0",
        meter: metered.meter,
        payer: verified.payer || null,
        note: "Charged nothing, so nothing was sent on chain. Your signed maximum was never used.",
      },
      answer,
    });
  }

  const settled = await settlePayment(payment.payload, settleReqs);

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
        scheme: isUpto ? "upto" : "exact",
        settled: settled.settled,
        transaction: settled.transaction,
        reason: settled.reason,
        ceilingAtomic: s.priceAtomic,
        chargedAtomic: settled.amount ?? chargeAtomic.toString(),
        // The meter the charge came from. For exact it is shown too, beside the fixed charge, so a
        // buyer can see what upto would have cost.
        meter: metered.meter,
        payer: settled.payer ?? (verified.payer || null),
        note: isUpto
          ? "Signed a maximum, charged the metered amount. The rest never left your wallet. Recompute the charge from the meter."
          : "Paid the listed price with exact. upto would have charged the metered amount shown.",
      },
      answer,
    },
    { headers: settled.transaction ? { "x-payment-response": paymentResponseHeader(settled) } : {} },
  );
}
