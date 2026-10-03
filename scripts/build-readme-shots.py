#!/usr/bin/env python3
"""
The README's product screenshots, captured from the running site rather than drawn.

The README carries hand-made SVG diagrams for the ideas and these two PNGs for the product itself,
so a reader can see that the site renders before they click anything. Both are the same viewport in
the two GitHub themes, which is why the README wraps them in a <picture>.

    npm run build && npx next start -p 3471
    python3 scripts/build-readme-shots.py                    # against 127.0.0.1:3471
    SHOT_URL=https://kanmani.xyz python3 scripts/build-readme-shots.py

Theme comes from `prefers-color-scheme`, because the switch stores nothing until a reader touches
it (components/theme-toggle.tsx) and the layout only sets `data-theme` from storage. Motion is
reduced for the capture so every reveal is already at its finished frame and the shot is
deterministic instead of depending on how fast the machine painted.

Output: public/readme/screenshot-light.png, public/readme/screenshot-dark.png
"""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "public" / "readme"
URL = os.environ.get("SHOT_URL", "http://127.0.0.1:3471")

# 1360 is the wide breakpoint the house gate checks. 2x so the PNG stays sharp on a retina reader,
# then halved on the way out, which is what keeps the file under the README's size ceiling.
#
# The height stops just above the hero's stat row on purpose. Those tiles read the live population
# and the test total, both of which move. A shot of them would start disagreeing with the README's
# own figures the next day. The nav, the headline and the two actions are the part worth
# showing: they prove the site renders.
WIDTH, HEIGHT, SCALE = 1360, 630, 2
CEILING_BYTES = 500 * 1024


def shrink(raw: bytes, path: Path) -> int:
    """Down to 1x and through PNG quantisation until it fits, reporting what it took."""
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    img = img.resize((img.width // SCALE, img.height // SCALE), Image.LANCZOS)
    for colours in (0, 256, 192, 128, 96):
        out = img if colours == 0 else img.quantize(colors=colours, method=Image.MEDIANCUT)
        buf = io.BytesIO()
        out.save(buf, format="PNG", optimize=True)
        if buf.tell() <= CEILING_BYTES or colours == 96:
            path.write_bytes(buf.getvalue())
            return buf.tell()
    raise AssertionError("unreachable")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ("light", "dark"):
            ctx = browser.new_context(
                viewport={"width": WIDTH, "height": HEIGHT},
                device_scale_factor=SCALE,
                color_scheme=theme,
                reduced_motion="reduce",
            )
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(f"{theme} console {m.type}: {m.text}")
                    if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"{theme} pageerror: {e}"))
            page.goto(URL, wait_until="networkidle", timeout=90_000)
            page.wait_for_timeout(1_500)
            raw = page.screenshot(type="png")
            size = shrink(raw, OUT / f"screenshot-{theme}.png")
            print(f"public/readme/screenshot-{theme}.png  {size / 1024:.0f} KB")
            ctx.close()
        browser.close()
    for e in errors:
        print(e, file=sys.stderr)
    if errors:
        sys.exit(f"{len(errors)} console or page errors during capture")


if __name__ == "__main__":
    main()
