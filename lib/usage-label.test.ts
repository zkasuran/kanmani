import { test } from "node:test";
import assert from "node:assert/strict";
import { NOT_MEASURED, singleRequestFloor } from "./usage.ts";

test("the floor is 2v - p, the least that made exactly one request", () => {
  // The figures the status page showed on 22 October: 16,268 client-days, 19,305 page views.
  assert.equal(singleRequestFloor(16_268, 19_305), 13_231);
  assert.equal(Math.floor((100 * 13_231) / 16_268), 81);
});

test("when everyone made exactly one request the floor is everyone", () => {
  assert.equal(singleRequestFloor(100, 100), 100);
});

test("when everyone made two or more requests the floor is zero", () => {
  assert.equal(singleRequestFloor(100, 200), 0);
  assert.equal(singleRequestFloor(100, 5_000), 0);
});

test("a floor can be checked by constructing a case that meets it", () => {
  // 7 clients: 5 made one request, 2 made two each. 9 requests. The floor is 2*7 - 9 = 5, exactly tight.
  assert.equal(singleRequestFloor(7, 9), 5);
  // Fewer than 5 single-request clients cannot account for 9 requests across 7 clients: every other client
  // needs at least 2, so s singles need at least s + 2 * (7 - s) requests. That is the whole argument for a floor.
  for (let singles = 0; singles < 5; singles++) assert.ok(singles + 2 * (7 - singles) > 9, `${singles} singles would need more than 9 requests`);
});

test("malformed or empty input never prints a negative or impossible share", () => {
  assert.equal(singleRequestFloor(0, 0), 0);
  assert.equal(singleRequestFloor(-5, 10), 0);
  assert.equal(singleRequestFloor(Number.NaN, 10), 0);
  assert.equal(singleRequestFloor(10, Number.NaN), 0);
  assert.equal(singleRequestFloor(10, 3), 10, "fewer requests than clients is impossible, so it is clamped to everyone");
});

test("the not-measured list now says a browser-like client is not necessarily a person", () => {
  assert.ok(NOT_MEASURED.some((l) => /browser-like client is a person/.test(l)));
});
