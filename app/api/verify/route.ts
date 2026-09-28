import { envelope, json, problem, SITE } from "@/lib/api.ts";
import { check } from "@/lib/check.ts";
import { claim, claims } from "@/lib/queries.ts";
import {
  challenge,
  confirmPaymentNonce,
  paymentFrom,
  paymentResponseHeader,
  PRICE_ATOMIC,
  releasePaymentNonce,
  requirements,
  reservePaymentNonce,
  settlePayment,
  verifyPayment,
} from "@/lib/x402.ts";

export const dynamic = "force-dynamic";

const RESOURCE = `${SITE}/api/verify`;

/**
 * Check a document, for a fee, over the rail this site exists to audit.
 *
 * ## Why this one costs and the rest do not
 *
 * Reading a verdict we already hold costs a database query, so `/api/claims` is free. This
 * endpoint fetches a URL on somebody else's server and makes an RPC call, so it is priced. That
 * is the honest line between the two and it is stated in the 402 body rather than left for a
 * caller to work out.
 *
 * ## Free preview, always
 *
 * A caller cannot consent to a price without seeing what it buys. So an unpaid request still gets
 * the full shape of the answer and if the document is already in our index it gets the real
 * verdict for nothing, because we did that work once already and charging twice for it would be
 * a toll rather than a price.
 */
export async function GET() {
  // A human will open this in a browser long before any agent posts to it.
  return json(challenge(RESOURCE, "This endpoint takes POST. Here is what it costs and why."), {
    status: 402,
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: Request) {
  let body: { uri?: string; feedbackHash?: string; id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return problem(400, "Body is not JSON", 'Send {"uri": "<document uri>"} or {"id": "<claim id>"}.');
  }

  // An id resolves to its document AND its on-chain commitment, so a check by id is a real
  // verification rather than a hash of whatever the host feels like serving today.
  let uri = body.uri?.trim();
  let feedbackHash = body.feedbackHash?.trim();
  if (body.id) {
    const c = await claim(body.id.trim());
    if (!c) {
      return problem(404, "No such claim", `${body.id} is not in this index. That is not the same as it not existing on chain.`);
    }
    uri = c.feedbackUri;
    feedbackHash = c.feedbackHash;
  }

  if (!uri) {
    return problem(400, "Nothing to check", 'Give a "uri" or an "id" of a claim in this index.');
  }

  /* ------------------------------------------------ free: we already checked this exact thing */

  if (feedbackHash) {
    const already = await claims({ withUri: true, limit: 1000 });
    const hit = already.rows.find(
      (c) => c.feedbackHash.toLowerCase() === feedbackHash!.toLowerCase() && c.outcome !== null,
    );
    if (hit) {
      return json(
        envelope(
          {
            paid: false,
            // Said plainly rather than implied by the absence of a charge.
            whyFree:
              "This document is already in our index with a recorded verdict, so nothing was fetched and nothing was charged. Re-checking it on demand would cost a request on somebody else's server and you can ask for that by posting without a feedbackHash.",
            claimId: hit.id,
            url: `${SITE}/claim/${encodeURIComponent(hit.id)}`,
            verdict: {
              outcome: hit.outcome,
              rung: hit.rung,
              reason: hit.reason,
              mapping: hit.mapping,
              declaredNetwork: hit.declaredNetwork,
              declaredTx: hit.declaredTx,
              hashMatches: hit.hashMatches,
              foundOnChain: hit.foundChain
                ? { chain: hit.foundChain, chainId: hit.foundChainId, blockNumber: hit.foundBlock }
                : null,
              checkedAt: hit.checkedAt,
              checkedAtBlock: hit.checkedAtBlock,
            },
          },
          `curl -sS '${SITE}/api/claims?limit=1000' | jq '.data.items[] | select(.id=="${hit.id}")'`,
        ),
      );
    }
  }

  /* ------------------------------------------------ paid: we have to go and fetch something */

  const payment = paymentFrom(req.headers);

  if (!payment.ok) {
    return json(challenge(RESOURCE, payment.reason), { status: 402 });
  }

  const verified = await verifyPayment(payment.payload);
  if (!verified.valid) {
    // Whose fault it is decides the status code. A facilitator outage answered as 402 would make
    // a client re-sign and re-signing burns a nonce for nothing.
    if (verified.ours) {
      return problem(503, "We could not check your payment", verified.reason, {
        retryable: true,
        note: "Your payment was not rejected. We could not reach the facilitator to look at it. Nothing was charged and your authorization is untouched.",
      });
    }
    return json(challenge(RESOURCE, verified.reason), { status: 402 });
  }

  // Reserve the authorization before doing any priced work. Without this, N requests carrying one
  // signature each run the fetch and RPC in parallel and only one of them ever settles, so the
  // other N minus one get the paid work for nothing. Only one caller holds the nonce at a time.
  const reservation = reservePaymentNonce(payment.payload);
  if (!reservation.ok) {
    return json(challenge(RESOURCE, reservation.reason), { status: 402 });
  }

  // Do the work BEFORE taking the money. If the check throws, nothing has been settled and the
  // payer still holds a valid authorization they can spend elsewhere.
  let result: Awaited<ReturnType<typeof check>>;
  try {
    result = await check({ uri, feedbackHash });
  } catch (e) {
    releasePaymentNonce(reservation.key);
    // The real error is logged, never returned: a stranger does not get our RPC or DB internals.
    console.error("[/api/verify] check failed:", (e as Error).message);
    return problem(500, "The check did not complete", "The document could not be checked. Nothing was charged.", {
      charged: false,
      retryable: true,
      note: "Your payment was verified and deliberately not settled, because we did not deliver. The authorization is still yours to spend.",
    });
  }

  const settled = await settlePayment(payment.payload);

  // Delivery is gated on a confirmed settlement. A payment that verified but did not settle (a
  // facilitator failure, an authorization the payer consumed elsewhere, a balance that moved) must
  // not hand back the paid result, or the settle step is optional and the price is a suggestion.
  // The authorization is untouched, so a genuine payer simply retries.
  if (!settled.settled) {
    releasePaymentNonce(reservation.key);
    return problem(402, "Payment did not settle", settled.reason ?? "settlement did not confirm", {
      charged: false,
      retryable: true,
      note: "The payment verified but settlement did not confirm, so nothing was delivered and nothing was charged. Your authorization is untouched and you can retry.",
    });
  }

  confirmPaymentNonce(reservation.key);

  return json(
    envelope(
      {
        paid: true,
        payment: {
          settled: settled.settled,
          transaction: settled.transaction,
          reason: settled.reason,
          payer: settled.payer ?? (verified.payer || null),
          amount: PRICE_ATOMIC,
          asset: requirements().asset,
          network: requirements().network,
          headerUsed: payment.header,
          note: "This settlement is itself an x402 payment on Monad, so it can be checked by this same endpoint.",
        },
        verdict: result.verdict,
        hashWasSupplied: result.hashWasSupplied,
        bytesRead: result.bytesRead,
        mediaType: result.mediaType,
        source: result.source,
        coverage: result.coverage,
      },
      result.reproduce,
    ),
    {
      headers: settled.transaction
        ? { "x-payment-response": paymentResponseHeader(settled) }
        : {},
    },
  );
}
