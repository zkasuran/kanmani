import { envelope, json, problem, SITE } from "@/lib/api.ts";
import { check } from "@/lib/check.ts";
import {
  challenge,
  confirmPaymentNonce,
  paymentFrom,
  paymentResponseHeader,
  releasePaymentNonce,
  reservePaymentNonce,
  settlePayment,
  verifyPayment,
} from "@/lib/x402.ts";
import { payNet, requirementsFor } from "@/lib/pay-net.ts";

export const dynamic = "force-dynamic";

const RESOURCE = `${SITE}/api/testnet/verify`;
const NET = "testnet" as const;
const NETWORK = "eip155:10143";

/**
 * The paid testnet check, settled on Monad testnet with TestUSDC.
 *
 * A sibling of /api/verify that settles over the gasless x402 rail on testnet, so a brand-new passkey
 * funded by the sponsored mint reaches a confirmed testnet transaction with zero funding steps. The
 * facilitator relays the signed EIP-3009 authorization and pays the gas, so the account needs no MON.
 *
 * The default target is a self-contained data: document, so the paid path always runs and a
 * settlement always lands even with no external document to fetch. A caller may still pass a uri.
 *
 * The mainnet /api/verify is byte-identical and untouched. This path exists beside it under its own
 * requirements (eip155:10143, TestUSDC's own EIP-712 domain), never by rewriting the live one.
 */

const DEFAULT_TARGET = `data:application/json,${encodeURIComponent('{"service":"kanmani-testnet-demo","note":"a settled testnet payment, nothing claimed"}')}`;

export function GET() {
  return json(challenge(RESOURCE, "This endpoint takes POST and settles on Monad testnet.", [requirementsFor(NET)]), {
    status: 402,
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: Request) {
  let body: { uri?: string } = {};
  try {
    const text = await req.text();
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    return problem(400, "Body is not JSON", 'Send {"uri":"<document uri>"} or an empty body for the demo target.');
  }
  const uri = body.uri?.trim() || DEFAULT_TARGET;

  // Testnet-aware: paymentFrom must accept eip155:10143 rather than the mainnet default.
  const payment = paymentFrom(req.headers, ["exact"], NETWORK);
  if (!payment.ok) {
    return json(challenge(RESOURCE, payment.reason, [requirementsFor(NET)]), { status: 402 });
  }

  const verified = await verifyPayment(payment.payload, requirementsFor(NET));
  if (!verified.valid) {
    if (verified.ours) {
      return problem(503, "We could not check your payment", verified.reason, {
        retryable: true,
        note: "Your payment was not rejected. We could not reach the facilitator. Nothing was charged and your authorization is untouched.",
      });
    }
    return json(challenge(RESOURCE, verified.reason, [requirementsFor(NET)]), { status: 402 });
  }

  const reservation = reservePaymentNonce(payment.payload);
  if (!reservation.ok) {
    return json(challenge(RESOURCE, reservation.reason, [requirementsFor(NET)]), { status: 402 });
  }

  // Do the work before taking the money. The data: target resolves with no network, so this cannot
  // fail for lack of a document, which is what makes the settle reliable on the demo path.
  let result: Awaited<ReturnType<typeof check>>;
  try {
    result = await check({ uri });
  } catch (e) {
    releasePaymentNonce(reservation.key);
    console.error("[/api/testnet/verify] check failed:", (e as Error).message);
    return problem(500, "The check did not complete", "Nothing was charged.", { charged: false, retryable: true });
  }

  const settled = await settlePayment(payment.payload, requirementsFor(NET));
  if (!settled.settled) {
    releasePaymentNonce(reservation.key);
    return problem(402, "Payment did not settle", settled.reason ?? "settlement did not confirm", {
      charged: false,
      retryable: true,
      note: "The payment verified but settlement did not confirm, so nothing was delivered and nothing was charged. Your authorization is untouched.",
    });
  }

  confirmPaymentNonce(reservation.key);

  const reqs = requirementsFor(NET);
  return json(
    envelope(
      {
        paid: true,
        payment: {
          settled: settled.settled,
          transaction: settled.transaction,
          txUrl: settled.transaction ? `${payNet(NET).explorerTx}${settled.transaction}` : null,
          reason: settled.reason,
          payer: settled.payer ?? (verified.payer || null),
          amount: reqs.amount,
          asset: reqs.asset,
          network: reqs.network,
          headerUsed: payment.header,
          note: "A settled testnet payment, relayed and paid for by the facilitator. The account held no MON.",
        },
        verdict: result.verdict,
      },
      result.reproduce,
    ),
    {
      headers: settled.transaction ? { "x-payment-response": paymentResponseHeader(settled) } : {},
    },
  );
}
