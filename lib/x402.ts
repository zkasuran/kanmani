/**
 * x402 v2, so the verifier itself is payable.
 *
 * An agent can pay to have another agent's claim checked, in USDC, on the chain whose claims it
 * is checking. That closes the loop this project is about: the thing that audits payments is
 * itself paid for over the rail it audits, and its own settlement lands in its own index like
 * anybody else's.
 *
 * ## Everything below was read from the spec and confirmed by calling, in that order
 *
 * The shapes come from `specs/x402-specification-v2.md` in the protocol repository, not from
 * memory. Writing it from memory the first time produced a v1-shaped payload with `scheme` and
 * `network` at the top level, and the live facilitator answered `unsupported_scheme` because v2
 * moved the chosen method into an `accepted` object and it found nothing to read. Two details
 * that cost that round trip, kept here so nobody re-derives them:
 *
 * - `PaymentRequirements.amount`, not `maxAmountRequired`. The v1 name is gone.
 * - `resource` is its own object beside `accepts`, not three loose fields inside each
 *   requirement.
 *
 * `https://x402-facilitator.molandak.org/supported`, read 2026-09-20:
 *
 * ```
 * scheme exact, network eip155:143,   x402Version 2
 * scheme upto,  network eip155:143,   x402Version 2, facilitator 0x7f6a…Db86
 * scheme exact, network eip155:10143, x402Version 2
 * ```
 *
 * USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` on chain 143, read from chain the same day:
 * `name()` `USDC`, `version()` `2`, `decimals()` **6**, `DOMAIN_SEPARATOR()`
 * `0xfe22123e…342c93c6`. Six decimals, not eighteen: a literal carried from an 18-decimal chain
 * is wrong by a factor of a million and would quietly ask for a million times the price.
 *
 * ## Two header generations, both live
 *
 * v2 sends the payload base64 in `PAYMENT-SIGNATURE`. The older generation used `X-PAYMENT` and
 * some servers reject it with `invalid_x402_version`. Both are read here, because refusing a
 * client for using last year's header name helps nobody.
 */

/** 0.01 USDC. Six decimals, read off the token rather than assumed. */
export const PRICE_ATOMIC = "10000";
export const USDC_MONAD = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
/** CAIP-2. v2 dropped the bare chain names v1 used. */
export const NETWORK = "eip155:143";
export const FACILITATOR = process.env.X402_FACILITATOR ?? "https://x402-facilitator.molandak.org";

/**
 * Where a payment goes.
 *
 * The one EVM identity behind this work. Public by design: an address belongs in a submission and
 * on a verification page, and the key that signs for it never leaves the machine it lives on.
 */
export const PAY_TO = process.env.X402_PAY_TO ?? "0xDB6c6340342e71A63cD11Ebac2185204b7777777";

/** Section 5.1.2. Note `amount`, and note that nothing describing the resource lives in here. */
export type PaymentRequirements = {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** The EIP-712 domain the signature is made under. Read off the token, never guessed. */
  extra: { name: string; version: string };
};

/** Section 5.1.2, ResourceInfo. Its own object in v2. */
export type ResourceInfo = { url: string; description?: string; mimeType?: string };

export function requirements(): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: PRICE_ATOMIC,
    asset: USDC_MONAD,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
  };
}

export function resourceInfo(url: string): ResourceInfo {
  return {
    url,
    description:
      "Fetch and check one evidence document: resolve it, compare its bytes against the hash committed on chain, read the cited transaction on the chain the document names.",
    mimeType: "application/json",
  };
}

/** Section 5.2.2. `accepted` carries the method the client chose out of `accepts`. */
export type PaymentPayload = {
  x402Version: 2;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: { signature: string; authorization: Record<string, string> };
  extensions?: Record<string, unknown>;
};

/**
 * Pull the payment out of whichever header the client used.
 *
 * Returns a reason rather than throwing, because a malformed payment is a 402 with an
 * explanation, not a 500. A client that cannot tell "your base64 was wrong" from "the server
 * broke" will retry the same broken request forever.
 */
