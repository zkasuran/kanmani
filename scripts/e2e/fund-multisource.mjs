#!/usr/bin/env node
// Multi-source quotes e2e (item 3.4): the panel renders one quote row per source chain, each with a
// delivery, a fee and a pass/refuse chip, and the Solana row is tagged non-EVM. Mocked quote route.
// Not run by the gate (node --check only).
import { chromium } from "playwright";
import { installEip1193, routeFund } from "./fixtures/fund-mock.mjs";

const BASE = process.argv[2] ?? "https://kanmani.xyz";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await installEip1193(page);
  await routeFund(page, { track: "happy" });
  const res = await page.goto(`${BASE}/fund`, { waitUntil: "domcontentloaded" });
  if (!res || !(await page.$('[data-testid="multisource"]'))) {
    console.log("SKIP - /fund has no multi-source panel yet");
    await context.close();
    await browser.close();
    process.exit(2);
  }
  let failed = 0;
  try {
    await page.waitForSelector('[data-testid="multisource-min"]', { timeout: 15000 });
    const rows = await page.$$('[data-testid="multisource-row"]');
    if (rows.length < 4) throw new Error(`expected >=4 source rows, saw ${rows.length}`);
    const mins = await page.$$('[data-testid="multisource-min"]');
    const fees = await page.$$('[data-testid="multisource-fee"]');
    const chips = await page.$$('[data-testid="multisource-chip"]');
    if (mins.length < 4 || fees.length < 4 || chips.length < 4) throw new Error("rows missing min, fee or chip");
    if (!(await page.$('[data-testid="tag-nonevm"]'))) throw new Error("no non-EVM tag (Solana) rendered");
    console.log(`ok   - ${rows.length} source rows, each with delivery, fee and a pass/refuse chip; non-EVM tagged`);
  } catch (e) {
    failed = 1;
    console.log(`FAIL - multi-source: ${e && e.message ? e.message : e}`);
  } finally {
    await context.close();
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
