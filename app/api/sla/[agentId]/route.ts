import { envelope, json, problem, SITE } from "@/lib/api.ts";
import { claimTruthWindow, MAX_SCOPE_PUBLISHERS, ScopeUnavailableError, type ClaimScope } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";

/**
 * The claim-truth rate for one agent over a block window, which is what a slashing oracle reads.
 *
 * A CRE workflow reaches consensus by having independent nodes compute the same answer, so this
 * endpoint is a pure function of the agent id and the block range and nothing else. Give it
 * `fromBlock` and `toBlock` and every node that queries the same range gets the same rows, because
 * the window is `Feedback.blockNumber`, which is the chain's own number rather than a wall clock.
 *
 * `unknown` is carried apart from the rate and never folded into it. `rateBps` is null on an empty
 * sample rather than 0, because 0 reads as "every claim was false" and would slash an agent nobody
 * has rated yet. The sample size a `minSampleSize` floor compares against is `true + false`, the
 * decided count, not the raw feedback total.
 */
export async function GET(req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const u = new URL(req.url);

  if (!/^\d+$/.test(agentId)) {
    return problem(400, "Bad agent id", "agentId must be a decimal registry id, for example 10182");
  }

  const fromRaw = u.searchParams.get("fromBlock") ?? "0";
  const toRaw = u.searchParams.get("toBlock") ?? String(2n ** 63n - 1n);
  let fromBlock: bigint;
  let toBlock: bigint;
  try {
    fromBlock = BigInt(fromRaw);
    toBlock = BigInt(toRaw);
  } catch {
    return problem(400, "Bad block range", "fromBlock and toBlock must be integers");
  }
  if (fromBlock < 0n || toBlock < 0n) {
    return problem(400, "Bad block range", "block numbers cannot be negative");
  }
  if (fromBlock > toBlock) {
    return problem(400, "Bad block range", "fromBlock must not be greater than toBlock");
  }

  // Optional scope. With neither parameter this is the original measurement, byte for byte. A bond's
  // terms can name the wallets allowed to publish about the agent and the address the claimed payments
  // must reach, so a stranger's feedback cannot move a bonded agent's rate.
  const ADDR = /^0x[0-9a-fA-F]{40}$/;
  const scope: ClaimScope = {};
  const publishersRaw = u.searchParams.get("publishers");
  if (publishersRaw !== null) {
    const list = publishersRaw.split(",").map((x) => x.trim());
    if (list.length === 0 || list.length > MAX_SCOPE_PUBLISHERS || !list.every((x) => ADDR.test(x))) {
      return problem(400, "Bad publishers", `publishers is a comma list of 1 to ${MAX_SCOPE_PUBLISHERS} 20-byte addresses`);
    }
    scope.publishers = list;
  }
  const recipientRaw = u.searchParams.get("recipient");
  if (recipientRaw !== null) {
    if (recipientRaw !== "agent" && !ADDR.test(recipientRaw)) {
      return problem(400, "Bad recipient", 'recipient is "agent" or a 20-byte address');
    }
    scope.recipient = recipientRaw;
  }

  let w;
  try {
    w = await claimTruthWindow(agentId, fromBlock, toBlock, scope.publishers || scope.recipient ? scope : undefined);
  } catch (e) {
    // A scope this deployment cannot answer is said so. It is not a server fault and not an empty sample.
    if (e instanceof ScopeUnavailableError) return problem(501, "Scope unavailable", e.message);
    throw e;
  }

  return json(
    envelope(
      {
        agentId: w.rows.agentId,
        url: `${SITE}/agent/${w.rows.agentId}`,
        window: { fromBlock: w.rows.fromBlock, toBlock: w.rows.toBlock },
        feedbacks: w.rows.feedbacks,
        sampleSize: w.rows.sampleSize,
        trueCount: w.rows.trueCount,
        falseCount: w.rows.falseCount,
        unknownCount: w.rows.unknownCount,
        noClaimCount: w.rows.noClaimCount,
        // Basis points so an on-chain reader compares integers. Null on an empty sample, which the
        // oracle must treat as "not enough to decide", never as a zero rate.
        rateBps: w.rows.rateBps,
        // Only present for a scoped request, so an unscoped answer has exactly the keys it always had.
        ...(w.rows.scope ? { scope: w.rows.scope, excludedByScope: w.rows.excludedByScope } : {}),
      },
      w.sql,
    ),
  );
}
