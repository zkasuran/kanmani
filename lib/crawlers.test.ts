import { test } from "node:test";
import assert from "node:assert/strict";
import robots from "../app/robots.ts";
import { ALWAYS_ALLOWED, BLOCKED_CRAWLERS, CRAWL_DELAY_SECONDS } from "./crawlers.ts";

test("no search engine or AI agent is on the blocked list", () => {
  const blocked = BLOCKED_CRAWLERS.map((b) => b.toLowerCase());
  for (const ok of ALWAYS_ALLOWED) assert.equal(blocked.includes(ok.toLowerCase()), false, ok);
});

test("the scraper that was in the 19 October access log is blocked", () => {
  assert.ok(BLOCKED_CRAWLERS.includes("SERankingBacklinksBot"));
});

test("robots.txt allows everyone by default with a crawl delay, and turns the listed scrapers away", () => {
  const r = robots();
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
  const star = rules.find((x) => x.userAgent === "*")!;
  assert.equal(star.allow, "/");
  assert.equal(star.crawlDelay, CRAWL_DELAY_SECONDS);
  const turned = rules.find((x) => Array.isArray(x.userAgent))!;
  assert.equal(turned.disallow, "/");
  assert.deepEqual(turned.userAgent, [...BLOCKED_CRAWLERS]);
  assert.equal(r.sitemap, "https://kanmani.xyz/sitemap.xml");
});

test("the default rule never disallows anything, so the API, llms.txt and the feed stay readable", () => {
  const rules = (Array.isArray(robots().rules) ? robots().rules : [robots().rules]) as { userAgent: unknown; disallow?: unknown }[];
  assert.equal(rules.find((x) => x.userAgent === "*")!.disallow, undefined);
});

import { POOL_WARN_EVERY_MS, shouldWarnPoolPressure } from "./db.ts";

test("pool pressure is logged only when queries are queueing, and at most once every thirty seconds", () => {
  assert.equal(shouldWarnPoolPressure(0, 1_000_000, 0), false, "an idle pool says nothing");
  assert.equal(shouldWarnPoolPressure(2, 1_000_000, 0), false, "two waiting is ordinary");
  assert.equal(shouldWarnPoolPressure(3, 1_000_000, 0), true);
  assert.equal(shouldWarnPoolPressure(40, 1_000_000, 1_000_000 - POOL_WARN_EVERY_MS + 1), false, "too soon after the last line");
  assert.equal(shouldWarnPoolPressure(40, 1_000_000, 1_000_000 - POOL_WARN_EVERY_MS), true);
});
