#!/usr/bin/env node
/**
 * A number on this site is never wrong, even for one frame. This proves it.
 *
 * On 2026-09-28 the landing's lead finding rendered as "0 of those payments are real" when the truth
 * was 64, because the counter animation reset to zero on mount and waited to be scrolled into view.
 * A first fix then rendered 8,093 as 1,647 in a full-page capture, because it offset off-screen digits
 * while waiting. Both looked fine to a reader scrolling normally. Both were caught only by reading what
 * each digit strip is ACTUALLY translated to in a real browser.
 *
 * So this reads the computed transform of every odometer strip and compares the digits a human would
 * see and the text a machine would read, against data-value, in the three ways a page is consumed:
 *
 *   static    no scroll at all: screenshot tools, link previews, print, reader mode
 *   scroll    a reader scrolling the full page
 *   reduced   prefers-reduced-motion
 *   capture   viewport grown to the full page, as full-page screenshots and previews do
 *
 *   node scripts/check-numbers.mjs [url]     default https://kanmani.xyz/
 *
 * Exit 0 only if every counter is correct in every mode.
 */
import { chromium } from "playwright";

const url = process.argv[2] ?? "https://kanmani.xyz/";
const exe = process.env.CHROME ?? "/usr/bin/google-chrome";

async function read(mode) {
  const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const p = await b.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: mode === "reduced" ? "reduce" : "no-preference",
    });
    await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    if (mode === "capture") {
      // What a full-page screenshot or link preview does: grow the viewport to the whole document,
      // no scrolling. This mode found 64 rendered as 18 after the first three passed.
      await p.waitForTimeout(1500);
      const H = await p.evaluate(() => document.body.scrollHeight);
      await p.setViewportSize({ width: 1440, height: H });
      await p.waitForTimeout(400);
    } else if (mode === "scroll") {
      await p.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 90));
        }
      });
      await p.waitForTimeout(3000);
    } else {
      await p.waitForTimeout(1500);
    }
    return await p.evaluate(() =>
      [...document.querySelectorAll(".odometer")].map((o) => ({
        truth: o.getAttribute("data-value"),
        // What a search engine, copy and paste or an agent reading the HTML gets.
        read: (o.textContent || "").trim(),
        seen: [...o.children]
          .map((c) => {
            if (c.classList.contains("odometer__sep")) return c.textContent;
            const strip = c.querySelector(".odometer__strip");
            const ty = new DOMMatrix(getComputedStyle(strip).transform).m42;
            return String(Math.round(-ty / parseFloat(getComputedStyle(strip).fontSize)));
          })
          .join(""),
      })),
    );
  } finally {
    await b.close();
  }
}

let bad = 0;
let total = 0;
for (const mode of ["static", "scroll", "reduced", "capture"]) {
  const rows = await read(mode);
  if (rows.length === 0) {
    console.log(`  ${mode.padEnd(8)} no counters found, which is itself a failure: nothing was checked`);
    total++;
    bad++;
    continue;
  }
  for (const r of rows) {
    total++;
    // Two ways to be wrong, both caught: the digits a person sees and the text a machine reads. An
    // earlier cut got the first right and read 8,093 as "80123456789,0012345678990..." in the second.
    const ok = r.truth === r.seen && r.truth === r.read;
    if (!ok) bad++;
    const why = r.truth !== r.seen ? ` seen ${r.seen}` : r.truth !== r.read ? ` read "${r.read.slice(0, 24)}"` : "";
    console.log(`  ${ok ? "OK   " : "WRONG"} ${mode.padEnd(8)} true ${String(r.truth).padEnd(8)}${ok ? " seen and read correctly" : why}`);
  }
}
console.log(`\n  ${total - bad} of ${total} readings correct${bad ? `, ${bad} WRONG` : ""}`);
process.exit(bad ? 1 : 0);
