/**
 * x402 `upto`: sign a maximum, settle what the work actually cost.
 *
 * ## The scheme, as the facilitator speaks it
 *
 * Confirmed by Devansh Purohit (mentor thread 3e97258f) and by the EVM spec
 * (x402-foundation/x402 specs/schemes/upto/scheme_upto_evm.md):
 *
 *   - Permit2 only. EIP-3009 cannot do this because `transferWithAuthorization` moves exactly the
 *     signed value, so there is no way to settle less without a refund or a second signature.
 *   - The buyer signs `permit2Authorization.permitted.amount`, the MAXIMUM, before the work runs.
 *   - /verify is sent `paymentRequirements.amount` = that maximum.
 *   - /settle is sent the same signed payload with `paymentRequirements.amount` = the ACTUAL charge.
 *     The facilitator checks actual <= signed maximum and transfers only the actual amount.
 *   - Actual may be 0, in which case nothing goes on chain and the authorisation lapses.
 *   - The witness binds `facilitator`, so only the facilitator the buyer signed for can settle. Its
 *     address comes from /supported, never from a constant here.
 *
 * ## The trust boundary, stated
 *
 * The signature caps the charge. It does not prove the usage behind it: a server could settle the
 * full maximum for work that cost a tenth. This module cannot fix that, but it refuses to make it
 * worse. `settlementRequirements` will not produce a charge above the signed maximum, below zero or
 * against a payload signed for a different ceiling than the one the server asked for. And every
 * charge carries the `meter` it was computed from, so the buyer can recompute it rather than only
 * knowing it was bounded.
 */

export const UPTO_PROXY = "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002";
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export type UptoRequirements = {
  scheme: "upto";
  network: `eip155:${number}`;
  /** At verify time: the maximum. At settle time: the actual charge. Atomic units, decimal string. */
  amount: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string; facilitatorAddress: `0x${string}` };
};

export type UptoPayload = {
  signature: `0x${string}`;
  permit2Authorization: {
    permitted: { token: string; amount: string };
    from: string;
    spender: string;
    nonce: string;
    deadline: string;
    witness: { to: string; facilitator: string; validAfter: string };
  };
};

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const ATOMIC = /^(0|[1-9][0-9]*)$/;

/** The facilitator's own upto address for a network, read from its /supported response. */
export function facilitatorAddressFrom(
  supported: { kinds?: { scheme?: string; network?: string; extra?: { facilitatorAddress?: string } }[] },
  network: string,
): `0x${string}` | null {
  const k = supported.kinds?.find((x) => x.scheme === "upto" && x.network === network);
  const a = k?.extra?.facilitatorAddress;
  return a && ADDR.test(a) ? (a as `0x${string}`) : null;
}

export function uptoRequirements(o: {
  network: `eip155:${number}`;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  maximum: bigint;
  facilitatorAddress: `0x${string}`;
  name?: string;
  version?: string;
  maxTimeoutSeconds?: number;
}): UptoRequirements {
  if (o.maximum <= 0n) throw new Error("the maximum must be positive");
  for (const [k, v] of [["asset", o.asset], ["payTo", o.payTo], ["facilitatorAddress", o.facilitatorAddress]] as const) {
    if (!ADDR.test(v)) throw new Error(`${k} is not an address`);
  }
  return {
    scheme: "upto",
    network: o.network,
    amount: o.maximum.toString(),
    asset: o.asset,
    payTo: o.payTo,
    maxTimeoutSeconds: o.maxTimeoutSeconds ?? 300,
    extra: { name: o.name ?? "USDC", version: o.version ?? "2", facilitatorAddress: o.facilitatorAddress },
  };
}

/** What the buyer actually signed as the ceiling. Null when the payload does not carry one. */
export function signedMaximum(p: UptoPayload | null | undefined): bigint | null {
  const a = p?.permit2Authorization?.permitted?.amount;
  return typeof a === "string" && ATOMIC.test(a) ? BigInt(a) : null;
}

export type Meter = { unit: string; used: number | string; pricePerUnitAtomic: string };

/**
 * The /settle requirements for an actual charge. When there must be no settlement, the reason.
 *
 * Each refusal is a charge the facilitator would also refuse or, worse, one it would accept that the
 * buyer never agreed to. Checking here means a bug in our metering fails loudly before a signature
 * is spent, rather than as an opaque facilitator error after.
 */
export function settlementRequirements(
  asked: UptoRequirements,
  payload: UptoPayload,
  actual: bigint,
): { ok: true; requirements: UptoRequirements } | { ok: false; reason: string } {
  const max = signedMaximum(payload);
  if (max === null) return { ok: false, reason: "the payload carries no signed maximum" };
  if (max !== BigInt(asked.amount)) {
    return { ok: false, reason: `signed for ${max}, but this resource asked for a maximum of ${asked.amount}` };
  }
  const auth = payload.permit2Authorization;
  if (auth.permitted.token.toLowerCase() !== asked.asset.toLowerCase()) return { ok: false, reason: "signed for a different token" };
  if (auth.witness.to.toLowerCase() !== asked.payTo.toLowerCase()) return { ok: false, reason: "signed to pay a different recipient" };
  if (auth.witness.facilitator.toLowerCase() !== asked.extra.facilitatorAddress.toLowerCase()) {
    return { ok: false, reason: "signed for a different facilitator" };
  }
  if (actual < 0n) return { ok: false, reason: "a charge cannot be negative" };
  if (actual > max) return { ok: false, reason: `charge ${actual} exceeds the signed maximum ${max}` };
  return { ok: true, requirements: { ...asked, amount: actual.toString() } };
}

/** Units used times price per unit, capped at the maximum. Integer maths only. */
export function meteredCharge(meter: Meter, maximum: bigint): bigint {
  const used = BigInt(typeof meter.used === "number" ? Math.ceil(meter.used) : meter.used);
  const price = BigInt(meter.pricePerUnitAtomic);
  if (used < 0n || price < 0n) throw new Error("usage and price must be non-negative");
  const c = used * price;
  return c > maximum ? maximum : c;
}
