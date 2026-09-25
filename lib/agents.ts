/**
 * Two agents that are worth running on Monad and would not be worth running anywhere else.
 *
 * ## The filter
 *
 * A swap router, a portfolio reader or a chat wrapper runs identically on any EVM chain, so shipping
 * one here demonstrates nothing about Monad beyond that it executes bytecode. Both agents below fail
 * on a slow or expensive chain, for the same underlying reason.
 *
 * ## Why Monad specifically
 *
 * Measured on mainnet while writing this: 15 blocks in 4 seconds, about 266ms each.
 *
 * A trust layer is a loop. Measure a claim, judge it, then price or slash against the judgement. The
 * loop is only a deterrent if it closes while the counterparty still has something to lose. On a
 * 12-second chain a false claim is paid and settled long before any verdict lands, so a bond is
 * decoration. At 266ms the same loop closes inside a handful of seconds, which is what turns
 * "trust becomes a price" from a slogan into an executable statement.
 *
 * So the product of both agents is **recency** and recency is only a product where blocks are cheap
 * and fast enough to re-read constantly.
 *
 *   Sentinel   sells a verdict with a block-level freshness guarantee and refuses to answer at all
 *              rather than serve a stale one.
 *   Assay      prices a bond from a live claim-truth rate, repricing per block instead of per report.
 *
 * ## What they are not
 *
 * Neither invents a measurement. Both read the same indexed corpus and the same judge the rest of
 * this site uses, so an answer from an agent and an answer from the website cannot disagree. An agent
 * that quietly ran a softer check to look better would be the exact fault we publish about others.
 */

import { claimTruthWindow, freshness } from "@/lib/queries.ts";

/** Monad mainnet, measured rather than assumed. Used to convert blocks into human time in answers. */
export const MONAD_BLOCK_MS = 266;

export type AgentSlug = "sentinel" | "assay";

export type AgentSpec = {
  slug: AgentSlug;
  name: string;
  /** One line, the thing it sells. */
  sells: string;
  /** Why a slow chain kills it. This is the justification for existing here and it is published. */
  needsMonad: string;
  priceAtomic: string;
  skillId: string;
  input: string;
  output: string;
};

export const AGENTS: Record<AgentSlug, AgentSpec> = {
  sentinel: {
    slug: "sentinel",
    name: "Sentinel",
    sells:
      "A pre-hire verdict on an agent, stamped with the block it was measured at, refused outright if the measurement is older than the caller's freshness bound.",
    needsMonad:
      "The caller sets maxAgeBlocks. A bound of 64 blocks is about 17 seconds on Monad and about 13 minutes on a 12-second chain, so the same guarantee is useful here and meaningless there. Refusing beats answering late, which is only an affordable policy when a fresh measurement is seconds away.",
    priceAtomic: "10000",
    skillId: "pre-hire-verdict",
    input: '{ "agentId": 10252, "maxAgeBlocks": 64 }',
    output: 'verdict, rung, measuredAtBlock, ageBlocks, ageSeconds, reproduce',
  },
  assay: {
    slug: "assay",
    name: "Assay",
    sells:
      "The bond an agent should post: a floor in basis points and a premium, derived from its live claim-truth rate and the size of the sample behind it.",
    needsMonad:
      "A quote is only honest while the rate behind it holds. Repricing per block is affordable at Monad gas and pointless at 12-second finality, where a daily report is the best anyone can offer. Pricing trust continuously is the whole reason the bond contract lives on this chain.",
    priceAtomic: "10000",
    skillId: "bond-quote",
    input: '{ "agentId": 10252 }',
    output: 'floorBps, premiumBps, sampleSize, rate, quotedAtBlock, refusalReason',
  },
};

export type SentinelAnswer = {
  agentId: number;
  verdict: "true" | "false" | "noClaim" | "unknown";
  rung: string | null;
  measuredAtBlock: number | null;
  ageBlocks: number | null;
  ageSeconds: number | null;
  withinBound: boolean;
  sampleSize: number;
  reproduce: string;
};

export type AssayAnswer = {
  agentId: number;
  /** Null when the sample cannot carry a price. Never a zero, which would read as "no risk". */
  floorBps: number | null;
  premiumBps: number | null;
  sampleSize: number;
  rate: number | null;
  quotedAtBlock: number | null;
  refusalReason: string | null;
  reproduce: string;
};

