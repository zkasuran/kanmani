import { problem } from "@/lib/api.ts";
import { agent } from "@/lib/queries.ts";
import { resolveEvidence } from "../../../../../verifier/src/ladder/resolve.ts";

export const dynamic = "force-dynamic";

/**
 * The registration document an agent declares, fetched by the server.
 *
 * The studio's "adopt an existing agent" step used to fetch this from the browser, straight from
 * whatever host the agent named. That forced the page's Content-Security-Policy to allow
 * `connect-src https:`, any host on the internet, which is the one directive a script injection
 * would need to exfiltrate. Fetched here instead, the browser only ever talks to this origin and the
 * chain RPCs, so the policy can name them exactly.
 *
 * The caller supplies an agent id, never a URL. The URL is the one the index holds for that agent,
 * so this cannot be pointed at an arbitrary address. The fetch still goes through the verifier's
 * guard: private and metadata addresses refused, DNS pinned, 64 KiB cap, timeout. A `data:` URI is
 * decoded in process.
 *
 * The bytes come back as text/plain with nosniff, whatever the remote host claimed, so a hostile
 * document cannot be rendered as HTML on this origin.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return problem(400, "Not an agent id", "Agent ids are decimal integers.");
  const a = await agent(id);
  if (!a) return problem(404, "No such agent", `Agent ${id} is not in this index.`);
  const uri = a.tokenUri ?? "";
  if (!uri) return problem(404, "No document declared", `Agent ${id} declares no registration document.`);

  const r = await resolveEvidence(uri);
  if (!r.ok) {
    return problem(502, "The document did not resolve", r.reason, {
      uri,
      upstreamStatus: r.status ?? null,
    });
  }
  return new Response(r.bytes as BodyInit, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "x-document-uri": encodeURI(uri).slice(0, 500),
    },
  });
}
