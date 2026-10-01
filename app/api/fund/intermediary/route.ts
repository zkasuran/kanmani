import { createPublicClient, erc20Abi, http } from "viem";
import { envelope, json, problem } from "@/lib/api.ts";
import { getIntermediary, IntentsConfigError, IntentsError } from "@/lib/intents.ts";
import { classifyFunding, type FundingClass } from "@/lib/intents-recover.ts";
import { viemChain } from "@/lib/chains.ts";
import { USDC_MONAD } from "@/lib/x402.ts";
import { usdc } from "@/lib/bonds.ts";
import { CHAIN_ID } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz";

/**
 * The intermediary account for a wallet and its live Monad USDC balance, so the recovery panel can show
 * what is sitting there after a short landing or an expiry. Keyless: `getIntermediary` is Aurora's
 * keyless GET and the balance is read on chain with the same pattern `/api/account/[address]` uses.
 *
 * A balance that could not be read is null, never 0: an empty intermediary and an unreachable RPC are
 * different facts. No API key, no secrets in the response.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^\d+$/;
const TIMEOUT_MS = 15_000;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const wallet = u.searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) {
    return problem(400, "wallet is required", "GET /api/fund/intermediary?wallet=0x…, the source wallet that owns the intermediary.");
  }
  const neededRaw = u.searchParams.get("needed");
  if (neededRaw !== null && !DECIMAL.test(neededRaw)) {
    return problem(400, "Bad needed", "`needed`, when given, must be USDC base units as a decimal string.");
  }
  const needed = neededRaw === null ? 0n : BigInt(neededRaw);

  let intermediary: string;
  try {
    intermediary = await getIntermediary(wallet, { timeoutMs: TIMEOUT_MS });
  } catch (err) {
    if (err instanceof IntentsConfigError) return problem(400, "Bad wallet", err.message);
    if (err instanceof IntentsError) return problem(502, "Could not resolve the intermediary", "Intents Connect did not return the intermediary account for this wallet.");
    throw err;
  }

  const chain = viemChain(CHAIN_ID);
  const client = chain ? createPublicClient({ chain, transport: http(process.env.RPC_MONAD || undefined) }) : null;
  const atomic = client
    ? await client
        .readContract({ address: USDC_MONAD, abi: erc20Abi, functionName: "balanceOf", args: [intermediary as `0x${string}`] })
        .catch(() => null)
    : null;

  const balance = atomic === null ? null : atomic.toString();
  const state: FundingClass | null =
    atomic === null ? null : classifyFunding({ neededAmount: needed, intermediaryBalance: atomic });

  return json(
    envelope(
      {
        wallet,
        intermediary,
        balance,
        balanceHuman: atomic === null ? null : usdc(atomic.toString()),
        needed: neededRaw === null ? null : needed.toString(),
        state,
        note: "The intermediary is owned by the source wallet through a Chain Signature. A null balance means the chain could not be read, never that it is empty.",
      },
      `curl -sS ${SITE}/api/fund/intermediary?wallet=${wallet}`,
    ),
  );
}
