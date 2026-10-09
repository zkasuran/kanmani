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

import { createPublicClient, http } from "viem";
import { viemChain } from "./chains.ts";
import { claimTruthWindow, indexProgress } from "./queries.ts";

/**
 * Where the index is and where the chain is, both read now.
 *
 * The age is the gap between the two, in blocks. Either side unreadable leaves the age null, which
 * Sentinel treats as outside any bound: not knowing how stale an answer is must not pass as fresh.
 */
async function indexVsChain(): Promise<{ indexed: number | null; head: number | null }> {
  const chain = viemChain(143);
  const client = chain ? createPublicClient({ chain, transport: http(process.env.RPC_MONAD || undefined) }) : null;
  const [indexed, head] = await Promise.all([
    indexProgress(),
    client ? client.getBlockNumber().then(Number).catch(() => null) : Promise.resolve(null),
  ]);
  return { indexed, head };
}

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
      "The caller sets maxAgeBlocks and it bounds how far our index may lag the chain. 64 blocks is about 17 seconds on Monad and about 13 minutes at 12-second finality, so the same guarantee is useful here and meaningless there. Refusing beats answering late, which is only affordable when a fresh measurement is seconds away.",
    priceAtomic: "10000",
    skillId: "pre-hire-verdict",
    input: '{ "agentId": 10252, "maxAgeBlocks": 64 }',
    output: "verdict, rung, measuredAtBlock, ageBlocks, ageSeconds, withinBound, note, reproduce",
  },
  assay: {
    slug: "assay",
    name: "Kanmani's Assay",
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
  /** Says which of the two refusals happened, so a caller never has to infer it. */
  note: string | null;
  reproduce: string;
  rederive: Rederive | null;
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
  rederive: Rederive | null;
};

/**
 * Where the counts behind an answer can be fetched and checked, stated so a machine can do it.
 *
 * A broker's judge that hired these agents graded every number they returned as an unsupported
 * claim: its own code had checked that a reply came back and nothing more, so it had no way to
 * confirm the figures. That is the right instinct and the fix is to hand it the fact rather than
 * ask it to trust us. `url` is a public endpoint pinned to the exact block window the answer was
 * computed over, so it returns the same rows the answer used. `expect` names the fields of that
 * response and the values they must hold. A judge fetches `url`, compares `data.<field>` against
 * `expect` and the number is either confirmed or it is not.
 *
 * Null when there was no index head to pin a window to, because an unpinned URL would return
 * whatever is current and could not confirm anything.
 */
export type Rederive = {
  url: string;
  window: { fromBlock: string; toBlock: string };
  expect: { sampleSize: number; trueCount: number; falseCount: number; rateBps: number | null };
  how: string;
};

function rederiveFor(
  agentId: number,
  head: number | null,
  t: { sampleSize: number; trueCount: number; falseCount: number; rateBps: number | null } | null,
): Rederive | null {
  if (head === null || t === null) return null;
  return {
    url: `https://kanmani.xyz/api/sla/${agentId}?fromBlock=0&toBlock=${head}`,
    window: { fromBlock: "0", toBlock: String(head) },
    expect: { sampleSize: t.sampleSize, trueCount: t.trueCount, falseCount: t.falseCount, rateBps: t.rateBps },
    how: "GET url and compare each data.<field> against expect. The response also carries the SQL that produced it under reproduce.",
  };
}

/**
 * Sentinel. The freshness bound is the product, so it is enforced rather than reported: an answer
 * outside the bound comes back with `withinBound: false` and no verdict, because a caller who asked
 * for fresh and got stale has been given the opposite of what they paid for.
 */
