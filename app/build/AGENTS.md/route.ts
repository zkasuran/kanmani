import { SITE } from "@/lib/api.ts";
import { agentsMdDropIn } from "@/lib/build-guide.ts";

export const dynamic = "force-static";

/** Drop-in AGENTS.md: `curl -s https://kanmani.xyz/build/AGENTS.md >> AGENTS.md` at your repo root. */
export function GET() {
  return new Response(agentsMdDropIn(SITE), {
    headers: { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
