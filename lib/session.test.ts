import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyMessage } from "viem";
import { deriveKeys } from "./iris.ts";
import {
  connectAndOpenSession,
  isSessionError,
  openSession,
  SessionError,
  type SessionScope,
} from "./session.ts";
import { repromptFor } from "./session-reprompt.ts";

/**
 * The pinned PRF vector, the same one iris and Sclera assert against, so the account address is a
 * known constant and a test needs no browser and no passkey.
 */
const PINNED_PRF = new Uint8Array(32).map((_, i) => i + 1);
const PINNED_ACCOUNT = "0x92c2a8984eb7b890FfB4c6B57560Ac4E4868454B";

const scope = (max = 50_000n): SessionScope => ({
  label: "x402 verification payments up to 0.05 USDC on kanmani.xyz",
  maxAmountAtomic: max,
  resourceHost: "kanmani.xyz",
});

/** A clock a test moves by hand, so expiry is deterministic. */
function fakeClock(start = 1_700_000_000_000) {
  const state = { t: start };
  return { now: () => state.t, advance: (ms: number) => (state.t += ms) };
}

async function openPinned(ttlMs: number, now: () => number) {
  const keys = await deriveKeys(PINNED_PRF);
  const session = openSession({
    privateKey: keys.account.privateKey,
    scope: scope(),
    ttlMs,
    seams: { now },
  });
  return { keys, session };
}

test("the session address is the passkey account address, derived not stored", async () => {
  const clock = fakeClock();
  const { keys, session } = await openPinned(60_000, clock.now);
  assert.equal(session.address, PINNED_ACCOUNT);
  assert.equal(session.address, keys.account.address);
});

test("one ceremony onboards, then the session signs with no further prompt", async () => {
  const clock = fakeClock();
  let ceremonies = 0;
  const connect = async () => {
    ceremonies += 1;
    return deriveKeys(PINNED_PRF);
  };

  const { session } = await connectAndOpenSession({
    connect,
    scope: scope(),
    ttlMs: 60_000,
    seams: { now: clock.now },
  });
  assert.equal(ceremonies, 1, "one prompt to onboard");

  // Three signatures, none of which runs the ceremony again.
  for (let i = 0; i < 3; i++) {
    const sig = await session.account.signMessage({ message: `check ${i}` });
    assert.match(sig, /^0x[0-9a-f]+$/i);
  }
  assert.equal(ceremonies, 1, "the session signs prompt-free");
});

test("the session signature recovers to the account address, so it is really that key", async () => {
  const clock = fakeClock();
  const { session } = await openPinned(60_000, clock.now);
  const message = "kanmani session proof";
  const signature = await session.account.signMessage({ message });
  const ok = await verifyMessage({ address: session.address, message, signature });
  assert.equal(ok, true);
});

test("a payment above the scope is refused before the key is touched", async () => {
  const clock = fakeClock();
  const { session } = await openPinned(60_000, clock.now);
  assert.throws(
    () => session.assertCanPay(50_001n),
    (e: unknown) => isSessionError(e) && e.code === "SCOPE_EXCEEDED",
  );
  // Refused, not ended: a scope miss is a bad request, not a reason to drop the session.
  assert.equal(session.ended(), false);
});

test("an expired session zeroes the key and refuses to sign", async () => {
  const clock = fakeClock();
  const { session } = await openPinned(30_000, clock.now);
  assert.equal(session.expired(), false);
  assert.ok(session.remainingMs() > 0);

  clock.advance(30_001);
  assert.equal(session.expired(), true);
  assert.equal(session.remainingMs(), 0);

  assert.throws(
    () => session.assertCanPay(10_000n),
    (e: unknown) => isSessionError(e) && e.code === "SESSION_EXPIRED",
  );
  assert.equal(session.ended(), true, "expiry ends the session, which zeroes the Mera key");

  // The Mera session itself now refuses, which is the proof the key is gone rather than idle.
  await assert.rejects(() => session.account.signMessage({ message: "too late" }));
});

