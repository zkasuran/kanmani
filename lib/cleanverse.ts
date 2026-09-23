/**
 * Off-chain Cleanverse Verified Identity (CVI) client.
 *
 * The gate on chain (`contracts/src/CleanverseGate.sol`) is the load-bearing check: it calls the real
 * Cleanverse Compliance Validator before any settlement, so a worker cannot be paid without a verified
 * identity. This module is the read the app makes before it ever gets that far, so a UI can show a
 * wallet as cleared, not cleared or not checkable and so a caller is told the reason before spending
 * gas on a settlement that would revert.
 *
 * It calls Verify CVI, `POST /api/cooperate/verify_apass`, documented at docs.cleanverse.com and read
 * on 2026-09-23. That endpoint answers, for a wallet and a Cleanverse Verified Asset (CVA) on a chain,
 * whether the wallet holds a valid CVI and the transfer is allowed. The response carries a `data.code`:
 *
 *   1  CVA not found
 *   2  user does not have a CVI
 *   3  CVI exists but cannot transfer (expired or frozen)
 *   4  success, valid CVI and transfer allowed
 *
 * Three properties this module holds to.
 *
 *  - **Unknown is never false.** A network error, a timeout, a non-success envelope or a `data.code`
 *    the client does not recognise returns `"unknown"`, not `"unverified"`. Unverified is a compliance
 *    answer. Unknown is an operational one. A caller that cannot tell them apart cannot tell a rejected
 *    wallet from an unreachable API and folding the second into the first is how a fail-open bug hides.
 *  - **Fail closed.** Nothing here ever returns `"verified"` unless the API said `data.code === 4` under
 *    a `"0000"` envelope. Every other path is unknown or unverified.
 *  - **SSRF guarded.** The base URL is pinned to an allowlisted Cleanverse host, redirects are refused
 *    rather than followed and the wallet, the token and the chain are validated before the request is
 *    built. The dynamic values travel in the JSON body, never in the URL, so there is no request-target
 *    a caller can steer.
 *
 * The `fetch` and the clock are injected, so the tests drive every branch with no network.
 */

/** What the client concluded. `unknown` is a first-class state, never a stand-in for `unverified`. */
export type CviState = "verified" | "unverified" | "unknown";

export type CviResult = {
  state: CviState;
  /** A short human reason, safe to log. Never carries PII, only the API's own status text. */
  reason: string;
  /** The API's `data.code` when one was read, else null. */
  code: number | null;
};

/** The chains Cleanverse documents for these endpoints. Anything else is rejected before a request. */
const ALLOWED_CHAINS = new Set([
  "solana",
  "base",
  "avalanche",
  "arbitrum",
  "ethereum",
  "polygon",
  "bsc",
  "monad",
  "hashkey",
  "platon",
]);

/** Cleanverse hosts this client will talk to. Pinning the host is the core of the SSRF guard. */
const ALLOWED_HOSTS = new Set(["uatapi.cleanverse.com", "api.cleanverse.com"]);

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const VERIFY_PATH = "/api/cooperate/verify_apass";

/** A `fetch` shaped just enough for what this module needs, so tests can pass a fake. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    redirect: "error";
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type CleanverseConfig = {
  /** The api-id issued by Cleanverse, sent in a plaintext header. Never the api-key, which is only
   *  used for body encryption on other endpoints and is not needed here. */
  apiId: string;
  /** The CVA (atoken) address the transfer would move. Sent as `atoken`. */
  cvaToken: string;
  /** Defaults to the sandbox host. Must be https and on the allowlist. */
  baseUrl?: string;
  /** Defaults to "monad". */
  chain?: string;
  /** Injected for tests. Defaults to the global fetch. */
  fetchImpl?: FetchLike;
  /** Request timeout. Defaults to 8000 ms. A slow API is unknown, not a rejection. */
  timeoutMs?: number;
  /** Injected for tests. Defaults to crypto.randomUUID. */
  requestId?: () => string;
};

/** Thrown for a misconfiguration the caller can fix, never for a compliance outcome. */
export class CleanverseConfigError extends Error {}

function assertConfig(cfg: CleanverseConfig): { base: string; chain: string } {
  if (!cfg.apiId) throw new CleanverseConfigError("apiId is required");
  if (!ADDRESS_RE.test(cfg.cvaToken)) throw new CleanverseConfigError("cvaToken must be a 0x address");
  const chain = (cfg.chain ?? "monad").toLowerCase();
  if (!ALLOWED_CHAINS.has(chain)) throw new CleanverseConfigError(`unsupported chain ${chain}`);

  const base = cfg.baseUrl ?? "https://uatapi.cleanverse.com";
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new CleanverseConfigError(`baseUrl is not a URL: ${base}`);
  }
  if (parsed.protocol !== "https:") throw new CleanverseConfigError("baseUrl must be https");
  if (!ALLOWED_HOSTS.has(parsed.host)) throw new CleanverseConfigError(`host ${parsed.host} is not allowlisted`);
  return { base: parsed.origin, chain };
}

/**
 * Ask Cleanverse whether `address` may receive the configured CVA.
 *
 * Returns one of three states and never throws for a network or API failure, so a caller can branch on
 * the result rather than wrap it in a try. It throws only `CleanverseConfigError` and only for a bad
 * address or a misconfiguration, because those are the caller's bug rather than a compliance answer.
 */
export async function verifyCvi(address: string, cfg: CleanverseConfig): Promise<CviResult> {
  const { base, chain } = assertConfig(cfg);
  if (!ADDRESS_RE.test(address)) throw new CleanverseConfigError("address must be a 0x address");

  const doFetch = cfg.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const newId = cfg.requestId ?? (() => crypto.randomUUID());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 8000);

  let res: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    res = await doFetch(base + VERIFY_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-id": cfg.apiId,
        "x-request-id": newId(),
      },
      body: JSON.stringify({ atoken: cfg.cvaToken, chain, address }),
      redirect: "error",
      signal: controller.signal,
    });
  } catch (err) {
    // A thrown fetch is a transport failure (DNS, timeout, refused redirect). That is unknown.
    return { state: "unknown", reason: `request failed: ${errText(err)}`, code: null };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return { state: "unknown", reason: `http ${res.status}`, code: null };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { state: "unknown", reason: "response was not json", code: null };
  }

  return interpret(body);
}

/** Map a decoded response body to a state. Kept separate so the tests can pin the mapping directly. */
export function interpret(body: unknown): CviResult {
  const env = body as { code?: unknown; data?: unknown };
  if (env?.code !== "0000") {
    // The envelope reports an API-level failure (bad request, auth, rate limit). Not a verdict.
    return { state: "unknown", reason: `envelope code ${String(env?.code)}`, code: null };
  }
  const data = env.data as { code?: unknown; message?: unknown } | undefined;
  const code = typeof data?.code === "number" ? data.code : null;
  const message = typeof data?.message === "string" ? data.message : "";

  if (code === 4) return { state: "verified", reason: message || "valid CVI, transfer allowed", code };
  // 2 (no CVI) and 3 (expired or frozen) are definitive: the wallet is not cleared for this transfer.
  if (code === 2 || code === 3) return { state: "unverified", reason: message || `data.code ${code}`, code };
  // 1 (CVA not found) points at the asset or config, not the wallet, so it is unknown not a rejection.
  if (code === 1) return { state: "unknown", reason: message || "CVA not found", code };
  // Any code the client does not recognise is unknown. It is never treated as a pass.
  return { state: "unknown", reason: `unrecognised data.code ${String(data?.code)}`, code };
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.name === "AbortError" ? "timeout" : err.message;
  return String(err);
}