export function paymentFrom(
  headers: Headers,
): { ok: true; payload: PaymentPayload; header: string } | { ok: false; reason: string } {
  const v2 = headers.get("payment-signature");
  const v1 = headers.get("x-payment");
  const raw = v2 ?? v1;
  if (!raw) return { ok: false, reason: "PAYMENT-SIGNATURE header is required" };

  let text: string;
  try {
    // Round-tripped rather than trusted. Buffer.from(x, "base64") drops characters it does not
    // like instead of failing, so a corrupt payload decodes to something shorter and plausible,
    // and comparing the re-encoding is the only way to notice.
    const buf = Buffer.from(raw, "base64");
    if (buf.toString("base64").replace(/=+$/, "") !== raw.trim().replace(/=+$/, "")) {
      return { ok: false, reason: "payment header is not valid base64" };
    }
    text = buf.toString("utf8");
  } catch {
    return { ok: false, reason: "payment header is not valid base64" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "payment header does not decode to JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "payment payload is not an object" };
  }

  const p = parsed as Record<string, unknown>;

  // A v1 client sends scheme and network at the top level with no `accepted`. Say exactly that,
  // rather than letting it read as a malformed request, because the fix is a client upgrade and
  // the client cannot guess that from "invalid".
  const accepted = p.accepted as Record<string, unknown> | undefined;
  if (!accepted && (p.scheme || p.network)) {
    return {
      ok: false,
      reason:
        "this payload is x402 v1 shaped: v2 carries the chosen method in an `accepted` object rather than `scheme` and `network` at the top level",
    };
  }
  if (!accepted || typeof accepted !== "object") {
    return { ok: false, reason: "payment payload has no `accepted` object" };
  }
  if (accepted.scheme !== "exact") {
    return { ok: false, reason: `scheme ${String(accepted.scheme)} is not served here, use exact` };
  }
  if (accepted.network !== NETWORK) {
    return { ok: false, reason: `network ${String(accepted.network)} is not served here, use ${NETWORK}` };
  }

  const inner = p.payload as { signature?: unknown; authorization?: unknown } | undefined;
  if (!inner || typeof inner.signature !== "string" || typeof inner.authorization !== "object") {
    return { ok: false, reason: "payload needs a `signature` and an `authorization`" };
  }

  return {
    ok: true,
    header: v2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT",
    payload: {
      x402Version: 2,
      resource: p.resource as ResourceInfo | undefined,
      accepted: accepted as unknown as PaymentRequirements,
      payload: inner as PaymentPayload["payload"],
      extensions: (p.extensions as Record<string, unknown>) ?? {},
    },
  };
}

type FacilitatorVerify = { isValid: boolean; invalidReason?: string; invalidReasonDetails?: string; payer?: string };
type FacilitatorSettle = {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
};

async function callFacilitator<T>(
  path: string,
  payload: PaymentPayload,
): Promise<{ ok: true; body: T } | { ok: false; reason: string }> {
  try {
    const r = await fetch(`${FACILITATOR}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Section 7.1. The requirements are sent again beside the payload so the facilitator checks
      // the payment against what the server asked for, not only against what the client claims
      // it was asked for.
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: requirements(),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await r.text();
    if (!r.ok && r.status >= 500) return { ok: false, reason: `facilitator returned HTTP ${r.status}` };
    try {
      return { ok: true, body: JSON.parse(text) as T };
    } catch {
      return { ok: false, reason: `facilitator returned HTTP ${r.status} with a body that is not JSON` };
    }
  } catch (e) {
    // The facilitator being down is our problem, not the payer's. It must never read as a
    // rejected payment: a client told "your payment is invalid" will re-sign rather than retry,
    // and re-signing burns a nonce for nothing.
    return { ok: false, reason: `could not reach the facilitator: ${(e as Error).message}` };
  }
}

export async function verifyPayment(
  payload: PaymentPayload,
): Promise<{ valid: true; payer: string } | { valid: false; reason: string; ours: boolean }> {
  const r = await callFacilitator<FacilitatorVerify>("/verify", payload);
  // `ours` separates "we could not check your payment" from "your payment is not valid". The
  // first is a 503 and the second is a 402, and a client has to be able to tell them apart.
  if (!r.ok) return { valid: false, reason: r.reason, ours: true };
  if (!r.body.isValid) {
    return {
      valid: false,
      ours: false,
      reason: r.body.invalidReasonDetails ?? r.body.invalidReason ?? "the facilitator rejected this payment",
    };
  }
  return { valid: true, payer: r.body.payer ?? "" };
}

export async function settlePayment(
  payload: PaymentPayload,
): Promise<{ settled: boolean; transaction: string | null; payer: string | null; reason: string | null }> {
  const r = await callFacilitator<FacilitatorSettle>("/settle", payload);
  if (!r.ok) return { settled: false, transaction: null, payer: null, reason: r.reason };
  const tx = r.body.transaction && r.body.transaction !== "" ? r.body.transaction : null;
  return {
    settled: Boolean(r.body.success),
    transaction: tx,
    payer: r.body.payer ?? null,
    reason: r.body.success ? null : (r.body.errorReason ?? "settlement did not succeed"),
  };
}

/** Section 5.3. What a settled payment sends back, so a payer can find its own transaction. */
export function paymentResponseHeader(s: {
  settled: boolean;
  transaction: string | null;
  payer: string | null;
}): string {
  return Buffer.from(
    JSON.stringify({
      success: s.settled,
      transaction: s.transaction ?? "",
      network: NETWORK,
      ...(s.payer ? { payer: s.payer } : {}),
    }),
  ).toString("base64");
}

/** Section 5.1. The 402 body, in the shape a v2 client expects. */
export function challenge(url: string, error: string) {
  return {
    x402Version: 2,
    error,
    resource: resourceInfo(url),
    accepts: [requirements()],
    extensions: {},
    // Not part of the spec and included anyway, because a human will open this endpoint in a
    // browser long before any agent posts to it, and a bare machine challenge tells them nothing.
    help: {
      meaning: "402 here means pay me, not broken.",
      price: "0.01 USDC on Monad, chain 143, six decimals.",
      why: "This endpoint fetches a document from somebody else's server and reads a chain. Reading what is already checked costs us a query, so that is free: GET /api/claims.",
      facilitator: FACILITATOR,
      headers: "Send the payload base64 in PAYMENT-SIGNATURE. The older X-PAYMENT is accepted too.",
    },
  };
}
