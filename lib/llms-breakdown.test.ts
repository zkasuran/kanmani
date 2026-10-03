/**
 * The unknown line in /llms.txt has to itemise every bucket that makes up its own total.
 *
 * It once named two of the three, so it read "15 could not be checked: 10 ... 2 ..." and the parts
 * summed to 12. A summary for a language model that contradicts itself is worse than none, because
 * the model will repeat the arithmetic. This reads the route source and checks that every term in
 * the total also appears in the breakdown.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the llms.txt unknown breakdown names every bucket its total adds up", () => {
  const src = readFileSync(new URL("../app/llms.txt/route.ts", import.meta.url), "utf8");
  const line = src.split("\n").find((l) => l.includes("could not be checked"));
  assert.ok(line, "the unknown line is missing from the route");
  const [total, breakdown] = line!.split("could not be checked");
  for (const bucket of ["unknownUnreachable", "unknownBytesMoved", "unknownUnparsed"]) {
    assert.ok(total!.includes(bucket), `${bucket} is not in the total`);
    assert.ok(breakdown!.includes(bucket), `${bucket} is in the total but not itemised`);
  }
});
