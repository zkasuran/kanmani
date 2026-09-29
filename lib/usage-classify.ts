/**
 * How a request is counted: which surface it hit, what kind of client made it plus which integrator
 * name (if any) it carries. Pure, shared by the log aggregator and the tests, so the rules are tested
 * rather than described.
 *
 * Nothing here returns a person. The outputs are a surface name, a class and a software or site name.
 */

export type ClientClass = "browser" | "crawler" | "software";

/** Search and AI crawlers, uptime monitors, SEO tools, scanners. Indexing is not use. */
const CRAWLER =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|preview|monitor|uptime|ahrefs|semrush|mj12|bytespider|claudebot|gptbot|perplexity|anthropic-ai|amazonbot|applebot|yandex|petalbot|dataforseo|censys|zgrab|nuclei|masscan|cve-|scanner|headlesschrome|playwright|puppeteer|lighthouse/i;

export function classify(userAgent: string): ClientClass {
  const u = userAgent || "";
  if (CRAWLER.test(u)) return "crawler";
  // A real browser: Mozilla plus an engine token. Scripts that fake "Mozilla" alone stay software.
  if (/^Mozilla\/5\.0/.test(u) && /(AppleWebKit|Gecko\/|Firefox\/)/.test(u)) return "browser";
  return "software";
}

/** The surface a path belongs to. Null for assets that say nothing about use. */
export function surface(method: string, rawPath: string): string | null {
  const p = rawPath.split("?")[0]!;
  if (/^\/_next\/|^\/brand\/|\.(png|jpe?g|svg|ico|css|woff2?|map|webp|txt\.gz)$/.test(p) || p === "/favicon.ico" || p === "/icon.svg") return null;
  if (p === "/sitemap.xml" || p === "/robots.txt") return null;
  const table: [RegExp, string][] = [
    [/^\/api\/registration\/check$/, "build:registration"],
    [/^\/api\/evidence\/check$/, "build:evidence"],
    [/^\/mcp$/, "mcp"],
    [/^\/skill\.md$/, "skill.md"],
    [/^\/build\/AGENTS\.md$/, "build:agents.md"],
    [/^\/openapi\.json$/, "openapi"],
    [/^\/\.well-known\//, "well-known"],
    [/^\/embed\.js$/, "embed"],
    [/^\/api\/service\//, method === "POST" ? "api:service:call" : "api:service:read"],
    [/^\/api\/verify$/, method === "POST" ? "api:verify:call" : "api:verify:read"],
    [/^\/api\/agent\//, "api:agent"],
    [/^\/api\/account\//, "api:account"],
    [/^\/api\/claims$/, "api:claims"],
    [/^\/api\/sla\//, "api:sla"],
    [/^\/api\/usage$/, "api:usage"],
    [/^\/api\/webhooks\//, "webhook"],
    [/^\/api\//, "api:other"],
    [/^\/feed\.json$/, "feed"],
    [/^\/llms\.txt$/, "llms.txt"],
    [/^\/agents\.md$/, "agents.md"],
    [/^\/schema\.json$/, "schema"],
  ];
  for (const [re, name] of table) if (re.test(p)) return name;
  // Probes for software we do not run (wp-admin, .env, phpmyadmin) are not use of Kanmani.
  if (/wp-|\.php$|\.env|\/\.git|phpmyadmin|\/cgi-bin|\/admin\b/i.test(p)) return null;
  return "page";
}

/** Surfaces a program uses, as opposed to a person reading a page. */
export const MACHINE_SURFACES = new Set([
  "build:registration", "build:evidence", "mcp", "skill.md", "build:agents.md", "openapi", "well-known",
  "embed", "api:service:call", "api:service:read", "api:verify:call", "api:verify:read", "api:agent",
  "api:account", "api:claims", "api:sla", "feed", "llms.txt", "agents.md", "schema",
]);

/**
 * The product name a tool announces, e.g. "taifoon-probe/2 (+https://...)" -> "taifoon-probe".
 * Only for software calling machine surfaces. Generic HTTP libraries are not named: "curl" or
 * "node" says nothing about who integrated.
 */
export function toolName(userAgent: string): string | null {
  const m = (userAgent || "").trim().match(/^([A-Za-z][A-Za-z0-9._-]{1,40})\//);
  if (!m) return null;
  const n = m[1]!.toLowerCase();
  if (/^(mozilla|curl|wget|node|undici|axios|python-urllib|python-requests|python-httpx|aiohttp|go-http-client|okhttp|java|libwww-perl|ruby|deno|bun|postmanruntime|insomnia|httpie|guzzlehttp|dart|reqwest)$/.test(n)) return null;
  return n;
}

/** A site that loads our embed or calls our API from its pages: the Referer or Origin host, not ours. */
export function embedHost(referer: string | undefined, origin: string | undefined): string | null {
  for (const v of [origin, referer]) {
    if (!v) continue;
    try {
      const h = new URL(v).hostname.toLowerCase();
      if (!h || h === "kanmani.xyz" || h.endsWith(".kanmani.xyz") || h === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(h)) continue;
      // Search engines and social sites refer readers; they do not integrate.
      if (/(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|t\.co|twitter|x|facebook|linkedin|reddit|github|youtube)\.[a-z.]+$/.test(h) || h === "t.co") continue;
      return h;
    } catch {
      /* not a URL */
    }
  }
  return null;
}

/** MCP clientInfo.name, cleaned to a short product name. */
export function mcpClientName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.trim().toLowerCase().replace(/[^a-z0-9._ -]/g, "").slice(0, 48);
  return n || null;
}
