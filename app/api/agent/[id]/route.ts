import { envelope, json, problem } from "@/lib/api.ts";
import { agent, claims, probedCluster } from "@/lib/queries.ts";
import { bondFor } from "@/lib/bonds.ts";
import { passkeyBinding } from "@/lib/agent-passkey-read.ts";
import { adextoMarketsFor } from "@/lib/adexto.ts";

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

  const [record, fb, bond, passkey, markets] = await Promise.all([
    a.uriHash ? probedCluster(a.uriHash) : Promise.resolve(undefined),
    claims({ agentId: a.id, withUri: false, limit: 200 }),
    // Read live from Sclera rather than from an index. A window matures when a block number passes and
    // emits nothing, so an event-derived state would keep reporting "active" after maturity.
    bondFor(Number(a.agentId)),
    passkeyBinding(Number(a.agentId)),
    adextoMarketsFor(Number(a.agentId)),
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
        // null means no bond was ever posted OR we could not reach the chain. Those are different and
        // the field says which: an unreachable chain returns null with no other bond fields, which a
        // consumer must not read as "unbonded".
        bond: bond
          ? {
              state: bond.state,
              amountAtomic: bond.amountAtomic,
              token: bond.token,
              minTruthRateBps: bond.minTruthRateBps,
              minSampleSize: bond.minSampleSize,
              postedAtBlock: bond.postedAtBlock,
              maturesAtBlock: bond.maturesAtBlock,
              matured: bond.matured,
              contract: bond.address,
            }
          : null,
        // The device passkey bound to this agent, verified by Monad's P256 precompile when it signs.
        // state is bound, none or unknown; unknown means the chain could not be read.
        passkey,
        // Token markets bound to this agent on ADEXTO, a separate project. The binding is read from
        // ADEXTO's factory on chain (agentIdOf), not taken from its list. [] when none or unreadable.
        markets: markets.map((m) => ({ venue: "ADEXTO", symbol: m.symbol, name: m.name, token: m.token, curve: m.curve, url: m.url })),
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
