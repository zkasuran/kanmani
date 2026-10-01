import { envelope, json, problem } from "@/lib/api.ts";
import { quoteFunding, IntentsConfigError, IntentsError } from "@/lib/intents.ts";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz";

/**
 * A dry cross-chain funding quote: what a Monad escrow job would be funded with from an asset held on
 * another chain, and whether that covers the job. The Aurora Intents Connect key stays server-side and
 * never reaches a response. Everything this route does lives in `lib/intents.ts` and is tested there;
 * this file is the Next.js surface and nothing else, the same split `/api/webhooks/alchemy` uses.
 *
 * A missing key is 503 for every request, never a skipped check (same posture as the Alchemy webhook).
 * The quote reports a shortfall rather than throwing, so the UI can show "the quote moved, this would be
 * refused" instead of a 500. The create route is where a doomed execution is refused.
 */

const MAX_BODY_BYTES = 8_192;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^\d+$/;
const MAX_ASSET_LEN = 200;
const TIMEOUT_MS = 20_000;

type Body = {
  wallet?: unknown;
  originAsset?: unknown;
  amount?: unknown;
  agent?: unknown;
  destinationAsset?: unknown;
  slippageTolerance?: unknown;
  jobAmount?: unknown;
};

export async function POST(req: Request) {
  const key = process.env.AURORA_INTENTS_API_KEY;
  if (!key) {
    return problem(
      503,
      "Funding not configured",
      "Cross-chain funding needs an Intents Connect API key wired on the server. This instance has none, so no quote can be priced.",
    );
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return problem(413, "Body too large", `The request body must be under ${MAX_BODY_BYTES} bytes.`);
  }
  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return problem(400, "Not JSON", "The body must be a JSON object with wallet, originAsset, amount and agent.");
  }

  if (typeof body.wallet !== "string" || !ADDRESS.test(body.wallet)) {
    return problem(400, "Bad wallet", "`wallet` must be a 0x address: the source wallet that owns the Monad intermediary.");
  }
  if (typeof body.agent !== "string" || !ADDRESS.test(body.agent)) {
    return problem(400, "Bad agent", "`agent` must be a 0x address: the agent the funded job hires.");
  }
  if (typeof body.originAsset !== "string" || body.originAsset.length === 0 || body.originAsset.length > MAX_ASSET_LEN) {
    return problem(400, "Bad originAsset", "`originAsset` must be an assetId string from Intents Connect /supported_tokens.");
  }
  if (typeof body.amount !== "string" || !DECIMAL.test(body.amount)) {
    return problem(400, "Bad amount", "`amount` must be the source amount in origin base units, as a decimal string.");
  }
  if (body.destinationAsset !== undefined && (typeof body.destinationAsset !== "string" || body.destinationAsset.length > MAX_ASSET_LEN)) {
    return problem(400, "Bad destinationAsset", "`destinationAsset`, when given, must be an assetId string.");
  }
  if (body.slippageTolerance !== undefined && (typeof body.slippageTolerance !== "number" || !Number.isFinite(body.slippageTolerance) || body.slippageTolerance < 0 || body.slippageTolerance > 10_000)) {
    return problem(400, "Bad slippageTolerance", "`slippageTolerance`, when given, must be basis points between 0 and 10000.");
  }
  if (body.jobAmount !== undefined && (typeof body.jobAmount !== "string" || !DECIMAL.test(body.jobAmount))) {
    return problem(400, "Bad jobAmount", "`jobAmount`, when given, must be USDC base units as a decimal string.");
  }

  try {
    const result = await quoteFunding(
      {
        wallet: body.wallet,
        originAsset: body.originAsset,
        amount: body.amount,
        agent: body.agent as `0x${string}`,
        destinationAsset: body.destinationAsset as string | undefined,
        slippageTolerance: body.slippageTolerance as number | undefined,
        jobAmount: body.jobAmount !== undefined ? BigInt(body.jobAmount as string) : undefined,
      },
      { apiKey: key, timeoutMs: TIMEOUT_MS },
    );
    return json(
      envelope(
        {
          minAmountOut: result.minAmountOut.toString(),
          networkFee: result.networkFee === null ? null : result.networkFee.toString(),
          intermediary: result.intermediary,
          depositAddress: result.depositAddress,
          needed: result.needed.toString(),
          shortfall: result.shortfall,
        },
        `curl -sS ${SITE}/api/fund/quote -H 'content-type: application/json' -d '{"wallet":"0x…","originAsset":"<assetId>","amount":"<base units>","agent":"0x…"}'`,
      ),
    );
  } catch (err) {
    if (err instanceof IntentsConfigError) {
      return problem(400, "Bad funding request", err.message);
    }
    if (err instanceof IntentsError) {
      return problem(502, "No usable quote from Aurora", "Intents Connect did not return a quote that could be read. Nothing was created.");
    }
    throw err;
  }
}
