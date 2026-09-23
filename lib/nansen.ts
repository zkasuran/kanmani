/**
 * A typed client for the Nansen API, built around an injected transport so it runs in a test with
 * no network and no key.
 *
 * ## What this is for
 *
 * The operators page can say how many wallets registered the same document. It cannot say WHO they
 * are. Nansen turns a wallet address into its known entity and behavioural labels, so a count of
 * 7,962 wallets becomes a distribution: how many are exchange deposit wallets, how many are smart
 * money, how many Nansen has nothing on. That last group is the honest one and it renders as
 * `unknown`, never as a zero.
 *
 * ## Everything below was read from Nansen's live docs on 2026-09-23, in that order
 *
 * - Base host `https://api.nansen.ai`, from `docs.nansen.ai/getting-started/authentication`.
 * - The key path sends the key in a lowercase `apikey` header. The docs are explicit that the
 *   header name is `apikey`, not `Authorization` and not `X-API-KEY`.
 * - The labels endpoint is `POST /api/v1/profiler/address/labels`. Request body is `address` and
 *   `chain` (an enum that includes `monad`), plus optional pagination. Response is
 *   `{ data: [{ label, category, kind }] }` where category is one of
 *   `smart_money, behavioral, defi, social, cefi, nft, others`.
 * - The x402 payment path is x402 V2 only, header `PAYMENT-SIGNATURE`. It settles on Base,
 *   Solana or Monad. Monad uses the Molandak facilitator, which is the same facilitator this
 *   product already pays its own verifier over (see lib/x402.ts). An optional `X-Payer-Address`
 *   header on the first request asks for a payer discount.
 * - The labels endpoint is the one profiler endpoint Nansen EXCLUDES from x402: it needs a Pro
 *   subscription, so it is the apikey path. The profiler endpoints that DO accept x402 (for example
 *   related-wallets, listed at $0.01 a call) go over the payment path. So this client speaks both
 *   and picks per call, which is why the auth mode is a parameter rather than a build-time choice.
 *
 * ## No network in here
 *
 * Nothing in this file opens a socket. Every call goes through an injected `NansenTransport`, so a
 * test drives the whole client with a fake transport and the production transport (in the enrich
 * CLI) screens the target through the repo's SSRF guard before it connects. The client cannot make
 * an unguarded request because it has no way to make a request at all on its own.
 */

/** The one host. A transport is free to refuse anything that does not start with this. */
export const NANSEN_BASE = "https://api.nansen.ai";

/** The chains Nansen's profiler accepts. We only ever ask about Monad, but the enum is the docs'. */
export type NansenChain =
  | "monad"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "bnb"
  | "polygon"
  | "optimism"
  | "solana"
  | "all";

/**
 * A label category, normalised. Nansen writes `others`; everything else here is its own spelling.
 * `other` is the normalised form of `others` and also the fallback when a label carries no category.
 */
export type LabelCategory =
  | "smart_money"
  | "cefi"
  | "defi"
  | "nft"
  | "social"
  | "behavioral"
  | "other";

/**
 * Which category wins when an address carries several, most telling first.
 *
 * A wallet that is both smart money and a DeFi user is most usefully shown as smart money, because
 * that is the rarer and more decision-changing fact. This ordering is a product choice and it is
 * stated here rather than buried in the classifier so a reader can disagree with it in one place.
 */
export const LABEL_CATEGORY_PRIORITY: readonly LabelCategory[] = [
  "smart_money",
  "cefi",
  "defi",
  "nft",
  "social",
  "behavioral",
  "other",
];

/* ------------------------------------------------------------------ response shapes */

/** One label object from the labels endpoint. `category` and `kind` are optional in the schema. */
export type NansenLabel = { label?: string; category?: string; kind?: string[] };

export type AddressLabelsResponse = {
  pagination?: { page: number; per_page: number; is_last_page: boolean };
  data: NansenLabel[];
};

/** One related wallet, from the x402-capable related-wallets endpoint. */
export type RelatedWallet = {
  address: string;
  address_label?: string;
  relation: string;
  transaction_hash: string;
  block_timestamp: string;
  order: number;
  chain: string;
};

export type RelatedWalletsResponse = {
  pagination?: { page: number; per_page: number; is_last_page: boolean };
  data: RelatedWallet[];
};

/* ------------------------------------------------------------------ classification */

/** Normalise the docs' category strings, folding `others` into `other` and the unknown into it. */
export function normalizeCategory(raw: string | undefined): LabelCategory {
  switch ((raw ?? "").toLowerCase()) {
    case "smart_money":
      return "smart_money";
    case "cefi":
      return "cefi";
    case "defi":
      return "defi";
    case "nft":
      return "nft";
    case "social":
      return "social";
    case "behavioral":
      return "behavioral";
    default:
      return "other";
  }
}

