/**
 * x402 v2, so the verifier itself is payable.
 *
 * An agent can pay to have another agent's claim checked, in USDC, on the chain whose claims it
 * is checking. That closes the loop this project is about: the thing that audits payments is
 * itself paid for over the rail it audits and its own settlement lands in its own index like
 * anybody else's.
 *
 * ## Everything below was read from the spec and confirmed by calling, in that order
 *
 * The shapes come from `specs/x402-specification-v2.md` in the protocol repository, not from
 * memory. Writing it from memory the first time produced a v1-shaped payload with `scheme` and
 * `network` at the top level and the live facilitator answered `unsupported_scheme` because v2
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
import { facilitatorAddressFrom, signedMaximum, uptoRequirements, type UptoPayload, type UptoRequirements } from "./upto.ts";

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
 * on a verification page and the key that signs for it never leaves the machine it lives on.
 */
export const PAY_TO = process.env.X402_PAY_TO ?? "0xDB6c6340342e71A63cD11Ebac2185204b7777777";

/** Section 5.1.2. Note `amount` and note that nothing describing the resource lives in here. */
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

/**
 * Priced endpoints do not all sell the same thing, so the description follows the URL.
 *
 * It used to be one hardcoded sentence about checking an evidence document, which was true of
 * /api/verify and false of every agent under /api/service. A 402 body that misdescribes what the
 * caller is buying is wrong information in the one place a machine has to trust us.
 */
const DESCRIPTIONS: Record<string, string> = {
  sentinel:
    "A pre-hire verdict on one agent, stamped with the block it was measured at, refused rather than served if it is older than the freshness bound you set.",
  assay:
    "The bond one agent should post: a floor in basis points plus a premium, derived from its measured claim-truth rate, refused when the sample is too small to price.",
};

