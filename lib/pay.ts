/**
 * The browser x402 payment path, signed by a Mera session.
 *
 * A user with a passkey and no MON, no extension and no seed phrase pays for one verification and
 * gets a real Monad transaction back. The account key derived from the passkey signs an EIP-3009
 * `transferWithAuthorization`, the facilitator relays it and pays the gas, so the settlement lands
 * on chain as an ordinary transfer the user never had to hold the gas token for.
 *
 * ## The wire format is not redefined here
 *
 * The payload shape, the requirements, the price, the token and the network all come from
 * lib/x402. This module only does the two things that are the client's job and were missing: build
 * the EIP-3009 authorization, sign it with the session account, then wrap it in the payload x402
 * already describes. The server route parses it with the same lib/x402 `paymentFrom`, so a test can
 * build a header here and read it back there and prove the two agree.
 *
 * ## The EIP-712 domain is read off x402, not guessed
 *
 * `requirements().extra` carries the token name and version, `requirements().asset` is the token
 * and `requirements().network` is the chain. The domain is assembled from those, so a wrong domain
 * is a wrong x402 config rather than a second place to keep in sync. The TransferWithAuthorization
 * type matches USDC's EIP-3009 typehash on chain 143, confirmed against the token contract.
 */

import { type ScopedSession, SessionError, type SessionScope } from "./session.ts";
import { NETWORK, PAY_TO, type PaymentPayload, requirements, resourceInfo } from "./x402.ts";

/** USDC on Monad is six decimals, read off the token, not assumed. */
export const USDC_DECIMALS = 6;

/** Monad's block explorer, the same one the rest of the app links transactions to. */
export const MONAD_EXPLORER_TX = "https://monadexplorer.com/tx/";

/** Turn `eip155:143` into the numeric chain id the EIP-712 domain needs. */
export function chainIdFromNetwork(network: string = NETWORK): number {
  const [family, id] = network.split(":");
  const chainId = Number(id);
  if (family !== "eip155" || !Number.isInteger(chainId)) {
    throw new Error(`network ${network} is not an eip155 chain id`);
  }
  return chainId;
}

export type Eip712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
};

/** The EIP-712 domain USDC signs `TransferWithAuthorization` under, built from the x402 config. */
export function usdcDomain(): Eip712Domain {
  const req = requirements();
  return {
    name: req.extra.name,
    version: req.extra.version,
    chainId: chainIdFromNetwork(req.network),
    verifyingContract: req.asset as `0x${string}`,
  };
}

/** The EIP-3009 struct. Field order and widths match USDC's typehash on chain 143. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** The authorization as it travels on the wire: every numeric field a decimal string. */
export type Eip3009Authorization = {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
};

function defaultRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** A fresh 32-byte nonce as hex. Random by default, injectable so a test is deterministic. */
export function randomNonce(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): `0x${string}` {
  const bytes = randomBytes(32);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

/**
 * Build the authorization for one verification payment.
 *
 * `to`, `value`, `asset` and the deadline window all come from x402's requirements, so the amount
 * and recipient are the ones the server asked for rather than numbers this file invented. `now` and
 * `nonce` are injectable so a test produces the same bytes twice.
 */
export function buildAuthorization(opts: {
  from: `0x${string}`;
  now?: number;
  ttlSeconds?: number;
  nonce?: `0x${string}`;
  randomBytes?: (n: number) => Uint8Array;
}): Eip3009Authorization {
  const req = requirements();
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const ttl = opts.ttlSeconds ?? req.maxTimeoutSeconds;
  return {
    from: opts.from,
    to: req.payTo as `0x${string}`,
    value: req.amount,
    validAfter: "0",
    validBefore: String(nowSec + ttl),
    nonce: opts.nonce ?? randomNonce(opts.randomBytes),
  };
}

/**
 * Sign the authorization with the session account.
 *
 * The order matters. First refuse an authorization whose `from` is not this session's address,
 * because the facilitator recovers the signer and requires it equals `from`, so signing for another
 * address only ever produces a payment that cannot be verified. Then run the session gate, which
 * ends and throws on an expired session and refuses an amount outside the scope. Only then does the
 * key sign, through the Mera session, with no prompt.
 */
export async function signAuthorization(
  session: ScopedSession,
  auth: Eip3009Authorization,
): Promise<`0x${string}`> {
  if (auth.from.toLowerCase() !== session.address.toLowerCase()) {
    throw new SessionError(
      "WRONG_SIGNER",
      `the authorization is from ${auth.from} but this session signs for ${session.address}`,
    );
  }
  session.assertCanPay(BigInt(auth.value), auth.to);

  return session.account.signTypedData({
    domain: usdcDomain(),
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  });
}

/** Wrap the signed authorization in the x402 v2 payload the server route parses. */
export function buildPaymentPayload(opts: {
  resourceUrl: string;
  authorization: Eip3009Authorization;
  signature: `0x${string}`;
}): PaymentPayload {
  return {
    x402Version: 2,
    resource: resourceInfo(opts.resourceUrl),
    accepted: requirements(),
    payload: {
      signature: opts.signature,
      authorization: opts.authorization as unknown as Record<string, string>,
    },
    extensions: {},
  };
}

/**
 * Base64 the payload for the payment header.
 *
 * Written out with `btoa` over the UTF-8 bytes rather than reaching for `Buffer`, which does not
 * exist in the browser. Standard base64, so lib/x402 `paymentFrom` decodes it byte for byte.
 */
export function encodePaymentHeader(payload: PaymentPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The token amount for one verification, in atomic units and as human USDC. */
export function verificationPrice(): { atomic: bigint; usdc: string } {
  const atomic = BigInt(requirements().amount);
  return { atomic, usdc: formatUsdc(atomic) };
}

/** Format atomic USDC as a decimal string, trimming trailing zeros. */
export function formatUsdc(atomic: bigint): string {
  const negative = atomic < 0n;
  const v = negative ? -atomic : atomic;
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = v / base;
  const frac = (v % base).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/**
 * A scope for x402 verification payments up to a ceiling.
 *
 * The ceiling is what the user agrees to when they open the session. Any single payment above it is
 * refused with SCOPE_EXCEEDED before the key signs.
 */
export function verificationScope(maxAmountAtomic: bigint, resourceHost: string): SessionScope {
  return {
    label: `x402 verification payments up to ${formatUsdc(maxAmountAtomic)} USDC on ${resourceHost}`,
    maxAmountAtomic,
    resourceHost,
    // Pin the recipient to the one this site is paid at. A session opened here can then only ever
    // sign a transfer to us, never to an address a tampered page slipped into the authorization.
    payTo: PAY_TO,
  };
}

/** What the caller learns after driving one payment. */
export type Settlement = {
  paid: boolean;
  settled: boolean;
  transaction: string | null;
  txUrl: string | null;
  payer: string | null;
  verdict: unknown;
};

export type PayResult =
  | { ok: true; status: number; settlement: Settlement; body: unknown }
  | { ok: false; status: number; reason: string; body: unknown };

function reasonFrom(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.detail === "string") return b.detail;
    if (typeof b.error === "string") return b.error;
  }
  return `the endpoint answered HTTP ${status}`;
}

/**
 * Drive one verification payment end to end.
 *
 * Build the authorization, sign it through the session, attach the header and POST to the paid
 * endpoint. `target` is what to check: a claim already on the site by `id` or any document by its
 * `uri`. A SessionError from the signing step is left to bubble up, because an expired session has
 * to reach the UI as a re-prompt rather than a failed fetch. `fetch`, `now` and the nonce are
 * injectable so a test drives the whole path with no network.
 */
export async function payForVerification(opts: {
  session: ScopedSession;
  target: { id: string } | { uri: string };
  endpoint?: string;
  resourceUrl?: string;
  headerName?: "X-PAYMENT" | "PAYMENT-SIGNATURE";
  fetchImpl?: typeof fetch;
  now?: number;
  ttlSeconds?: number;
  nonce?: `0x${string}`;
  randomBytes?: (n: number) => Uint8Array;
}): Promise<PayResult> {
  const endpoint = opts.endpoint ?? "/api/verify";
  const resourceUrl = opts.resourceUrl ?? endpoint;
  const headerName = opts.headerName ?? "X-PAYMENT";
  const doFetch = opts.fetchImpl ?? fetch;

  const auth = buildAuthorization({
    from: opts.session.address,
    now: opts.now,
    ttlSeconds: opts.ttlSeconds,
    nonce: opts.nonce,
    randomBytes: opts.randomBytes,
  });
  const signature = await signAuthorization(opts.session, auth);
  const payload = buildPaymentPayload({ resourceUrl, authorization: auth, signature });
  const header = encodePaymentHeader(payload);

  const res = await doFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", [headerName]: header },
    body: JSON.stringify(opts.target),
  });

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Leave body as the raw text so the caller sees whatever the server actually sent.
  }

  if (!res.ok) {
    return { ok: false, status: res.status, reason: reasonFrom(body, res.status), body };
  }

  const data = ((body as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
  const payment = (data.payment as Record<string, unknown>) ?? {};
  const tx = (payment.transaction as string | null) ?? null;
  return {
    ok: true,
    status: res.status,
    settlement: {
      paid: Boolean(data.paid),
      settled: Boolean(payment.settled),
      transaction: tx,
      txUrl: tx ? `${MONAD_EXPLORER_TX}${tx}` : null,
      payer: (payment.payer as string | null) ?? null,
      verdict: data.verdict ?? null,
    },
    body,
  };
}

