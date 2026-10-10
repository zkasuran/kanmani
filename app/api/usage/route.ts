import { envelope, json } from "@/lib/api.ts";
import { NOT_MEASURED, usage } from "@/lib/usage.ts";

export const dynamic = "force-dynamic";

/**
 * Who uses Kanmani, without tracking anyone. Counts, software names and public chain events only.
 * `?days=` from 1 to 60, default 7. A section that could not be read is null, never zero.
 */
export async function GET(req: Request) {
  const d = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const u = await usage(Number.isFinite(d) ? d : 7);
  return json(
    envelope(
      { ...u, notMeasured: NOT_MEASURED, method: "https://kanmani.xyz/status#usage" },
      "On chain: eth_getLogs on 0xd75f7786…44Fc32, 0x57aF4e4B…f0eaf, 0xB4d641f0…FE3f and 0x1E30531C…19dC24, actor != 0xDB6c…7777. Requests: scripts/usage-aggregate.mjs over the access log.",
    ),
  );
}
