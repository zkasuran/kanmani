import { envelope, json, problem } from "@/lib/api.ts";
import { createFunding, IntentsConfigError, IntentsError, ShortfallError } from "@/lib/intents.ts";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz";

/**
 * Create a cross-chain funding execution and return its signing payload so the client can sign at once.
 * The shortfall guard runs first (inside `createFunding`), so an execution the escrow would revert on
 * is never created: a short quote comes back as 409, not a 201 the user then funds into a loss.
 *
 * The Intents Connect key stays server-side. The response carries the deposit address, the execution id
 * and the wallet together (the status read needs both, there is no by-id endpoint), plus the signing
 * payload, which is public per-execution data the client must have to sign, not a secret.
 */

const MAX_BODY_BYTES = 8_192;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^\d+$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const MAX_ASSET_LEN = 200;
const TIMEOUT_MS = 30_000;

type Body = {
  wallet?: unknown;
  originAsset?: unknown;
  amount?: unknown;
  agent?: unknown;
  jobAmount?: unknown;
  destinationAsset?: unknown;
  slippageTolerance?: unknown;
  deadline?: unknown;
  termsHash?: unknown;
  salt?: unknown;
};

export async function POST(req: Request) {
  const key = process.env.AURORA_INTENTS_API_KEY;
  if (!key) {
    return problem(
      503,
      "Funding not configured",
      "Cross-chain funding needs an Intents Connect API key wired on the server. This instance has none, so no execution can be created.",
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
    return problem(400, "Not JSON", "The body must be a JSON object with wallet, originAsset, amount, agent and jobAmount.");
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
  if (typeof body.jobAmount !== "string" || !DECIMAL.test(body.jobAmount) || BigInt(body.jobAmount) <= 0n) {
    return problem(400, "Bad jobAmount", "`jobAmount` must be the USDC the job will hold, in base units, as a positive decimal string. A create sizes the escrow against it.");
  }
  if (body.destinationAsset !== undefined && (typeof body.destinationAsset !== "string" || body.destinationAsset.length > MAX_ASSET_LEN)) {
    return problem(400, "Bad destinationAsset", "`destinationAsset`, when given, must be an assetId string.");
  }
  if (body.slippageTolerance !== undefined && (typeof body.slippageTolerance !== "number" || !Number.isFinite(body.slippageTolerance) || body.slippageTolerance < 0 || body.slippageTolerance > 10_000)) {
    return problem(400, "Bad slippageTolerance", "`slippageTolerance`, when given, must be basis points between 0 and 10000.");
  }
  if (body.deadline !== undefined && (typeof body.deadline !== "string" || !DECIMAL.test(body.deadline))) {
    return problem(400, "Bad deadline", "`deadline`, when given, must be a unix seconds decimal string.");
  }
  if (body.termsHash !== undefined && (typeof body.termsHash !== "string" || !BYTES32.test(body.termsHash))) {
    return problem(400, "Bad termsHash", "`termsHash`, when given, must be a 0x 32-byte hash.");
  }
  if (body.salt !== undefined && (typeof body.salt !== "string" || !BYTES32.test(body.salt))) {
    return problem(400, "Bad salt", "`salt`, when given, must be a 0x 32-byte value.");
  }

  try {
    const r = await createFunding(
      {
        wallet: body.wallet,
        originAsset: body.originAsset,
        amount: body.amount,
        agent: body.agent as `0x${string}`,
        jobAmount: BigInt(body.jobAmount),
        destinationAsset: body.destinationAsset as string | undefined,
        slippageTolerance: body.slippageTolerance as number | undefined,
        deadline: body.deadline !== undefined ? BigInt(body.deadline as string) : undefined,
        termsHash: body.termsHash as `0x${string}` | undefined,
        salt: body.salt as `0x${string}` | undefined,
      },
      { apiKey: key, timeoutMs: TIMEOUT_MS },
    );
    return json(
      envelope(
        {
          id: r.id,
          wallet: r.wallet,
          status: r.status,
          depositAddress: r.depositAddress,
          intermediary: r.intermediary,
          minAmountOut: r.minAmountOut.toString(),
          needed: r.needed.toString(),
          messageToSign: r.messageToSign,
          payloadJson: r.payloadJson,
          signingStandard: r.signingStandard,
        },
        `curl -sS ${SITE}/api/fund/${r.id ?? "<id>"}?wallet=${r.wallet}`,
      ),
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ShortfallError) {
      return problem(
        409,
        "Quote cannot cover the job",
        `The guaranteed delivery ${err.minAmountOut} is below the ${err.needed} the job needs, so the escrow would revert. Re-quote; nothing was created.`,
      );
    }
    if (err instanceof IntentsConfigError) {
      return problem(400, "Bad funding request", err.message);
    }
    if (err instanceof IntentsError && err.upstream) {
      // Aurora judged the request itself, so the reason is about the caller's input and is shown.
      return problem(422, "Aurora refused the execution", err.upstream.message, {
        upstreamStatus: err.upstream.status,
        ...(err.upstream.minAmount ? { minAmount: err.upstream.minAmount } : {}),
      });
    }
    if (err instanceof IntentsError) {
      return problem(502, "Aurora did not create the execution", "Intents Connect did not return a usable create response. Nothing was created.");
    }
    throw err;
  }
}
