#!/usr/bin/env node
/**
 * Smoke: the agents section of /account (formerly /studio) renders its register-and-sign flow and a virtual authenticator can seed against it.
 * Harness slot (flagship 0.1). The deep signing-step assertions belong to flagship 1.4 / 2.1, which
 * deepen this file; run.mjs discovers it either way.
 *
 *   node scripts/e2e/studio.mjs [url]     default https://kanmani.xyz
 *
 * Exits 2 (SKIP) if the virtual authenticator cannot seed against the given URL.
 */
import { argUrl, launchChrome, checks, installVirtualAuthenticator, webAuthnAvailable, createCredential, skip } from "./lib.mjs";

const url = argUrl();
const c = checks("studio");
const browser = await launchChrome();

try {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  await installVirtualAuthenticator(page);
  const res = await page.goto(url + "/account#agents", { waitUntil: "networkidle", timeout: 45000 });
  c.check((res ? res.status() : 0) === 200, `GET /account#agents -> ${res ? res.status() : 0}`);

  const body = await page.locator("body").innerText();
  c.check(/register|repoint|document/i.test(body), "the register-and-sign flow renders");
  c.check(await webAuthnAvailable(page), "webAuthn is available in the page");

  const created = await createCredential(page);
  if (created !== true) skip(`virtual authenticator did not seed against ${url}: ${created}`);
  c.ok("the virtual authenticator seeded one credential for the signing step");
} finally {
  await browser.close();
}

c.exit();
