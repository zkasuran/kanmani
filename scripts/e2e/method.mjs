#!/usr/bin/env node
/**
 * The /method review-queue panel renders, states the never-auto-applied posture, and when the queue
 * has rows the model reads qwen3.8-max. Both colour schemes, zero console or page errors. This is the
 * flagship 9.2 check (spec 19 D.2); run.mjs discovers it by filename, so it needs no runner wiring.
 *
 *   node scripts/e2e/method.mjs [url]     default https://kanmani.xyz
 *
 * The queue is empty until the proposer runs against the live gap, so the model assertion is made
 * only when a row is present. The posture sentence is asserted in every state, because that is the
 * invariant a regression would break.
 */
import { argUrl, launchChrome, checks, collectPageErrors } from "./lib.mjs";

const POSTURE = "Nothing on this queue has changed a verdict on this site";

const url = argUrl();
const c = checks("method");
const browser = await launchChrome();

try {
  for (const scheme of ["light", "dark"]) {
    const page = await (await browser.newContext({ colorScheme: scheme, viewport: { width: 1360, height: 900 } })).newPage();
    const errors = collectPageErrors(page);
    const res = await page.goto(url + "/method", { waitUntil: "networkidle", timeout: 45000 });
    c.check((res ? res.status() : 0) === 200, `${scheme.padEnd(5)} GET /method -> ${res ? res.status() : 0}`);

    const body = await page.locator("body").innerText();
    c.check(/the review queue/i.test(body), `${scheme.padEnd(5)} the review-queue panel renders`);
    c.check(body.includes(POSTURE), `${scheme.padEnd(5)} the never-auto-applied posture is stated`);

    const empty = /The queue is empty right now/i.test(body);
    if (empty) {
      c.note(`${scheme}: queue is empty (no keyed proposer run yet), model assertion skipped`);
    } else {
      c.check(/qwen3\.8-max/i.test(body), `${scheme.padEnd(5)} a queued proposal names model qwen3.8-max`);
    }

    c.check(errors.length === 0, `${scheme.padEnd(5)} no console or page error${errors.length ? `: ${errors.length}` : ""}`);
    for (const e of errors.slice(0, 3)) c.note(e.slice(0, 160));
    await page.close();
  }
} finally {
  await browser.close();
}

c.exit();
