#!/usr/bin/env node
/**
 * The /bond page renders its panels and shows a live bond state, with no console error. Read-only:
 * no wallet is connected and nothing is posted, so this runs anonymously against the live URL.
 *
 *   node scripts/e2e/bond.mjs [url]     default https://kanmani.xyz
 *
 * The bond list reads Sclera on each load (app/bond/page.tsx), so a state word in the body is proof
 * the contract read resolved rather than threw.
 */
import { argUrl, launchChrome, checks, collectPageErrors } from "./lib.mjs";

const url = argUrl();
const c = checks("bond");
const browser = await launchChrome();

try {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const errors = collectPageErrors(page);
  const res = await page.goto(url + "/bond", { waitUntil: "networkidle", timeout: 45000 });
  const status = res ? res.status() : 0;
  c.check(status === 200, `GET /bond -> ${status}`);

  const body = await page.locator("body").innerText();
  c.check(/bond your own agent/i.test(body), "the post-a-bond panel renders");
  const state = body.match(/\b(active|released|slashed|unbonded|releasable)\b/i);
  c.check(Boolean(state), `a live bond state is shown${state ? `: ${state[0]}` : ""}`);
  c.check(/USDC/.test(body), "the staked amount is shown in USDC");
  c.check(errors.length === 0, `no console or page error${errors.length ? `: ${errors.length}` : ""}`);
  for (const e of errors.slice(0, 3)) c.note(e.slice(0, 160));
} finally {
  await browser.close();
}

c.exit();
