import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTEXT, open, parseSealed, seal, writeMessage, type Sealed } from "./vault.ts";
import { deriveKeys } from "./iris.ts";

const KEY = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const OTHER = new Uint8Array(32).fill(0x11);

test("a sealed blob opens with the same key and context", async () => {
  const s = await seal(KEY, CONTEXT.jobBrief, "index every claim on Monad");
  const r = await open(KEY, s, CONTEXT.jobBrief);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.text, "index every claim on Monad");
});

test("the plaintext is not in the sealed blob", async () => {
  // The obvious failure that nobody checks for, because the happy path passes either way.
  const s = await seal(KEY, CONTEXT.jobBrief, "the quick brown fox");
  const blob = JSON.stringify(s);
  assert.ok(!blob.includes("quick"), "plaintext leaked into the blob");
  assert.ok(!blob.includes("fox"));
});

/* ------------------------------------------------- the cross-device gate */

test("the same passkey opens what the same passkey sealed, on a different derivation", async () => {
  // This IS the PRF bounty's second half, "decrypts the same state". Two independent derivations
  // from the same PRF output, one sealing and one opening, with nothing shared between them but
  // the 32 bytes the passkey produced.
  const prf = new Uint8Array(32).map((_, i) => i + 1);
  const deviceA = await deriveKeys(prf);
  const deviceB = await deriveKeys(prf);

  const s = await seal(deviceA.content, CONTEXT.agentMemory, "what the agent remembers");
  const r = await open(deviceB.content, s, CONTEXT.agentMemory);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.text, "what the agent remembers");
});

test("a different passkey cannot open it", async () => {
  const mine = await deriveKeys(new Uint8Array(32).fill(1));
  const theirs = await deriveKeys(new Uint8Array(32).fill(2));
  const s = await seal(mine.content, CONTEXT.jobBrief, "private");
  const r = await open(theirs.content, s, CONTEXT.jobBrief);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /authentication failed/);
});

/* ------------------------------------------------- context binding */

test("a blob sealed for one purpose cannot be opened as another", async () => {
  // Same key for both. Without the AAD binding this would succeed, and a server that can move a
  // blob between slots could change what a client believes it is.
  const s = await seal(KEY, CONTEXT.jobBrief, "the brief");
  const r = await open(KEY, s, CONTEXT.agentMemory);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /labelled .*job-brief.* opened as .*agent-memory/);
});

test("relabelling a blob breaks it, because the context is authenticated not just stored", async () => {
  // The check above fails early on a string compare. This one proves GCM itself refuses, so the
  // early check is a better error message rather than the actual defence.
  const s = await seal(KEY, CONTEXT.jobBrief, "the brief");
  const relabelled: Sealed = { ...s, context: CONTEXT.agentMemory };
  // Opened with no expected context, so only the AAD stands between this and a successful read.
  const r = await open(KEY, relabelled);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /authentication failed/);
});

test("a blob with no context is refused at seal time", async () => {
  await assert.rejects(() => seal(KEY, "", "x"), /could be opened as anything else/);
});

/* ------------------------------------------------- tampering */

test("flipping one bit of the ciphertext is caught", async () => {
  const s = await seal(KEY, CONTEXT.deliverable, "the work product");
  const bytes = Buffer.from(s.ct.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  bytes[0] ^= 0x01;
  const tampered: Sealed = { ...s, ct: bytes.toString("base64url") };
  const r = await open(KEY, tampered, CONTEXT.deliverable);
  assert.equal(r.ok, false);
});

test("swapping the nonce is caught", async () => {
  const a = await seal(KEY, CONTEXT.jobBrief, "one");
  const b = await seal(KEY, CONTEXT.jobBrief, "two");
  const r = await open(KEY, { ...a, nonce: b.nonce }, CONTEXT.jobBrief);
  assert.equal(r.ok, false);
});

test("a wrong-length nonce is refused with its length, not a generic failure", async () => {
  const s = await seal(KEY, CONTEXT.jobBrief, "x");
  const r = await open(KEY, { ...s, nonce: "AAAA" }, CONTEXT.jobBrief);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /nonce must be 12 bytes/);
});

/* ------------------------------------------------- nonces */

test("every seal uses a fresh nonce", async () => {
  // GCM loses everything on a nonce reuse under one key. A counter would need state, and there is
  // no state here by design, so the only safe answer is random every time.
  const nonces = new Set<string>();
  for (let i = 0; i < 200; i++) nonces.add((await seal(KEY, CONTEXT.jobBrief, "same")).nonce);
  assert.equal(nonces.size, 200, "a nonce repeated");
});

test("sealing the same plaintext twice gives different ciphertext", async () => {
  const a = await seal(KEY, CONTEXT.jobBrief, "identical");
  const b = await seal(KEY, CONTEXT.jobBrief, "identical");
  assert.notEqual(a.ct, b.ct);
});

/* ------------------------------------------------- untrusted input */

test("a key that is not 32 bytes is refused rather than stretched", async () => {
  await assert.rejects(() => seal(new Uint8Array(16), CONTEXT.jobBrief, "x"), /32 bytes for AES-256/);
  await assert.rejects(() => seal(OTHER.slice(0, 31), CONTEXT.jobBrief, "x"), /32 bytes/);
});

