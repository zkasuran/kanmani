import { envelope, json, problem } from "@/lib/api.ts";
import { agent, claims, probedCluster } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";

/**
 * One agent as JSON, including what is NOT known about it.
 *
 * The fields that render as "unknown" on the page are `null` here rather than absent. An absent
 * key invites a consumer to default it to zero, which is the exact failure this project exists to
 * point at. Null says the question was asked and had no answer.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await agent(decodeURIComponent(id));
  if (!a) {
    return problem(404, "No such agent", `Agent ${id} is not in this index. That is not the same as it not existing on chain.`);
  }

  const [record, fb] = await Promise.all([
    a.uriHash ? probedCluster(a.uriHash) : Promise.resolve(undefined),
    claims({ agentId: a.id, withUri: false, limit: 200 }),
  ]);

  const checked = fb.rows.filter((c) => c.outcome !== null);
  return json(
    envelope(
      {
        agentId: a.agentId,
        name: a.name,
        owner: a.owner,
        agentWallet: a.agentWallet,
        registeredAtBlock: a.registeredAtBlock,
        transferCount: a.transferCount,
        metadataUpdateCount: a.metadataUpdateCount,
        // The operator's own assertion. Labelled as theirs so a consumer never reads it as ours.
        declaresX402: a.declaresX402,
        endpoints: a.endpoints,
        registration: record
          ? {
              uri: record.uri,
              uriHash: record.uriHash,
              state: record.state,
              reason: record.reason,
              askedAt: record.checkedAt,
              sharedWithAgents: record.memberCount - 1,
              sharedAcrossWallets: record.distinctOwners,
            }
          : null,
        claims: {
          onChain: a.feedbackCount,
          checkable: fb.rows.filter((c) => c.feedbackUri !== "").length,
          checked: checked.length,
          resolve: checked.filter((c) => c.outcome === "true").length,
          doNotResolve: checked.filter((c) => c.outcome === "false").length,
          couldNotCheck: checked.filter((c) => c.outcome === "unknown").length,
          assertNoPayment: checked.filter((c) => c.outcome === "noClaim").length,
          items: fb.rows.map((c) => ({
            id: c.id,
            outcome: c.outcome,
            rung: c.rung,
            reason: c.reason,
            declaredNetwork: c.declaredNetwork,
            declaredTx: c.declaredTx,
            foundOnChain: c.foundChain ? { chain: c.foundChain, chainId: c.foundChainId, block: c.foundBlock } : null,
            checkedAt: c.checkedAt,
            checkedAtBlock: c.checkedAtBlock,
            blockNumber: c.blockNumber,
          })),
        },
      },
      `cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 'tokenURI(uint256)(string)' ${a.agentId} --rpc-url https://rpc.monad.xyz`,
    ),
  );
}
