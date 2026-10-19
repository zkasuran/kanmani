import type { MetadataRoute } from "next";
import { BLOCKED_CRAWLERS, CRAWL_DELAY_SECONDS } from "../lib/crawlers.ts";

/**
 * What a crawler may do here.
 *
 * Search engines and AI agents are welcome: the site exists to be read, and /llms.txt, /feed.json and the
 * API are written for machines. What is turned away is the backlink and SEO scrapers (see
 * lib/crawlers.ts). They fetch hundreds of dynamic agent pages for no reader, and each page costs real
 * database time. Everyone else is asked to wait between requests. A crawl delay is a request and not an
 * enforcement, which is why the pages themselves were also made cheap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", crawlDelay: CRAWL_DELAY_SECONDS },
      { userAgent: [...BLOCKED_CRAWLERS], disallow: "/" },
    ],
    sitemap: "https://kanmani.xyz/sitemap.xml",
  };
}
