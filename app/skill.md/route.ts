import { SITE } from "@/lib/api.ts";
import { skillMd } from "@/lib/build-guide.ts";

export const dynamic = "force-static";

/** agentskills.io SKILL.md. Install: save as ~/.claude/skills/kanmani/SKILL.md (or your tool's skills dir). */
export function GET() {
  return new Response(skillMd(SITE), {
    headers: { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
