# Hold It Safe: the two-minute pitch

<a href="kanmani-pitch-720p.mp4"><img src="poster.jpg" alt="Kanmani pitch: it becomes a price." width="100%"></a>

**[▶ Watch the pitch (720p, 2:00)](kanmani-pitch-720p.mp4)**

The film is a single night-time wall with a camera moving along it. Each beat of the pitch is painted onto the next stretch of wall in spray, stencil, stickers or wheatpaste, cut to a 90 BPM boom-bap track. Every figure comes from the project's own published numbers.

| time | bars | on the wall |
|---|---|---|
| 0:00 | 0–3 | A flashlight finds the wall and a streetlight buzzes on. **KANMANI** goes up with *hold it safe.* |
| 0:08 | 3–7 | The beat drops and a stencil prints **10,258** agents. Every integrity tool stamps VERIFIED. *But did the payment happen?* |
| 0:19 | 7–13 | **85** claims split into **12 true** and **73 false**. Of the 73, **64** are real transactions on the wrong chain and **9** are on no chain. **Hash integrity ≠ claim truth.** |
| 0:35 | 13–17 | 100 wheatpasted agents, **79** of which turn to 404: **8,093 agents across 7,962 wallets, one dead document.** |
| 0:45 | 17–20 | Breakdown. A roller buffs over the grid, and on top: **NOT FRAUD. PLUMBING.** |
| 0:53 | 20–26 | The mark is sprayed. **The payment writes the receipt.** Then escrow → deliver → settle → price it. |
| 1:09 | 26–32 | Nine *HELLO my name is* slaps, one for each layer, **8 live and 1 built**. |
| 1:25 | 32–38 | **Proof.** The mainnet receipt prints (1.40 escrowed, 0.60 to the agent, 0.80 returned, 0 retained). Blocks tick every **266 ms**, set against a 12-second finality bar. |
| 1:41 | 38–41 | Halftime: **UNKNOWN is never FALSE**, and a null is never 0. |
| 1:49 | 41–45 | **Trust stops being a badge. It becomes a price.** kanmani.xyz, then a tape stop into the end card. |

The verdict colours follow the site's rule. Green means true, red means false, slate means unknown, and violet/cyan are the brand, never a verdict. The dead-document cells are marked 404 in slate, not red, because a document that stopped answering is not an accusation.

## How it is made

Nothing is filmed, sampled or licensed. The whole film is code.

| file | role |
|---|---|
| `engine.js` | Procedural brick, concrete and shutter walls, plus every mark that goes on them: 3D spray pieces with zig-zag nozzle reveals, overspray and drips; tags; marker lines; cardboard stencils that slide on, get sprayed and peel off; stamps; stickers; wheatpaste; the roller buff; the receipt; the block ticker. |
| `scenes.js` | The storyboard: 45 bars at 90 BPM, a camera path along one continuous wall, and a cue for each sound. |
| `film.js` | Camera, handheld shake, kick-synced push, streetlight lighting, whip-pan motion blur, film grain and the end card. `renderFrame(t)` depends only on `t`. |
| `soundtrack.py` | A boom-bap score synthesised in numpy (Am9 – Fmaj9 – Dm9 – E7#9, swung hats, FM Rhodes, bells, vinyl crackle), plus sound effects for every cue (spray hiss, can rattle, stamp, slap, roller, marker, printer, block ticks, DJ scratch on the whips), panned to where they happen on screen. |
| `render.mjs` | Headless Chromium renders frames in parallel. Each worker encodes a chunk, and the chunks are joined without re-encoding. |

Because every frame is a pure function of time, the render is exact and repeatable: any frame can be rendered on its own, and a re-run gives the same file.

## Re-render

```bash
node pitch/render.mjs cues                                         # the sound cue list
python3 pitch/soundtrack.py pitch/out/cues.json pitch/out/soundtrack.wav
node pitch/render.mjs video 6                                      # 3,600 frames; ~3 minutes on 8 cores
node pitch/render.mjs mux                                          # -> pitch/out/kanmani-pitch.mp4
node pitch/render.mjs sheet 7.5 30 60 90 116.8                     # a contact sheet of any moments
```

Requirements: Node with Playwright's Chromium, Python 3 with `numpy` and `scipy`, and an ffmpeg binary. If `FFMPEG` is unset, the script uses the one bundled with `imageio-ffmpeg`. You can also open `index.html` over http with `?t=42` to scrub to any moment, or `?play` to watch it live in the browser.

To change a number or a line, edit `scenes.js` and re-render. The sound follows automatically, because the soundtrack reads its cues from the film.

## Fonts

The fonts are bundled in `fonts/` under their own licences, as published on Google Fonts. Rubik Wet Paint, Rubik Spray Paint, Sedgwick Ave Display, Big Shoulders Stencil, Space Grotesk and JetBrains Mono use the SIL Open Font License 1.1. Permanent Marker and Rock Salt use the Apache License 2.0.
