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
 */
export function contentSecurityPolicy(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    "img-src 'self' data: https:",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
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

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

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
  let b = buckets.get(ip);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, b);
  }
  b.count++;

  // Opportunistic sweep so the map cannot grow without bound.
  if (buckets.size > 20_000) {
    for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
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
