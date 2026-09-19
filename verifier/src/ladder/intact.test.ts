import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { intactCheck } from "./intact.ts";

const enc = (s: string) => new TextEncoder().encode(s);

test("bytes that match the commitment are intact", () => {
  const body = enc('{"network":"monad","tx":"0xabc"}');
  const r = intactCheck(body, keccak256(body));
  assert.equal(r.intact, true);
});

test("one flipped byte is not intact", () => {
  const body = enc('{"network":"monad","tx":"0xabc"}');
  const committed = keccak256(body);
  const tampered = enc('{"network":"monad","tx":"0xabd"}');
  const r = intactCheck(tampered, committed);
  assert.equal(r.intact, false);
  if (r.intact === false) assert.match(r.reason, /do not match the hash committed/);
});

test("the committed hash is compared case insensitively", () => {
  const body = enc("hello");
  const upper = keccak256(body).toUpperCase().replace("0X", "0x");
  assert.equal(intactCheck(body, upper).intact, true);
  assert.equal(intactCheck(body, `  ${keccak256(body)}  `).intact, true);
});

/**
 * The trap this rung exists to avoid.
 *
 * Re-encoding a document changes its bytes while leaving its meaning identical. If `intactCheck`
 * took a parsed object or stringified before hashing, an honest document with different spacing
 * would verify and the commitment would stop meaning what its author signed up to.
 */
test("a semantically identical re-encode does NOT verify and that is correct", () => {
  const original = enc('{"network":"monad","amount":"1000000"}');
  const committed = keccak256(original);

  const reEncoded = enc(JSON.stringify(JSON.parse(new TextDecoder().decode(original))));
  // Same meaning, different bytes: key order preserved here but spacing normalised elsewhere in
  // the wild. Prove the bytes really did change before asserting on the outcome.
  const spacedOut = enc('{ "network": "monad", "amount": "1000000" }');
  assert.notDeepEqual(Array.from(spacedOut), Array.from(original), "bytes differ");
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(spacedOut)),
    JSON.parse(new TextDecoder().decode(original)),
    "meaning is identical",
  );

  assert.equal(intactCheck(spacedOut, committed).intact, false, "different bytes, so not intact");
  assert.equal(intactCheck(reEncoded, committed).intact, true, "these bytes happen to be identical");
});

/* ------------------------------------------------------ unknown, never false */

test("a malformed commitment is unknown rather than a mismatch", () => {
  const body = enc("x");
  for (const bad of ["", "0x", "not a hash", "0x1234", `${keccak256(body)}00`]) {
    const r = intactCheck(body, bad);
    assert.equal(r.intact, "unknown", `${JSON.stringify(bad)} should be unknown`);
  }
});

test("an empty document is unknown, not a considered mismatch", () => {
  // keccak256 of empty input is a real value, so without this branch an empty body would compare
  // against it and read as a deliberate answer.
  const emptyHash = keccak256(new Uint8Array());
  const r = intactCheck(new Uint8Array(), emptyHash);
  assert.equal(r.intact, "unknown");
  if (r.intact === "unknown") assert.match(r.reason, /empty/);
});

test("the computed hash is reported so a reader can recompute it", () => {
  const body = enc("audit me");
  const r = intactCheck(body, keccak256(enc("something else")));
  assert.equal(r.intact, false);
  if (r.intact === false) {
    assert.equal(r.computed, keccak256(body));
    assert.equal(r.computed, keccak256(toHex(body)));
  }
});
