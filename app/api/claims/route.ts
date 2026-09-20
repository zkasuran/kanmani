import { envelope, json, problem, SITE } from "@/lib/api.ts";
import { claims, claimsCount, type Outcome, type Rung } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";

const OUTCOMES = ["true", "false", "noClaim", "unknown"] as const;
const RUNGS = ["declared", "resolvable", "intact", "parsed", "true"] as const;

/**
 * The claim feed, filtered the same way the page filters it.
 *
 * Same query builder as `/claims`, so the JSON and the HTML cannot drift. An unknown filter value
 * is refused with the list of accepted values rather than silently ignored: a filter that is
 * quietly dropped returns plausible, wrong data and nobody notices.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const outcome = u.searchParams.get("outcome") ?? undefined;
  const rung = u.searchParams.get("rung") ?? undefined;
  const mapping = u.searchParams.get("mapping") ?? undefined;
  const network = u.searchParams.get("network") ?? undefined;
  const limit = Math.min(Number(u.searchParams.get("limit") ?? 100) || 100, 1000);
  const offset = Math.max(Number(u.searchParams.get("offset") ?? 0) || 0, 0);

  if (outcome && !OUTCOMES.includes(outcome as Outcome)) {
    return problem(400, "Unknown outcome", `outcome must be one of ${OUTCOMES.join(", ")}`, { accepted: OUTCOMES });
  }
  if (rung && !RUNGS.includes(rung as Rung)) {
    return problem(400, "Unknown rung", `rung must be one of ${RUNGS.join(", ")}`, { accepted: RUNGS });
  }

  const f = { outcome: outcome as Outcome | undefined, rung: rung as Rung | undefined, mapping, network };
  const [list, total] = await Promise.all([claims({ ...f, limit, offset }), claimsCount(f)]);

  return json(
    envelope(
      {
        total,
        limit,
        offset,
        next: offset + limit < total ? `${SITE}/api/claims?${new URLSearchParams({ ...Object.fromEntries(u.searchParams), offset: String(offset + limit) })}` : null,
        items: list.rows.map((c) => ({
          id: c.id,
          url: `${SITE}/claim/${encodeURIComponent(c.id)}`,
          agentId: c.agentNumber,
          leftBy: c.clientAddress,
          feedbackUri: c.feedbackUri,
          feedbackHash: c.feedbackHash,
          revoked: c.revoked,
          operatorReply: c.responseUri,
          outcome: c.outcome,
          rung: c.rung,
          reason: c.reason,
          mapping: c.mapping,
          declaredNetwork: c.declaredNetwork,
          declaredTx: c.declaredTx,
          hashMatches: c.hashMatches,
          foundOnChain: c.foundChain ? { chain: c.foundChain, chainId: c.foundChainId, block: c.foundBlock } : null,
          checkedAt: c.checkedAt,
          checkedAtBlock: c.checkedAtBlock,
          recordedInBlock: c.blockNumber,
          recordedInTx: c.txHash,
        })),
      },
      // The SQL, verbatim, because that is what actually produced this body.
      list.sql,
    ),
  );
}