test("after expiry the next connect runs the ceremony again", async () => {
  const clock = fakeClock();
  let ceremonies = 0;
  const connect = async () => {
    ceremonies += 1;
    return deriveKeys(PINNED_PRF);
  };
  const open = () =>
    connectAndOpenSession({ connect, scope: scope(), ttlMs: 10_000, seams: { now: clock.now } });

  const first = await open();
  assert.equal(ceremonies, 1);

  clock.advance(10_001);
  assert.throws(
    () => first.session.assertCanPay(10_000n),
    (e: unknown) => isSessionError(e) && e.code === "SESSION_EXPIRED",
  );

  // The UI answers SESSION_EXPIRED by re-running the ceremony.
  const second = await open();
  assert.equal(ceremonies, 2, "re-prompt on the action after expiry");
  assert.equal(second.session.address, PINNED_ACCOUNT);
});

test("end is idempotent and a later sign attempt is a clean SESSION_ENDED", async () => {
  const clock = fakeClock();
  const { session } = await openPinned(60_000, clock.now);
  session.end();
  session.end();
  assert.equal(session.ended(), true);
  assert.throws(
    () => session.assertCanPay(1n),
    (e: unknown) => e instanceof SessionError && e.code === "SESSION_ENDED",
  );
});

test("a session needs a positive time to live", async () => {
  const keys = await deriveKeys(PINNED_PRF);
  assert.throws(() =>
    openSession({ privateKey: keys.account.privateKey, scope: scope(), ttlMs: 0 }),
  );
});

test("a payment session only pays the recipient its scope names", async () => {
  const keys = await deriveKeys(PINNED_PRF);
  const pinned = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
  const session = openSession({
    privateKey: keys.account.privateKey,
    scope: { label: "pay us", maxAmountAtomic: 50_000n, resourceHost: "kanmani.xyz", payTo: pinned },
    ttlMs: 60_000,
    seams: { now: fakeClock().now },
  });
  // The right recipient is fine, in either casing.
  session.assertCanPay(10_000n, pinned.toLowerCase());
  // A different recipient is refused before the key signs, so a tampered authorization cannot redirect.
  assert.throws(
    () => session.assertCanPay(10_000n, "0x1111111111111111111111111111111111111111"),
    (e: unknown) => isSessionError(e) && e.code === "WRONG_SIGNER",
  );
});

/* ---------------------------------------------- the three re-prompt cases, as the UI drives them */

test("within scope signs with no prompt, over cap prompts, after expiry renews once", async () => {
  const clock = fakeClock();
  let ceremonies = 0;
  const connect = async () => {
    ceremonies += 1;
    return deriveKeys(PINNED_PRF);
  };
  const open = () =>
    connectAndOpenSession({ connect, scope: scope(50_000n), ttlMs: 10_000, seams: { now: clock.now } });

  // 1. Within scope: one ceremony onboards, two signatures run with no further prompt.
  const { session } = await open();
  assert.equal(ceremonies, 1);
  session.assertCanPay(50_000n);
  session.assertCanPay(10_000n);
  await session.account.signMessage({ message: "a" });
  await session.account.signMessage({ message: "b" });
  assert.equal(ceremonies, 1, "the session signs prompt-free within scope");
  assert.equal(repromptFor(null), "none");

  // 2. Over the cap: refused, and the UI maps it to raiseCap, which re-prompts.
  const over = (() => {
    try {
      session.assertCanPay(50_001n);
      return null;
    } catch (e) {
      return e as SessionError;
    }
  })();
  assert.ok(over && over.code === "SCOPE_EXCEEDED");
  assert.equal(repromptFor(over.code), "raiseCap");
  assert.equal(session.ended(), false, "a scope miss is a bad request, not a dropped session");

  // 3. After expiry: refused, mapped to renew, one more ceremony reopens the session.
  clock.advance(10_001);
  const expired = (() => {
    try {
      session.assertCanPay(10_000n);
      return null;
    } catch (e) {
      return e as SessionError;
    }
  })();
  assert.ok(expired && expired.code === "SESSION_EXPIRED");
  assert.equal(repromptFor(expired.code), "renew");
  const reopened = await open();
  assert.equal(ceremonies, 2, "renew runs exactly one more ceremony");
  reopened.session.assertCanPay(10_000n);
});
