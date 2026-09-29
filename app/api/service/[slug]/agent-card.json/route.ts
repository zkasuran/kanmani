import { json, problem, SITE } from "@/lib/api.ts";
import { a2aCard, bySlug, CATALOG } from "@/lib/agent-catalog.ts";

export const dynamic = "force-dynamic";

/** The A2A agent card each agent's ERC-8004 registration points its A2A service at. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const c = bySlug(slug);
  if (!c) return problem(404, "No such agent", `Known agents: ${CATALOG.map((x) => x.slug).join(", ")}.`);
  return json(a2aCard(SITE, c), { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
}
