import { envelope, json, problem } from "@/lib/api.ts";
import { submitFundingSignature, IntentsConfigError, IntentsError } from "@/lib/intents.ts";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz";

/**
 * Submit the execution signature to Intents Connect. The create response carries `messageToSign`, the
 * client signs it with EIP-191 personal_sign and posts the `secp256k1:<base58>` signature here; this
 * route relays it to Aurora with the server-held key. Confirmed order by the organizer (Chris
 * Gutkowski, 2026-09-29): sign before depositing, so the batch runs by itself once the bridge lands.
 *
 * The signature is per-execution authorization the user produced; the only secret is the api key, which
 * stays in the header to Aurora and never in a response. A missing key is 503, the same posture as the
 * quote and create routes.
 */

const MAX_BODY_BYTES = 4_096;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const SIGNATURE = /^secp256k1:[1-9A-HJ-NP-Za-km-z]+$/;
const TIMEOUT_MS = 30_000;

type Body = { wallet?: unknown; executionId?: unknown; signature?: unknown };

export async function POST(req: Request) {
  const key = process.env.AURORA_INTENTS_API_KEY;
  if (!key) {
    return problem(
      503,
      "Funding not configured",
      "Submitting a signature needs the Intents Connect API key wired on the server. This instance has none.",
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
    return problem(400, "Not JSON", "The body must be a JSON object with wallet, executionId and signature.");
  }

  if (typeof body.wallet !== "string" || !ADDRESS.test(body.wallet)) {
    return problem(400, "Bad wallet", "`wallet` must be the 0x source wallet the execution was created for.");
  }
  if (typeof body.executionId !== "string" || !UUID.test(body.executionId)) {
    return problem(400, "Bad executionId", "`executionId` must be the uuid returned by /api/fund/create.");
  }
  if (typeof body.signature !== "string" || !SIGNATURE.test(body.signature)) {
    return problem(400, "Bad signature", "`signature` must be `secp256k1:<base58 of the 65-byte signature>`, not raw 0x hex.");
  }

  try {
    const r = await submitFundingSignature(
      { wallet: body.wallet, executionId: body.executionId, signature: body.signature },
      { apiKey: key, timeoutMs: TIMEOUT_MS },
    );
    return json(
      envelope(
        { executionId: body.executionId, wallet: body.wallet, status: r.status, messageSigned: r.messageSigned },
        `curl -sS ${SITE}/api/fund/${body.executionId}?wallet=${body.wallet}`,
      ),
    );
  } catch (err) {
    if (err instanceof IntentsConfigError) {
      return problem(400, "Bad submit request", err.message);
    }
    if (err instanceof IntentsError) {
      return problem(502, "Aurora rejected the signature", "Intents Connect did not accept the signature. The execution is unchanged.");
    }
    throw err;
  }
}
