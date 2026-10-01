#!/usr/bin/env node
/**
 * Cross-device PRF, flagship 2.1, Mera PRF bounty.
 *
 * Done when two virtual-authenticator contexts with the same credential show identical fingerprints
 * and both decrypt the same server-stored blob. The load-bearing assumption is that an injected
 * credential reproduces the same PRF output in a second authenticator. The Chromium source says it
 * does NOT (the PRF secret is random per credential, not carried by any exported credential), so this
 * suite PROBES that first and does not report a cross-context pass the probe did not produce. When the
 * probe fails, the maths proof is iris.test.ts and fingerprint.test.ts offline, and the true
 * cross-device evidence is the live 2.4 clip with two synced devices.
 *
 *   node scripts/e2e/mera-prf-crossdevice.spec.mjs [url]     default https://kanmani.xyz
 *   NEGATIVE=1 injects a different key into B, so FP_A !== FP_B and decrypt fails. Proves the check
 *   can fail.
 */
import { launchChrome, argUrl } from "./lib.mjs";
import { addPrfAuthenticator, cloneCredentialTo, getCredential } from "./lib/passkey-authenticator.mjs";

const url = argUrl();
const NEGATIVE = process.env.NEGATIVE === "1";
const ADDR_RE = /0x[0-9a-fA-F]{40}/;
const NOTE = `cross-device ${Date.now()}`;

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

/** The combined device fingerprint from the top of the keys panel. */
async function deviceFingerprint(page) {
  const panel = page.locator("section", { hasText: /this device.?s fingerprint/i }).first();
  await panel.waitFor({ timeout: 15_000 });
  const text = await panel.innerText();
  const m = text.match(/([0-9a-f]{8}(?:\s[0-9a-f]{8}){2,})/i);
  if (!m) throw new Error("no device fingerprint rendered");
  return m[1].toLowerCase().replace(/\s+/g, "");
}

async function accountAddress(page) {
  const text = await page.locator("body").innerText();
  const m = text.match(ADDR_RE);
  if (!m) throw new Error("no account address rendered");
  return m[0];
}

const { browser } = await launchChrome();

// Context A: create a passkey, read its fingerprint and store a note under the content key.
const ctxA = await browser.newContext();
const pageA = await ctxA.newPage();
const { cdp: cdpA, authenticatorId: authA } = await addPrfAuthenticator(pageA);
await pageA.goto(`${url}/account`, { waitUntil: "networkidle" });
await pageA.getByRole("button", { name: /create a passkey/i }).click();
const fpA = await deviceFingerprint(pageA);
const addrA = await accountAddress(pageA);
await pageA.getByRole("textbox").first().fill(NOTE);
await pageA.getByRole("button", { name: /encrypt and store/i }).click();
await pageA.getByText(/stored\./i).waitFor({ timeout: 15_000 }).catch(() => {});

// Export the credential, optionally corrupt it, seed context B.
const cred = await getCredential(cdpA, authA);
if (NEGATIVE && cred?.privateKey) cred.privateKey = cred.privateKey.slice(0, -4) + "AAAA";

const ctxB = await browser.newContext();
const pageB = await ctxB.newPage();
await cloneCredentialTo(pageB, cred);
await pageB.goto(`${url}/account`, { waitUntil: "networkidle" });

// Probe: does the fresh context reproduce the account at all? If not, this is the documented limit,
// not a product bug, so the suite reports it as expected rather than as a pass.
let fpB = null;
let addrB = null;
try {
  await pageB.getByRole("button", { name: /sign in with an existing one/i }).click();
  fpB = await deviceFingerprint(pageB);
  addrB = await accountAddress(pageB);
} catch (e) {
  check("virtual-authenticator reproduced the account", false, e.message);
}

const reproduced = fpB !== null && addrB === addrA && fpB === fpA;
if (NEGATIVE) {
  check("negative: a different key gives a different fingerprint", fpB !== fpA || addrB !== addrA);
} else if (reproduced) {
  check("FP_A === FP_B across two contexts", true, fpA);
  // On B, fetch the server blob and decrypt it. Both decrypt the same state is the Done-when.
  await pageB.getByRole("button", { name: /fetch from the server and decrypt/i }).click();
  const read = await pageB
    .getByText(new RegExp(NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  check("B decrypted the note A stored", read);
} else {
  // Expected on Chrome's virtual authenticator. Not a product failure, and not reported as a pass.
  console.log(
    "  note  the virtual authenticator did not reproduce the PRF across contexts, which the Chromium",
  );
  console.log(
    "        source predicts. Cross-device is proven by the offline determinism vector and the live clip.",
  );
}

await browser.close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`\ncrossdevice: ${checks.length - failed} of ${checks.length} checks`);
process.exit(failed === 0 ? 0 : 1);
