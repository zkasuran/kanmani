import { test } from "node:test";
import assert from "node:assert/strict";
import { challenge, NETWORK, paymentFrom, paymentResponseHeader, requirements } from "./x402.ts";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

const goodPayload = {
  x402Version: 2,
  resource: { url: "https://example/api/verify", mimeType: "application/json" },
  accepted: {
    scheme: "exact",
    network: NETWORK,
    amount: "10000",
    asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    payTo: "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
  },
  payload: { signature: `0x${"a".repeat(130)}`, authorization: { from: "0x1", to: "0x2", value: "10000" } },
  extensions: {},
};

const headers = (h: Record<string, string>) => new Headers(h);

/* ---------------------------------------------- the shapes the spec actually specifies */

test("a v2 payload in PAYMENT-SIGNATURE is accepted", () => {
  const r = paymentFrom(headers({ "payment-signature": b64(goodPayload) }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.header, "PAYMENT-SIGNATURE");
    assert.equal(r.payload.accepted.scheme, "exact");
    assert.equal(r.payload.x402Version, 2);
  }
});

test("the older X-PAYMENT header is accepted too and says which one was used", () => {
  // Both generations are live in the wild. Refusing a client for using last year's header name
  // helps nobody and the response says which it read so a client can tell it is on the old one.
  const r = paymentFrom(headers({ "x-payment": b64(goodPayload) }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.header, "X-PAYMENT");
});

test("PAYMENT-SIGNATURE wins when a client sends both", () => {
  const other = { ...goodPayload, payload: { ...goodPayload.payload, signature: `0x${"b".repeat(130)}` } };
  const r = paymentFrom(headers({ "payment-signature": b64(goodPayload), "x-payment": b64(other) }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.header, "PAYMENT-SIGNATURE");
});

/* ---------------------------------------------- the failure that actually happened */

test("a v1-shaped payload is named as v1, not called malformed", () => {
  // This exact payload was sent to the live facilitator and came back `unsupported_scheme`,
  // which tells a client nothing about how to fix it. v2 moved the chosen method into
  // `accepted`, so the reason says that, because the fix is a client change and a client
  // cannot guess it from "invalid".
  const v1 = { x402Version: 1, scheme: "exact", network: NETWORK, payload: goodPayload.payload };
  const r = paymentFrom(headers({ "payment-signature": b64(v1) }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /v1 shaped/);
    assert.match(r.reason, /accepted/);
  }
});

/* ---------------------------------------------- refusals, each with a reason a client can act on */

test("a missing header asks for the one the spec names", () => {
  const r = paymentFrom(headers({}));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /PAYMENT-SIGNATURE/);
});

test("base64 that does not round-trip is refused", () => {
  // Buffer.from(x, "base64") drops characters it does not like rather than failing, so a corrupt
  // payload decodes to something shorter and plausible. Comparing the re-encoding is the only
  // way to notice and without this check a truncated payload reads as a valid short one.
  const r = paymentFrom(headers({ "payment-signature": "!!!! not base64 !!!!" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /base64/);
});

test("valid base64 that is not JSON is refused as not JSON", () => {
  const r = paymentFrom(headers({ "payment-signature": Buffer.from("hello").toString("base64") }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /JSON/);
});

test("a scheme we do not serve is refused by name", () => {
  const upto = { ...goodPayload, accepted: { ...goodPayload.accepted, scheme: "upto" } };
  const r = paymentFrom(headers({ "payment-signature": b64(upto) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /upto is not served here/);
});

test("a different chain is refused by name, with the one we do serve", () => {
  // Testnet is a real mistake a client makes and the message has to be actionable. Settling a
  // mainnet price against a testnet token would be free money in the wrong direction.
  const testnet = { ...goodPayload, accepted: { ...goodPayload.accepted, network: "eip155:10143" } };
  const r = paymentFrom(headers({ "payment-signature": b64(testnet) }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /eip155:10143 is not served here/);
    assert.match(r.reason, /eip155:143/);
  }
});

test("a payload with no signature is refused before it reaches the facilitator", () => {
  const noSig = { ...goodPayload, payload: { authorization: {} } };
  const r = paymentFrom(headers({ "payment-signature": b64(noSig) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /signature/);
});

/* ---------------------------------------------- the money constants, which are easy to get wrong */

test("the price is in six-decimal units, because USDC on Monad is six", () => {
  // A literal carried from an 18-decimal chain is wrong by a factor of a million and it would
  // fail by asking for a million times the price rather than by throwing.
  const r = requirements();
  assert.equal(r.amount, "10000", "10000 atomic units at 6 decimals is 0.01 USDC");
  assert.equal(r.asset, "0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
  assert.equal(r.extra.version, "2", "read from the token's version(), which the EIP-712 domain needs");
  assert.equal(r.network, "eip155:143", "CAIP-2. v2 dropped the bare chain names v1 used");
});

test("requirements carry no resource fields, which is where v1 put them", () => {
  const r = requirements() as Record<string, unknown>;
  assert.equal(r.maxAmountRequired, undefined, "v1 name, gone in v2");
  assert.equal(r.resource, undefined);
  assert.equal(r.description, undefined);
  assert.equal(r.mimeType, undefined);
});

test("the 402 body carries resource beside accepts, not inside it", () => {
  const c = challenge("https://example/api/verify", "because") as Record<string, unknown>;
  assert.equal(c.x402Version, 2);
  assert.equal(c.error, "because");
  assert.ok(c.resource, "ResourceInfo is its own object in v2");
  assert.ok(Array.isArray(c.accepts));
  assert.deepEqual(c.extensions, {});
});

test("the 402 body explains itself to a human, because one will open it in a browser first", () => {
  const c = challenge("https://example/api/verify", "x") as { help: Record<string, string> };
  assert.match(c.help.meaning, /pay me, not broken/);
  assert.match(c.help.why, /free/, "the free alternative is named rather than left to be discovered");
});

/* ---------------------------------------------- the receipt */

test("a settlement receipt decodes to the shape the spec describes", () => {
  const h = paymentResponseHeader({ settled: true, transaction: "0xabc", payer: "0xdef" });
  const d = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  assert.deepEqual(d, { success: true, transaction: "0xabc", network: NETWORK, payer: "0xdef" });
});

test("a failed settlement reports an empty transaction, never a missing field", () => {
  // The spec says transaction is required and empty on failure. A missing key would let a client
  // read `undefined` and decide the field was simply not implemented.
  const h = paymentResponseHeader({ settled: false, transaction: null, payer: null });
  const d = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  assert.equal(d.success, false);
  assert.equal(d.transaction, "");
  assert.equal(d.network, NETWORK);
});
