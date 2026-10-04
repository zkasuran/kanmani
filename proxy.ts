import chainTable from "./shared/erc8004-chains.json" with { type: "json" };
import { NextResponse, type NextRequest } from "next/server";

/**
 * A generous per-IP flood guard.
 *
 * The site is public and does real work per request: a fetch on somebody else's server, an RPC call,
 * a scan of the index. None of it is rate limited by anything else, so a single client can hold the
 * eight-connection pool open with cheap repeated requests. This is the outer bound that stops that.
 *
 * It is deliberately loose. A judge browsing, the half-hourly anonymous canary and an agent polling
 * the machine surfaces all sit far under the ceiling. Only a flood trips it. It trips with a 429
 * and a Retry-After rather than a silent drop, so a well-behaved client backs off and a browser shows
 * a real status. In-memory on purpose: the app is one long-lived process. The token's own limits
 * plus the database statement_timeout are the durable backstops. A limiter is not a security boundary
 * on its own, it is a courtesy that keeps one caller from starving the rest.
 *
 * This is Next's "proxy" convention (formerly "middleware"), so it runs before every matched route.
 */
/**
 * The Content-Security-Policy, built per request with a fresh nonce.
 *
 * `script-src` allows only scripts carrying this response's nonce plus whatever those scripts load
 * (`'strict-dynamic'`). It used to be `'self' 'unsafe-inline'`, which let any injected inline script
 * run. That mattered more once passkey keys lived in page memory: an inline injection could have read
 * them. Next stamps the nonce on its own bootstrap scripts when it finds it in the CSP of the request,
 * and the layout stamps it on the one inline script we write (the theme, before first paint).
 *
 * `style-src` keeps `'unsafe-inline'`. Tailwind and React write inline style attributes. A style
 * cannot run code, so the residual risk there is layout defacement rather than key theft.
 *
 * `frame-ancestors 'none'` refuses framing outright, matching `x-frame-options: DENY` in
 * next.config.ts. The trust badge reaches a host page as a shadow-DOM span written by embed.js, not
 * as an iframe, so nothing legitimate frames this site.
 */
/**
 * Every host the browser opens a connection to, by name. These are the public chain RPCs the studio
 * and the session read through viem, taken from shared/erc8004-chains.json so a chain added there is
 * not silently blocked here. Anything an agent declares (its registration document, its endpoints)
 * is fetched by the server through the SSRF guard, never by the page, so no wildcard is needed.
 * A script injection that got past the nonce could still read the page, but could not post what it
 * read anywhere but these.
 */
export const CONNECT_HOSTS: readonly string[] = [
  ...new Set(
    (chainTable as { chains?: { publicRpc?: string | null }[] }).chains
      ?.map((c) => c.publicRpc)
      .filter((u): u is string => typeof u === "string" && u.startsWith("https://"))
      .map((u) => new URL(u).origin) ?? [],
  ),
];

