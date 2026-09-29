import { SITE } from "@/lib/api.ts";
import { openapi } from "@/lib/openapi.ts";

export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(openapi(SITE), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
