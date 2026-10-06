import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveKeys, toBase64url, toHex } from "./iris.ts";
import {
  parseSession,
  persistSession,
  serializeSession,
  sessionRecord,
  SESSION_KEY,
  type StorageLike,
  type StoredSession,
} from "./login.ts";

/**
 * The no-persist invariant, made falsifiable.
 *
 * The whole account layer rests on one claim: a derived key never reaches a store. The code keeps it
 * today (keys live in React memory, only the public session record is written), but a claim with no
 * test is one refactor from being quietly false on a judge's machine mid-gate. So this fails the
 * moment any of the four derived secrets appears in anything the write path emits.
 *
 * It runs against `persistSession`, which `components/session.tsx` `write` calls and nothing else, so
 * this is a test over the real write path rather than a parallel copy.
 */

const PRF = new Uint8Array(32).map((_, i) => i + 1);
const NOW = 1_700_000_000_000;

/** A store that records every byte written, so a leak is a value we can read back and assert on. */
function recordingStorage(): { storage: StorageLike; writes: { key: string; value: string }[] } {
  const writes: { key: string; value: string }[] = [];
  return {
    writes,
    storage: {
      setItem: (key, value) => writes.push({ key, value }),
      removeItem: () => {},
    },
  };
}

/** Every byte-string of a derived secret, in both encodings a careless write might use. */
async function forbiddenSecrets(): Promise<string[]> {
  const k = await deriveKeys(PRF);
  const secrets = [
    k.account.privateKey,
    k.attestation.privateKey,
    k.onchainAttestation.privateKey,
    k.content,
  ];
  return secrets.flatMap((s) => [toHex(s), toBase64url(s)]);
}

test("the write path never serializes a derived key", async () => {
  const keys = await deriveKeys(PRF);
  const record = sessionRecord(keys.account.address, "passkey", NOW);

  const { storage, writes } = recordingStorage();
  persistSession(storage, record);

  const written = writes.map((w) => w.value).join("\n");
  // The address IS written and IS public, so this proves the scan looks at a non-empty string rather
  // than passing because nothing was written.
  assert.ok(written.includes(keys.account.address.toLowerCase()), "the public address is written");

  for (const secret of await forbiddenSecrets()) {
    assert.ok(
      !written.includes(secret),
      `a derived secret reached storage: ${secret.slice(0, 12)}…`,
    );
  }
});

test("what is written reads back as the public record and nothing more", async () => {
  const keys = await deriveKeys(PRF);
  const record = sessionRecord(keys.account.address, "passkey", NOW);
  const { storage, writes } = recordingStorage();
  persistSession(storage, record);

  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.key, SESSION_KEY);
  // Round-tripped through the same parser the app uses. parseSession rejects any field outside the
  // public set, so a key smuggled into the record would fail here as well as in the scan above.
  const back = parseSession(writes[0]!.value);
  assert.deepEqual(back, record);
  assert.deepEqual(Object.keys(JSON.parse(serializeSession(record))).sort(), [
    "address",
    "method",
    "since",
    "v",
  ]);
});

test("persisting null clears rather than writing anything", () => {
  const removed: string[] = [];
  const written: string[] = [];
  const storage: StorageLike = {
    setItem: (k) => written.push(k),
    removeItem: (k) => removed.push(k),
  };
  persistSession(storage, null);
  assert.deepEqual(written, [], "nothing is written when there is no session");
  assert.deepEqual(removed, [SESSION_KEY]);
});

test("the write path touches only the store it is handed, never a global one", async () => {
  const keys = await deriveKeys(PRF);
  const record: StoredSession = sessionRecord(keys.account.address, "passkey", NOW);

  // Spy on every global store a future refactor might reach for. persistSession takes its store as an
  // argument, so a write to one of these would be a regression that this catches.
  const localSink: unknown[] = [];
  const idbSink: unknown[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = { local: g.localStorage, idb: g.indexedDB };
  g.localStorage = { setItem: (...a: unknown[]) => localSink.push(a), removeItem: () => {} };
  g.indexedDB = { open: (...a: unknown[]) => idbSink.push(a), databases: async () => [] };
  try {
    const { storage } = recordingStorage();
    persistSession(storage, record);
    assert.deepEqual(localSink, [], "nothing reached localStorage");
    assert.deepEqual(idbSink, [], "nothing reached indexedDB");
  } finally {
    g.localStorage = saved.local;
    g.indexedDB = saved.idb;
  }
});
