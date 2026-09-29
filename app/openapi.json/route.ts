import { SITE } from "@/lib/api.ts";
import { openapi } from "@/lib/openapi.ts";

// Rendered per request, not at build: SITE comes from the server env. A build-time render baked
// the local fallback URL into every link of the published file.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(JSON.stringify(openapi(SITE), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
