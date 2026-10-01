#!/usr/bin/env node
// Every-state e2e for the /fund flow (item 3.2 Done-when: "e2e against a mocked API covers every state").
//
// Drives the live site with a mocked Aurora API (scripts/e2e/fixtures/fund-mock.mjs), so no key and no
// network are touched and the status sequence is deterministic. Asserts the flow walks the right
// data-state values on [data-testid="fund-flow"] per track. Written to agent 01's convention: URL from
// argv[2], system Chrome, one line per check, non-zero exit on failure, SKIP (exit 2) if /fund has no flow.
//
// Not run by the lane gate (node --check only); it runs against a built app once one is up, and against
// the deployed site after the key lands.
import { chromium } from "playwright";
import { installEip1193, routeFund, DEPOSIT_ADDRESS, DESTINATION_TX } from "./fixtures/fund-mock.mjs";

const BASE = process.argv[2] ?? "https://kanmani.xyz";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const AGENT = "0x1111111111111111111111111111111111111111";

let failed = 0;
const ok = (name) => console.log(`ok   - ${name}`);
const bad = (name, err) => {
  failed += 1;
  console.log(`FAIL - ${name}: ${err && err.message ? err.message : err}`);
};

async function stateReaches(page, state, timeout = 15000) {
  await page.waitForSelector(`[data-testid="fund-flow"][data-state="${state}"]`, { timeout });
}

async function startQuote(page) {
  await page.fill('[data-testid="fund-agent"]', AGENT);
  await page.fill('[data-testid="fund-amount"]', "0.12");
  await page.click('[data-testid="fund-quote-btn"]');
}

async function runTrack(browser, track, states, extra) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installEip1193(page);
  await routeFund(page, { track });
  const res = await page.goto(`${BASE}/fund`, { waitUntil: "domcontentloaded" });
  if (!res || !(await page.$('[data-testid="fund-flow"]'))) {
    console.log(`SKIP - /fund has no interactive flow yet`);
    await context.close();
    process.exit(2);
  }
  try {
    await startQuote(page);
    await stateReaches(page, "quote");
    if (track !== "quote-error" && track !== "shortfall-at-create") {
      await page.click('[data-testid="fund-sign"]');
    } else if (track === "shortfall-at-create") {
      await page.click('[data-testid="fund-sign"]');
    }
    for (const s of states) await stateReaches(page, s);
    if (extra) await extra(page);
    ok(`track ${track}: ${["form", ...states].join(" -> ")}`);
  } catch (e) {
    bad(`track ${track}`, e);
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  try {
    // quote-error: the quote fails, the flow goes to error and does not advance.
    await runTrack(browser, "quote-error", ["error"]);

    // shortfall-at-create: create returns a delivery below the job, the client guard drops back to quote.
    await runTrack(browser, "shortfall-at-create", ["quote"]);

    // happy: form -> quote -> signing -> awaiting-deposit -> bridging -> funded, with address, QR and tx.
    await runTrack(browser, "happy", ["signing", "awaiting-deposit", "bridging", "funded"], async (page) => {
      const addr = await page.textContent('[data-testid="fund-deposit-address"]');
      if (!addr || !addr.includes(DEPOSIT_ADDRESS)) throw new Error("deposit address not shown in full");
      if (!(await page.$('[data-testid="fund-deposit-qr"]'))) throw new Error("deposit QR svg missing");
      const min = await page.textContent('[data-testid="fund-quote-min"]');
      if (!min || !/\d/.test(min)) throw new Error("quote min not rendered");
      const tx = await page.getAttribute('[data-testid="fund-tx"]', "href");
      if (!tx || !tx.includes(`monadexplorer.com/tx/${DESTINATION_TX}`)) throw new Error("funded destination tx link missing");
    });

    // short: ... -> short-landing, copy names the intermediary and a recovery, not a refund.
    await runTrack(browser, "short", ["signing", "awaiting-deposit", "bridging", "short-landing"], async (page) => {
      const body = (await page.textContent('[data-state="short-landing"]')) ?? "";
      if (!/intermediary/i.test(body) || /refund/i.test(body)) throw new Error("short-landing copy wrong");
    });

    // expired: ... -> expired, copy says refunded, not stuck in intermediary.
    await runTrack(browser, "expired", ["signing", "awaiting-deposit", "expired"], async (page) => {
      const body = (await page.textContent('[data-state="expired"]')) ?? "";
      if (!/refund/i.test(body)) throw new Error("expired copy should say refunded");
    });
  } finally {
    await browser.close();
  }
  if (failed > 0) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall /fund states covered");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
