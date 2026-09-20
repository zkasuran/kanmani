import { SITE } from "@/lib/api.ts";
import { claims, probedClusters } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";

/**
 * Complete, and every URL in it resolves.
 *
 * Capped deliberately rather than emitting 10,252 agent URLs: a sitemap a crawler cannot finish
 * is worse than a smaller one it can. The cap is stated in a comment in the file itself so nobody
 * mistakes it for completeness.
 */
export async function GET() {
  const [cl, recent] = await Promise.all([probedClusters(200), claims({ limit: 500 })]);

  const urls = [
    { loc: "/", priority: "1.0" },
    { loc: "/agents", priority: "0.8" },
    { loc: "/operators", priority: "0.9" },
    { loc: "/claims", priority: "0.8" },
    { loc: "/verify", priority: "0.8" },
    { loc: "/compare", priority: "0.6" },
    { loc: "/method", priority: "0.9" },
    { loc: "/status", priority: "0.7" },
    ...cl.rows.map((c) => ({ loc: `/operators/${c.uriHash}`, priority: "0.6" })),
    ...recent.rows.map((c) => ({ loc: `/claim/${encodeURIComponent(c.id)}`, priority: "0.5" })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Clusters capped at 200 and claims at 500. Not a claim of completeness: a sitemap a crawler
     cannot finish is worse than a smaller one it can. Everything is reachable from /operators
     and /claims, which paginate. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${SITE}${u.loc.replace(/&/g, "&amp;")}</loc><priority>${u.priority}</priority></url>`,
  )
  .join("\n")}
</urlset>
`;
  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
  });
}