/**
 * The classification of one address, kept apart so the honesty rule lives in one function.
 *
 * `unlabeled` means Nansen answered and holds nothing. It is NOT a category and NOT a negative
 * finding. A wallet with no label is shown as `unknown`, never as a zero and never as some default
 * bucket that reads like a judgment.
 */
export type WalletClassification =
  | { status: "labeled"; category: LabelCategory; labels: string[] }
  | { status: "unlabeled"; category: null; labels: [] };

const UNLABELED: WalletClassification = { status: "unlabeled", category: null, labels: [] };

export function classifyLabels(data: NansenLabel[] | undefined): WalletClassification {
  if (!Array.isArray(data) || data.length === 0) return UNLABELED;
  const labels = [
    ...new Set(
      data
        .map((d) => d.label)
        .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
        .map((l) => l.trim()),
    ),
  ];
  // Rows came back but none carried a readable label. Answered with nothing usable is still
  // unlabeled. Inventing a label from an empty row is the exact fabrication this whole build refuses.
  if (labels.length === 0) return UNLABELED;
  const present = new Set(data.map((d) => normalizeCategory(d.category)));
  const category = LABEL_CATEGORY_PRIORITY.find((c) => present.has(c)) ?? "other";
  return { status: "labeled", category, labels };
}

/* ------------------------------------------------------------------ transport and auth */

/** One HTTP exchange. The production version screens through the SSRF guard before it connects. */
export type NansenHttpRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

export type NansenHttpResponse = {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
};

export type NansenTransport = (req: NansenHttpRequest) => Promise<NansenHttpResponse>;

/** What the server said when it answered 402, handed to a payer to turn into a signed header. */
export type X402Challenge = { status: 402; body: unknown; headers: Record<string, string> };

/** Produces the `PAYMENT-SIGNATURE` header value for a challenge. Kept as a seam so the signing
 * key and the facilitator round trip live in the caller, never in this client. */
export type X402Pay = (challenge: X402Challenge) => Promise<string>;

export type NansenAuth =
  | { mode: "apikey"; apiKey: string }
  | { mode: "x402"; payerAddress?: string; pay: X402Pay };

export type NansenResult<T> =
  | { ok: true; data: T; authMode: "apikey" | "x402"; httpStatus: number; paid: boolean }
  | { ok: false; reason: string; authMode: "apikey" | "x402"; httpStatus: number | null };

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Pull a short human reason out of Nansen's error envelope, without inventing one. */
function errorDetail(text: string): string | null {
  const body = safeJson(text);
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const m = b.message ?? b.error;
    if (typeof m === "string" && m.length > 0) return m.slice(0, 200);
  }
  return null;
}

/**
 * Turn one response into a result.
 *
 * A 200 with JSON is the only success. Every other status is an error the caller sees as an error,
 * never a body quietly treated as data. Swallowing a 429 or a 500 into a plausible-looking empty
 * response would publish our own outage as a fact about somebody's wallet, which is the mistake the
 * whole product exists to point at.
 */
