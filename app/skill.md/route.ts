import { SITE } from "@/lib/api.ts";
import { skillMd } from "@/lib/build-guide.ts";

// Rendered per request, not at build: SITE comes from the server env. A build-time render baked
// the local fallback URL into every link of the published file.
export const dynamic = "force-dynamic";

/** agentskills.io SKILL.md. Install: save as ~/.claude/skills/kanmani/SKILL.md (or your tool's skills dir). */
export function GET() {
  return new Response(skillMd(SITE), {
    headers: { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
