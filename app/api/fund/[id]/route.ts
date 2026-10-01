import { envelope, json, problem } from "@/lib/api.ts";
import { readFundingStatus, IntentsConfigError, IntentsError } from "@/lib/intents.ts";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz";

/**
 * The live status of one funding execution. Keyless: Intents Connect indexes executions by wallet and
 * has no by-id endpoint, so this reads the by-wallet list and filters by id. The wallet is therefore
 * required on the query string, not optional, and a missing one is a 400 that says why rather than a
 * silent empty read.
 *
 * This file is the Next.js surface; the read and the array filter live in `lib/intents.ts` and are
 * tested there.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TIMEOUT_MS = 15_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return problem(400, "Bad execution id", "The execution id must be a uuid.");
  }
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) {
    return problem(
      400,
      "wallet is required",
      "GET /api/fund/:id?wallet=0x…, because Intents Connect indexes executions by wallet and has no by-id endpoint.",
    );
  }

  try {
    const item = await readFundingStatus({ wallet, id }, { timeoutMs: TIMEOUT_MS });
    if (!item) {
      return problem(404, "No such execution for this wallet", "No execution with that id was found for this wallet.");
    }
    return json(
      envelope(
        {
          id: item.id,
          status: item.status,
          messageSigned: item.messageSigned,
          minAmountOut: item.minAmountOut === null ? null : item.minAmountOut.toString(),
          networkFee: item.networkFee === null ? null : item.networkFee.toString(),
          intermediary: item.intermediary,
          depositAddress: item.depositAddress,
          destinationAsset: item.destinationAsset,
          deadline: item.deadline,
        },
        `curl -sS ${SITE}/api/fund/${id}?wallet=${wallet}`,
      ),
    );
  } catch (err) {
    if (err instanceof IntentsConfigError) {
      return problem(400, "Bad status request", err.message);
    }
    if (err instanceof IntentsError) {
      return problem(502, "Could not read the execution", "Intents Connect did not return a readable status. Try again.");
    }
    throw err;
  }
}
