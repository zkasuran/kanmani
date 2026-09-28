#!/usr/bin/env python3
"""
The README's moving pictures, written as plain SVG.

GitHub renders an SVG in an <img> with its inline <style> and CSS animations intact, but runs no
script and loads no external font. So every file here is self-contained: system font stacks, no
<script>, no remote reference, and every animation declared in CSS or SMIL. Each file also carries a
`prefers-reduced-motion` block that stops the loops and shows the finished frame.

Every animation *starts* from a keyframe and falls back to the element's own attributes, so a viewer
that ignores CSS animation still sees the complete, correct picture rather than a blank one.

The figures are the same ones the README table states and the site serves from /feed.json. They are
drawn here, not typed into a painting, so changing one is an edit to this file and a re-run:

    python3 scripts/build-readme-art.py

Output: public/readme/*.svg
"""
from __future__ import annotations

import math
from pathlib import Path
from textwrap import wrap
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent.parent / "public" / "readme"

# ---- the site's dark palette (app/globals.css) ------------------------------------------------
INK = "#05070a"
PANEL = "#0b0f16"
PANEL2 = "#111720"
LINE = "#1d2836"
LINE_B = "#2b3a4d"
TEXT = "#dce5f0"
MUTED = "#7f8ea3"
FAINT = "#5d6d85"
BRAND = "#836ef9"
BRAND_DIM = "#4b3f8f"
ACCENT = "#22d3ee"
TRUE = "#34d399"
TRUE_BG = "#06281f"
FALSE = "#f87171"
FALSE_BG = "#2c1014"
UNKNOWN = "#94a3b8"
UNKNOWN_BG = "#171f2b"
NOCLAIM = "#64748b"
NOCLAIM_BG = "#121820"

SANS = "'Space Grotesk','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
BODY = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

EASE_OUT = "cubic-bezier(.16,1,.3,1)"
EASE_IO = "cubic-bezier(.65,0,.35,1)"

BASE_CSS = f"""
.sans{{font-family:{SANS}}}
.body{{font-family:{BODY}}}
.mono{{font-family:{MONO}}}
.in{{animation:in .9s {EASE_OUT} backwards;animation-delay:var(--d,0s)}}
@keyframes in{{from{{opacity:0;transform:translateY(10px)}}}}
@keyframes spin{{to{{transform:rotate(360deg)}}}}
"""

REDUCED = """
@media (prefers-reduced-motion:reduce){
  *{animation:none!important}
  .rm-hide{opacity:0!important}
}
"""


def t(s: str) -> str:
    return escape(s)


def backdrop(w: int, h: int, glow=((0.12, -0.1, BRAND, 0.30), (1.0, 0.1, ACCENT, 0.12))) -> str:
    """The site's field: ink, a violet bloom, a cyan one, a hairline grid and a lit top edge."""
    grads = []
    fills = []
    for i, (cx, cy, c, a) in enumerate(glow):
        grads.append(
            f'<radialGradient id="g{i}" cx="{cx}" cy="{cy}" r=".75">'
            f'<stop offset="0" stop-color="{c}" stop-opacity="{a}"/>'
            f'<stop offset="1" stop-color="{c}" stop-opacity="0"/></radialGradient>'
        )
        fills.append(f'<rect width="{w}" height="{h}" rx="24" fill="url(#g{i})"/>')
    return f"""
<defs>
  {''.join(grads)}
  <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
    <path d="M48 0H0V48" fill="none" stroke="{LINE}" stroke-width="1"/>
  </pattern>
  <radialGradient id="gridmask-g" cx=".5" cy="0" r=".9">
    <stop offset=".2" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
  <mask id="gridmask"><rect width="{w}" height="{h}" fill="url(#gridmask-g)"/></mask>
  <linearGradient id="edge" x1="0" x2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <clipPath id="frame"><rect width="{w}" height="{h}" rx="24"/></clipPath>
</defs>
<rect width="{w}" height="{h}" rx="24" fill="{INK}"/>
<g clip-path="url(#frame)">
  {''.join(fills)}
  <rect width="{w}" height="{h}" fill="url(#grid)" mask="url(#gridmask)"/>
</g>
<rect x=".5" y=".5" width="{w - 1}" height="{h - 1}" rx="23.5" fill="none" stroke="{LINE_B}" stroke-opacity=".8"/>
<rect x="120" y="0" width="{w - 240}" height="1" fill="url(#edge)"/>
"""


