#!/usr/bin/env python3
"""
Build the logo and the media package.

## What is drawn and what is generated

The mark is drawn, not generated. It is five rungs rising left to right, the one idea the product rests
on and it has to stay legible at 16px in a browser tab where an image model's output turns to mush. It
is also the one asset that must be identical everywhere, so it comes from a single 32-unit geometry that
both the SVG and every raster size share.

MiniMax generates backdrops only and never type. Image models render text as convincing garbage and
the one thing a social card cannot get wrong is the product name.

## Sizes and why each exists

  favicon 16/32/48   browser tabs, where the mark is 11 pixels of line and nothing else survives
  180                apple-touch-icon, the only size iOS reads
  512                PWA and GitHub org avatar
  1200x630           Open Graph, the size every social preview crops toward
  1280x640           README banner
  1500x500           X header

Usage: MINIMAX_API_KEY=... python3 scripts/build-media.py
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
BRAND = ROOT / "public" / "brand"
PUB.mkdir(exist_ok=True)
BRAND.mkdir(parents=True, exist_ok=True)

INK = (5, 7, 10)
TEXT = (232, 240, 250)
MUTED = (148, 163, 184)
GREEN = (52, 211, 153)

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# The single source of the mark. Both the SVG and every raster below read these points, so the logo
# cannot drift between a favicon and a header the way two hand-drawn copies would.
GRID = 32
LADDER = [(5, 25), (10, 25), (10, 21), (15, 21), (15, 17), (20, 17), (20, 13), (25, 13), (25, 9), (27, 9)]
NODE = (27, 9, 2.2)


def svg(stroke: str = "#34d399", bg: str = "#05070a", rounded: bool = True) -> str:
    d = "M" + "L".join(f"{x} {y}" for x, y in LADDER)
    rect = f'<rect width="{GRID}" height="{GRID}" rx="7" fill="{bg}"/>' if rounded else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {GRID} {GRID}" role="img" aria-label="Kanmani">\n'
        f"  {rect}\n"
        f'  <path d="{d}" fill="none" stroke="{stroke}" stroke-width="2.1" stroke-linecap="square"/>\n'
        f'  <circle cx="{NODE[0]}" cy="{NODE[1]}" r="{NODE[2]}" fill="{stroke}"/>\n'
        f"</svg>\n"
    )


# At 16px a five-rung ladder is about two pixels per rung and reads as a smudge, which the first pass
# proved by eye. Small sizes get three rungs and a heavier stroke filling more of the canvas: the same
# idea at lower resolution, which is what a favicon is for. This is the normal reason a mark has a
# simplified variant rather than a scaled one.
LADDER_SMALL = [(5, 26), (13, 26), (13, 18), (21, 18), (21, 10), (27, 10)]
NODE_SMALL = (27, 10, 3.0)


def raster(size: int, transparent: bool = False, pad: float = 0.0) -> Image.Image:
    """Render at 4x then downsample, because a 16px mark drawn directly has ragged joins."""
    ss = 4
    big = size * ss
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0) if transparent else INK + (255,))
    d = ImageDraw.Draw(im)
    inset = big * pad
    k = (big - inset * 2) / GRID
    small = size <= 48
    path = LADDER_SMALL if small else LADDER
    node = NODE_SMALL if small else NODE
    pts = [(inset + x * k, inset + y * k) for x, y in path]
    d.line(pts, fill=GREEN, width=max(int((3.4 if small else 2.1) * k), 1), joint="curve")
    r = node[2] * k
    cx, cy = inset + node[0] * k, inset + node[1] * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    return im.resize((size, size), Image.LANCZOS)


def generate(prompt: str, ratio: str, dest: Path, key: str) -> bool:
    body = json.dumps(
        {
            "model": "image-01",
            "prompt": f"{prompt}, deep near-black navy background, one thin emerald line, fine faint grid, "
            "flat vector, generous negative space, technical and calm, no text, no words, no letters, no logos",
            "aspect_ratio": ratio,
            "n": 1,
            "prompt_optimizer": False,
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.minimax.io/v1/image_generation",
        data=body,
        headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.load(r)
    except Exception as e:  # noqa: BLE001
        print(f"    generate failed: {e}")
        return False
    if (d.get("base_resp") or {}).get("status_code") != 0:
        print(f"    generate refused: {d.get('base_resp')}")
        return False
    urls = ((d.get("data") or {}).get("image_urls")) or []
    if not urls:
        return False
    urllib.request.urlretrieve(urls[0], dest)
    return True


def live_sub() -> str:
    """Numbers come off our own feed, so a card cannot quote a figure the site contradicts."""
    try:
        with urllib.request.urlopen("https://kanmani.xyz/feed.json", timeout=25) as r:
            sm = (json.load(r).get("data") or {}).get("summary") or {}
        if sm.get("paymentClaims") and sm.get("doNotResolve") is not None:
            return f"kanmani.xyz  ·  {sm['paymentClaims']} payment claims checked, {sm['doNotResolve']} did not resolve"
    except Exception as e:  # noqa: BLE001
        print(f"    live figures unavailable ({e})")
    return "kanmani.xyz"


def card(src: Path, dest: Path, size: tuple, tag: str, title: str, sub: str, logo: bool = True) -> None:
    base = Image.new("RGBA", size, INK + (255,))
    if src.exists():
        art = ImageEnhance.Brightness(Image.open(src).convert("RGBA")).enhance(1.9)
        f = max(size[0] / art.width, size[1] / art.height)
        art = art.resize((int(art.width * f) + 1, int(art.height * f) + 1), Image.LANCZOS)
        base.alpha_composite(art, ((size[0] - art.width) // 2, (size[1] - art.height) // 2))

    # One gradient over the full height. An earlier version started a third of the way down and left a
    # hard seam across the middle of every card.
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for i in range(size[1]):
        ld.line([(0, i), (size[0], i)], fill=(5, 7, 10, int(18 + 224 * (i / size[1]) ** 2.1)))
    base.alpha_composite(layer)

    d = ImageDraw.Draw(base)
    pad = int(size[0] * 0.055)
    f_tag = ImageFont.truetype(MONO, max(int(size[1] * 0.034), 11))
    f_title = ImageFont.truetype(SANS_B, max(int(size[1] * 0.095), 16))
    f_sub = ImageFont.truetype(MONO, max(int(size[1] * 0.035), 10))

    x = pad
    if logo:
        m = raster(int(size[1] * 0.085), transparent=True)
        base.alpha_composite(m, (pad, pad - int(m.height * 0.18)))
        x = pad + m.width + int(size[0] * 0.014)
    d.text((x, pad), tag, font=f_tag, fill=GREEN)

    words, lines, cur = title.split(), [], ""
    for w in words:
        t = f"{cur} {w}".strip()
        if d.textlength(t, font=f_title) > size[0] - pad * 2:
            lines.append(cur)
            cur = w
        else:
            cur = t
    lines.append(cur)

    lh = int(size[1] * 0.11)
    rule_y = size[1] - pad - int(size[1] * 0.08)
    y = rule_y - int(size[1] * 0.02) - lh * len(lines)
    for ln in lines:
        d.text((pad, y), ln, font=f_title, fill=TEXT)
        y += lh
    d.line([(pad, rule_y), (pad + int(size[0] * 0.055), rule_y)], fill=GREEN, width=3)
    d.text((pad, size[1] - pad - int(size[1] * 0.05)), sub, font=f_sub, fill=MUTED)
    base.convert("RGB").save(dest, "PNG", optimize=True)
    print(f"    {dest.relative_to(ROOT)}  {size[0]}x{size[1]}  {dest.stat().st_size // 1024} KB")


def main() -> None:
    key = os.environ.get("MINIMAX_API_KEY", "")
    if not key:
        sys.exit("MINIMAX_API_KEY is not set")

    print("logo:")
    (ROOT / "app" / "icon.svg").write_text(svg())
    (BRAND / "mark.svg").write_text(svg())
    (BRAND / "mark-transparent.svg").write_text(svg(rounded=False))
    (BRAND / "mark-light.svg").write_text(svg(stroke="#047857", bg="#ffffff"))
    print("    app/icon.svg, public/brand/mark{,-transparent,-light}.svg")

    for n in (16, 32, 48, 180, 512):
        raster(n).convert("RGB").save(BRAND / f"mark-{n}.png", optimize=True)
    raster(180).convert("RGB").save(PUB / "apple-icon.png", optimize=True)
    raster(512, transparent=True).save(BRAND / "mark-512-transparent.png", optimize=True)
    print("    rasters 16/32/48/180/512 plus a transparent 512")

    sub = live_sub()
    tmp = ROOT / ".asset-tmp"
    tmp.mkdir(exist_ok=True)

    jobs = [
        ("og", "a single thin line crossing a wide dark field, one small emerald node where it settles", "16:9",
         (1200, 630), "the settlement and trust layer",
         "Every payment claim on Monad, checked against the chain it names."),
        ("banner", "an ascending five step ladder drawn as one continuous thin line", "16:9",
         (1280, 640), "settlement and trust for agent work",
         "Trust stops being a badge. It becomes a price."),
        ("header", "one long horizontal thin line with a faint grid receding behind it", "16:9",
         (1500, 500), "kanmani", "Trust becomes a price."),
    ]
    for name, prompt, ratio, size, tag, title in jobs:
        print(f"{name}:")
        raw = tmp / f"{name}.png"
        generate(prompt, ratio, raw, key)
        out = PUB / f"{name}.png" if name in {"og", "banner"} else BRAND / f"{name}.png"
        card(raw, out, size, tag, title, sub)

    print("done")


if __name__ == "__main__":
    main()
