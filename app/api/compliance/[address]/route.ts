import { isAddress } from "viem";
import { envelope, json, problem } from "@/lib/api.ts";
import {
  COMPLIANCE_CHAINS,
  MAINNET_GATE,
  TESTNET_GATE,
  readCviStatus,
} from "@/lib/cleanverse-onchain.ts";

export const dynamic = "force-dynamic";

/**
 * The on-chain CVI status of one wallet on both Monad chains, read from public state only.
 *
 * No auth is needed and none is checked, the same reason as the account route: an address and its
 * on-chain CVI status are already public, so gating this would protect nothing. There is no secret
 * here. The read needs no key and the off-chain Cleanverse API is not called, so there is no SSRF
 * surface and no allowlist dependency.
 *
 * A chain that cannot be read is `unknown`, never `unverified`: an unreachable RPC and a wallet that
 * is not cleared are different facts, and the one failing chain never blocks the other.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) {
    return problem(400, "Not an address", `${address} is not a 20-byte hex address.`);
  }
  const worker = address.toLowerCase() as `0x${string}`;

  const chains = await Promise.all(
    COMPLIANCE_CHAINS.map(async (c) => ({
      chainId: c.chainId,
      key: c.key,
      displayName: c.displayName,
      gate: c.gate,
      registered: c.registered,
      ...(await readCviStatus(worker, c)),
    })),
  );

  return json(
    envelope(
      { address: worker, chains },
      `cviStatus(${worker}) via eth_call to each gate: 143 ${MAINNET_GATE}, 10143 ${TESTNET_GATE}`,
    ),
    { headers: { "cache-control": "no-store" } },
  );
}
