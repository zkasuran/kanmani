/**
 * The POST probe transport, tested against the things it promises.
 *
 * `guardedRequest` is how an agent's own endpoint gets called with a stranger's URL, and until now
 * nothing asserted its own behaviour: the SSRF screen underneath it is well tested in guard.test.ts,
 * but the 256 KiB cap, the `truncated` flag, the timeout, the header flatten and the rule that a
 * redirect is REPORTED rather than followed were covered nowhere. A refactor that dropped the cap,
 * or that started following a 302, would have passed the suite silently. That matters because a
 * followed redirect turns a probe of one endpoint into a request to another, which is the exact
 * SSRF the screen exists to stop.
 *
 * The transport is driven through `probeOnce` against loopback, the same way guard.test.ts drives
 * `fetchOnce`. Pointing `guardedRequest` at loopback is impossible by design, so the screen is
 * exercised separately through its own entry point below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { guardedRequest, probeOnce } from "./probe.ts";

/** A loopback server on an ephemeral port, closed by the caller. */
function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a !== null ? a.port : 0;
      resolve({ port, close: () => s.close() });
    });
  });
}

/* ------------------------------------------------------------------ the byte cap */

test("SIZE: an endless chunked body is cut at the cap and reported truncated", async () => {
  // No content-length, chunked, streams forever. The only thing that stops it is our own counter.
  let stopped = false;
  const s = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    const pump = () => {
      if (stopped || res.writableEnded) return;
      if (!res.write("A".repeat(4096))) {
        res.once("drain", pump);
        return;
      }
      setImmediate(pump);
    };
    res.on("close", () => {
      stopped = true;
    });
    pump();
  });
  try {
    const r = await probeOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], { maxBytes: 4096, timeoutMs: 2500 });
    assert.equal(r.ok, true, "a capped read is a success, not a refusal: we got an answer");
    if (r.ok) {
      assert.equal(r.truncated, true, "the flag is how a caller knows the body is a prefix");
      assert.ok(r.body.length <= 4096, `kept ${r.body.length} bytes, cap is 4096`);
    }
  } finally {
    stopped = true;
    s.close();
  }
});

test("SIZE: an honest oversize Content-Length is capped as the bytes arrive", async () => {
  const body = "B".repeat(20_000);
  const s = await listen((_req, res) => {
    res.writeHead(200, { "content-length": String(body.length) });
    res.end(body);
  });
  try {
    const r = await probeOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], { maxBytes: 4096, timeoutMs: 2500 });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.truncated, true);
      assert.ok(r.body.length <= 4096, `kept ${r.body.length} bytes, cap is 4096`);
    }
  } finally {
    s.close();
  }
});

test("a body under the cap comes back whole and is not flagged truncated", async () => {
  const body = JSON.stringify({ hello: "world" });
  const s = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  try {
    const r = await probeOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], { maxBytes: 4096, timeoutMs: 2500 });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.body, body);
      assert.equal(r.truncated, false);
      assert.equal(r.status, 200);
    }
  } finally {
    s.close();
  }
});

/* ------------------------------------------------------------------ the timeout */

test("TIMEOUT: a server that accepts and never answers is cut off, not waited on", async () => {
  const s = await listen(() => {
    // Headers never written. The socket stays open.
  });
  try {
    const r = await probeOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], { timeoutMs: 300 });
    assert.equal(r.ok, false, "a hang must become a refusal");
    if (!r.ok) assert.match(r.reason, /no answer within 300ms/);
  } finally {
    s.close();
  }
});

/* ------------------------------------------------- a redirect is reported, never followed */

test("REDIRECT: a 302 is reported in headers.location and not followed", async () => {
  // If the probe followed this, a probe of one endpoint would become a request to another, which
  // is the SSRF the screen exists to stop. The second server records whether it was ever hit.
  let secretWasHit = false;
  const secret = await listen((_req, res) => {
    secretWasHit = true;
    res.writeHead(200).end("should never be read");
  });
  const open = await listen((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${secret.port}/internal` }).end();
  });
  try {
    const r = await probeOnce(new URL(`http://x:${open.port}/`), ["127.0.0.1"], { timeoutMs: 2500 });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.status, 302, "the redirect itself is the answer");
      assert.equal(r.headers.location, `http://127.0.0.1:${secret.port}/internal`);
      assert.equal(r.body, "", "no body was fetched from the target");
    }
    assert.equal(secretWasHit, false, "the redirect target must never be requested");
  } finally {
    secret.close();
    open.close();
  }
});

/* ------------------------------------------------------------------ headers and POST body */

test("a repeated response header is flattened rather than dropped or left as an array", async () => {
  const s = await listen((_req, res) => {
    res.writeHead(402, {
      "content-type": "application/json",
      "www-authenticate": ["Payment realm=a", "Payment realm=b"],
      "x-a2a-extensions": "https://github.com/google-a2a/a2a-x402/v0.1",
    });
    res.end("{}");
  });
  try {
    const r = await probeOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], { timeoutMs: 2500 });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.status, 402);
      assert.equal(r.headers.wwwAuthenticate, "Payment realm=a, Payment realm=b");
      assert.equal(r.headers.a2aExtensions, "https://github.com/google-a2a/a2a-x402/v0.1");
      assert.equal(r.headers.contentType, "application/json");
    }
  } finally {
    s.close();
  }
});

test("a POST body arrives intact with its length and content type set", async () => {
  const sent = JSON.stringify({ jsonrpc: "2.0", method: "message/send", id: 1 });
  let seenBody = "";
  let seenType: string | undefined;
  let seenLength: string | undefined;
  let seenMethod = "";
  const s = await listen((req, res) => {
    seenMethod = req.method ?? "";
    seenType = req.headers["content-type"];
    seenLength = req.headers["content-length"];
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seenBody = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  try {
    const r = await probeOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], {
      method: "POST",
      body: sent,
      timeoutMs: 2500,
    });
    assert.equal(r.ok, true);
    assert.equal(seenMethod, "POST");
    assert.equal(seenBody, sent);
    assert.equal(seenType, "application/json");
    assert.equal(seenLength, String(Buffer.byteLength(sent)));
  } finally {
    s.close();
  }
});

test("ms is always reported, on success and on refusal", async () => {
  const s = await listen((_req, res) => res.writeHead(200).end("ok"));
  try {
    const good = await probeOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], { timeoutMs: 2500 });
    assert.equal(typeof good.ms, "number");
  } finally {
    s.close();
  }
  const refused = await guardedRequest("http://127.0.0.1:1/");
  assert.equal(typeof refused.ms, "number");
});

/* ----------------------------------------------- the screen, through the production entry point */

test("SSRF: guardedRequest refuses the private and malformed URLs rather than throwing", async () => {
  const mustRefuse = [
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata, the one that matters
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://user:pw@example.com/", // credentials in the URL
    "file:///etc/passwd",
    "ftp://example.com/",
    "not a url at all",
    "",
  ];
  for (const raw of mustRefuse) {
    const r = await guardedRequest(raw, { timeoutMs: 500 });
    assert.equal(r.ok, false, `${raw} must be refused`);
    if (!r.ok) assert.ok(r.reason.length > 0, `${raw} must say why`);
  }
});

test("SSRF: a hostname that does not resolve is a refusal, never an uncaught throw", async () => {
  // Fails closed. A resolver error must not become an exception in the caller's request handler.
  const r = await guardedRequest("http://probe-test.invalid/", { timeoutMs: 500 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.reason.length > 0);
});
