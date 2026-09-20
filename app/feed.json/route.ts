import { envelope, json, SITE } from "@/lib/api.ts";
import { claims, freshness, measurement } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";

/**
 * The whole checked population, machine-readable, in one request.
 *
 * Carries the distribution alongside the items on purpose. A consumer that takes only the `false`
 * rows and publishes a count has, at that moment, dropped the denominator and the unknowns. The
 * summary sits at the top of the same document so that is a deliberate act rather than an
 * accident of pagination.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const limit = Math.min(Number(u.searchParams.get("limit") ?? 2000) || 2000, 5000);

  const [m, list, fresh] = await Promise.all([
    measurement(),
    claims({ limit, withUri: true }),
    freshness(),
  ]);
  const d = m.rows;

  return json(
    envelope(
      {
        summary: {
          paymentClaims: d.paymentClaims,
          resolve: d.resolve,
          doNotResolve: d.doNotResolve,
          assertNoPayment: d.noClaim,
          couldNotCheck: {
            total: d.unknownUnreachable + d.unknownBytesMoved + d.unknownUnparsed,
            documentWouldNotAnswer: d.unknownUnreachable,
            bytesNoLongerMatchTheirCommitment: d.unknownBytesMoved,
            noMappingReadTheShape: d.unknownUnparsed,
          },
          // Stated here rather than only on a page, because a consumer of this file never sees
          // the page. Unchecked is not the same as clean.
          claimsWithAUriAndNoVerdict: fresh.rows.claimsWithNoVerdict,
        },
        note:
          "unknown is never false. A claim we could not check is not a claim we judged. If you " +
          "aggregate these rows, carry the unknowns through rather than dropping them.",
        returned: list.rows.length,
        totalCheckable: d.verdicts,
        items: list.rows.map((c) => ({
          id: c.id,
          url: `${SITE}/claim/${encodeURIComponent(c.id)}`,
          agentId: c.agentNumber,
          outcome: c.outcome,
          rung: c.rung,
          reason: c.reason,
          mapping: c.mapping,
          declaredNetwork: c.declaredNetwork,
          declaredTx: c.declaredTx,
          hashMatches: c.hashMatches,
          foundOnChain: c.foundChain
            ? { chain: c.foundChain, chainId: c.foundChainId, block: c.foundBlock }
            : null,
          checkedAt: c.checkedAt,
          checkedAtBlock: c.checkedAtBlock,
        })),
      },
      `curl -sS '${SITE}/api/claims?limit=1000' | jq '.data.items | group_by(.outcome) | map({(.[0].outcome): length}) | add'`,
      fresh.rows.latestIndexedBlock,
    ),
  );
}
