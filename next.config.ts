import type { NextConfig } from "next";

const config: NextConfig = {
  // Next writes its own AGENTS.md and CLAUDE.md at the repo root on first dev run. Off, for two
  // reasons: `/agents.md` here is a product surface with a specific meaning (the safe-access
  // contract for an agent consuming this site), so a framework file of the same name at the root
  // is a collision; and a root CLAUDE.md would ship to the public repo alongside our own
  // conventions without anyone deciding it should.
  agentRules: false,
  // `x-powered-by: Next.js` names the framework and its rough version band on every response, which
  // is free reconnaissance for anyone scanning for a known framework bug. Nothing needs it.
  poweredByHeader: false,
  // Every page reads the live index, so nothing here may be captured at build time. `next build`
  // confirms that rather than this comment asserting it: every route reports as dynamic and the
  // only static one is /_not-found.
  //
  // `staleTimes.dynamic: 0` is the load-bearing half. It stops the client router serving a cached
  // render when a judge clicks between pages, which would show a number from thirty seconds ago
  // with nothing on screen saying so. `static` sits at its floor of 30 because the only static
  // route here is the 404 and Next refuses anything lower.
  //
  // Muster's index froze for five days while its page reported a number that was true when it
  // was written. Rendering per request is half the fix; /status showing its own freshness is the
  // other half.
  experimental: { staleTimes: { dynamic: 0, static: 30 } },
  // The database connection is server-only. Bundling `pg` into a client chunk would fail loudly,
  // which is the correct outcome, but this makes the intent explicit.
  serverExternalPackages: ["pg"],
  async headers() {
    // Security headers on every response. The Content-Security-Policy is NOT here: it carries a fresh
    // nonce per request, so proxy.ts builds it. A static one here would be sent beside it and both
    // would be enforced.
    const security = [
      { key: "x-content-type-options", value: "nosniff" },
      // HSTS. `upgrade-insecure-requests` in the per-request CSP rewrites mixed content but does not
      // stop an SSL-strip on the first navigation; this does, and `preload` covers the very first
      // visit. The half-hourly canary already asserts this header, so once set it stays monitored.
      { key: "strict-transport-security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
      // DENY, not SAMEORIGIN. Nothing here is ever framed: the badge in app/embed.js/route.ts
      // injects a shadow-DOM span into the host page rather than an iframe, and the repo contains
      // no iframe at all. So same-origin framing buys nothing and leaves a clickjacking surface.
      // The matching `frame-ancestors 'none'` is in the per-request CSP in proxy.ts.
      { key: "x-frame-options", value: "DENY" },
      { key: "permissions-policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];
    return [
      {
        // Security headers apply to everything the site serves.
        source: "/:path*",
        headers: security,
      },
      {
        // The machine-readable surfaces exist to be consumed by somebody else's agent, so they
        // say so. Without this an agent fetching /feed.json from a browser context is blocked by
        // the same-origin policy and the whole point of publishing it is lost.
        source: "/:path(llms.txt|agents.md|feed.json|schema.json|sitemap.xml)",
        headers: [{ key: "access-control-allow-origin", value: "*" }],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "access-control-allow-origin", value: "*" },
          { key: "access-control-allow-headers", value: "content-type, x-payment" },
          { key: "access-control-allow-methods", value: "GET, POST, OPTIONS" },
          // x402 carries its challenge and its receipt in headers, so a browser client has to be
          // able to read them back.
          { key: "access-control-expose-headers", value: "x-payment-response, www-authenticate" },
        ],
      },
    ];
  },
};

export default config;
