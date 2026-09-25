# Brand package

The mark is five rungs rising left to right with a node where the last one settles. It is the
verification ladder, which is the one idea the product rests on, so the logo is the argument rather
than a decoration.

## Files

| file | use |
|---|---|
| `mark.svg` | the full mark, five rungs, on its own dark tile |
| `mark-transparent.svg` | same, no tile, for placing on your own background |
| `mark-light.svg` | light-mode pair, darker green on white |
| `mark-small.svg` | three rungs, heavier stroke. **Use below 48px** |
| `mark-16/32/48.png` | rasters of the small variant |
| `mark-180.png` | apple-touch-icon, the only size iOS reads |
| `mark-512.png`, `mark-512-transparent.png` | PWA, org avatars |
| `header.png` | 1500x500, X header |
| `../og.png` | 1200x630, Open Graph and every social preview |
| `../banner.png` | 1280x640, README banner |

## Two rules

**Below 48px use the small variant.** At 16px the five-rung mark is about two pixels per rung and
reads as a smudge. The three-rung version is the same idea at lower resolution, which is what a
favicon is for.

**Do not retype the numbers.** The cards carry live figures read from `/feed.json` at build time, so
regenerating is how they stay true. Editing the text by hand is how a card ends up quoting a number
the site contradicts, which is the failure this whole project exists to catch.

## Regenerating

    MINIMAX_API_KEY=... python3 scripts/build-media.py

MiniMax paints the backdrops. Every glyph is drawn by Pillow, because image models render text as
convincing garbage and the one thing a social card cannot get wrong is the product name. The mark
itself is never generated: both the SVG and every raster read one 32-unit geometry, so a favicon and a
header cannot drift apart.
