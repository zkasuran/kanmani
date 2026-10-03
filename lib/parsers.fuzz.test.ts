/**
 * Random bytes into every parser.
 *
 * The enumerated adversarial cases elsewhere in this suite are strong: a chosen bad hash, a chosen
 * ambiguous mapping, a chosen base64 that fails its round trip. What they cannot do is find the
 * input nobody thought of. The Solidity side already has six `testFuzz_` tests; this is the same
 * discipline on the TypeScript side.
 *
 * The property under test is the same for all six parsers and it is the one the whole verifier rests
 * on: **a parser handed arbitrary bytes returns a typed outcome and never throws.** Every one of
 * these runs on input a stranger controls. A throw from any of them is a 500 on a public route, or a
 * dead sweep worker, instead of an `unparsed` or an `unknown`.
 *
 * The generator is seeded and the seed is printed on failure, so a hit is reproducible rather than a
 * flake that vanishes on re-run. Deterministic by default: the suite must not pass today and fail
 * tomorrow on the same code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDocument } from "../verifier/src/ladder/parse.ts";
import { decodeDataUri } from "../verifier/src/ladder/resolve.ts";
import { decodeTransfer } from "../verifier/src/ladder/settled.ts";
import { parseSealed } from "./vault.ts";
import { paymentFrom } from "./x402.ts";
import { parseDelivery } from "./rehydrate.ts";

/** xorshift32. Small, seeded and good enough to find a crash. */
function rng(seed: number) {
  let s = seed | 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

const SEED = Number(process.env.FUZZ_SEED ?? 20261003);
/** Kept low enough that the whole suite stays a few seconds. Raise with FUZZ_ROUNDS to dig. */
const ROUNDS = Number(process.env.FUZZ_ROUNDS ?? 400);

function randomBytes(r: () => number, max = 512): Uint8Array {
  const n = Math.floor(r() * max);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256);
  return b;
}

/** Bytes biased toward the shapes a parser almost accepts, which is where the bugs are. */
function randomish(r: () => number): Uint8Array {
  const pick = r();
  const frag = [
    "{", "}", "[", "]", '"', ":", ",", "\\", "\u0000", "\uFFFD",
    "0x", "network", "monad", "payment_tx", "proof_of_payment", "rating",
    "true", "false", "null", "NaN", "-1", "1e999", "\\u", "data:", ";base64,",
  ];
  if (pick < 0.5) return randomBytes(r);
  let s = "";
  const n = Math.floor(r() * 40);
  for (let i = 0; i < n; i++) s += frag[Math.floor(r() * frag.length)];
  return new TextEncoder().encode(s);
}

function randomString(r: () => number): string {
  // Latin-1 range only, so the string is always a valid JS string. Invalid UTF-8 is covered by the
  // byte generators above, which is the right place for it.
  const n = Math.floor(r() * 120);
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(Math.floor(r() * 256));
  return s;
}

/**
 * A header-legal value: printable ASCII only.
 *
 * `Headers.set` refuses a value carrying CR, LF or a NUL, and so does every HTTP server, so those
 * bytes cannot reach `paymentFrom` in production. Generating them would only prove the runtime's own
 * header validation works, and would hide the inputs that CAN arrive.
 */
function randomHeaderValue(r: () => number): string {
  const n = Math.floor(r() * 160);
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(0x20 + Math.floor(r() * 0x5f));
  return s;
}

/** An arbitrary JSON-ish value, including the shapes that break naive recursive walks. */
function randomValue(r: () => number, depth = 0): unknown {
  const pick = Math.floor(r() * 12);
  if (depth > 3) return pick % 2 === 0 ? null : randomString(r);
  switch (pick) {
    case 0: return null;
    case 1: return undefined;
    case 2: return r() < 0.5;
    case 3: return Math.floor((r() - 0.5) * 1e12);
    case 4: return r() * Number.MAX_SAFE_INTEGER;
    case 5: return randomString(r);
    case 6: return Array.from({ length: Math.floor(r() * 5) }, () => randomValue(r, depth + 1));
    case 7: {
      const o: Record<string, unknown> = {};
      const n = Math.floor(r() * 5);
      for (let i = 0; i < n; i++) o[randomString(r).slice(0, 12) || `k${i}`] = randomValue(r, depth + 1);
      return o;
    }
    case 8: return { event: randomValue(r, depth + 1) };
    case 9: return { event: { data: { block: { logs: randomValue(r, depth + 1) } } } };
    case 10: return { event: { activity: randomValue(r, depth + 1) } };
    default: return NaN;
  }
}