export function contentSecurityPolicy(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    "img-src 'self' data: https:",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${CONNECT_HOSTS.join(" ")}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** 16 random bytes, base64. Fresh per request: a nonce that repeats is a password printed on the page. */
function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 600;
/**
 * The free build checks do real work per call (RPC reads, a gas estimate, a cross-chain search) and
 * are the endpoints a looping coding agent will hammer. 60 a minute is far above a builder iterating
 * on a draft and far below what would starve the RPC budget for everyone else.
 */
const BUILD_PATHS = /^\/(api\/registration\/check|api\/evidence\/check|mcp)$/;
const MAX_BUILD_PER_WINDOW = 60;
const buildBuckets = new Map<string, Bucket>();
/**
 * The keyed cross-chain funding routes each spend a real Aurora Intents Connect call and share one
 * account key. A judge clicking through the flow is far under 20 a minute; a loop trips it. The GET
 * status read is cheap and keyless, so it rides the general limit. The durable cap is Aurora's own key limit.
 */
const FUND_PATHS = /^\/api\/fund\/(quote|create|submit)$/;
const MAX_FUND_PER_WINDOW = 20;
const fundBuckets = new Map<string, Bucket>();

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
/**
 * Router prefetches get their own bucket, the same size as the general one.
 *
 * Next prefetches every link that scrolls into view, so a reader who does nothing but read a long
 * page spends requests without asking for anything. Measured on the canary: a third of one client's
 * traffic was prefetches, median 1 KB and 18 ms each, and counting them against the general limit is
 * what tripped a 429 at 525 requests a minute. They are not exempt, because the header is client
 * controlled: forging it buys a second allowance of the same size, never an unbounded one.
 */
const prefetchBuckets = new Map<string, Bucket>();
const isPrefetch = (req: NextRequest) => req.headers.get("next-router-prefetch") !== null;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function proxy(req: NextRequest): NextResponse {
  // A CORS preflight carries no work and must not be counted. Otherwise a browser client burns its budget
  // on the OPTIONS that precedes every cross-origin POST.
  if (req.method === "OPTIONS") return NextResponse.next();
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const now = Date.now();
  const ip = clientIp(req);
  const pool = isPrefetch(req) ? prefetchBuckets : buckets;
  let b = pool.get(ip);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    pool.set(ip, b);
  }
  b.count++;

  // Opportunistic sweep so the map cannot grow without bound.
  for (const m of [buckets, prefetchBuckets]) {
    if (m.size > 20_000) for (const [k, v] of m) if (now >= v.resetAt) m.delete(k);
  }

  if (req.method === "POST" && BUILD_PATHS.test(req.nextUrl.pathname)) {
    let bb = buildBuckets.get(ip);
    if (!bb || now >= bb.resetAt) {
      bb = { count: 0, resetAt: now + WINDOW_MS };
      buildBuckets.set(ip, bb);
    }
    if (++bb.count > MAX_BUILD_PER_WINDOW) {
      const retryAfter = Math.max(1, Math.ceil((bb.resetAt - now) / 1000));
      return new NextResponse(
        JSON.stringify({ error: "rate limited", detail: `The free build checks allow ${MAX_BUILD_PER_WINDOW} calls a minute per client. Retry after the given seconds.`, retryAfterSeconds: retryAfter }),
        { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfter) } },
      );
    }
    if (buildBuckets.size > 20_000) for (const [k, v] of buildBuckets) if (now >= v.resetAt) buildBuckets.delete(k);
  }

  if (req.method === "POST" && FUND_PATHS.test(req.nextUrl.pathname)) {
    let fb = fundBuckets.get(ip);
    if (!fb || now >= fb.resetAt) {
      fb = { count: 0, resetAt: now + WINDOW_MS };
      fundBuckets.set(ip, fb);
    }
    if (++fb.count > MAX_FUND_PER_WINDOW) {
      const retryAfter = Math.max(1, Math.ceil((fb.resetAt - now) / 1000));
      return new NextResponse(
        JSON.stringify({ error: "rate limited", detail: `The cross-chain funding routes allow ${MAX_FUND_PER_WINDOW} calls a minute per client. Retry after the given seconds.`, retryAfterSeconds: retryAfter }),
        { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfter) } },
      );
    }
    if (fundBuckets.size > 20_000) for (const [k, v] of fundBuckets) if (now >= v.resetAt) fundBuckets.delete(k);
  }

  if (b.count > MAX_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return new NextResponse(
      JSON.stringify({ error: "rate limited", detail: "Too many requests. Slow down and retry.", retryAfterSeconds: retryAfter }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfter) } },
    );
  }
  // The nonce travels to the render on the REQUEST (Next reads the CSP there to stamp its scripts and
  // the layout reads x-nonce) and to the browser on the RESPONSE, where it is enforced.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

// Everything except Next's own static assets, which are cheap and served without touching the pool.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
