import { envelope, json, problem } from "@/lib/api.ts";
import { toWireSteps, IntentsConfigError, IntentsError, type Terms } from "@/lib/intents.ts";
import { buildRefundSteps, buildWithdrawStep, requestStepsExecution } from "@/lib/intents-recover.ts";
import { USDC_MONAD } from "@/lib/x402.ts";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz";

/**
 * One-click recovery of funds sitting at the intermediary after a short landing or an expiry. Builds a
 * steps-only execution (no bridge, no deposit): re-fund rebuilds approve + createJob sized to the real
 * balance, withdraw is a single transfer back to the owner. The server holds the key and talks to
 * Aurora; the signing and the on-chain run are the owner's (a hard stop), so the public page sends
 * dry:true and hands the returned signing payload to the connected wallet.
 *
 * Mirrors the quote/create split under a distinct `recover/` segment. A missing key is 503.
 */

const MAX_BODY_BYTES = 8_192;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^\d+$/;
const TIMEOUT_MS = 30_000;

type Body = {
  wallet?: unknown;
  mode?: unknown;
  balance?: unknown;
  recipient?: unknown;
  agent?: unknown;
  dry?: unknown;
};

function termsFor(agent: `0x${string}`, balance: bigint): Terms {
  return {
    agent,
    token: USDC_MONAD as `0x${string}`,
    amount: balance,
    pricePerUnit: balance,
    deadline: 4102444800n,
    termsHash: ("0x" + "00".repeat(32)) as `0x${string}`,
    salt: ("0x" + "11".repeat(32)) as `0x${string}`,
  };
}

export async function POST(req: Request) {
  const key = process.env.AURORA_INTENTS_API_KEY;
  if (!key) {
    return problem(503, "Funding not configured", "Recovery needs the Intents Connect API key wired on the server. This instance has none.");
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return problem(413, "Body too large", `The request body must be under ${MAX_BODY_BYTES} bytes.`);
  }
  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return problem(400, "Not JSON", "The body must be a JSON object with wallet, mode and balance.");
  }

  if (typeof body.wallet !== "string" || !ADDRESS.test(body.wallet)) {
    return problem(400, "Bad wallet", "`wallet` must be the 0x source wallet that owns the intermediary.");
  }
  if (body.mode !== "refund" && body.mode !== "withdraw") {
    return problem(400, "Bad mode", "`mode` must be `refund` or `withdraw`.");
  }
  if (typeof body.balance !== "string" || !DECIMAL.test(body.balance) || BigInt(body.balance) <= 0n) {
    return problem(400, "Bad balance", "`balance` must be the intermediary USDC balance in base units, a positive decimal string.");
  }
  const dry = body.dry === undefined ? true : body.dry === true;
  const balance = BigInt(body.balance);

  let wireSteps;
  try {
    if (body.mode === "refund") {
      if (typeof body.agent !== "string" || !ADDRESS.test(body.agent)) {
        return problem(400, "Bad agent", "`agent` must be a 0x address: a re-fund rebuilds the job that hires it.");
      }
      wireSteps = toWireSteps(buildRefundSteps({ balance, terms: termsFor(body.agent as `0x${string}`, balance) }).steps);
    } else {
      const recipient = typeof body.recipient === "string" && ADDRESS.test(body.recipient) ? body.recipient : body.wallet;
      wireSteps = toWireSteps([buildWithdrawStep({ balance, recipient })]);
    }
  } catch (err) {
    if (err instanceof IntentsConfigError) return problem(400, "Bad recovery request", err.message);
    throw err;
  }

  try {
    const r = await requestStepsExecution({ wallet: body.wallet, steps: wireSteps, dry }, { apiKey: key, timeoutMs: TIMEOUT_MS });
    return json(
      envelope(
        {
          mode: body.mode,
          wallet: body.wallet,
          dry,
          id: r.id,
          status: r.status,
          intermediary: r.intermediary,
          networkFee: r.networkFee === null ? null : r.networkFee.toString(),
          messageToSign: dry ? null : r.messageToSign,
          payloadJson: dry ? null : r.payloadJson,
          signingStandard: dry ? null : r.signingStandard,
          note: "Signing and the on-chain steps-only run are done by the owner's wallet, never by the server. A dry call only estimates.",
        },
        `curl -sS ${SITE}/api/fund/recover -H 'content-type: application/json' -d '{"wallet":"${body.wallet}","mode":"${body.mode}","balance":"${body.balance}","dry":true}'`,
      ),
      { status: dry ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof IntentsConfigError) return problem(400, "Bad recovery request", err.message);
    if (err instanceof IntentsError) return problem(502, "Aurora did not accept the recovery", "Intents Connect did not return a usable steps execution. Nothing was created.");
    throw err;
  }
}
