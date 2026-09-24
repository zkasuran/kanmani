#!/usr/bin/env python3
"""
Build the raster assets: a README banner and an Open Graph card.

Two decisions worth stating, because both are about not trusting a generator with the part that has to
be exact.

The backdrop is generated and the type is not. Image models render text as plausible-looking garbage,
and the one thing a social card cannot get wrong is the product name. So MiniMax paints an abstract
field and Pillow draws every glyph, which also means the copy can be edited later without paying for a
new generation.

The numbers are read from the live API rather than typed in. A card that says a figure the site
contradicts is exactly the failure this project is about, so the card asks /api/claims for the count at
build time and prints what it gets back.

Usage: MINIMAX_API_KEY=... python3 scripts/build-assets.py
"""

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public"
OUT.mkdir(exist_ok=True)

KEY = os.environ.get("MINIMAX_API_KEY", "")
if not KEY:
    sys.exit("MINIMAX_API_KEY is not set")

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
# Proportional for headlines. A mono headline at 90px wraps badly and reads as a terminal dump rather
# than a product, which is the exact impression this art exists to avoid.
SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

INK = (5, 7, 10)
TEXT = (232, 240, 250)
MUTED = (148, 163, 184)
BRAND = (52, 211, 153)

# The site's own palette, so a generated backdrop cannot drift away from the product it fronts.
STYLE = (
    "deep near-black navy background #05070a, a single thin emerald #34d399 line, "
    "fine faint grid texture, flat vector, generous negative space, technical and calm, "
    "no text, no words, no letters, no logos, no people"
)


def generate(prompt: str, ratio: str, dest: Path) -> bool:
    """Ask MiniMax for one backdrop. Returns False rather than raising so a miss does not kill the run."""
    body = json.dumps(
        {"model": "image-01", "prompt": f"{prompt}, {STYLE}", "aspect_ratio": ratio, "n": 1, "prompt_optimizer": False}
    ).encode()
    req = urllib.request.Request(
        "https://api.minimax.io/v1/image_generation",
        data=body,
        headers={"Authorization": f"Bearer {KEY}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.load(r)
    except Exception as e:  # noqa: BLE001
        print(f"  generate failed: {e}")
        return False
    if (d.get("base_resp") or {}).get("status_code") != 0:
        print(f"  generate refused: {d.get('base_resp')}")
        return False
    urls = ((d.get("data") or {}).get("image_urls")) or []
    if not urls:
        print("  no image returned")
        return False
    urllib.request.urlretrieve(urls[0], dest)
    print(f"  backdrop -> {dest.name} ({dest.stat().st_size // 1024} KB)")
    return True


def live_counts() -> str:
    """
    Read the figures off our own API so the card cannot contradict the site.

    The numbers live under `data.summary`, not at the top level. The first run looked for `totals`, found
    nothing and silently dropped the number from the art, which is how a card ends up saying less than
    it could. Now a miss is printed.
    """
    try:
        with urllib.request.urlopen("https://kanmani.xyz/feed.json", timeout=25) as r:
            summary = (json.load(r).get("data") or {}).get("summary") or {}
        claims, bad = summary.get("paymentClaims"), summary.get("doNotResolve")
        if claims and bad is not None:
            print(f"  live: {claims} payment claims, {bad} did not resolve")
            return f"kanmani.xyz  ·  {claims} payment claims checked, {bad} did not resolve"
        print(f"  live summary missing expected keys: {list(summary)[:6]}")
    except Exception as e:  # noqa: BLE001
        print(f"  live counts unavailable ({e})")
    return "kanmani.xyz"


def scrim(img: Image.Image) -> None:
    """
    One gradient over the FULL height, darkest at the bottom.

    The first version started the scrim a third of the way down and left a hard horizontal seam across
    the middle of both cards, which read as a rendering bug. A gradient with no start edge cannot seam.
    """
    w, h = img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(h):
        t = i / h
        d.line([(0, i), (w, i)], fill=(5, 7, 10, int(18 + 224 * t**2.1)))
    img.alpha_composite(layer)


def lift(art: Image.Image, factor: float = 1.9) -> Image.Image:
    """
    Brighten the generated field so it is actually visible under the scrim.

    The model returns a very dark image when asked for near-black. Stacking a scrim on top buried it
    entirely: the first banner had art in it that no viewer could see. Screening it against itself keeps
    the blacks black while pulling the drawn line up.
    """
    from PIL import ImageEnhance

    return ImageEnhance.Brightness(art).enhance(factor)


def card(src: Path, dest: Path, size: tuple, title: str, sub: str, tag: str) -> None:
    base = Image.new("RGBA", size, INK + (255,))
    if src.exists():
        art = lift(Image.open(src).convert("RGBA"))
        s_ = max(size[0] / art.width, size[1] / art.height)
        art = art.resize((int(art.width * s_) + 1, int(art.height * s_) + 1), Image.LANCZOS)
        base.alpha_composite(art, ((size[0] - art.width) // 2, (size[1] - art.height) // 2))

    scrim(base)
    d = ImageDraw.Draw(base)

    pad = int(size[0] * 0.058)
    f_tag = ImageFont.truetype(MONO, int(size[1] * 0.034))
    f_title = ImageFont.truetype(SANS_B, int(size[1] * 0.098))
    f_sub = ImageFont.truetype(MONO, int(size[1] * 0.036))

    d.text((pad, pad), tag, font=f_tag, fill=BRAND)

    words, lines, cur = title.split(), [], ""
    for w in words:
        t = f"{cur} {w}".strip()
        if d.textlength(t, font=f_title) > size[0] - pad * 2:
            lines.append(cur)
            cur = w
        else:
            cur = t
    lines.append(cur)

    lh = int(size[1] * 0.112)
    rule_y = size[1] - pad - int(size[1] * 0.082)
    y = rule_y - int(size[1] * 0.022) - lh * len(lines)
    for ln in lines:
        d.text((pad, y), ln, font=f_title, fill=TEXT)
        y += lh

    d.line([(pad, rule_y), (pad + int(size[0] * 0.055), rule_y)], fill=BRAND, width=3)
    d.text((pad, size[1] - pad - int(size[1] * 0.050)), sub, font=f_sub, fill=MUTED)

    base.convert("RGB").save(dest, "PNG", optimize=True)
    print(f"  card -> {dest.name} {size[0]}x{size[1]} ({dest.stat().st_size // 1024} KB)")


def main() -> None:
    sub = live_counts()

    tmp = ROOT / ".asset-tmp"
    tmp.mkdir(exist_ok=True)

    jobs = [
        ("banner", "an ascending five step ladder drawn as one continuous thin line, rising left to right", "16:9",
         (1280, 640), "settlement and trust for agent work", "Trust stops being a badge. It becomes a price."),
        ("og", "a single thin line crossing a wide dark field, one small emerald node where it settles", "16:9",
         (1200, 630), "the settlement and trust layer", "Every payment claim on Monad, checked against the chain it names."),
    ]
    for name, prompt, ratio, size, tag, title in jobs:
        print(f"{name}:")
        raw = tmp / f"{name}.png"
        generate(prompt, ratio, raw)
        card(raw, OUT / f"{name}.png", size, title, sub, tag)

    print("done")


if __name__ == "__main__":
    main()
