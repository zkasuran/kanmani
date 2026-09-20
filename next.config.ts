import type { NextConfig } from "next";

const config: NextConfig = {
  // Next writes its own AGENTS.md and CLAUDE.md at the repo root on first dev run. Off, for two
  // reasons: `/agents.md` here is a product surface with a specific meaning (the safe-access
  // contract for an agent consuming this site), so a framework file of the same name at the root
  // is a collision; and a root CLAUDE.md would ship to the public repo alongside our own
  // conventions without anyone deciding it should.
  agentRules: false,
  // Every page reads the live index, so nothing here may be captured at build time. A judge
  // opening this during the judging window must see what the database says at that moment, not
  // what it said when the bundle was built.
  //
  // Muster's index froze for five days while its page reported a number that was true when it
  // was written. Rendering per request is half the fix; /status showing its own freshness is the
  // other half.
  experimental: { staleTimes: { dynamic: 0, static: 0 } },
  // The database connection is server-only. Bundling `pg` into a client chunk would fail loudly,
  // which is the correct outcome, but this makes the intent explicit.
  serverExternalPackages: ["pg"],
  async headers() {
    return [
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