def svg(w: int, h: int, label: str, css: str, body: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{t(label)}">
<title>{t(label)}</title>
<style>{BASE_CSS}{css}{REDUCED}</style>
{body}
</svg>
"""


def kicker(x: int, y: int, text: str, d="0s") -> str:
    return (
        f'<g class="in" style="--d:{d}"><rect x="{x}" y="{y - 5}" width="22" height="1.5" fill="{BRAND}"/>'
        f'<text x="{x + 32}" y="{y}" class="mono" font-size="12.5" letter-spacing="2.6" fill="{BRAND}">{t(text.upper())}</text></g>'
    )


def mark(x: float, y: float, s: float, animated=True) -> str:
    """The aperture mark on the shared 32-unit geometry, scaled by `s`."""
    cls = ' class="mk"' if animated else ""
    return f"""<g transform="translate({x} {y}) scale({s})"{cls}>
  <path class="mk-l" d="M13 7L4.5 16L13 25" fill="none" stroke="{BRAND}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="mk-r" d="M19 7L27.5 16L19 25" fill="none" stroke="{BRAND}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle class="mk-n" cx="16" cy="16" r="2.35" fill="{ACCENT}"/>
</g>"""


MARK_CSS = f"""
.mk path,.mk circle{{transform-box:fill-box;transform-origin:center}}
.mk-l{{animation:mkl 1s {EASE_OUT} .15s backwards}}
.mk-r{{animation:mkr 1s {EASE_OUT} .15s backwards}}
.mk-n{{animation:mkn .8s cubic-bezier(.34,1.56,.64,1) .7s backwards}}
@keyframes mkl{{from{{opacity:0;transform:translateX(-6px)}}}}
@keyframes mkr{{from{{opacity:0;transform:translateX(6px)}}}}
@keyframes mkn{{from{{transform:scale(0)}}}}
"""


# ============================================================================== hero
def aperture(x: float, y: float, size: float) -> str:
    """The site's hero aperture (components/aperture.tsx), as a nested viewport so the CSS
    transform-origins resolve against its own 400-unit box."""
    ticks = "".join(
        f'<line x1="200" y1="{22 if i % 5 == 0 else 26}" x2="200" y2="30" class="tk{" tk-m" if i % 5 == 0 else ""}" transform="rotate({i * 6} 200 200)"/>'
        for i in range(60)
    )
    blocks = "".join(
        f'<rect x="195" y="81" width="10" height="10" rx="2.5" class="bk{" bk-l" if i % 3 == 0 else ""}" '
        f'transform="rotate({i * 30} 200 200)" style="animation-delay:{-i * 0.333:.3f}s"/>'
        for i in range(12)
    )
    pulses = "".join(
        f'<circle cx="200" cy="200" r="22" class="pl rm-hide" style="animation-delay:{2 + p * 0.22:.2f}s"/>' for p in range(3)
    )
    return f"""<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 400 400" overflow="visible" class="ap">
<defs>
  <radialGradient id="ap-core"><stop offset="0" stop-color="{ACCENT}" stop-opacity=".55"/><stop offset=".45" stop-color="{BRAND}" stop-opacity=".18"/><stop offset="1" stop-color="{BRAND}" stop-opacity="0"/></radialGradient>
  <linearGradient id="ap-rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BRAND}" stop-opacity=".35"/><stop offset=".5" stop-color="{BRAND}"/><stop offset="1" stop-color="{BRAND}" stop-opacity=".35"/></linearGradient>
  <linearGradient id="ap-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{ACCENT}" stop-opacity="0"/><stop offset="1" stop-color="{ACCENT}" stop-opacity=".32"/></linearGradient>
  <linearGradient id="ap-beam" x1="0" x2="1"><stop offset="0" stop-color="{BRAND}" stop-opacity="0"/><stop offset=".5" stop-color="{ACCENT}" stop-opacity=".7"/><stop offset="1" stop-color="{BRAND}" stop-opacity="0"/></linearGradient>
  <filter id="ap-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
</defs>
<circle cx="200" cy="200" r="186" class="rg" opacity=".45"/>
<g class="sp sp-slow">{ticks}</g>
<circle cx="200" cy="200" r="150" class="rg rg-d sp sp-rev"/>
<g class="sp sp-orbit">{blocks}</g>
<circle cx="200" cy="200" r="119" class="rg"/>
<g class="sw"><path d="M200 200 L200 82 A118 118 0 0 1 318 200 Z" fill="url(#ap-sweep)"/></g>
<circle cx="200" cy="200" r="92" fill="url(#ap-core)" class="gl"/>
<line x1="96" y1="200" x2="304" y2="200" class="wr"/>
<rect x="96" y="199" width="208" height="2" fill="url(#ap-beam)" class="bm"/>
<g filter="url(#ap-glow)" opacity=".55">
  <path d="M168 110 L88 200 L168 290" class="rl" stroke="{BRAND}"/>
  <path d="M232 110 L312 200 L232 290" class="rl" stroke="{BRAND}"/>
</g>
<path d="M168 110 L88 200 L168 290" class="rl rl-l" stroke="url(#ap-rail)"/>
<path d="M232 110 L312 200 L232 290" class="rl rl-r" stroke="url(#ap-rail)"/>
<circle cx="104" cy="200" r="5" class="pk pk-in rm-hide"/>
<circle cx="200" cy="200" r="5" class="pk pk-out rm-hide"/>
{pulses}
<circle cx="200" cy="200" r="30" fill="none" stroke="{ACCENT}" stroke-opacity=".5"/>
<circle cx="200" cy="200" r="15" class="nd"/>
<circle cx="200" cy="200" r="5.5" fill="{ACCENT}" class="cr"/>
</svg>"""


APERTURE_CSS = f"""
.ap *{{transform-box:view-box;transform-origin:200px 200px}}
.ap .tk,.ap .bk{{transform-origin:0 0}}
.rg{{fill:none;stroke:{LINE_B};stroke-width:1}}
.rg-d{{stroke:{BRAND};stroke-dasharray:2 9;opacity:.6}}
.tk{{stroke:{LINE_B};stroke-width:1}}.tk-m{{stroke:{FAINT};stroke-width:1.4}}
.sp-slow{{animation:spin 90s linear infinite}}
.sp-rev{{animation:spin 60s linear infinite reverse}}
.sp-orbit{{animation:spin 48s linear infinite}}
.bk{{fill:{PANEL2};stroke:{LINE_B};animation:bt 4s {EASE_IO} infinite}}
.bk-l{{fill:#3a3170;stroke:{BRAND}}}
@keyframes bt{{0%,70%,100%{{opacity:.55}}80%{{opacity:1}}}}
.sw{{animation:spin 8s linear infinite}}
.wr{{stroke:{LINE_B};stroke-dasharray:3 5}}
.bm{{transform-origin:96px 200px;animation:bm 8s {EASE_IO} 2s infinite}}
@keyframes bm{{0%,8%{{transform:scaleX(0);opacity:0}}30%{{transform:scaleX(.5);opacity:1}}62%{{transform:scaleX(1);opacity:1}}80%,100%{{transform:scaleX(1);opacity:0}}}}
.rl{{fill:none;stroke-width:9;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:260}}
.rl-l{{animation:dr 1.6s {EASE_OUT} .3s backwards,cl 8s {EASE_IO} 2s infinite}}
.rl-r{{animation:dr 1.6s {EASE_OUT} .3s backwards,cr 8s {EASE_IO} 2s infinite}}
@keyframes dr{{from{{stroke-dashoffset:260}}}}
@keyframes cl{{0%,25%,60%,100%{{transform:none}}38%,46%{{transform:translateX(10px)}}}}
@keyframes cr{{0%,25%,60%,100%{{transform:none}}38%,46%{{transform:translateX(-10px)}}}}
.pk{{fill:{TEXT};opacity:0}}
.pk-in{{animation:pi 8s {EASE_IO} 2s infinite}}
.pk-out{{fill:{ACCENT};animation:po 8s {EASE_IO} 2s infinite}}
@keyframes pi{{0%{{transform:translateX(0);opacity:0}}6%{{opacity:1}}34%{{transform:translateX(96px);opacity:1}}38%,100%{{transform:translateX(96px);opacity:0}}}}
@keyframes po{{0%,48%{{transform:translateX(0) scale(.4);opacity:0}}52%{{transform:translateX(6px);opacity:1}}78%{{transform:translateX(96px);opacity:1}}84%,100%{{transform:translateX(96px);opacity:0}}}}
.gl{{animation:gl 8s {EASE_IO} 2s infinite}}
@keyframes gl{{0%,30%,70%,100%{{opacity:.65;transform:scale(1)}}42%{{opacity:1;transform:scale(1.08)}}}}
.nd{{fill:#0b2a33;stroke:{ACCENT};stroke-width:1.5;animation:nl 1s cubic-bezier(.34,1.56,.64,1) 1.1s backwards,nb 8s {EASE_IO} 2s infinite}}
.cr{{animation:nl 1s cubic-bezier(.34,1.56,.64,1) 1.2s backwards}}
@keyframes nl{{from{{transform:scale(0)}}}}
@keyframes nb{{0%,34%,56%,100%{{transform:scale(1)}}40%{{transform:scale(1.18)}}}}
.pl{{fill:none;stroke:{ACCENT};stroke-width:1.2;opacity:0;animation:pu 8s cubic-bezier(.25,1,.5,1) infinite}}
@keyframes pu{{0%,38%{{transform:scale(.7);opacity:0}}40%{{opacity:.85}}66%,100%{{transform:scale(4.4);opacity:0}}}}
"""


def hero() -> str:
    w, h = 1280, 580
    chips = [("10,258", "agents measured"), ("1 job", "settled in real USDC"), ("524", "tests passing")]
    chip_svg = []
    cx = 72
    for i, (v, k) in enumerate(chips):
        width = 26 + len(v) * 11 + 8 + len(k) * 7.4 + 22
        chip_svg.append(
            f'<g class="in" style="--d:{1.05 + i * 0.08:.2f}s">'
            f'<rect x="{cx}" y="484" width="{width:.0f}" height="38" rx="19" fill="{PANEL}" fill-opacity=".8" stroke="{LINE_B}"/>'
            f'<text x="{cx + 20}" y="508" class="sans" font-size="17" font-weight="600" fill="{TEXT}">{t(v)}'
            f'<tspan dx="9" class="body" font-size="13" font-weight="400" fill="{MUTED}">{t(k)}</tspan></text></g>'
        )
        cx += width + 12
    lines = ["The settlement and", "trust layer for agent", "work on Monad."]
    head = "".join(
        f'<text x="72" y="{250 + i * 64}" class="sans in" style="--d:{0.25 + i * 0.1:.2f}s" font-size="58" font-weight="600" letter-spacing="-1.8" fill="{TEXT}">{t(s)}</text>'
        for i, s in enumerate(lines)
    )
    css = MARK_CSS + APERTURE_CSS + f"""
.live{{animation:lv 2.4s {EASE_IO} infinite}}
@keyframes lv{{0%,100%{{opacity:1}}50%{{opacity:.35}}}}
"""
    body = backdrop(w, h) + f"""
<g class="in">
  {mark(66, 58, 1.55)}
  <text x="124" y="92" class="sans" font-size="30" font-weight="600" letter-spacing="-.6" fill="{TEXT}">kanmani</text>
  <rect x="262" y="70" width="190" height="28" rx="14" fill="none" stroke="{LINE_B}"/>
  <circle cx="280" cy="84" r="4" fill="{TRUE}" class="live"/>
  <text x="293" y="88.5" class="mono" font-size="12" fill="{MUTED}">monad mainnet · 143</text>
</g>
<text x="72" y="168" class="mono in" style="--d:.15s" font-size="13" letter-spacing="3" fill="{FAINT}">ERC-8004 · X402 · MONAD MAINNET · CHAIN 143</text>
{head}
<defs>
  <linearGradient id="shimmer" x1="0" x2="1" gradientUnits="objectBoundingBox">
    <stop offset="0" stop-color="{BRAND}"/><stop offset=".42" stop-color="{BRAND}"/>
    <stop offset=".5" stop-color="{ACCENT}"/><stop offset=".58" stop-color="{BRAND}"/><stop offset="1" stop-color="{BRAND}"/>
    <animateTransform attributeName="gradientTransform" type="translate" values="-1 0;1 0;1 0" keyTimes="0;.55;1" dur="5.5s" begin="1.4s" repeatCount="indefinite"/>
  </linearGradient>
</defs>
<text x="72" y="444" class="body in" style="--d:.6s" font-size="25" fill="{TEXT}">Trust stops being a badge. <tspan fill="url(#shimmer)" font-weight="600">It becomes a price.</tspan></text>
{''.join(chip_svg)}
{aperture(792, 70, 440)}
"""
    return svg(w, h, "Kanmani: the settlement and trust layer for agent work on Monad. Trust stops being a badge. It becomes a price.", css, body)


# ============================================================================== flow
FLOW = [
    ("Escrow", "The buyer locks USDC against terms. The job id is derived, never supplied."),
    ("Deliver", "The agent delivers. Both sides have an exit that does not need the other to reply."),
    ("Settle", "Payment and receipt in one transaction. Unspent metered funds return in the same call."),
    ("Price it", "The claim-truth rate that falls out becomes the bond, the odds and the credit line."),
]


def flow() -> str:
    w, h = 1280, 470
    xs = [160 + i * 320 for i in range(4)]
    y = 232
    loop = 6.4
    stations = []
    for i, (name, text) in enumerate(FLOW):
        x = xs[i]
        body_lines = "".join(
            f'<tspan x="{x}" dy="{0 if j == 0 else 21}">{t(l)}</tspan>' for j, l in enumerate(wrap(text, 34))
        )
        stations.append(f"""
<g class="in" style="--d:{0.3 + i * 0.12:.2f}s">
  <circle cx="{x}" cy="{y}" r="34" fill="{PANEL}" stroke="{LINE_B}"/>
  <circle cx="{x}" cy="{y}" r="34" fill="none" stroke="{ACCENT}" stroke-width="1.5" class="ring" style="animation-delay:{i * loop / 4:.2f}s"/>
  <circle cx="{x}" cy="{y}" r="34" fill="none" stroke="{ACCENT}" class="wave rm-hide" style="animation-delay:{i * loop / 4:.2f}s"/>
  <text x="{x}" y="{y + 6}" text-anchor="middle" class="mono" font-size="16" font-weight="600" fill="{BRAND}">0{i + 1}</text>
  <text x="{x}" y="{y + 72}" text-anchor="middle" class="mono" font-size="13" letter-spacing="2.4" fill="{TEXT}">{t(name.upper())}</text>
  <text x="{x}" y="{y + 102}" text-anchor="middle" class="body" font-size="14" fill="{MUTED}">{body_lines}</text>
</g>""")
    # One packet runs the whole line, pausing at each station, in the same loop as the rings.
    kf = []
    for i in range(4):
        a = i * 25
        kf.append(f"{a}%{{transform:translateX({xs[i] - xs[0]}px)}}")
        kf.append(f"{a + 12}%{{transform:translateX({xs[i] - xs[0]}px)}}")
    kf.append(f"100%{{transform:translateX({xs[3] - xs[0]}px);opacity:0}}")
    css = f"""
.ring{{opacity:.15;animation:rg {loop}s {EASE_IO} infinite}}
@keyframes rg{{0%,100%{{opacity:.15}}6%,20%{{opacity:1}}}}
.wave{{opacity:0;transform-box:fill-box;transform-origin:center;animation:wv {loop}s cubic-bezier(.25,1,.5,1) infinite}}
@keyframes wv{{0%{{opacity:.8;transform:scale(1)}}22%,100%{{opacity:0;transform:scale(1.9)}}}}
.pkt{{animation:pk {loop}s {EASE_IO} infinite}}
@keyframes pk{{{''.join(kf)}}}
.trail{{stroke-dasharray:4 8;animation:tr 1.2s linear infinite}}
@keyframes tr{{to{{stroke-dashoffset:-12}}}}
"""
    body = backdrop(w, h, ((0.5, -0.3, BRAND, 0.22), (0.95, 1.1, ACCENT, 0.08))) + f"""
{kicker(72, 72, "how the money moves")}
<text x="72" y="124" class="sans in" style="--d:.1s" font-size="34" font-weight="600" letter-spacing="-1" fill="{TEXT}">The receipt is produced by the payment, not written about it afterwards.</text>
<line x1="{xs[0]}" y1="{y}" x2="{xs[3]}" y2="{y}" stroke="{LINE_B}" stroke-width="2"/>
<line x1="{xs[0]}" y1="{y}" x2="{xs[3]}" y2="{y}" stroke="{BRAND}" stroke-opacity=".6" stroke-width="2" class="trail"/>
{''.join(stations)}
<g class="pkt rm-hide"><circle cx="{xs[0]}" cy="{y - 34}" r="6" fill="{ACCENT}"/><circle cx="{xs[0]}" cy="{y - 34}" r="12" fill="{ACCENT}" opacity=".2"/></g>
<text x="640" y="438" text-anchor="middle" class="mono in" style="--d:.9s" font-size="13" fill="{FAINT}">on mainnet  ·  <tspan fill="{TEXT}">1.40</tspan> escrowed  ·  <tspan fill="{TEXT}">30 of 70</tspan> calls used  ·  <tspan fill="{TEXT}">0.60</tspan> to the agent  ·  <tspan fill="{TEXT}">0.80</tspan> returned in the same transaction  ·  <tspan fill="{TEXT}">0</tspan> retained</text>
"""
    return svg(w, h, "How the money moves: escrow, deliver, settle, price it.", css, body)


# ============================================================================== findings
def band(x0, y0a, y0b, x1, y1a, y1b) -> str:
    m = (x0 + x1) / 2
    return f"M{x0} {y0a} C{m} {y0a} {m} {y1a} {x1} {y1a} L{x1} {y1b} C{m} {y1b} {m} {y0b} {x0} {y0b} Z"


def findings() -> str:
    w, h = 1280, 660
    k = 3.6  # px per claim
    top = 200
    c1, c2, c3 = 300, 640, 1000
    nw = 12
    n85, n12, n73, n64, n9 = 85 * k, 12 * k, 73 * k, 64 * k, 9 * k
    # column 1
    a0, a1 = top, top + n85
    # column 2: true on top, a gap, false below
    t0, t1 = top - 14, top - 14 + n12
    f0 = t1 + 28
    f1 = f0 + n73
    # column 3: from the false node, a gap between
    e0 = f0 - 12
    e1 = e0 + n64
    z0 = e1 + 28
    z1 = z0 + n9
    split = a0 + n12
    fsplit = f0 + n64
    css = f"""
.bd{{animation:rv 1.6s {EASE_OUT} backwards}}
@keyframes rv{{from{{clip-path:inset(0 100% 0 0)}}to{{clip-path:inset(0 0 0 0)}}}}
.nd{{animation:gr .8s {EASE_OUT} backwards}}
@keyframes gr{{from{{transform:scaleY(0)}}}}
.nd{{transform-box:fill-box;transform-origin:center}}
"""
    body = backdrop(w, h, ((0.05, -0.2, BRAND, 0.24), (1.0, 1.0, FALSE, 0.06))) + f"""
<defs>
  <linearGradient id="b-true" x1="0" x2="1"><stop offset="0" stop-color="{TEXT}" stop-opacity=".18"/><stop offset="1" stop-color="{TRUE}" stop-opacity=".55"/></linearGradient>
  <linearGradient id="b-false" x1="0" x2="1"><stop offset="0" stop-color="{TEXT}" stop-opacity=".18"/><stop offset="1" stop-color="{FALSE}" stop-opacity=".5"/></linearGradient>
  <linearGradient id="b-else" x1="0" x2="1"><stop offset="0" stop-color="{FALSE}" stop-opacity=".4"/><stop offset="1" stop-color="{ACCENT}" stop-opacity=".45"/></linearGradient>
  <linearGradient id="b-none" x1="0" x2="1"><stop offset="0" stop-color="{FALSE}" stop-opacity=".4"/><stop offset="1" stop-color="{FALSE}" stop-opacity=".8"/></linearGradient>
</defs>
{kicker(72, 66, "the measurement")}
<text x="72" y="116" class="sans in" style="--d:.1s" font-size="34" font-weight="600" letter-spacing="-1" fill="{TEXT}">Every payment claim on Monad, checked against the chain it names.</text>
<text x="72" y="148" class="body in" style="--d:.2s" font-size="16" fill="{MUTED}">All 10,258 agents read. Every document here is hash-perfect, so every integrity check calls it verified. Integrity is not truth.</text>

<g class="bd" style="animation-delay:.4s">
  <path d="{band(c1 + nw, a0, split, c2, t0, t1)}" fill="url(#b-true)"/>
  <path d="{band(c1 + nw, split, a1, c2, f0, f1)}" fill="url(#b-false)"/>
</g>
<g class="bd" style="animation-delay:1.1s">
  <path d="{band(c2 + nw, f0, fsplit, c3, e0, e1)}" fill="url(#b-else)"/>
  <path d="{band(c2 + nw, fsplit, f1, c3, z0, z1)}" fill="url(#b-none)"/>
</g>

<rect x="{c1}" y="{a0}" width="{nw}" height="{n85}" rx="3" fill="{TEXT}" class="nd" style="animation-delay:.2s"/>
<rect x="{c2}" y="{t0}" width="{nw}" height="{n12}" rx="3" fill="{TRUE}" class="nd" style="animation-delay:.9s"/>
<rect x="{c2}" y="{f0}" width="{nw}" height="{n73}" rx="3" fill="{FALSE}" class="nd" style="animation-delay:.9s"/>
<rect x="{c3}" y="{e0}" width="{nw}" height="{n64}" rx="3" fill="{ACCENT}" class="nd" style="animation-delay:1.6s"/>
<rect x="{c3}" y="{z0}" width="{nw}" height="{n9}" rx="3" fill="{FALSE}" class="nd" style="animation-delay:1.6s"/>

<g class="in" style="--d:.3s">
  <text x="{c1 - 22}" y="{a0 + n85 / 2 + 6}" text-anchor="end" class="sans" font-size="76" font-weight="700" letter-spacing="-3" fill="{TEXT}">85</text>
  <text x="{c1 - 24}" y="{a0 + n85 / 2 + 36}" text-anchor="end" class="body" font-size="14.5" fill="{MUTED}">payment claims</text>
  <text x="{c1 - 24}" y="{a0 + n85 / 2 + 56}" text-anchor="end" class="body" font-size="14.5" fill="{MUTED}">that exist at all</text>
  <text x="{c1 - 24}" y="{a0 + n85 / 2 + 86}" text-anchor="end" class="mono" font-size="11.5" letter-spacing="1.2" fill="{FAINT}">OF 10,258 AGENTS</text>
</g>
<g class="in" style="--d:1s">
  <text x="{c2 + 30}" y="{t0 + 36}" class="sans" font-size="40" font-weight="700" letter-spacing="-1.5" fill="{TRUE}">12</text>
  <text x="{c2 + 88}" y="{t0 + 22}" class="mono" font-size="12" letter-spacing="1.5" fill="{TRUE}">TRUE</text>
  <text x="{c2 + 88}" y="{t0 + 40}" class="body" font-size="13.5" fill="{MUTED}">on the chain they name</text>
  <text x="{c2 + 30}" y="{f0 + 42}" class="sans" font-size="40" font-weight="700" letter-spacing="-1.5" fill="{FALSE}">73</text>
  <text x="{c2 + 88}" y="{f0 + 26}" class="mono" font-size="12" letter-spacing="1.5" fill="{FALSE}">FALSE</text>
  <text x="{c2 + 88}" y="{f0 + 44}" class="body" font-size="13.5" fill="{MUTED}">not on the chain they name</text>
</g>
<g class="in" style="--d:1.7s">
  <text x="{c3 + 30}" y="{e0 + 58}" class="sans" font-size="54" font-weight="700" letter-spacing="-2" fill="{ACCENT}">64</text>
  <text x="{c3 + 32}" y="{e0 + 84}" class="body" font-size="14" fill="{TEXT}">real transactions,</text>
  <text x="{c3 + 32}" y="{e0 + 103}" class="body" font-size="14" fill="{TEXT}">on a different chain</text>
  <text x="{c3 + 32}" y="{e0 + 130}" class="body" font-size="13" fill="{MUTED}">one wrong field,</text>
  <text x="{c3 + 32}" y="{e0 + 148}" class="body" font-size="13" fill="{MUTED}">fixable in one edit</text>
  <text x="{c3 + 30}" y="{z0 + 30}" class="sans" font-size="34" font-weight="700" letter-spacing="-1" fill="{FALSE}">9</text>
  <text x="{c3 + 62}" y="{z0 + 16}" class="body" font-size="14" fill="{TEXT}">found on</text>
  <text x="{c3 + 62}" y="{z0 + 34}" class="body" font-size="14" fill="{TEXT}">no chain at all</text>
</g>
<text x="72" y="626" class="body in" style="--d:2s" font-size="14" fill="{FAINT}">None of it is fraud and the project never says it is. A registry has no mechanism to keep a true statement true.</text>
"""
    return svg(w, h, "85 payment claims: 12 on the chain they name, 73 not. Of those 73, 64 are real transactions on a different chain and 9 exist on no chain at all.", css, body)


# ============================================================================== cluster
def cluster() -> str:
    w, h = 1280, 330
    agents, members, owners = 10258, 8093, 7962
    lit = round(members / agents * 100)  # 79 of every 100
    cols, rows, cell, gap = 20, 5, 22, 7
    gx, gy = 640, 92
    cells = []
    for i in range(cols * rows):
        r, c = divmod(i, cols)
        x = gx + c * (cell + gap)
        y = gy + r * (cell + gap)
        on = i < lit
        d = (c * 0.035 + r * 0.05) + 0.3
        cells.append(
            f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" rx="5" class="c{" on" if on else ""}" style="animation-delay:{d:.2f}s{"," + f"{d + 2.2:.2f}s" if on else ""}"/>'
        )
    css = f"""
.c{{fill:{BRAND_DIM};fill-opacity:.55;stroke:{BRAND};stroke-opacity:.5;transform-box:fill-box;transform-origin:center;animation:ci .6s {EASE_OUT} backwards}}
.c.on{{fill:{PANEL2};fill-opacity:1;stroke:{LINE_B};stroke-opacity:1;animation:ci .6s {EASE_OUT} backwards,dim 5s {EASE_IO} infinite}}
@keyframes ci{{from{{opacity:0;transform:scale(.4)}}}}
@keyframes dim{{0%,100%{{opacity:1}}50%{{opacity:.55}}}}
"""
    body = backdrop(w, h, ((0.0, 0.0, BRAND, 0.2), (1.0, 1.0, ACCENT, 0.06))) + f"""
{kicker(72, 66, "who this is for")}
<text x="72" y="152" class="sans in" style="--d:.1s" font-size="76" font-weight="700" letter-spacing="-3" fill="{BRAND}">{members:,}</text>
<text x="72" y="190" class="body in" style="--d:.2s" font-size="18" fill="{TEXT}">agents across {owners:,} wallets share one registration</text>
<text x="72" y="214" class="body in" style="--d:.2s" font-size="18" fill="{TEXT}">document that no longer answers.</text>
<text x="72" y="256" class="body in" style="--d:.3s" font-size="14.5" fill="{MUTED}">An expired preview deployment. Nobody's misconduct, and the registry</text>
<text x="72" y="278" class="body in" style="--d:.3s" font-size="14.5" fill="{MUTED}">reports no difference between those and the live ones. That filter is the product.</text>
{''.join(cells)}
<g class="in" style="--d:1s">
  <rect x="{gx}" y="256" width="12" height="12" rx="3" fill="{PANEL2}" stroke="{LINE_B}"/>
  <text x="{gx + 20}" y="266" class="mono" font-size="12" fill="{MUTED}"><tspan fill="{TEXT}">{lit}</tspan> in every 100 agents · the one dead document</text>
  <rect x="{gx + 390}" y="256" width="12" height="12" rx="3" fill="{BRAND_DIM}" stroke="{BRAND}" stroke-opacity=".5"/>
  <text x="{gx + 410}" y="266" class="mono" font-size="12" fill="{MUTED}">everyone else</text>
</g>
"""
    return svg(w, h, f"{members:,} of {agents:,} agents, across {owners:,} wallets, share one registration document that no longer answers.", css, body)


# ============================================================================== stack
STACK = [
    ("Retina", "Index the evidence", "The evidence pointer, indexed so there is something to check at all.", "live"),
    ("Fovea", "Verify the claim", "Five rungs, four outcomes. Read the named chain, at a block.", "live"),
    ("Aqueous", "Escrow the job", "USDC locked first. The settlement itself emits the receipt.", "live"),
    ("Iris · x402", "Pay without a wallet", "One passkey is the account. The buyer needs no MON.", "live"),
    ("Optic", "Answer on chain", "The first row in Monad's ERC-8004 Validation Registry.", "live"),
    ("Sclera", "Bond the promise", "USDC staked against a claim-truth floor. A signed verdict slashes.", "live"),
    ("Chiasm", "Read every chain at once", "BSC beside Monad, merged on the document's content hash.", "live"),
    ("Intents", "Fund from any chain", "Written and tested. No cross-chain fund executed yet.", "built"),
    ("Self-heal", "Heal a fixed record", "A repaired document re-reads itself from the event stream.", "live"),
]


def stack() -> str:
    w, h = 1280, 700
    cw, ch, gx, gy = 364, 148, 22, 22
    ox, oy = 72, 170
    loop = 9 * 0.7
    cards = []
    for i, (code, name, text, status) in enumerate(STACK):
        r, c = divmod(i, 3)
        x = ox + c * (cw + gx)
        y = oy + r * (ch + gy)
        live = status == "live"
        chip_w = 58 if live else 66
        lines = "".join(f'<tspan x="{x + 22}" dy="{0 if j == 0 else 19}">{t(l)}</tspan>' for j, l in enumerate(wrap(text, 44)))
        chip = (
            f'<rect x="{x + cw - chip_w - 18}" y="{y + 18}" width="{chip_w}" height="22" rx="11" '
            f'fill="{"#1b1638" if live else PANEL2}" stroke="{BRAND if live else LINE_B}" stroke-opacity="{".6" if live else "1"}"/>'
            + (f'<circle cx="{x + cw - chip_w - 4}" cy="{y + 29}" r="3" fill="{BRAND}" class="dot"/>' if live else "")
            + f'<text x="{x + cw - 18 - (10 if live else chip_w / 2)}" y="{y + 33}" text-anchor="{"end" if live else "middle"}" class="mono" font-size="10.5" letter-spacing="1.2" fill="{BRAND if live else MUTED}">{status.upper()}</text>'
        )
        cards.append(f"""
<g class="in" style="--d:{0.25 + i * 0.06:.2f}s">
  <rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="14" fill="{PANEL}" fill-opacity=".92" stroke="{LINE_B}"/>
  <rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="14" fill="none" stroke="url(#lit)" stroke-width="1.5" class="hl rm-hide" style="animation-delay:{i * 0.7:.2f}s"/>
  <text x="{x + 22}" y="{y + 34}" class="mono" font-size="11" letter-spacing="1.6" fill="{FAINT}"><tspan fill="{BRAND}">{i + 1:02d}</tspan>  {t(code.upper())}</text>
  <text x="{x + 22}" y="{y + 70}" class="sans" font-size="21" font-weight="600" letter-spacing="-.4" fill="{TEXT}">{t(name)}</text>
  <text x="{x + 22}" y="{y + 100}" class="body" font-size="13.5" fill="{MUTED}">{lines}</text>
  {chip}
</g>""")
    css = f"""
.hl{{opacity:0;animation:hl {loop:.1f}s {EASE_IO} infinite}}
@keyframes hl{{0%{{opacity:0}}3%{{opacity:1}}14%{{opacity:0}}100%{{opacity:0}}}}
.dot{{animation:dt 2.4s {EASE_IO} infinite}}
@keyframes dt{{0%,100%{{opacity:1}}50%{{opacity:.3}}}}
"""
    body = backdrop(w, h, ((0.1, -0.1, BRAND, 0.26), (0.95, 0.4, ACCENT, 0.1))) + f"""
<defs><linearGradient id="lit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{ACCENT}"/><stop offset=".5" stop-color="{BRAND}"/><stop offset="1" stop-color="{BRAND}" stop-opacity=".2"/></linearGradient></defs>
{kicker(72, 66, "the stack")}
<text x="72" y="116" class="sans in" style="--d:.1s" font-size="34" font-weight="600" letter-spacing="-1" fill="{TEXT}">Nine layers, one primitive underneath: a proven track record.</text>
<text x="72" y="148" class="body in" style="--d:.2s" font-size="16" fill="{MUTED}">In the order money flows through them. <tspan fill="{BRAND}">live</tspan> is running on Monad mainnet now. <tspan fill="{TEXT}">built</tspan> is written and tested, not yet deployed.</text>
{''.join(cards)}
"""
    return svg(w, h, "The stack: nine layers in the order money flows. Eight live on Monad mainnet, one built.", css, body)


# ============================================================================== outcomes
OUTCOMES = [
    ("true", TRUE, TRUE_BG, "The cited transaction is on the chain the document names."),
    ("false", FALSE, FALSE_BG, "We read that chain successfully and the transaction is not there."),
    ("noClaim", NOCLAIM, NOCLAIM_BG, "The document parsed and asserts no payment. Nothing to resolve."),
    ("unknown", UNKNOWN, UNKNOWN_BG, "We could not look, or could not read what we fetched. Never an accusation."),
]


def outcomes() -> str:
    w, h = 1280, 330
    cw, gx = 270, 18
    cards = []
    for i, (name, fg, bg, text) in enumerate(OUTCOMES):
        x = 72 + i * (cw + gx)
        y = 120
        lines = "".join(f'<tspan x="{x + 22}" dy="{0 if j == 0 else 19}">{t(l)}</tspan>' for j, l in enumerate(wrap(text, 32)))
        cards.append(f"""
<g class="in" style="--d:{0.2 + i * 0.08:.2f}s">
  <rect x="{x}" y="{y}" width="{cw}" height="128" rx="14" fill="{bg}" stroke="{fg}" stroke-opacity=".35"/>
  <rect x="{x + 22}" y="{y + 22}" width="{len(name) * 9.4 + 22:.0f}" height="26" rx="6" fill="{INK}" fill-opacity=".35" stroke="{fg}" stroke-opacity=".4"/>
  <text x="{x + 33}" y="{y + 40}" class="mono" font-size="14" font-weight="600" fill="{fg}">{name}</text>
  <text x="{x + 22}" y="{y + 76}" class="body" font-size="13.5" fill="{TEXT}" fill-opacity=".82">{lines}</text>
</g>""")
    body = backdrop(w, h, ((0.5, -0.4, BRAND, 0.18),)) + f"""
{kicker(72, 66, "four outcomes, one rule")}
<text x="72" y="100" class="sans in" style="--d:.1s" font-size="26" font-weight="600" letter-spacing="-.6" fill="{TEXT}"><tspan class="mono" fill="{UNKNOWN}">unknown</tspan> is never <tspan class="mono" fill="{FALSE}">false</tspan>, and a null is never <tspan class="mono">0</tspan>.</text>
{''.join(cards)}
<text x="72" y="294" class="body in" style="--d:.6s" font-size="14" fill="{FAINT}">Enforced in the types, in the contract, in the SQL and in the UI. A failure to look is not a finding against anybody.</text>
"""
    return svg(w, h, "Four outcomes: true, false, noClaim, unknown. Unknown is never false and a null is never zero.", "", body)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "hero.svg": hero(),
        "flow.svg": flow(),
        "findings.svg": findings(),
        "cluster.svg": cluster(),
        "stack.svg": stack(),
        "outcomes.svg": outcomes(),
    }
    for name, content in files.items():
        (OUT / name).write_text(content, encoding="utf-8")
        print(f"public/readme/{name}  {len(content.encode()) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
