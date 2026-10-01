import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { cardFigures, cardLine } from "@/lib/og-card.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const W = 1200;
const H = 630;

let assets: Promise<{ base: string; mono: Buffer }> | null = null;
function load() {
  assets ??= (async () => {
    const dir = join(process.cwd(), "lib", "og");
    const [png, mono] = await Promise.all([readFile(join(dir, "base.png")), readFile(join(dir, "DejaVuSansMono.ttf"))]);
    return { base: `data:image/png;base64,${png.toString("base64")}`, mono };
  })();
  return assets;
}

/** The shared-link card: the original design with the figures line drawn from live data. */
export async function GET() {
  const [{ base, mono }, f] = await Promise.all([load(), cardFigures()]);
  const res = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative" }}>
        <img src={base} width={W} height={H} alt="" style={{ position: "absolute", left: 0, top: 0 }} />
        <div
          style={{
            position: "absolute",
            left: 66,
            top: 535,
            fontFamily: "Mono",
            fontSize: 22,
            lineHeight: 1.2,
            color: "rgb(148,163,184)",
            whiteSpace: "nowrap",
          }}
        >
          {cardLine(f)}
        </div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "Mono", data: mono, weight: 400, style: "normal" }] },
  );
  // Short enough that the card follows the hourly sweep, long enough that a burst of shares is one render.
  res.headers.set("cache-control", f ? "public, max-age=900, s-maxage=900" : "no-store");
  return res;
}
