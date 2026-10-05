/**
 * Tenderly alerts as the trigger that re-verifies a repaired document.
 *
 * The same job the Alchemy webhook did until Alchemy's monthly cap paused it on 2026-10-03: a
 * Tenderly alert watches the Identity Registry for MetadataUpdate and URIUpdated on Monad mainnet and
 * posts the transaction here. Everything after the signature and the parse is `runDelivery` in
 * lib/rehydrate.ts, the same path Alchemy uses, so the two providers cannot judge differently.
 *
 * Tenderly's signing scheme (docs.tenderly.co, Alert Destinations, Project-Scoped, "Securing the
 * Webhook"): `x-tenderly-signature` is the hex HMAC-SHA256, keyed by the webhook's signing secret,
 * over the raw request body followed by the `Date` header. So the order is the same as Alchemy's:
 * raw body, then signature, then parse.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { problem } from "./api.ts";
import { readBodyText } from "./body.ts";
import { liveDeps, runDelivery, type AlchemyDelivery, type Deps, type WebhookLog } from "./rehydrate.ts";

export const TENDERLY_SECRET_ENV = "TENDERLY_WEBHOOK_SECRET";
export const TENDERLY_SIGNATURE_HEADER = "x-tenderly-signature";

export function tenderlySecretFrom(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env[TENDERLY_SECRET_ENV];
  return v && v.trim() !== "" ? v.trim() : null;
}

/** Constant-time check of Tenderly's signature. A digest is 64 hex characters, so a length mismatch leaks nothing. */
export function verifyTenderlySignature(rawBody: string, date: string, header: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").update(date, "utf8").digest("hex");
  const got = header.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(got)) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

const HEX = /^0x[0-9a-fA-F]*$/;

function asLog(v: unknown, txHash: string | null): WebhookLog | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  // Tenderly sends logs either flat or with the raw log under `raw`. Both are read, nothing else is.
  const src = (o.raw && typeof o.raw === "object" ? o.raw : o) as Record<string, unknown>;
  const address = typeof src.address === "string" ? src.address.toLowerCase() : null;
  const topics = Array.isArray(src.topics) ? src.topics.filter((t): t is string => typeof t === "string" && HEX.test(t)) : null;
  const data = typeof src.data === "string" && HEX.test(src.data) ? src.data : "0x";
  if (!address || !topics) return null;
  return { address, topics: topics.map((t) => t.toLowerCase()), data, txHash };
}

export type TenderlyParse = { ok: true; delivery: AlchemyDelivery } | { ok: false; reason: string };

/** Rebuilt field by field, like parseDelivery, so nothing unexpected rides along. */
export function parseTenderly(body: unknown): TenderlyParse {
  if (!body || typeof body !== "object") return { ok: false, reason: "the body is not a JSON object" };
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : "";
  if (id === "") return { ok: false, reason: "no `id`, so the delivery cannot be keyed for exactly-once processing" };
  const type = b.event_type === "TEST" || b.event_type === "ALERT" ? b.event_type : null;
  if (type === null) return { ok: false, reason: "`event_type` must be ALERT or TEST" };
  const tx = b.transaction && typeof b.transaction === "object" ? (b.transaction as Record<string, unknown>) : null;
  if (tx === null) return { ok: false, reason: "no `transaction` object" };
  const txHash = typeof tx.hash === "string" ? tx.hash : typeof tx.transaction_hash === "string" ? tx.transaction_hash : null;
  const rawLogs = Array.isArray(tx.logs) ? tx.logs : [];
  const logs = rawLogs.map((l) => asLog(l, txHash)).filter((l): l is WebhookLog => l !== null);
  return {
    ok: true,
    delivery: {
      id,
      webhookId: typeof b.alert_id === "string" ? b.alert_id : "",
      type: `TENDERLY_${type}`,
      createdAt: "",
      logs,
    },
  };
}

export async function handleTenderlyWebhook(
  req: Request,
  deps: Deps = liveDeps(),
  secret: string | null = tenderlySecretFrom(),
): Promise<Response> {
  if (secret === null) {
    return problem(503, "Webhook signing secret is not configured", "No secret is wired, so every delivery is refused rather than accepted unchecked.", {
      envVar: TENDERLY_SECRET_ENV,
      retryable: true,
    });
  }
  const read = await readBodyText(req);
  if (!read.ok) return problem(read.status, read.title, read.detail);
  const raw = read.text;

  const header = req.headers.get(TENDERLY_SIGNATURE_HEADER);
  const date = req.headers.get("date");
  if (!header || !date) {
    return problem(401, "Missing signature", `Every delivery must carry ${TENDERLY_SIGNATURE_HEADER} and Date.`);
  }
  if (!verifyTenderlySignature(raw, date, header, secret)) {
    return problem(401, "Signature does not verify", "Nothing was read out of the body and nothing was written.");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "Body is not JSON", "The signature verified and the payload did not parse.");
  }
  const parsed = parseTenderly(body);
  if (!parsed.ok) return problem(400, "Delivery shape not recognised", parsed.reason);
  return runDelivery(parsed.delivery, `tenderly:${parsed.delivery.id}`, "tenderly-id", deps);
}
