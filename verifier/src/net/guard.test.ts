/**
 * The guard, tested against the attacks it exists to stop.
 *
 * Every test here is an attacker doing something specific, rather than a check that a helper
 * returns a boolean. The two that matter most are `rebinding` and `redirectIntoLoopback`, because
 * those are the ones a hostname-only blocklist passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { isForbiddenAddress, resolvePublic, screenUrl } from "./guard.ts";
import { fetchOnce, guardedFetch } from "./fetch.ts";

/* ------------------------------------------------------------------ address screening */

test("blocks every private and reserved range we care about", () => {
  const mustBlock = [
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata, the one that matters
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1", // loopback in v4-mapped notation
    "::ffff:7f00:1", // the same loopback in the hex form new URL() actually produces
    "::ffff:169.254.169.254", // cloud metadata, v4-mapped dotted
    "::ffff:a9fe:a9fe", // cloud metadata, v4-mapped hex
    "0:0:0:0:0:ffff:7f00:1", // loopback, mapped and uncompressed
    "::7f00:1", // loopback in the deprecated v4-compatible form
    "64:ff9b::7f00:1", // loopback behind the well-known NAT64 prefix
  ];
  for (const ip of mustBlock) {
    assert.ok(isForbiddenAddress(ip), `${ip} should be blocked`);
  }
});

test("allows a public IPv4 carried inside a v4-mapped IPv6 address", () => {
  // The screen has to keep working for real mapped addresses, not reject the whole notation.
  assert.equal(isForbiddenAddress("::ffff:8.8.8.8"), null);
  assert.equal(isForbiddenAddress("::ffff:808:808"), null);
});

test("URL-parser normalisation cannot smuggle a mapped loopback past screenUrl", () => {
  // The bug this pins: new URL() rewrites [::ffff:127.0.0.1] to ::ffff:7f00:1 before the guard sees
  // it, so a regex on the dotted form never fired and loopback read as public. Screening the parsed
  // bytes is what closes it. Feeding the dotted string straight to isForbiddenAddress, as an earlier
  // test did, never exercised the notation the parser actually hands over.
  const mustBlock = [
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "http://[::ffff:10.0.0.5]:8081/v1/graphql",
    "http://[::7f00:1]/",
    "http://[64:ff9b::7f00:1]/",
  ];
  for (const u of mustBlock) {
    assert.equal(screenUrl(u).ok, false, `${u} must be blocked after URL normalisation`);
  }
  // A public mapped address is still fetchable.
  assert.equal(screenUrl("http://[::ffff:8.8.8.8]/").ok, true);
});

test("allows ordinary public addresses", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
    assert.equal(isForbiddenAddress(ip), null, `${ip} should be allowed`);
  }
});

test("172.16.0.0/12 boundaries are not off by one", () => {
  assert.equal(isForbiddenAddress("172.15.255.255"), null, "just below the range is public");
  assert.ok(isForbiddenAddress("172.16.0.0"), "bottom of the range is private");
  assert.ok(isForbiddenAddress("172.31.255.255"), "top of the range is private");
  assert.equal(isForbiddenAddress("172.32.0.0"), null, "just above the range is public");
});

/* ------------------------------------------------------------------ scheme handling */

test("refuses schemes it cannot fetch and URLs carrying credentials", () => {
  assert.equal(screenUrl("file:///etc/passwd").ok, false);
  assert.equal(screenUrl("gopher://example.com/").ok, false);
  assert.equal(screenUrl("http://user:pw@example.com/").ok, false);
  assert.equal(screenUrl("not a url").ok, false);
  assert.equal(screenUrl("https://example.com/doc.json").ok, true);
});

test("a literal private address in the URL is refused without touching DNS", () => {
  assert.equal(screenUrl("http://169.254.169.254/latest/meta-data/").ok, false);
  assert.equal(screenUrl("http://[::1]:8081/v1/graphql").ok, false);
});

/* ------------------------------------------------------------------ resolution */

test("ANY private answer poisons the whole set, not just the first", async () => {
  // A hostname answering with one public address and one private one. Screening only the first
  // record would let this through and the socket might well pick the second.
  const r = await resolvePublic("mixed.example", async () => ["93.184.216.34", "127.0.0.1"]);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /127\.0\.0\.1/);
});

test("a DNS failure is a refusal with a reason, never a silent allow", async () => {
  const r = await resolvePublic("nope.example", async () => {
    throw new Error("NXDOMAIN");
  });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /DNS lookup failed/);
});

test("a resolver that hangs is cut off by the DNS timeout, not left to stall the worker", async () => {
  // A hostname pointed at a resolver that never answers. Without the bound this await never returns
  // and the serial worker stops. The short timeout proves the race fires.
  const r = await resolvePublic("slow.example", () => new Promise<string[]>(() => {}), 50);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match((r as { reason: string }).reason, /DNS lookup failed: timed out/);
});

/* ------------------------------------------------------------------ live server tests */

function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => {
      resolve({ port: (s.address() as { port: number }).port, close: () => s.close() });
    });
  });
}

