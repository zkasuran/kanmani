/**
 * Metering for the two shipped agents. Pure and free of the database so the rule is tested, not
 * described. Kept apart from lib/agents.ts, which reads the index.
 */
import type { AgentSlug, AssayAnswer, SentinelAnswer } from "./agents.ts";
import { meteredCharge, type Meter } from "./upto.ts";

/**
 * What a call actually cost, for x402 `upto`. The price in the spec is now the CEILING.
 *
 * Both agents do the same work: read the decided claims for one agent and judge them. So the meter
 * is claims read, with a small base for the lookup itself:
 *
 *   charge = min(ceiling, 2000 + 1000 per decided claim)      atomic USDC, 6 decimals
 *
 * One exception, in the buyer's favour. Sentinel refused on freshness gives no verdict at all, so it
 * costs nothing: the buyer asked for fresh, did not get it and pays zero. Under `exact` that refusal
 * used to cost the full price, which was the scheme's limit rather than a choice.
 *
 * The meter is returned with every answer so the buyer can recompute the charge. A signature caps
 * what we may take. Only the published meter lets the buyer check what we did take.
 */
export const METER_BASE_ATOMIC = "2000";
export const METER_PER_CLAIM_ATOMIC = "1000";

export function chargeFor(
  slug: AgentSlug,
  answer: SentinelAnswer | AssayAnswer,
  ceiling: bigint,
): { meter: Meter; chargeAtomic: bigint } {
  const refusedOnFreshness = slug === "sentinel" && (answer as SentinelAnswer).withinBound === false;
  const meter: Meter = refusedOnFreshness
    ? { unit: "decided claim read", used: 0, pricePerUnitAtomic: METER_PER_CLAIM_ATOMIC, baseAtomic: "0" }
    : { unit: "decided claim read", used: answer.sampleSize, pricePerUnitAtomic: METER_PER_CLAIM_ATOMIC, baseAtomic: METER_BASE_ATOMIC };
  return { meter, chargeAtomic: meteredCharge(meter, ceiling) };
}

