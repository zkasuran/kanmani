import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeDataUri, resolveEvidence } from "./resolve.ts";

const text = (b: Uint8Array) => Buffer.from(b).toString("utf8");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/* ---------------------------------------------------------------- data: URIs */

test("decodes the base64 shape, which is 397 of a 400 document sample", () => {
  const body = JSON.stringify({ elo: 1500, game: "chess" });
  const r = decodeDataUri(`data:application/json;base64,${b64(body)}`);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(text(r.bytes), body);
});

test("decodes the percent-encoded shape, which is the other 3", () => {
  const body = JSON.stringify({ score: 100, conversation_success: true });
  const r = decodeDataUri(`data:application/json,${encodeURIComponent(body)}`);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(text(r.bytes), body);
});

test("bytes come back EXACTLY, because the hash is computed over them", () => {
  // Any normalisation here would break `intact` for every data: document at once and it would
  // break it silently, looking like the authors got their own hashes wrong.
  const body = '{ "a" : 1,\n  "b":  2 }';
  const r = decodeDataUri(`data:application/json;base64,${b64(body)}`);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(text(r.bytes), body, "spacing and newlines survive");
});

test("invalid base64 is refused rather than silently truncated", () => {
  // Buffer.from is lenient: it drops characters it cannot read and returns something shorter,
  // which would decode to a plausible-looking partial document.
  const r = decodeDataUri("data:application/json;base64,!!!!not base64!!!!");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not valid base64/);
});

test("a malformed data URI is refused with a reason", () => {
  assert.equal(decodeDataUri("data:application/json;base64").ok, false, "no comma");
  assert.equal(decodeDataUri("data:application/json;base64,").ok, false, "empty payload");
});

test("the cap applies before decoding, so a hostile payload is never allocated", () => {
  const huge = "A".repeat(200_000);
  const r = decodeDataUri(`data:application/json;base64,${huge}`, 4096);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /encoded characters/);
});

test("a payload under the encoded bound but over the byte cap is still refused", () => {
  const body = "x".repeat(6000);
  const r = decodeDataUri(`data:text/plain;base64,${b64(body)}`, 4096);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /exceeds 4096 bytes/);
});

/* ---------------------------------------------------------------- dispatch */

test("resolveEvidence routes by scheme and records which one it used", async () => {
  const r = await resolveEvidence(`data:application/json;base64,${b64('{"a":1}')}`);
  assert.equal(r.ok, true);
  assert.equal(r.source, "data");
});

test("an empty or unsupported URI is refused rather than guessed at", async () => {
  assert.equal((await resolveEvidence("")).ok, false);
  assert.equal((await resolveEvidence("   ")).ok, false);

  // Bare inline JSON appears in other registries but not on Monad. Treating it as a document would
  // let a URI that simply failed to parse look like evidence.
  const inline = await resolveEvidence('{"network":"monad"}');
  assert.equal(inline.ok, false);
  if (!inline.ok) assert.match(inline.reason, /unsupported URI scheme/);

  assert.equal((await resolveEvidence("file:///etc/passwd")).ok, false);
});

test("PATH TRAVERSAL in an ipfs URI is refused before any gateway is contacted", async () => {
  // Found by this test failing against the first implementation, which allowed `.` in the CID
  // character class because CIDs sit next to filenames in people's heads. `..` sailed through and
  // would have been concatenated onto the gateway URL.
  for (const bad of [
    "ipfs://../../etc/passwd",
    "ipfs://bafyreal/../../secret",
    "ipfs://.",
    "ipfs://..",
    "ipfs://short",
    "ipfs://has spaces",
  ]) {
    const r = await resolveEvidence(bad, { ipfsGateway: "https://gw.invalid/ipfs/" });
    assert.equal(r.ok, false, `${bad} must be refused`);
    if (!r.ok) assert.match(r.reason, /not a CID/);
  }
});

test("a well formed ipfs CID is accepted by the validator and reaches the gateway step", async () => {
  // The two real ones on Monad. Proven by the refusal being about the network rather than the CID.
  const r = await resolveEvidence(
    "ipfs://bafkreiepr5tuj23bvva5rlu2f73b7nwrfbzewoh72udubucwhbmlixfh2m",
    { ipfsGateway: "https://gw.invalid/ipfs/", timeoutMs: 600 },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.doesNotMatch(r.reason, /not a CID/, "the CID itself was fine");
});

test("the data: path never touches the network, which is 92% of this corpus", async () => {
  // Proven by giving it a resolver that throws if called. The guard is the most security-critical
  // file in the build and also the one that almost never runs on real data.
  const r = await resolveEvidence(`data:application/json;base64,${b64('{"ok":true}')}`, {
    // guardedFetch would use this; the data path must not reach it.
    ...({ resolver: () => { throw new Error("network was touched"); } } as object),
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, "data");
});

test("the declared media type comes back, including RFC 2397's text/plain default", async () => {
  const json = await resolveEvidence(`data:application/json;base64,${b64('{"a":1}')}`);
  assert.equal(json.mediaType, "application/json");

  const plain = await resolveEvidence("data:text/plain,Excellent%20service");
  assert.equal(plain.mediaType, "text/plain");

  // `data:,payload` omits the type and the spec says that means text/plain rather than unknown.
  const bare = await resolveEvidence("data:,Excellent%20service");
  assert.equal(bare.mediaType, "text/plain");
  assert.equal(bare.ok, true);
});