export function resourceInfo(url: string): ResourceInfo {
  const slug = url.split("/api/service/")[1]?.split(/[?#]/)[0] ?? "";
  return {
    url,
    description:
      DESCRIPTIONS[slug] ??
      "Fetch and check one evidence document: resolve it, compare its bytes against the hash committed on chain, read the cited transaction on the chain the document names.",
    mimeType: "application/json",
  };
}

/** Section 5.2.2. `accepted` carries the method the client chose out of `accepts`. */
export type PaymentPayload = {
  x402Version: 2;
  resource?: ResourceInfo;
  accepted: PaymentRequirements | UptoRequirements;
  /** `exact` carries an EIP-3009 `authorization`. `upto` carries a Permit2 `permit2Authorization`. */
  payload: { signature: string; authorization: Record<string, string> } | UptoPayload;
  extensions?: Record<string, unknown>;
};

export type Scheme = "exact" | "upto";

/**
 * The facilitator's own upto address on mainnet, read from its /supported and cached.
 *
 * Null when it cannot be read or is not advertised. The caller then offers `exact` only, because an
 * upto challenge with a guessed facilitator would ask the buyer to sign an authorisation that nobody
 * can settle.
 */
let uptoFacilitator: { at: number; address: `0x${string}` | null } | null = null;
export async function uptoFacilitatorAddress(): Promise<`0x${string}` | null> {
  if (uptoFacilitator && Date.now() - uptoFacilitator.at < 10 * 60_000) return uptoFacilitator.address;
  try {
    const r = await fetch(`${FACILITATOR}/supported`, { signal: AbortSignal.timeout(8_000) });
    const address = r.ok ? facilitatorAddressFrom(await r.json(), NETWORK) : null;
    uptoFacilitator = { at: Date.now(), address };
    return address;
  } catch {
    // Not cached, so the next request tries again rather than serving exact-only for ten minutes.
    return null;
  }
}

/** Mainnet upto requirements for a ceiling. Same asset and payee as `exact`, so only the scheme differs. */
export function uptoServiceRequirements(maximumAtomic: string, facilitatorAddress: `0x${string}`): UptoRequirements {
  return uptoRequirements({
    network: NETWORK,
    asset: USDC_MONAD,
    payTo: PAY_TO as `0x${string}`,
    maximum: BigInt(maximumAtomic),
    facilitatorAddress,
  });
}

/**
 * Pull the payment out of whichever header the client used.
 *
 * Returns a reason rather than throwing, because a malformed payment is a 402 with an
 * explanation, not a 500. A client that cannot tell "your base64 was wrong" from "the server
 * broke" will retry the same broken request forever.
 */
export function paymentFrom(
  headers: Headers,
  /** Which schemes this endpoint serves. Exact only unless a route opts in to upto. */
  schemes: readonly Scheme[] = ["exact"],
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
  if (!schemes.includes(accepted.scheme as Scheme)) {
    return { ok: false, reason: `scheme ${String(accepted.scheme)} is not served here, use ${schemes.join(" or ")}` };
  }
  if (accepted.network !== NETWORK) {
    return { ok: false, reason: `network ${String(accepted.network)} is not served here, use ${NETWORK}` };
  }

  const inner = p.payload as { signature?: unknown; authorization?: unknown; permit2Authorization?: unknown } | undefined;
  if (accepted.scheme === "upto") {
    // The ceiling the buyer signed must be a whole atomic amount. Otherwise nothing downstream can compare
    // a charge against it.
    if (!inner || typeof inner.signature !== "string" || signedMaximum(inner as UptoPayload) === null) {
      return { ok: false, reason: "upto payload needs a `signature` and a `permit2Authorization` with a whole `permitted.amount`" };
    }
  } else if (!inner || typeof inner.signature !== "string" || typeof inner.authorization !== "object") {
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
  reqs: PaymentRequirements | UptoRequirements = requirements(),
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
        paymentRequirements: reqs,
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
  /** For upto: the requirements at the CEILING. Verify-time `amount` is the signed maximum. */
  reqs?: PaymentRequirements | UptoRequirements,
): Promise<{ valid: true; payer: string } | { valid: false; reason: string; ours: boolean }> {
  const r = await callFacilitator<FacilitatorVerify>("/verify", payload, reqs);
  // `ours` separates "we could not check your payment" from "your payment is not valid". The
  // first is a 503 and the second is a 402 and a client has to be able to tell them apart.
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
  /** For upto: the requirements at the ACTUAL charge, from `settlementRequirements`. */
  reqs?: PaymentRequirements | UptoRequirements,
): Promise<{ settled: boolean; transaction: string | null; payer: string | null; reason: string | null; amount?: string }> {
  const r = await callFacilitator<FacilitatorSettle & { amount?: string }>("/settle", payload, reqs);
  if (!r.ok) return { settled: false, transaction: null, payer: null, reason: r.reason };
  const tx = r.body.transaction && r.body.transaction !== "" ? r.body.transaction : null;
  return {
    settled: Boolean(r.body.success),
    transaction: tx,
    payer: r.body.payer ?? null,
    reason: r.body.success ? null : (r.body.errorReason ?? "settlement did not succeed"),
    ...(typeof r.body.amount === "string" ? { amount: r.body.amount } : {}),
  };
}

/**
 * A single-flight lock over payment authorizations, keyed by (payer, nonce).
 *
 * The on-chain EIP-3009 nonce stops a payment settling twice: the token rejects a spent nonce. It
 * does NOT stop the same authorization being used to run the priced WORK many times in parallel
 * before any settle lands, so N concurrent requests carrying one signature would each fetch and
 * check for one eventual charge. This closes that: a nonce is reserved before the work and only one
 * caller holds it at a time. A reservation that is never confirmed expires, so a crash does not
 * strand a payer's authorization forever.
 *
 * In-memory on purpose: this app runs as one long-lived process while the token's own nonce is the
 * durable backstop across a restart. It is a concurrency guard, not the source of truth.
 */
const RESERVATION_TTL_MS = 120_000;
const nonceState = new Map<string, { state: "inflight" | "consumed"; at: number }>();

function nonceKey(payload: PaymentPayload): string | null {
  // upto: the Permit2 nonce, which is what the chain burns on settlement. Prefixed so an EIP-3009
  // nonce and a Permit2 nonce with the same bytes can never collide.
  const p2 = (payload.payload as UptoPayload | undefined)?.permit2Authorization;
  if (p2) {
    const from = typeof p2.from === "string" ? p2.from.toLowerCase() : "";
    const nonce = typeof p2.nonce === "string" ? p2.nonce.toLowerCase() : "";
    return from && nonce ? `permit2:${from}:${nonce}` : null;
  }
  const auth = (payload.payload as { authorization?: Record<string, string> } | undefined)?.authorization;
  const from = typeof auth?.from === "string" ? auth.from.toLowerCase() : "";
  const nonce = typeof auth?.nonce === "string" ? auth.nonce.toLowerCase() : "";
  if (!from || !nonce) return null;
  return `${from}:${nonce}`;
}

/** Reserve the authorization for this request. Refuse when another request already holds it. */
export function reservePaymentNonce(payload: PaymentPayload): { ok: true; key: string } | { ok: false; reason: string } {
  const key = nonceKey(payload);
  if (!key) return { ok: false, reason: "authorization is missing a payer or nonce" };
  const now = Date.now();
  const existing = nonceState.get(key);
  if (existing) {
    if (existing.state === "consumed") {
      return { ok: false, reason: "this payment authorization has already been used" };
    }
    if (now - existing.at < RESERVATION_TTL_MS) {
      return { ok: false, reason: "this payment authorization is already being processed" };
    }
  }
  nonceState.set(key, { state: "inflight", at: now });
  // Opportunistic sweep so the map cannot grow without bound on a long-lived process.
  if (nonceState.size > 10_000) {
    for (const [k, v] of nonceState) if (now - v.at > RESERVATION_TTL_MS * 4) nonceState.delete(k);
  }
  return { ok: true, key };
}

/** Release a reservation whose payment did not settle, so the payer can retry with the same auth. */
export function releasePaymentNonce(key: string): void {
  const v = nonceState.get(key);
  if (v && v.state === "inflight") nonceState.delete(key);
}

/** Mark an authorization spent once its settlement confirmed. */
export function confirmPaymentNonce(key: string): void {
  nonceState.set(key, { state: "consumed", at: Date.now() });
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
export function challenge(url: string, error: string, accepts: (PaymentRequirements | UptoRequirements)[] = [requirements()]) {
  return {
    x402Version: 2,
    error,
    resource: resourceInfo(url),
    accepts,
    extensions: {},
    // Not part of the spec and included anyway, because a human will open this endpoint in a
    // browser long before any agent posts to it and a bare machine challenge tells them nothing.
    help: {
      meaning: "402 here means pay me, not broken.",
      price: "0.01 USDC on Monad, chain 143, six decimals.",
      why: "This endpoint does work against live chain state on request. Reading what we already checked costs us a query, so that is free: GET /api/claims.",
      facilitator: FACILITATOR,
      headers: "Send the payload base64 in PAYMENT-SIGNATURE. The older X-PAYMENT is accepted too.",
    },
  };
}
