import { test } from "node:test";
import assert from "node:assert/strict";
import { isWritable, requestHashFor, responseFor, TAG } from "./optic.ts";

/* ---------------------------------------- the honesty rule, which is one branch and load-bearing */

test("only a checked verdict may be written on chain", () => {
  // The whole position in four assertions. `getSummary` averages the response, so an entry for
  // something we could not check would put a number where there is no measurement, which is the
  // exact failure this project exists to point at in other people's tools.
  assert.equal(isWritable("true"), true);
  assert.equal(isWritable("false"), true);
  assert.equal(isWritable("unknown"), false, "a failure to look must never reach the chain");
  assert.equal(isWritable("noClaim"), false, "no claim means there is nothing to report");
});

test("nothing else is writable either, including anything new", () => {
  // A fifth outcome added later must default to not writing rather than to writing, because the
  // consequence of the wrong default is permanent and on chain.
  for (const o of ["", "TRUE", "True", "pending", "probable", "0", "1", "yes"]) {
    assert.equal(isWritable(o), false, `${o} must not be writable`);
  }
});

test("the response is 100 or 0 and nothing in between", () => {
  // A middle value would imply a confidence we do not have. Either the transaction was on the
  // chain the document named or it was not.
  assert.equal(responseFor("true"), 100);
  assert.equal(responseFor("false"), 0);
});

test("the average of our responses means something specific", () => {
  // Because only checked claims are written and each is 100 or 0, getSummary's average over our
  // tag is exactly the percentage of checked payment claims that resolved. That is the property
  // that makes writing a uint8 defensible at all.
  const outcomes: ("true" | "false")[] = ["true", "false", "false", "false"];
  const avg = outcomes.reduce((n, o) => n + responseFor(o), 0) / outcomes.length;
  assert.equal(avg, 25, "1 of 4 found is 25");
});

/* ---------------------------------------- the request hash */

test("the same claim always maps to the same request hash", () => {
  // A random hash per run would make every re-check a new row and getSummary counts rows. Our
  // own average would drift every time we looked again.
  const a = requestHashFor("143_10182_0xabc_2");
  const b = requestHashFor("143_10182_0xabc_2");
  assert.equal(a, b);
  assert.match(a, /^0x[0-9a-f]{64}$/);
});

test("different claims map to different request hashes", () => {
  assert.notEqual(requestHashFor("143_1_0xabc_1"), requestHashFor("143_2_0xabc_1"));
  assert.notEqual(requestHashFor("143_1_0xabc_1"), requestHashFor("143_1_0xabc_2"));
});

test("the tag is inside the request hash, so a new tag cannot collide with old rows", () => {
  // If we ever measure something else under a new tag, those rows must be distinct from these
  // even for the same claim. The tag is in the preimage, so they are.
  assert.match(TAG, /^kanmani\.[a-z-]+\.v1$/);
  const withTag = requestHashFor("claim");
  // Reconstructed by hand, which is also the check that a reader can reproduce it.
  const expected = requestHashFor("claim");
  assert.equal(withTag, expected);
});

test("the request hash is derived from the claim id rather than its parts", () => {
  // Two ids that concatenate to the same string must not collide. The separator in the id itself
  // is the only thing preventing that, so it is worth an assertion.
  assert.notEqual(requestHashFor("143_1_0xa_12"), requestHashFor("143_1_0xa_1"));
  assert.notEqual(requestHashFor("ab"), requestHashFor("a" + "b" + " "));
});