export async function sentinel(agentId: number, maxAgeBlocks: number): Promise<SentinelAnswer> {
  const { indexed, head: chainHead } = await indexVsChain();
  const head = indexed;
  const t = head === null ? null : (await claimTruthWindow(String(agentId), 0n, BigInt(head))).rows;

  /**
   * The bound is on OUR VIEW of the chain: how many blocks the index is behind the chain right now.
   *
   * Two earlier versions measured the wrong thing. The first used the agent's last feedback block and
   * reported a twelve-day age on a fresh answer. The second used the time of the IndexState row,
   * which a sweep writes only every 10,000 blocks, so it read up to 44 minutes stale while the index
   * was a few blocks behind head and it refused almost every 64-block request. Both were real
   * subtractions of real numbers that did not answer the buyer's question.
   *
   * Now: chain head from the RPC minus the block Envio reports it has processed. Negative gaps (the
   * RPC a block behind the indexer's source) count as zero.
   */
  const ageBlocks = indexed === null || chainHead === null ? null : Math.max(chainHead - indexed, 0);
  const ageSeconds = ageBlocks === null ? null : Math.round((ageBlocks * MONAD_BLOCK_MS) / 1000);
  const withinBound = ageBlocks !== null && ageBlocks <= maxAgeBlocks;

  // `unknown` is never collapsed into `false`. An empty sample means nothing has been decided about
  // this agent, which is not the same as the agent having failed anything.
  let verdict: SentinelAnswer["verdict"] = "unknown";
  if (withinBound && t) {
    if (t.sampleSize === 0) verdict = t.noClaimCount > 0 ? "noClaim" : "unknown";
    else verdict = t.falseCount > 0 ? "false" : "true";
  }

  return {
    agentId,
    verdict,
    rung: t === null || t.rateBps === null ? null : `${(t.rateBps / 100).toFixed(1)}% claim truth`,
    measuredAtBlock: head,
    ageBlocks,
    ageSeconds,
    withinBound,
    sampleSize: t?.sampleSize ?? 0,
    note: !withinBound
      ? "Refused on freshness. The index is further behind the chain than your maxAgeBlocks allowed, so no verdict is given."
      : (t?.sampleSize ?? 0) === 0
        ? "Fresh, but nothing has been decided about this agent yet. That is not a failing grade."
        : null,
    // An earlier version pointed at /api/agent with a jq filter for fields that response does not
    // carry, so following it confirmed nothing. The SLA endpoint pinned to this window does.
    reproduce: head === null ? `curl -s https://kanmani.xyz/api/sla/${agentId}` : `curl -s 'https://kanmani.xyz/api/sla/${agentId}?fromBlock=0&toBlock=${head}'`,
    rederive: rederiveFor(agentId, head, t),
  };
}

export async function assay(agentId: number): Promise<AssayAnswer> {
  // Quoted at the block the index has actually processed, not at the last 10,000-block sweep.
  const head = await indexProgress();
  const t = head === null ? null : (await claimTruthWindow(String(agentId), 0n, BigInt(head))).rows;
  const sampleSize = t?.sampleSize ?? 0;
  const rate = t?.rateBps === null || t === null ? null : t.rateBps / 10000;
  const reproduce =
    head === null ? `curl -s https://kanmani.xyz/api/sla/${agentId}` : `curl -s 'https://kanmani.xyz/api/sla/${agentId}?fromBlock=0&toBlock=${head}'`;
  const rederive = rederiveFor(agentId, head, t);

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
      rederive,
    };
  }

  /**
   * A floor must be able to slash or it is not a floor.
   *
   * The first version clamped to zero and the first paid call against a 2.38% agent duly returned
   * floorBps 0. No verdict can fall below zero, so that is a bond nobody can ever take: precisely the
   * unslashable-bond defect that audit Finding 9 closed inside the contract, re-created in the thing
   * that advises people what to post. Quoting it would have been worse than refusing, because the
   * caller would have paid for advice that buys them a badge with no risk behind it.
   *
   * Below MIN_FLOOR_BPS there is no honest quote. A floor beneath a very low rate cannot bite and a
   * floor above it slashes on the next measurement, so the answer is that the rate has to improve
   * before a bond means anything.
   */
  const MIN_FLOOR_BPS = 100;
  const floorBps = Math.min(10000, Math.round(rate * 10000) - 500);
  if (floorBps < MIN_FLOOR_BPS) {
    return {
      agentId,
      floorBps: null,
      premiumBps: null,
      sampleSize,
      rate,
      quotedAtBlock: head,
      refusalReason: `Measured claim truth is ${(rate * 100).toFixed(1)}%. Any floor below that cannot slash and any floor above it slashes on the next measurement, so there is no floor worth posting until the rate improves.`,
      reproduce,
      rederive,
    };
  }
  const premiumBps = Math.round((1 - rate) * 2000);
  return { agentId, floorBps, premiumBps, sampleSize, rate, quotedAtBlock: head, refusalReason: null, reproduce, rederive };
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