test("guardedFetch refuses a host that resolves to loopback, even to reach a real server", async () => {
  const s = await listen((_req, res) => {
    res.writeHead(200);
    res.end("SECRET");
  });
  try {
    const r = await guardedFetch(`http://sneaky.invalid:${s.port}/`, {
      resolver: async () => ["127.0.0.1"],
      timeoutMs: 2500,
    });
    assert.equal(r.ok, false, "the screen has to win even though a server is really there");
    if (r.ok === false) assert.doesNotMatch(r.reason, /SECRET/);
  } finally {
    s.close();
  }
});

test("guardedFetch refuses a v4-mapped loopback literal even with a real server behind it", async () => {
  // End to end proof of the fix: a server really answers on loopback, and the request is refused at
  // the screen before any byte is read, so SECRET never comes back.
  const s = await listen((_req, res) => {
    res.writeHead(200);
    res.end("SECRET");
  });
  try {
    const r = await guardedFetch(`http://[::ffff:127.0.0.1]:${s.port}/`, { timeoutMs: 2500 });
    assert.equal(r.ok, false, "the mapped loopback literal must be blocked");
    if (r.ok === false) {
      assert.match(r.reason, /IPv4-in-IPv6/);
      assert.doesNotMatch(r.reason, /SECRET/);
    }
  } finally {
    s.close();
  }
});

test("REBINDING: DNS is resolved exactly once, so a second answer cannot be swapped in", async () => {
  // The attack: answer public while the guard looks, private when the socket connects. If the
  // hostname were handed to the runtime, the second answer would win. Counting resolver calls is
  // the direct way to show there is no second answer to win with.
  let calls = 0;
  const flipflop = async () => {
    calls++;
    return calls === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
  };
  const r = await guardedFetch("http://rebind.invalid/", { resolver: flipflop, timeoutMs: 700 });
  assert.equal(calls, 1, "resolved once, so the flip never gets a turn");
  // The pinned address is public and unroutable from a test box, so this fails to connect rather
  // than reaching anything. Failing to connect is the correct outcome.
  assert.equal(r.ok, false);
});

test("REDIRECT into loopback is refused at the second hop", async () => {
  const secret = await listen((_req, res) => {
    res.writeHead(200);
    res.end("INTERNAL");
  });
  const open = await listen((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${secret.port}/` });
    res.end();
  });
  try {
    // First hop is screened against a public address but served locally through the pin, so the
    // hop under test is the second one.
    const first = await fetchOnce(
      new URL(`http://public.invalid:${open.port}/`),
      ["127.0.0.1"],
      4096,
      2500,
    );
    assert.equal(first.ok, true);
    assert.ok(first.ok && first.redirectTo, "first hop is a redirect");

    // That Location is what guardedFetch would re-screen. It must be refused.
    const screened = screenUrl(first.ok ? first.redirectTo! : "");
    assert.equal(screened.ok, false, "the redirect target is loopback and must be blocked");
  } finally {
    secret.close();
    open.close();
  }
});

/* --------------------------------------------- transport: cap, timeout, exact bytes */

test("SIZE: an unbounded chunked response is cut off at the cap", async () => {
  // The realistic oversize attack. With HTTP/1.1 a fixed Content-Length is authoritative framing,
  // so a server cannot declare twelve bytes and smuggle more past it: the client stops at twelve
  // and the surplus reads as a malformed second response. What a server CAN do is omit the length
  // entirely, use chunked encoding and stream forever. That is what this serves.
  let stopped = false;
  const s = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" }); // chunked, no content-length
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
    const r = await fetchOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], 4096, 2500);
    assert.equal(r.ok, false, "must refuse rather than buffer an endless body");
    if (r.ok === false) assert.match(r.reason, /exceeds 4096 bytes/);
  } finally {
    stopped = true;
    s.close();
  }
});

test("SIZE: an honest oversize Content-Length is also capped as bytes arrive", async () => {
  const body = "B".repeat(20_000);
  const s = await listen((_req, res) => {
    res.writeHead(200, { "content-length": String(body.length) });
    res.end(body);
  });
  try {
    const r = await fetchOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], 4096, 2500);
    assert.equal(r.ok, false);
    if (r.ok === false) assert.match(r.reason, /exceeds 4096 bytes/);
  } finally {
    s.close();
  }
});

test("a document under the cap comes back byte for byte", async () => {
  const body = JSON.stringify({ network: "monad", tx: "0xabc" });
  const s = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  try {
    const r = await fetchOnce(new URL(`http://x:${s.port}/doc.json`), ["127.0.0.1"], 4096, 2500);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(Buffer.from(r.bytes!).toString("utf8"), body);
      assert.equal(r.status, 200);
    }
  } finally {
    s.close();
  }
});

test("a hanging server is a timeout with a reason, not a stuck worker", async () => {
  const s = await listen(() => {
    /* never responds */
  });
  try {
    const started = Date.now();
    const r = await fetchOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], 4096, 700);
    assert.equal(r.ok, false);
    if (r.ok === false) assert.match(r.reason, /timed out/);
    assert.ok(Date.now() - started < 4000, "gave up promptly");
  } finally {
    s.close();
  }
});

test("a non-200 is a refusal carrying the status, not an empty success", async () => {
  const s = await listen((_req, res) => {
    res.writeHead(404);
    res.end("gone");
  });
  try {
    const r = await fetchOnce(new URL(`http://x:${s.port}/`), ["127.0.0.1"], 4096, 2500);
    assert.equal(r.ok, false);
    if (r.ok === false) assert.match(r.reason, /HTTP 404/);
  } finally {
    s.close();
  }
});
