# Brand package

The Kanmani logo is a verification aperture: two counterparties close around one proof node. It makes
the trust model visible without turning the identity into a generic shield or chain-link symbol.

## Files

| file | use |
|---|---|
| `mark.svg` | full violet-and-cyan logo on its dark tile |
| `mark-transparent.svg` | same logo without a tile, for placing on another background |
| `mark-light.svg` | light-mode pair with stronger contrast on white |
| `mark-small.svg` | optically corrected logo with heavier rails; **use below 48px** |
| `mark-16/32/48.png` | rasters of the small variant |
| `mark-180.png` | apple-touch-icon, the only size iOS reads |
| `mark-512.png`, `mark-512-transparent.png` | PWA and organization avatars |
| `header.png` | 1500x500, X header |
| `../og.png` | 1200x630, Open Graph and every social preview |
| `../banner.png` | 1280x640, README banner |

## Two rules

**Below 48px use the small variant.** Its heavier rails and larger proof node survive browser-tab size
without changing the full logo's silhouette.

**Do not retype the numbers.** The cards carry live figures read from `/feed.json` at build time, so
regenerating is how they stay true. Editing the text by hand is how a card ends up quoting a number
the site contradicts, which is the failure this whole project exists to catch.

## Regenerating

    MINIMAX_API_KEY=... python3 scripts/build-media.py

MiniMax paints the backdrops. Every glyph is drawn by Pillow, because image models render text as
convincing garbage and the one thing a social card cannot get wrong is the product name. The logo
itself is never generated: both the SVG and every raster read one 32-unit geometry, so a favicon and a
header cannot drift apart.