function interpret<T>(
  res: NansenHttpResponse,
  authMode: "apikey" | "x402",
  paid: boolean,
): NansenResult<T> {
  if (res.status === 200) {
    const parsed = safeJson(res.bodyText);
    if (parsed === undefined) {
      return { ok: false, reason: "Nansen answered 200 with a body that is not JSON", authMode, httpStatus: 200 };
    }
    return { ok: true, data: parsed as T, authMode, httpStatus: 200, paid };
  }
  const detail = errorDetail(res.bodyText);
  return {
    ok: false,
    reason: `Nansen returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
    authMode,
    httpStatus: res.status,
  };
}

/* ------------------------------------------------------------------ the call */

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Post one profiler request, handling whichever auth mode was chosen.
 *
 * apikey mode is a single request with the `apikey` header. x402 mode posts once. If the server
 * answers 402 it hands the challenge to the payer, then retries with the `PAYMENT-SIGNATURE` header
 * the payer returned. A 402 with no payer to satisfy it is an error rather than a silent unpaid
 * retry. So is a payer that cannot sign.
 */
export async function callNansen<T>(
  path: string,
  body: Record<string, unknown>,
  auth: NansenAuth,
  transport: NansenTransport,
): Promise<NansenResult<T>> {
  const url = `${NANSEN_BASE}${path}`;
  const bodyText = JSON.stringify(body);
  const base: Record<string, string> = { "content-type": "application/json" };

  if (auth.mode === "apikey") {
    if (!auth.apiKey) {
      return { ok: false, reason: "no Nansen apikey provided", authMode: "apikey", httpStatus: null };
    }
    const res = await transport({ url, method: "POST", headers: { ...base, apikey: auth.apiKey }, body: bodyText });
    return interpret<T>(res, "apikey", false);
  }

  const headers = { ...base };
  if (auth.payerAddress) headers["x-payer-address"] = auth.payerAddress;
  const first = await transport({ url, method: "POST", headers, body: bodyText });
  if (first.status !== 402) return interpret<T>(first, "x402", false);

  let signature: string;
  try {
    signature = await auth.pay({ status: 402, body: safeJson(first.bodyText), headers: first.headers });
  } catch (e) {
    return { ok: false, reason: `x402 payment could not be produced: ${msg(e)}`, authMode: "x402", httpStatus: 402 };
  }
  if (!signature) {
    return { ok: false, reason: "x402 payer returned no PAYMENT-SIGNATURE", authMode: "x402", httpStatus: 402 };
  }
  const second = await transport({
    url,
    method: "POST",
    headers: { ...headers, "payment-signature": signature },
    body: bodyText,
  });
  return interpret<T>(second, "x402", true);
}

/** The labels endpoint. apikey path, because Nansen excludes labels from x402. */
export function fetchAddressLabels(
  address: string,
  chain: NansenChain,
  auth: NansenAuth,
  transport: NansenTransport,
): Promise<NansenResult<AddressLabelsResponse>> {
  return callNansen<AddressLabelsResponse>(
    "/api/v1/profiler/address/labels",
    { address, chain },
    auth,
    transport,
  );
}

/** Related wallets. This one accepts x402, so it is where the payment path actually runs. */
export function fetchRelatedWallets(
  address: string,
  chain: NansenChain,
  auth: NansenAuth,
  transport: NansenTransport,
): Promise<NansenResult<RelatedWalletsResponse>> {
  return callNansen<RelatedWalletsResponse>(
    "/api/v1/profiler/address/related-wallets",
    { address, chain },
    auth,
    transport,
  );
}

/* ------------------------------------------------------------------ the enrichment */

/**
 * One address, enriched, in the shape the store keeps.
 *
 * There are three statuses and the split matters. `labeled` is Nansen holding something. `unlabeled` is
 * Nansen answering and holding nothing. `unknown` is us failing to get an answer at all: a rate
 * limit, a 500, a missing key. The page shows the last two the same way, as `unknown`, but the row
 * keeps them apart so a reader can tell "asked, nothing there" from "never got an answer". Folding
 * our own failure into a negative label is the failure this build refuses.
 */
export type WalletEnrichment = {
  address: string;
  chain: NansenChain;
  status: "labeled" | "unlabeled" | "unknown";
  category: LabelCategory | null;
  labels: string[];
  labelCount: number;
  source: string;
  authMode: "apikey" | "x402";
  reason: string;
  httpStatus: number | null;
  checkedAt: string;
};

export const LABELS_SOURCE = "nansen:profiler/address/labels";

/**
 * Fetch and classify one wallet's labels into a row the CLI can write.
 *
 * A failed lookup becomes `unknown` rather than `unlabeled`, because we did not learn that the
 * wallet has no label, we learned that we could not ask. That distinction is the honesty floor.
 */
export async function enrichWallet(
  address: string,
  chain: NansenChain,
  auth: NansenAuth,
  transport: NansenTransport,
  now: () => Date = () => new Date(),
): Promise<WalletEnrichment> {
  const res = await fetchAddressLabels(address, chain, auth, transport);
  const base = {
    address: address.toLowerCase(),
    chain,
    source: LABELS_SOURCE,
    checkedAt: now().toISOString(),
  };

  if (!res.ok) {
    return {
      ...base,
      status: "unknown",
      category: null,
      labels: [],
      labelCount: 0,
      authMode: res.authMode,
      reason: res.reason,
      httpStatus: res.httpStatus,
    };
  }

  const c = classifyLabels(res.data?.data);
  return {
    ...base,
    status: c.status,
    category: c.category,
    labels: c.labels,
    labelCount: c.labels.length,
    authMode: res.authMode,
    reason:
      c.status === "labeled"
        ? `${c.labels.length} label${c.labels.length === 1 ? "" : "s"}, primary category ${c.category}`
        : "Nansen answered and holds no label for this address",
    httpStatus: res.httpStatus,
  };
}
