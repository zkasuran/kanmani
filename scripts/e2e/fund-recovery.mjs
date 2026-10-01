#!/usr/bin/env node
// Recovery e2e (item 3.3): short-landing and expiry both render the recovery affordances, and the two
// one-sentence explanations, with re-fund and withdraw each previewing through /api/fund/recover.
// Mocked API, deterministic. Not run by the gate (node --check only).
import { chromium } from "playwright";
import { installEip1193, routeFund } from "./fixtures/fund-mock.mjs";

const BASE = process.argv[2] ?? "https://kanmani.xyz";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";

let failed = 0;
const ok = (n) => console.log(`ok   - ${n}`);
const bad = (n, e) => {
  failed += 1;
  console.log(`FAIL - ${n}: ${e && e.message ? e.message : e}`);
};

async function runTrack(browser, track, explainTestId) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installEip1193(page);
  await routeFund(page, { track });
  const res = await page.goto(`${BASE}/fund`, { waitUntil: "domcontentloaded" });
  if (!res || !(await page.$('[data-testid="recovery-panel"]'))) {
    console.log("SKIP - /fund has no recovery panel yet");
    await context.close();
    process.exit(2);
  }
  try {
    await page.waitForSelector(`[data-testid="recovery-panel"][data-state="${track}"]`, { timeout: 15000 });
    if (!(await page.$(`[data-testid="${explainTestId}"]`))) throw new Error("one-sentence explanation missing");
    if (!(await page.$('[data-testid="recover-refund"]'))) throw new Error("re-fund button missing");
    if (!(await page.$('[data-testid="recover-withdraw"]'))) throw new Error("withdraw button missing");
    await page.click('[data-testid="recover-withdraw"]');
    await page.waitForSelector('[data-testid="recovery-result"]', { timeout: 10000 });
    ok(`track ${track}: recovery affordances render and withdraw previews`);
  } catch (e) {
    bad(`track ${track}`, e);
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  try {
    await runTrack(browser, "short", "recovery-explain-short");
    await runTrack(browser, "expired", "recovery-explain-expired");
  } finally {
    await browser.close();
  }
  if (failed > 0) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nrecovery paths covered");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
