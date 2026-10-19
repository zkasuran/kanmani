/**
 * Crawlers this site asks to stay away, and the pause it asks of the rest.
 *
 * These are backlink, SEO and data-resale scrapers. On 14 and 19 October the database timed out under a
 * burst of dynamic `/agent/<id>` requests, and the access log shows one of them (SERankingBacklinksBot,
 * one address, 177 requests in ten minutes) beside Googlebot. The page was the real problem and is fixed.
 * Asking these to leave costs a reader nothing, because none of them is a reader.
 *
 * Never list a search engine or an AI agent here. The site is meant to be found and to be read by machines.
 */
export const BLOCKED_CRAWLERS: readonly string[] = [
  "SERankingBacklinksBot",
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "BLEXBot",
  "DataForSeoBot",
  "Bytespider",
  "PetalBot",
];

/** Seconds a well-behaved crawler is asked to wait between requests. Googlebot ignores it, which is fine. */
export const CRAWL_DELAY_SECONDS = 5;

/** Engines and agents that must always be allowed. A test holds the blocked list against this one. */
export const ALWAYS_ALLOWED: readonly string[] = ["Googlebot", "Bingbot", "DuckDuckBot", "GPTBot", "ClaudeBot", "PerplexityBot", "OAI-SearchBot"];