test("parseSealed refuses everything malformed and keeps nothing extra", () => {
  assert.equal(parseSealed(null), null);
  assert.equal(parseSealed("not json"), null);
  assert.equal(parseSealed({}), null);
  assert.equal(parseSealed({ v: 2, context: "a", nonce: "b", ct: "c" }), null, "wrong version");
  assert.equal(parseSealed({ v: 1, context: "", nonce: "b", ct: "c" }), null, "empty context");
  assert.equal(parseSealed({ v: 1, context: "a", nonce: 5, ct: "c" }), null, "nonce not a string");

  // The server holds these blobs and is not trusted, so a field it adds must not survive a
  // client round-trip back to it.
  const cleaned = parseSealed({ v: 1, context: "a", nonce: "b", ct: "c", evil: "payload" });
  assert.deepEqual(cleaned, { v: 1, context: "a", nonce: "b", ct: "c" });
});

test("parseSealed accepts the JSON a server would actually return", async () => {
  const s = await seal(KEY, CONTEXT.jobBrief, "round trip");
  const parsed = parseSealed(JSON.stringify(s));
  assert.ok(parsed);
  const r = await open(KEY, parsed!, CONTEXT.jobBrief);
  assert.equal(r.ok, true);
});

test("an unknown format version is refused by name", async () => {
  const s = await seal(KEY, CONTEXT.jobBrief, "x");
  const r = await open(KEY, { ...s, v: 2 as unknown as 1 }, CONTEXT.jobBrief);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /unknown vault format version 2/);
});

test("binary survives the round trip, not just text", async () => {
  const bytes = new Uint8Array(1024).map((_, i) => (i * 31) & 0xff);
  const s = await seal(KEY, CONTEXT.deliverable, bytes);
  const r = await open(KEY, s, CONTEXT.deliverable);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.bytes, bytes);
});

/* ------------------------------------------------- authorising a write */

test("a vault write signature recovers to the signer's own address", async () => {
  // The server is told an address and has to check it rather than trust it. Recovery is what
  // makes that possible without the client also sending a public key.
  const { deriveKeys, signVaultWrite } = await import("./iris.ts");
  const { secp256k1 } = await import("@noble/curves/secp256k1");
  const { keccak_256 } = await import("@noble/hashes/sha3");

  const k = await deriveKeys(new Uint8Array(32).fill(5));
  const s = await seal(k.content, CONTEXT.jobBrief, "brief");
  const sig = signVaultWrite(writeMessage(k.account.address, s), k.account.privateKey);

  assert.match(sig, /^0x[0-9a-f]{130}$/, "65 bytes: r, s, then the recovery byte");

  const raw = sig.slice(2);
  const pub = secp256k1.Signature.fromCompact(Uint8Array.from(Buffer.from(raw.slice(0, 128), "hex")))
    .addRecoveryBit(parseInt(raw.slice(128, 130), 16))
    .recoverPublicKey(keccak_256(writeMessage(k.account.address, s)))
    .toRawBytes(false);
  const hash = keccak_256(pub.slice(1));
  const recovered = `0x${Array.from(hash.slice(-20), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  assert.equal(recovered, k.account.address.toLowerCase());
});

test("a signature for one blob does not authorise a different blob", async () => {
  // Otherwise one captured signature would let anybody replace that slot's contents forever.
  const { deriveKeys, signVaultWrite } = await import("./iris.ts");
  const k = await deriveKeys(new Uint8Array(32).fill(5));

  const a = await seal(k.content, CONTEXT.jobBrief, "the real brief");
  const b = await seal(k.content, CONTEXT.jobBrief, "a replacement");
  const sigForA = signVaultWrite(writeMessage(k.account.address, a), k.account.privateKey);
  const sigForB = signVaultWrite(writeMessage(k.account.address, b), k.account.privateKey);
  assert.notEqual(sigForA, sigForB, "the ciphertext is inside the signed message");
});

test("the signed message covers every field that matters", () => {
  const base: Sealed = { v: 1, context: "c", nonce: "n", ct: "x" };
  const addr = "0x1111111111111111111111111111111111111111";
  const other = "0x2222222222222222222222222222222222222222";
  const msg = (a: string, s: Sealed) => new TextDecoder().decode(writeMessage(a, s));

  // Each of these is a thing a server could otherwise be talked into changing.
  assert.notEqual(msg(addr, base), msg(other, base), "address");
  assert.notEqual(msg(addr, base), msg(addr, { ...base, context: "d" }), "context");
  assert.notEqual(msg(addr, base), msg(addr, { ...base, nonce: "m" }), "nonce");
  assert.notEqual(msg(addr, base), msg(addr, { ...base, ct: "y" }), "ciphertext");
  assert.match(msg(addr, base), /^kanmani\.vault\.write\.v1\n/, "domain prefix, so it cannot be replayed elsewhere");
});

test("the address in the signed message is case-normalised", () => {
  // A client that sends a checksummed address and a server that lowercases it would otherwise
  // compute different digests and every write would fail for no visible reason.
  const s: Sealed = { v: 1, context: "c", nonce: "n", ct: "x" };
  const upper = "0xABCDEF1111111111111111111111111111111111";
  assert.deepEqual(writeMessage(upper, s), writeMessage(upper.toLowerCase(), s));
});
