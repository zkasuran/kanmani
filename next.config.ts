import type { NextConfig } from "next";

const config: NextConfig = {
  // Next writes its own AGENTS.md and CLAUDE.md at the repo root on first dev run. Off, for two
  // reasons: `/agents.md` here is a product surface with a specific meaning (the safe-access
  // contract for an agent consuming this site), so a framework file of the same name at the root
  // is a collision; and a root CLAUDE.md would ship to the public repo alongside our own
  // conventions without anyone deciding it should.
  agentRules: false,
  // Every page reads the live index, so nothing here may be captured at build time. `next build`
  // confirms that rather than this comment asserting it: every route reports as dynamic and the
  // only static one is /_not-found.
  //
  // `staleTimes.dynamic: 0` is the load-bearing half. It stops the client router serving a cached
  // render when a judge clicks between pages, which would show a number from thirty seconds ago
  // with nothing on screen saying so. `static` sits at its floor of 30 because the only static
  // route here is the 404, and Next refuses anything lower.
  //
  // Muster's index froze for five days while its page reported a number that was true when it
  // was written. Rendering per request is half the fix; /status showing its own freshness is the
  // other half.
  experimental: { staleTimes: { dynamic: 0, static: 30 } },
  // The database connection is server-only. Bundling `pg` into a client chunk would fail loudly,
  // which is the correct outcome, but this makes the intent explicit.
  serverExternalPackages: ["pg"],
  async headers() {
    // Security headers on every response. The CSP is deliberately permissive on script and style
    // sources ('unsafe-inline' plus self), because Next's hydration bootstrap and Tailwind's inline
    // styles need it and a nonce pipeline is not wired here. The value it does add is real: object,
    // base-uri, frame-ancestors and form-action are locked down, so an injected tag cannot load a
    // plugin, rewrite the base href, frame the site for clickjacking or retarget a form. The XSS
    // surface is already small (no reflected user input, the one dangerouslySetInnerHTML is a static
    // string, embed.js renders through textContent in a closed shadow root), so this is defence in
    // depth rather than the only guard.
    const csp = [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https:",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; ");
    const security = [
      { key: "content-security-policy", value: csp },
      { key: "x-content-type-options", value: "nosniff" },
      { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
      { key: "x-frame-options", value: "SAMEORIGIN" },
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
