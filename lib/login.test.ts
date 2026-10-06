import assert from "node:assert/strict";
import test from "node:test";

import { displayAddress, parseSession, sessionRecord, shortAddress, walletLoginMessage, SESSION_KEY } from "./login.ts";

const A = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";

test("a written session reads back as the same session, address lowercased", () => {
  const rec = sessionRecord(A, "wallet", 1_700_000_000_000);
  assert.deepEqual(parseSession(JSON.stringify(rec)), { ...rec, address: A.toLowerCase() });
});

test("a session carrying anything beyond the public fields is rejected whole", () => {
  const rec = sessionRecord(A, "passkey", 1);
  for (const extra of [{ privateKey: "0x01" }, { keys: {} }, { content: "x" }]) {
    assert.equal(parseSession(JSON.stringify({ ...rec, ...extra })), null, JSON.stringify(extra));
  }
});

test("malformed or foreign storage never logs anyone in", () => {
  const rec = sessionRecord(A, "passkey", 1);
  const bad = [
    null,
    "",
    "not json",
    "[]",
    "null",
    JSON.stringify({ ...rec, v: 2 }),
    JSON.stringify({ ...rec, address: "0x123" }),
    JSON.stringify({ ...rec, method: "password" }),
    JSON.stringify({ ...rec, kind: "admin" }),
    JSON.stringify({ ...rec, since: 0 }),
    JSON.stringify({ ...rec, since: "yesterday" }),
  ];
  for (const b of bad) assert.equal(parseSession(b), null, String(b));
});

test("sessionRecord refuses a non-address instead of storing it", () => {
  assert.throws(() => sessionRecord("vitalik.eth", "wallet", 1));
});

test("the wallet message says what it is, what it costs and carries the nonce", () => {
  const m = walletLoginMessage({ host: "kanmani.xyz", address: A, created: true, nonce: "n0nce", issuedAt: "2026-09-28T00:00:00Z" });
  assert.match(m, /^Create a Kanmani account on kanmani\.xyz/);
  assert.match(m, /not a transaction and it costs nothing/);
  assert.match(m, /Nonce: n0nce/);
  assert.match(m, new RegExp(A));
  assert.match(walletLoginMessage({ host: "h", address: A, created: false, nonce: "x", issuedAt: "t" }), /^Log in to Kanmani on h/);
});

test("short address keeps both ends and leaves non-addresses alone", () => {
  assert.equal(shortAddress(A), "0xDB6c…7777");
  assert.equal(shortAddress(A.toLowerCase()), "0xDB6c…7777", "stored lowercase, shown checksummed");
  assert.equal(shortAddress("nope"), "nope");
  assert.equal(displayAddress(A.toLowerCase()), A);
});

test("the storage key is versioned so an old shape is never read as a new one", () => {
  assert.match(SESSION_KEY, /\.v\d+$/);
});

test("a session written before kind was removed still reads, with kind dropped", () => {
  const rec = sessionRecord(A, "passkey", 5);
  for (const kind of ["agent", "user"]) {
    assert.deepEqual(parseSession(JSON.stringify({ ...rec, kind })), rec, kind);
  }
  assert.equal(parseSession(JSON.stringify({ ...rec, kind: "admin" })), null, "only the two legacy values");
  assert.ok(!("kind" in rec), "a new record never carries it");
});
