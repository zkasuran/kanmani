#!/usr/bin/env node
/**
 * The blog's screenshots, taken from the live site rather than drawn.
 *
 * Each shot is cropped to the one element that makes its point, so a reader sees the thing the
 * paragraph beside it is about and not a whole page they have to search. Every shot is taken in both
 * themes and the post serves the one that matches the reader's own, so a figure never flashes white
 * on a dark page.
 *
 *   node scripts/build-blog-shots.mjs                    every shot, against https://kanmani.xyz
 *   node scripts/build-blog-shots.mjs --only qwen        one post's shots
 *   SITE=http://localhost:3400 node scripts/build-blog-shots.mjs
 *
 * Output: public/blog/<post>/<name>-<theme>.png, plus public/blog/shots.json recording when each was
 * taken and from which URL, so a figure caption can say what it shows and when.
 *
 * A shot whose element is missing fails loudly. Guessing a crop would put a picture of the wrong thing
 * next to a sentence about something else, which is worse than no picture.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = (process.env.SITE ?? "https://kanmani.xyz").replace(/\/$/, "");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";

/**
 * One entry per figure. `selector` is the element to crop to. `text`, when given, narrows to the
 * element of that selector containing it. `pad` adds breathing room around the crop. `prepare` runs
 * before the shot, for anything that has to be scrolled or opened first.
 */
const SHOTS = [
  // claim-truth: the ladder on one false claim and one true one, the panels that carry the verdict.
  { post: "claim-truth", name: "false-chain", path: "/claim/143_10181_0x01F90369170C917A2c0E9d26D54c6A3A400984D3_1", selector: "section.elevated", text: /what the chain says/i, width: 1200 },
  { post: "claim-truth", name: "false-head", path: "/claim/143_10181_0x01F90369170C917A2c0E9d26D54c6A3A400984D3_1", selector: "section", text: /No transaction with this hash/i, width: 1200 },
  { post: "claim-truth", name: "distribution", path: "/claims", selector: "section", text: /assert no payment/i, width: 1200, first: true },
  // qwen: the same tab-settlement claim after the induced mapping shipped (before is kept from an earlier capture)
  { post: "qwen", name: "after", path: "/claim/143_10255_0x49472EF9ED99f30d4eaD45Ac9E1C16c31f70783A_3", selector: "main", width: 1100, clipHeight: 760 },
  // nansen
  { post: "nansen", name: "cluster", path: "/operators", selector: "section", text: /distinct wallets/i, width: 1280 },
  { post: "nansen", name: "funders", path: "/operators", selector: "section.elevated", text: /who funded those wallets/, width: 1280 },
  // cleanverse
  { post: "cleanverse", name: "status", path: "/compliance", selector: "section.elevated", text: /live CVI status/i, width: 1200 },
  // mera
  { post: "mera-prf", name: "keys", path: "/account", selector: "section.elevated", text: /what this site has stored/i, width: 1200 },
];

const meta = existsSync(join(ROOT, "public/blog/shots.json"))
  ? JSON.parse(readFileSync(join(ROOT, "public/blog/shots.json"), "utf8"))
  : {};

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
let failed = 0;
try {
  for (const s of SHOTS) {
    if (ONLY && s.post !== ONLY) continue;
    for (const theme of ["dark", "light"]) {
      const ctx = await browser.newContext({
        viewport: { width: s.width ?? 1200, height: 1000 },
        deviceScaleFactor: 2,
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      // The stored theme wins over prefers-color-scheme, so pin it explicitly.
      await page.addInitScript((t) => localStorage.setItem("kanmani.theme", t), theme);
      try {
        await page.goto(SITE + s.path, { waitUntil: "networkidle", timeout: 60_000 });
        await page.waitForTimeout(800);
        // The sticky header would sit over the top of any crop scrolled under it.
        await page.addStyleTag({ content: ".site-header{position:static!important}.skip-link{display:none!important}" });
        let el = page.locator(s.selector);
        if (s.text) el = el.filter({ hasText: s.text });
        // The innermost match is the panel itself, not a page-wide wrapper that also contains the text.
        el = s.first ? el.first() : el.last();
        await el.waitFor({ timeout: 15_000 });
        await el.scrollIntoViewIfNeeded();
        const box = await el.boundingBox();
        if (!box) throw new Error("element has no box");
        // boundingBox is relative to the viewport, a full-page clip to the page. Add the scroll.
        const sy = await page.evaluate(() => window.scrollY);
        box.y += sy;
        const pad = s.pad ?? 16;
        const clip = {
          x: Math.max(0, box.x - pad),
          y: Math.max(0, box.y - pad),
          width: Math.min(box.width + pad * 2, s.width ?? 1200),
          height: Math.min(box.height + pad * 2, s.clipHeight ?? 1400),
        };
        const file = join(ROOT, "public/blog", s.post, `${s.name}-${theme}.png`);
        mkdirSync(dirname(file), { recursive: true });
        await page.screenshot({ path: file, clip, fullPage: true });
        meta[`${s.post}/${s.name}`] = { url: SITE + s.path, takenAt: new Date().toISOString(), width: Math.round(clip.width), height: Math.round(clip.height) };
        console.log(`ok    ${s.post}/${s.name}-${theme}  ${Math.round(clip.width)}x${Math.round(clip.height)}`);
      } catch (e) {
        failed++;
        console.log(`FAIL  ${s.post}/${s.name}-${theme}  ${(e).message.split("\n")[0]}`);
      } finally {
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(ROOT, "public/blog/shots.json"), JSON.stringify(meta, null, 2) + "\n");
process.exit(failed ? 1 : 0);
