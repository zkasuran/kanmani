#!/usr/bin/env node
/**
 * The top menu must reach every submenu item by the path a person actually takes.
 *
 * Panels open leftward from their label, so reaching an item on the left means travelling diagonally
 * across the neighbouring labels. With instant switching, 6 of 12 such routes landed on the wrong menu
 * or on none. This moves the mouse from each label to its panel's first and last item at a realistic
 * event rate and checks which menu is open and which item is under the pointer on arrival.
 *
 *   node scripts/e2e/nav.mjs [url] [width]      defaults https://kanmani.xyz/ 1440
 *   npm run e2e                                 runs this and every other suite under scripts/e2e/
 */
import { chromium } from "playwright";

const exe = process.env.CHROME ?? "/usr/bin/google-chrome";
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: +(process.argv[3] ?? 1440), height: 900 } });
// The menu's hover intent is a set of timers (90ms to open, 120ms to scan, 300ms to settle), so the
// test has to control time rather than hope for it. Headless Chrome software-renders the blurred
// glass panels and takes several hundred milliseconds per mouse step, so with the real clock every
// timer fired between steps and the test reported a hand that "rested" on each label it crossed.
// A person crosses those few pixels in one 16ms frame. The page clock is paused and driven by hand,
// one frame per step, so the menu sees the pace a real mouse delivers whatever the renderer costs.
await p.clock.install();
await p.goto((process.argv[2] ?? "https://kanmani.xyz/"), { waitUntil: "networkidle" });
// install() alone lets fake time keep flowing with the wall clock, so a slow step still let the timers
// fire. Paused, the page only moves forward when runFor says so.
await p.clock.pauseAt(Date.now() + 1000);
const labels = await p.$$eval("nav a[aria-haspopup]", els => els.map(e => { const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
let broken = 0;
for (const l of labels) {
  for (const target of ["first-left", "last"]) {
    await p.mouse.move(700, 600); await p.clock.runFor(300);
    await p.mouse.move(l.x, l.y); await p.clock.runFor(220);
    const items = await p.$$eval('[role="menu"] [role="menuitem"]', els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x + 24, y: r.y + r.height / 2, t: e.textContent.trim().split(/\s/)[0] }; }));
    if (!items.length) { console.log(`  ${l.text}: no items`); continue; }
    const goal = target === "last" ? items.at(-1) : items[0];
    // A person moves in a roughly straight line at a normal pace, about 300ms for this distance: 18
    // steps, one 16ms frame each on the page clock. Real input events, so enter and leave fire.
    await p.mouse.move(l.x, l.y);
    const STEPS = 18;
    for (let i = 1; i <= STEPS; i++) {
      await p.mouse.move(l.x + ((goal.x - l.x) * i) / STEPS, l.y + ((goal.y - l.y) * i) / STEPS);
      await p.clock.runFor(16);
    }
    await p.clock.runFor(60);
    const open = await p.$eval('[role="menu"]', m => m.getAttribute("aria-label")).catch(() => null);
    const under = await p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="menuitem"]')?.textContent.trim().split(/\s/)[0] ?? null, goal);
    const ok = open === l.text && under === goal.t;
    if (!ok) broken++;
    console.log(`  ${ok ? "ok   " : "BUG  "} ${l.text.padEnd(10)} -> ${target.padEnd(10)} "${goal.t}"  open menu on arrival: ${open}  under pointer: ${under}`);
  }
}
console.log(`\n  broken paths: ${broken} of ${labels.length * 2}`);
await b.close();
process.exit(broken ? 1 : 0);
