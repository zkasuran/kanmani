import { createPublicClient, erc20Abi, formatEther, http, isAddress } from "viem";
import { envelope, json, problem } from "@/lib/api.ts";
import { agents, agentsCount } from "@/lib/queries.ts";
import { bondsFor, usdc } from "@/lib/bonds.ts";
import { viemChain } from "@/lib/chains.ts";
import { USDC_MONAD } from "@/lib/x402.ts";
import { CHAIN_ID } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

/** Enough for any real operator. The count beside the list is exact either way. */
const LIST_LIMIT = 100;

/**
 * Everything the account menu shows for one address, read from public state only.
 *
 * No login is needed and none is checked. An address, its balances and the agents it owns are
 * already public on chain, so gating this would protect nothing and would imply otherwise. What the
 * login proves is who is looking, which matters for signing, not for reading.
 *
 * A balance that could not be read is `null`, never `0`: an empty wallet and an unreachable RPC are
 * different facts and the menu says which one it has.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) {
    return problem(400, "Not an address", `${address} is not a 20-byte hex address.`);
  }
  const owner = address.toLowerCase() as `0x${string}`;

  const chain = viemChain(CHAIN_ID);
  const client = chain ? createPublicClient({ chain, transport: http(process.env.RPC_MONAD || undefined) }) : null;

  const [list, count, mon, usdcAtomic] = await Promise.all([
    agents({ owner, limit: LIST_LIMIT }),
    agentsCount({ owner }),
    client ? client.getBalance({ address: owner }).catch(() => null) : Promise.resolve(null),
    client
      ? client
          .readContract({ address: USDC_MONAD, abi: erc20Abi, functionName: "balanceOf", args: [owner] })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  // Live from Sclera. `bondFor` returns null both for "no bond" and for "could not read", so an agent
  // missing from this map is reported as null ("none found") and never as a definite "none".
  const bonds = await bondsFor(list.rows.map((a) => a.agentId)).catch(() => new Map());

  return json(
    envelope(
      {
        address: owner,
        balances: {
          mon: mon === null ? null : formatEther(mon),
          usdc: usdcAtomic === null ? null : usdc(usdcAtomic.toString()),
        },
        agentCount: count,
        agents: list.rows.map((a) => ({
          agentId: a.agentId,
          name: a.name,
          rung: a.rung,
          feedbackCount: a.feedbackCount,
          // The bond state when one was read, otherwise null: none found, which includes a failed read.
          bond: bonds.get(a.agentId)?.state ?? null,
        })),
      },
      `SELECT agentId FROM Agent WHERE chainId = ${CHAIN_ID} AND lower(owner) = '${owner}'; balances via eth_getBalance and USDC balanceOf at ${USDC_MONAD}`,
    ),
    { headers: { "cache-control": "no-store" } },
  );
}
