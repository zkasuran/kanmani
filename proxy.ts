import { NextResponse, type NextRequest } from "next/server";

/**
 * A generous per-IP flood guard.
 *
 * The site is public and does real work per request: a fetch on somebody else's server, an RPC call,
 * a scan of the index. None of it is rate limited by anything else, so a single client can hold the
 * eight-connection pool open with cheap repeated requests. This is the outer bound that stops that.
 *
 * It is deliberately loose. A judge browsing, the half-hourly anonymous canary and an agent polling
 * the machine surfaces all sit far under the ceiling. Only a flood trips it, and it trips with a 429
 * and a Retry-After rather than a silent drop, so a well-behaved client backs off and a browser shows
 * a real status. In-memory on purpose: the app is one long-lived process, and the token's own limits
 * plus the database statement_timeout are the durable backstops. A limiter is not a security boundary
 * on its own, it is a courtesy that keeps one caller from starving the rest.
 *
 * This is Next's "proxy" convention (formerly "middleware"), so it runs before every matched route.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 600;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function proxy(req: NextRequest): NextResponse {
  // A CORS preflight carries no work and must not be counted, or a browser client burns its budget
  // on the OPTIONS that precedes every cross-origin POST.
  if (req.method === "OPTIONS") return NextResponse.next();

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

  if (b.count > MAX_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return new NextResponse(
      JSON.stringify({ error: "rate limited", detail: "Too many requests. Slow down and retry.", retryAfterSeconds: retryAfter }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfter) } },
    );
  }
  return NextResponse.next();
}

// Everything except Next's own static assets, which are cheap and served without touching the pool.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
