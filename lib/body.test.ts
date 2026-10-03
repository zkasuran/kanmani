/**
 * The inbound body ceiling.
 *
 * This was the one untrusted-input surface in the repo with no bound at all. Every OUTBOUND parser
 * caps what it reads; `await req.json()` on the way IN buffered whatever arrived, and on the priced
 * service route it ran before the payment check, so a stranger with no key and no payment could post
 * a body of any size and make the process hold it. The per-IP limiter counts requests, not bytes.
 *
 * Three properties are asserted here, in order of how much they matter:
 *
 *  1. An oversize body is refused with 413 and nothing is parsed.
 *  2. The refusal happens while the body is still arriving, not after it is all in memory. A cap
 *     that buffers first and measures second is not a cap.
 *  3. `content-length` is never trusted. A sender understating it is still counted on arrival, and a
 *     sender overstating it is refused without reading anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_REQUEST_BYTES, readBodyJson, readBodyText } from "./body.ts";

/** A POST carrying `text`, with whatever content-length the runtime computes. */
function post(text: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/service/notary", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: text,
  });
}

/* ------------------------------------------------------------------ the ceiling itself */

test("a body under the ceiling is read whole", async () => {
  const body = JSON.stringify({ document: "a".repeat(1000) });
  const r = await readBodyText(post(body), 4096);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.text, body);
});

test("a body over the ceiling is refused with 413 and nothing is parsed", async () => {
  const body = JSON.stringify({ document: "a".repeat(20_000) });
  const r = await readBodyJson(post(body), 4096);
  assert.equal(r.ok, false, "must refuse rather than buffer");
  if (!r.ok) {
    assert.equal(r.status, 413, "413: the request was understood and refused on size");
    assert.match(r.detail, /4096 bytes/, "the refusal names the limit so a caller can comply");
    assert.match(r.detail, /no work was done/);
  }
});

test("a body exactly at the ceiling is allowed, one byte past it is not", async () => {
  // The boundary, in both directions, so the comparison cannot be off by one.
  const at = "a".repeat(64);
  const over = "a".repeat(65);
  const atR = await readBodyText(post(at), 64);
  assert.equal(atR.ok, true, "exactly at the limit is within it");
  const overR = await readBodyText(post(over), 64);
  assert.equal(overR.ok, false, "one byte past the limit is refused");
  if (!overR.ok) assert.equal(overR.status, 413);
});

test("the default ceiling is a real number and is applied when none is given", async () => {
  assert.equal(typeof MAX_REQUEST_BYTES, "number");
  assert.ok(MAX_REQUEST_BYTES > 0);
  const r = await readBodyText(post(JSON.stringify({ ok: true })));
  assert.equal(r.ok, true, "an ordinary body passes the default");
});

/* ------------------------------------- the refusal happens while the body is still arriving */

test("an endless stream is cut off instead of being buffered to exhaustion", async () => {
  // The attack the ceiling exists to stop: no content-length, chunked, never ends. If the cap
  // buffered first and measured second this test would never finish.
  let pushed = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pushed += 1;
      if (pushed > 10_000) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode("A".repeat(1024)));
    },
  });
  const req = new Request("https://example.test/api/service/notary", {
    method: "POST",
    body: stream,
    // @ts-expect-error duplex is required by the runtime for a stream body and is not in the DOM lib
    duplex: "half",
  });
  const r = await readBodyText(req, 4096);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 413);
  // 4096 bytes is four 1 KiB chunks, so the fifth is the one that crosses. A handful of extra
  // pulls is fine; thousands would mean the whole stream was drained before the decision.
  assert.ok(pushed < 20, `read ${pushed} chunks before refusing, expected only the few around the cap`);
});

/* ------------------------------------------------------------------ content-length is a claim */

test("an overstated content-length is refused without reading the body", async () => {
  // Cheap early refusal. The header says it is too big, so there is no reason to read it.
  const req = new Request("https://example.test/api/service/notary", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "999999999" },
    body: "{}",
  });
  const r = await readBodyText(req, 4096);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 413);
});

test("an understated content-length does not get a body past the ceiling", async () => {
  // The important direction. A lying header must not buy a bigger allowance: the decision is made
  // on bytes that actually arrived.
  const body = "A".repeat(20_000);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  const req = new Request("https://example.test/api/service/notary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    // @ts-expect-error duplex is required by the runtime for a stream body and is not in the DOM lib
    duplex: "half",
  });
  const r = await readBodyText(req, 4096);
  assert.equal(r.ok, false, "the counter, not the header, is what decides");
  if (!r.ok) assert.equal(r.status, 413);
});

/* ------------------------------------------------------------------ the other failure shapes */

test("an empty body reads as an empty string rather than failing", async () => {
  const req = new Request("https://example.test/api/service/notary", { method: "POST" });
  const r = await readBodyText(req);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.text, "");
});

test("bytes that are not UTF-8 are a 400, not a string full of replacement characters", async () => {
  // A lone continuation byte. Decoding non-fatally would hand the parser a U+FFFD and report a
  // confusing JSON error instead of the real problem.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff, 0xfe, 0x80, 0x81]));
      controller.close();
    },
  });
  const req = new Request("https://example.test/api/service/notary", {
    method: "POST",
    body: stream,
    // @ts-expect-error duplex is required by the runtime for a stream body and is not in the DOM lib
    duplex: "half",
  });
  const r = await readBodyText(req, 4096);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.match(r.title, /not UTF-8/);
  }
});

test("a body that is valid UTF-8 and not JSON is a 400 with no part of it echoed back", async () => {
  const r = await readBodyJson(post("this is not json at all"), 4096);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    // Nothing the caller sent may come back in the message. A reflected body is an XSS vector the
    // moment any client renders an error.
    assert.equal(r.detail.includes("not json at all"), false);
  }
});

test("valid JSON comes back parsed", async () => {
  const r = await readBodyJson(post(JSON.stringify({ agentId: 10182, nested: { a: [1, 2] } })), 4096);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, { agentId: 10182, nested: { a: [1, 2] } });
});

test("a JSON body that is a bare scalar or null still parses rather than throwing", async () => {
  for (const raw of ["null", "0", '"a string"', "true", "[]", "{}"]) {
    const r = await readBodyJson(post(raw), 4096);
    assert.equal(r.ok, true, `${raw} is valid JSON`);
  }
});
