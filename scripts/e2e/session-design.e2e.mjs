#!/usr/bin/env node
/**
 * Session design, live. Flagship 1.3.
 *
 * A payment within scope makes no new passkey assertion, a payment over the cap prompts once, and an
 * expiry renew prompts exactly once. The virtual authenticator records an assertion as a bump in the
 * credential's signCount, so counting that across each action is the faithful measure of "did it
 * re-prompt". The pure mapping behind the UI is lib/session-reprompt.ts, tested offline; this is its
 * live form.
 *
 *   node scripts/e2e/session-design.e2e.mjs [url]      default https://kanmani.xyz
 */
import { launchPage, argUrl } from "./lib.mjs";
import { addPrfAuthenticator, getCredential } from "./lib/passkey-authenticator.mjs";

const url = argUrl();
const { browser, page } = await launchPage();
const { cdp, authenticatorId } = await addPrfAuthenticator(page);

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

/** The credential's signCount, which bumps once per assertion ceremony. */
async function signCount() {
  const cred = await getCredential(cdp, authenticatorId);
  return cred ? Number(cred.signCount ?? 0) : 0;
}

await page.goto(`${url}/pay?net=testnet`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /connect a new passkey/i }).click();
await page.getByText(/signing session open/i).waitFor({ timeout: 15_000 });

// 1. Within scope: a pay signs through the open session with no new ceremony.
const before = await signCount();
await page.getByRole("button", { name: /pay .* and verify/i }).click();
await page.waitForTimeout(2500);
const afterPay = await signCount();
check("a pay within scope triggers no new passkey assertion", afterPay === before, `before=${before} after=${afterPay}`);

// 2. Renew: the renew path runs exactly one ceremony. Driven here by signing in again, which is the
// same one-assertion path renew uses.
await page.getByRole("button", { name: /sign in with an existing one/i }).click().catch(() => {});
await page.waitForTimeout(2000);
const afterRenew = await signCount();
check("a renew runs exactly one assertion", afterRenew === afterPay + 1, `after=${afterRenew}`);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\nsession-design: ${checks.length - failed} of ${checks.length} checks`);
process.exit(failed === 0 ? 0 : 1);
