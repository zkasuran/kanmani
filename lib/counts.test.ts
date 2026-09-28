import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SUITES, TESTS_PASSING, TESTS_SKIPPED } from "./counts.ts";

test("the published total is the sum of the suites, not a typed figure", () => {
  assert.equal(TESTS_PASSING, 237 + 181 + 119);
  assert.equal(TESTS_SKIPPED, 3 + 17 + 8);
});

test("no page hardcodes a test count beside the constant", () => {
  // The hero shipped 503 for days while the real total was 511. A literal in the page is how that
  // happens, so a reintroduced one fails here rather than on somebody's screen.
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const stale of ["503", "511"]) {
    assert.ok(
      !new RegExp(`v="${stale}"`).test(page),
      `app/page.tsx hardcodes ${stale}. Use TESTS_PASSING from lib/counts.ts.`,
    );
  }
});

test("every suite has more total than passing or the skip count is a lie", () => {
  for (const [name, s] of Object.entries(SUITES)) {
    assert.ok(s.total >= s.pass, `${name}: total must be at least pass`);
  }
});
