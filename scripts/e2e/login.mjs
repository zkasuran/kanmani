#!/usr/bin/env node
/**
 * Smoke: /login renders its passkey ceremony surface and a virtual authenticator can seed a
 * credential against it. This is the harness slot (flagship 0.1). Flagship 1.4 (stateless, 10/10)
 * deepens this file with the PRF-derived key assertions; it adds no runner wiring, because run.mjs
 * discovers suites by filename.
 *
 *   node scripts/e2e/login.mjs [url]     default https://kanmani.xyz
 *
 * Exits 2 (SKIP) if the virtual authenticator cannot seed against the given URL, which is a real
 * state for a remote origin rather than a failure of the page.
 */
import { argUrl, launchChrome, checks, installVirtualAuthenticator, webAuthnAvailable, createCredential, skip } from "./lib.mjs";

const url = argUrl();
const c = checks("login");
const browser = await launchChrome();

try {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  await installVirtualAuthenticator(page);
  const res = await page.goto(url + "/login", { waitUntil: "networkidle", timeout: 45000 });
  c.check((res ? res.status() : 0) === 200, `GET /login -> ${res ? res.status() : 0}`);

  const body = await page.locator("body").innerText();
  c.check(/passkey/i.test(body), "the passkey ceremony surface renders");
  c.check(await webAuthnAvailable(page), "webAuthn is available in the page");

  const created = await createCredential(page);
  if (created !== true) skip(`virtual authenticator did not seed against ${url}: ${created}`);
  c.ok("the virtual authenticator seeded one credential");
} finally {
  await browser.close();
}

c.exit();
