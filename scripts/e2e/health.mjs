#!/usr/bin/env node
/**
 * Every public route answers under 400, with no console error and no uncaught page error, in both
 * colour schemes. This reconstructs the "health 0" number the old /tmp/shots suite reported before
 * it was wiped (.hq/MEMORY.md): 0 broken routes is the pass.
 *
 *   node scripts/e2e/health.mjs [url]     default https://kanmani.xyz
 *
 * Reads through Playwright's own events rather than injecting any script, so the site's strict CSP
 * cannot make the probe itself look like a violation.
 */
import { argUrl, launchChrome, checks, collectPageErrors } from "./lib.mjs";

const ROUTES = [
  "/",
  "/claims",
  "/operators",
  "/method",
  "/status",
  "/bond",
  "/pay",
  "/account",
  "/hire",
  "/validate",
  "/chains",
  "/developers",
  "/blog/qwen",
  "/login",
  "/login?tab=create",
  "/fund",
];

const url = argUrl();
// 32 page loads in about a minute add up to more than the site's 600 requests a minute per client, so the
// last routes answered 429 and the suite called the site broken. E2E_ROUTE_PAUSE_MS spaces them out.
// Zero by default, so a local run is as fast as it was.
const routePause = Math.max(0, Number(process.env.E2E_ROUTE_PAUSE_MS ?? 0) || 0);
const c = checks("health");
const browser = await launchChrome();

try {
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1360, height: 900 } });
    for (const route of ROUTES) {
      if (routePause > 0) await new Promise((r) => setTimeout(r, routePause));
      const page = await context.newPage();
      const errors = collectPageErrors(page);
      let status = 0;
      try {
        const res = await page.goto(url + route, { waitUntil: "networkidle", timeout: 45000 });
        status = res ? res.status() : 0;
        // Give client components a beat to mount and throw if they are going to.
        await page.waitForTimeout(400);
      } catch (e) {
        errors.push(`goto: ${e instanceof Error ? e.message : String(e)}`);
      }
      const okStatus = status > 0 && status < 400;
      const clean = errors.length === 0;
      c.check(okStatus && clean, `${scheme.padEnd(5)} ${route.padEnd(16)} HTTP ${status || "none"}${clean ? "" : `  ${errors.length} error(s)`}`);
      if (!clean) for (const e of errors.slice(0, 3)) c.note(e.slice(0, 160));
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}

c.exit();