/**
 * Sentinel. The freshness bound is the product, so it is enforced rather than reported: an answer
 * outside the bound comes back with `withinBound: false` and no verdict, because a caller who asked
 * for fresh and got stale has been given the opposite of what they paid for.
 */
export async function sentinel(agentId: number, maxAgeBlocks: number): Promise<SentinelAnswer> {
  const f = (await freshness()).rows;
  const head = f.latestIndexedBlock === null ? null : Number(f.latestIndexedBlock);
  // The whole indexed range, because a pre-hire question is about the agent's whole record rather
  // than a slice of it. The freshness bound is applied to the index head, not to the window.
  const t = head === null ? null : (await claimTruthWindow(String(agentId), 0n, BigInt(head))).rows;

  const ageBlocks = head === null || f.latestFeedbackBlock === null
    ? null
    : Math.max(head - Number(f.latestFeedbackBlock), 0);
  const withinBound = ageBlocks !== null && ageBlocks <= maxAgeBlocks;

  // A decided sample with no falses reads true, any false reads false, an empty sample stays unknown.
  // `unknown` is never collapsed into `false`, which is the rule the rest of this project holds to.
  let verdict: SentinelAnswer["verdict"] = "unknown";
  if (withinBound && t) {
    if (t.sampleSize === 0) verdict = t.noClaimCount > 0 ? "noClaim" : "unknown";
    else verdict = t.falseCount > 0 ? "false" : "true";
  }

  return {
    agentId,
    verdict,
    rung: t === null ? null : t.rateBps === null ? null : `${(t.rateBps / 100).toFixed(1)}% claim truth`,
    measuredAtBlock: head,
    ageBlocks,
    ageSeconds: ageBlocks === null ? null : Math.round((ageBlocks * MONAD_BLOCK_MS) / 1000),
    withinBound,
    sampleSize: t?.sampleSize ?? 0,
    reproduce: `curl -s https://kanmani.xyz/api/agent/${agentId} | jq '{rung, checkedAtBlock}'`,
  };
}

export async function assay(agentId: number): Promise<AssayAnswer> {
  const f = (await freshness()).rows;
  const head = f.latestIndexedBlock === null ? null : Number(f.latestIndexedBlock);
  const t = head === null ? null : (await claimTruthWindow(String(agentId), 0n, BigInt(head))).rows;
  const sampleSize = t?.sampleSize ?? 0;
  const rate = t?.rateBps === null || t === null ? null : t.rateBps / 10000;
  const reproduce = `curl -s https://kanmani.xyz/api/sla/${agentId}`;

  if (sampleSize < 5 || rate === null) {
    return {
      agentId,
      floorBps: null,
      premiumBps: null,
      sampleSize,
      rate,
      quotedAtBlock: head,
      refusalReason:
        sampleSize === 0
          ? "No decided claims. A bond priced off an empty sample cannot be slashed, so there is nothing honest to quote."
          : `Sample of ${sampleSize} is below the minSample of 5 the deployed contract enforces.`,
      reproduce,
    };
  }

  const floorBps = Math.max(0, Math.min(10000, Math.round(rate * 10000) - 500));
  const premiumBps = Math.round((1 - rate) * 2000);
  return { agentId, floorBps, premiumBps, sampleSize, rate, quotedAtBlock: head, refusalReason: null, reproduce };
}

/** The ERC-8004 record for one agent, written inline so it cannot rot the way 8,093 hosted ones did. */
export function registrationRecord(spec: AgentSpec, wallet: string): Record<string, unknown> {
  return {
    protocolVersion: "0.3.0",
    name: spec.name,
    description: spec.sells,
    url: `https://kanmani.xyz/api/service/${spec.slug}`,
    agentWallet: wallet,
    capabilities: { streaming: false, pushNotifications: false },
    skills: [
      {
        id: spec.skillId,
        name: spec.name,
        description: spec.sells,
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        endpoint: `https://kanmani.xyz/api/service/${spec.slug}`,
        x402: { network: "eip155:143", asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", maxAmountRequired: spec.priceAtomic },
      },
    ],
    // Published so the claim is checkable rather than asserted. Anyone can time the loop themselves.
    requiresFastFinality: { chainId: 143, measuredBlockMs: MONAD_BLOCK_MS, why: spec.needsMonad },
  };
}
