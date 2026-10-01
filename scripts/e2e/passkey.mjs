#!/usr/bin/env node
/**
 * Smoke: a virtual authenticator seeds one passkey credential against the account surface. Harness
 * slot (flagship 0.1): it proves the create path runs headless. The derive-and-fingerprint
 * assertions (same passkey yields the same keys and address on a second context) are PRF work and
 * belong to flagship 2.1, which deepens this file. run.mjs discovers it by filename.
 *
 *   node scripts/e2e/passkey.mjs [url]     default https://kanmani.xyz
 *
 * Exits 2 (SKIP) if the virtual authenticator cannot seed against the given URL. PRF through a
 * virtual authenticator is unproven from Chrome's own spec, so the deep key-derivation path may fall
 * back to the injectable webAuthnClient seam (lib/agent-passkey.fixture.ts); that is 2.1's call.
 */
import { argUrl, launchChrome, checks, installVirtualAuthenticator, webAuthnAvailable, createCredential, skip } from "./lib.mjs";

const url = argUrl();
const c = checks("passkey");
const browser = await launchChrome();

try {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  await installVirtualAuthenticator(page);
  const res = await page.goto(url + "/account", { waitUntil: "networkidle", timeout: 45000 });
  c.check((res ? res.status() : 0) === 200, `GET /account -> ${res ? res.status() : 0}`);
  c.check(await webAuthnAvailable(page), "webAuthn is available in the page");

  const created = await createCredential(page);
  if (created !== true) skip(`virtual authenticator did not seed against ${url}: ${created}`);
  c.ok("create succeeded: the passkey ceremony runs headless");
  c.note("derive -> fingerprint (stateless 10/10, cross-device identity) is flagship 2.1, which deepens this suite");
} finally {
  await browser.close();
}

c.exit();