/**
 * Run one parser over `ROUNDS` random inputs. A throw fails the test and names the seed, the round
 * and the input, so the exact case can be replayed.
 */
function property(name: string, make: (r: () => number) => unknown, call: (input: never) => unknown) {
  test(`FUZZ: ${name} returns a typed outcome and never throws`, () => {
    const r = rng(SEED);
    for (let i = 0; i < ROUNDS; i++) {
      const input = make(r);
      let out: unknown;
      try {
        out = call(input as never);
      } catch (e) {
        assert.fail(
          `${name} threw on round ${i} with FUZZ_SEED=${SEED}: ${(e as Error).message}\n` +
            `input was: ${typeof input === "string" ? JSON.stringify(input.slice(0, 200)) : JSON.stringify(input)?.slice(0, 200)}`,
        );
      }
      // "Typed outcome" means it came back with something a caller can branch on, never undefined.
      assert.notEqual(out, undefined, `${name} returned undefined on round ${i} with FUZZ_SEED=${SEED}`);
    }
  });
}

/* ------------------------------------------------------------------ the six parsers */

// The document parser. Arbitrary bytes, including invalid UTF-8, must land on a parsed shape or on
// `unparsed` with a reason.
property("parseDocument", randomish, (b: Uint8Array) => {
  const out = parseDocument(b);
  assert.equal(typeof out.kind, "string");
  return out;
});

// The data: URI decoder, which carries both the pre-decode and the post-decode byte bound.
property("decodeDataUri", (r) => `data:${randomString(r)}`, (s: string) => {
  const out = decodeDataUri(s);
  assert.equal(typeof out.ok, "boolean");
  if (!out.ok) assert.equal(typeof out.reason, "string");
  return out;
});

// The sealed-vault parser. Arbitrary values, because it is handed whatever JSON.parse produced.
property("parseSealed", randomValue, (v: unknown) => {
  const out = parseSealed(v);
  // null is the refusal. Anything else must be an object, never a partially filled one.
  if (out !== null) assert.equal(typeof out, "object");
  return out === null ? "refused" : out;
});

// The x402 payment header parser, driven through a real Headers object.
property(
  "paymentFrom",
  (r) => {
    const h = new Headers();
    if (r() < 0.5) h.set("payment-signature", randomHeaderValue(r));
    if (r() < 0.5) h.set("x-payment", randomHeaderValue(r));
    return h;
  },
  (h: Headers) => {
    const out = paymentFrom(h);
    assert.equal(typeof out.ok, "boolean");
    if (!out.ok) assert.equal(typeof out.reason, "string");
    return out;
  },
);

// The ERC-20 Transfer log decoder. Topics and data are attacker-supplied on any chain.
property(
  "decodeTransfer",
  (r) => ({
    address: randomString(r),
    topics: Array.from({ length: Math.floor(r() * 5) }, () => randomString(r)),
    data: randomString(r),
  }),
  (log: { address: string; topics: string[]; data: string }) => {
    const out = decodeTransfer(log);
    if (out !== null) assert.equal(typeof out, "object");
    return out === null ? "refused" : out;
  },
);

// The webhook delivery parser. Runs after the HMAC, so only a key holder reaches it, and it still
// has to fail closed on a body that verified and does not parse.
property("parseDelivery", randomValue, (v: unknown) => {
  const out = parseDelivery(v);
  assert.equal(typeof out.ok, "boolean");
  if (!out.ok) assert.equal(typeof out.reason, "string");
  return out;
});

/* --------------------------------------------- the same six, with the degenerate inputs pinned */

test("every parser refuses the degenerate inputs rather than throwing", () => {
  const empty = new Uint8Array(0);
  assert.equal(typeof parseDocument(empty).kind, "string");
  assert.equal(decodeDataUri("").ok, false);
  assert.equal(decodeDataUri("data:").ok, false);
  assert.equal(parseSealed(undefined), null);
  assert.equal(parseSealed(null), null);
  assert.equal(parseSealed({}), null);
  assert.equal(paymentFrom(new Headers()).ok, false);
  assert.equal(decodeTransfer({ address: "", topics: [], data: "" }), null);
  assert.equal(parseDelivery(undefined).ok, false);
  assert.equal(parseDelivery(null).ok, false);
});
