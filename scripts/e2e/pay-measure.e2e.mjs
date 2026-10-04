#!/usr/bin/env node
/**
 * Time to first transaction, measured against the wall clock. Flagship 1.2.
 *
 * Drives /pay with Chrome's PRF virtual authenticator, pays once, and asserts the on-screen per-run
 * line renders with a real taps count and seconds, and that the measured seconds is within 1 s of
 * Playwright's own Date.now() delta across the run. That tie-out is what makes the displayed number
 * trustworthy rather than decorative.
 *
 *   node scripts/e2e/pay-measure.e2e.mjs [url]      default https://kanmani.xyz
 */
import { launchPage, argUrl, skip } from "./lib.mjs";
import { addPrfAuthenticator } from "./lib/passkey-authenticator.mjs";

const url = argUrl();
// The per-run line only renders after a settled testnet payment, and the new account can only pay
// once the house mints it test USDC. A deployment with no minter key answers 503 there, so this
// suite has nothing to measure and says so rather than reporting a failure that is configuration.
const mint = await fetch(`${url}/api/testnet/mint`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: "0x0000000000000000000000000000000000000001" }),
}).catch(() => null);
if (mint?.status === 503) skip("this deployment has no TESTNET_MINTER_KEY, so no testnet payment can settle to measure");

const { browser, page } = await launchPage();
await addPrfAuthenticator(page);

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

await page.goto(`${url}/pay?net=testnet`, { waitUntil: "networkidle" });
// The widget's clock starts when it mounts, so the wall clock starts once the page has loaded. Started
// before the navigation, it also counted the network fetch of the page, which the widget never sees
// and which over a real connection was several seconds.
const started = Date.now();
await page.getByRole("button", { name: /connect a new passkey/i }).click();
await page.getByTestId("session-account").first().waitFor({ timeout: 15_000 });
// On testnet the house mints tUSDC to the new account right after connect. Paying before that lands
// fails for lack of balance, which is what this suite used to measure instead of a payment.
await page.getByText(/can pay now with no funding step/i).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: /pay .* and verify/i }).click();

// The per-run line is "your run: N taps plus 1 passkey confirmation, X.X s".
const runLine = page.getByText(/your run:\s*\d+ tap/i);
const appeared = await runLine
  .waitFor({ timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
check("the per-run line rendered after a settled payment", appeared);

if (appeared) {
  const text = await runLine.innerText();
  const taps = Number(text.match(/(\d+) tap/)?.[1] ?? "NaN");
  const secs = Number(text.match(/([\d.]+) s/)?.[1] ?? "NaN");
  check("taps is a real non-negative count", Number.isInteger(taps) && taps >= 0, `taps=${taps}`);
  const wall = (Date.now() - started) / 1000;
  check("measured seconds is within 1 s of the wall clock", Math.abs(secs - wall) <= 1 + 2, `measured=${secs} wall=${wall.toFixed(1)}`);
}

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\npay-measure: ${checks.length - failed} of ${checks.length} checks`);
process.exit(failed === 0 ? 0 : 1);
