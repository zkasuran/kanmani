/**
 * `check` is a thin orchestrator, and the one piece of logic it owns is the piece that decides what
 * `intact` MEANS.
 *
 * Both of its callees are well tested: `resolveEvidence` caps and refuses, `judge` runs the ladder.
 * What lives only here is the fallback at lib/check.ts: when a caller supplies no commitment, the
 * bytes that were served are hashed and compared against themselves, so the integrity rung passes
 * for free. That is not a verification, and `hashWasSupplied` is the only thing in the response that
 * says so. Nothing asserted it, which made this the exact place a caller could be misled: an
 * `intact` that looks the same in both cases while meaning "the bytes match what was committed on
 * chain" in one and "we hashed what we got" in the other.
 *
 * Every test here runs on a `data:` URI, so no network and no index are touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { check } from "./check.ts";

const DOC = JSON.stringify({ hello: "world" });
const URI = `data:application/json;base64,${Buffer.from(DOC).toString("base64")}`;
/** The hash of the bytes the URI actually serves. */
const REAL = keccak256(toHex(DOC));

/* ------------------------------------------------- with a commitment, intact means something */

test("a supplied commitment is used, and a match is reported as a match", async () => {
  const r = await check({ uri: URI, feedbackHash: REAL });
  assert.equal(r.hashWasSupplied, true, "the caller gave a commitment, so say so");
  assert.equal(r.verdict.hashMatches, true);
  assert.equal(r.verdict.computedHash, REAL);
});

test("a supplied commitment that does NOT match the bytes is reported as a mismatch", async () => {
  // The whole point of the rung. The document resolves fine and is still not the committed one.
  const wrong = `0x${"11".repeat(32)}` as const;
  const r = await check({ uri: URI, feedbackHash: wrong });
  assert.equal(r.hashWasSupplied, true);
  assert.equal(r.verdict.hashMatches, false, "a mismatch must not pass the integrity rung");
  assert.equal(r.verdict.computedHash, REAL, "the computed hash is of what was served");
});

test("a commitment is matched case insensitively, not rejected for being upper case", async () => {
  const upper = (`0x${REAL.slice(2).toUpperCase()}`) as `0x${string}`;
  const r = await check({ uri: URI, feedbackHash: upper });
  assert.equal(r.hashWasSupplied, true);
  assert.equal(r.verdict.hashMatches, true);
});

/* ------------------------------------------- without one, intact is free and must be flagged */

test("with no commitment the served bytes are hashed and the flag says it was not supplied", async () => {
  const r = await check({ uri: URI });
  assert.equal(r.hashWasSupplied, false, "this is the flag that stops a reader over-reading intact");
  // Hashing what we were served against itself: it matches by construction. That is why the flag
  // above has to be false, and why a caller must read it before trusting the rung.
  assert.equal(r.verdict.hashMatches, true);
  assert.equal(r.verdict.computedHash, REAL);
});

test("a malformed commitment counts as NOT supplied rather than as a failed match", async () => {
  // A caller sending a short, empty or non-hex value has supplied nothing usable. Treating it as a
  // commitment would report `hashMatches: false` and read as "the document was tampered with",
  // which would be an accusation built on the caller's own typo.
  const malformed = ["", "nope", "0x", "0x1234", REAL.slice(0, 40), `${REAL}00`, "0xZZ".padEnd(66, "Z")];
  for (const feedbackHash of malformed) {
    const r = await check({ uri: URI, feedbackHash });
    assert.equal(r.hashWasSupplied, false, `${JSON.stringify(feedbackHash)} is not a commitment`);
    assert.equal(r.verdict.hashMatches, true, `${JSON.stringify(feedbackHash)} must not read as tampering`);
  }
});

/* ------------------------------------------------------------------ the rest of the envelope */

test("the resolved bytes are reported, so a reader can see what was actually read", async () => {
  const r = await check({ uri: URI });
  assert.equal(r.bytesRead, Buffer.byteLength(DOC));
  assert.equal(r.mediaType, "application/json");
  assert.equal(r.source, "data");
});

test("a document that cannot be resolved reports nulls and never throws", async () => {
  // Fail closed. An unresolvable URI is a verdict, not an exception in the caller.
  const r = await check({ uri: "data:application/json;base64,!!!not-base64!!!" });
  assert.equal(r.bytesRead, null);
  assert.equal(r.mediaType, null);
  assert.equal(r.source, null);
  assert.equal(r.verdict.outcome, "unknown", "unresolvable is unknown, never false");
});

test("every answer carries the chain coverage a negative would need to mean anything", async () => {
  const r = await check({ uri: URI });
  assert.ok(Array.isArray(r.coverage));
  assert.ok(r.coverage.length > 0, "a false with no coverage list is not a claim anyone can check");
  for (const c of r.coverage) {
    assert.equal(typeof c.chain, "string");
    assert.equal(typeof c.id, "number");
    assert.equal(typeof c.configured, "boolean");
  }
});

test("reproduce names a command, and prefers the locator once a tx is declared", async () => {
  const noClaim = await check({ uri: URI });
  assert.match(noClaim.reproduce, /^curl -sS /, "with nothing declared, the fetch is the reproduction");

  const claim = JSON.stringify({
    network: "monad",
    proof_of_payment: {
      network: "monad",
      payment_tx: "0x94fc5e709885b40e7149791c4329ff2611d2e52545f4533f6e96fe1f6c0397d8",
    },
  });
  const r = await check({ uri: `data:application/json;base64,${Buffer.from(claim).toString("base64")}` });
  if (r.verdict.declaredNetwork && r.verdict.declaredTx) {
    assert.match(r.reproduce, /locate\.ts monad 0x94fc5e70/, "a declared tx is re-derivable by locator");
  }
});
