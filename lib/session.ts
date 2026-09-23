/**
 * A scoped, expiring Mera signing session.
 *
 * One passkey ceremony derives the account key (see lib/iris). That key opens a secp256k1 signing
 * session which signs 32-byte digests with no further prompt until it ends. `toViemAccount` adapts
 * the session into a viem account, so the same session signs EIP-712, EIP-191 and transactions the
 * way any viem account does, still with no prompt and still with no key on a server.
 *
 * This module adds the two things a raw session does not carry: a SCOPE (what the session may sign
 * and up to what value) plus an EXPIRY (a wall-clock deadline after which the key is zeroed so the
 * next action has to re-prompt). Both are enforced in `assertCanPay`, which every signing path
 * calls before it touches the key.
 *
 * ## Why an explicit expiry
 *
 * A prompt-free session is a key sitting in memory. The safe version of that is a key that stops
 * working on its own. `openSession` takes a TTL and records a deadline. The first call made past
 * the deadline ends the session (which zeroes the key inside Mera) then throws SESSION_EXPIRED, so
 * the app re-runs the one-prompt ceremony rather than signing on a session the user has walked away
 * from. Expiry is not a timer that fires on its own, it is checked on use, so a backgrounded tab
 * cannot sign either.
 *
 * ## Nothing here needs a browser
 *
 * `createSecp256k1SigningSession` and `toViemAccount` are pure over a private key. The seams exist
 * so a test injects a clock and asserts expiry deterministically. The signing itself is the real
 * Mera session in tests too, so a test recovers the signer and proves it is the session key rather
 * than trusting that it was.
 */

import { createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { Secp256k1SigningSession } from "@category-labs/mera";
import type { LocalAccount } from "viem";
import { type IrisKeys } from "./iris.ts";

/** What a session is allowed to do, in units the caller understands. */
export type SessionScope = {
  /** One line a person can read, naming what may be signed and up to what value. */
  label: string;
  /** The largest single payment this session will sign, in the token's atomic units. */
  maxAmountAtomic: bigint;
  /** The host this session pays. Shown so a user knows which site the session is for. */
  resourceHost: string;
};

export type SessionErrorCode = "SESSION_EXPIRED" | "SESSION_ENDED" | "SCOPE_EXCEEDED" | "WRONG_SIGNER";

/**
 * A refusal the UI can act on rather than a bare throw.
 *
 * The `code` decides what happens next: SESSION_EXPIRED and SESSION_ENDED mean re-run the ceremony,
 * SCOPE_EXCEEDED means this action is outside what the user agreed to, WRONG_SIGNER means the
 * authorization names an address this session does not control.
 */
export class SessionError extends Error {
  readonly code: SessionErrorCode;
  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}

export function isSessionError(e: unknown): e is SessionError {
  return e instanceof SessionError;
}

type CreateSession = (options: { privateKey: Uint8Array }) => Secp256k1SigningSession;
type ToAccount = (session: Secp256k1SigningSession) => LocalAccount<"mera">;

/**
 * Injection points for tests. In production every default is the real thing: the real Mera session
 * factory, the real viem adapter, the real wall clock.
 */
export type SessionSeams = {
  createSession?: CreateSession;
  toAccount?: ToAccount;
  /** Milliseconds since the epoch. Injected so a test can move time past the deadline at will. */
  now?: () => number;
};

/** A live session with a scope and a deadline attached. */
export type ScopedSession = {
  /** The viem account the session backs. Signs EIP-712, EIP-191 and transactions with no prompt. */
  readonly account: LocalAccount<"mera">;
  /** EIP-55 address of the session key. Same address the passkey derives every time. */
  readonly address: `0x${string}`;
  readonly scope: SessionScope;
  readonly openedAt: number;
  readonly expiresAt: number;
  /** Milliseconds left before expiry, floored at zero. Drives the countdown in the UI. */
  remainingMs(): number;
  /** True once the deadline has passed. */
  expired(): boolean;
  /** True once the key has been zeroed, by expiry or by an explicit end. */
  ended(): boolean;
  /**
   * The one gate every signing path runs first. Throws SESSION_ENDED or SESSION_EXPIRED when the
   * session is no longer usable (ending it first so the key is gone). Throws SCOPE_EXCEEDED when the
   * amount is larger than the session was opened for.
   */
  assertCanPay(amountAtomic: bigint): void;
  /** Zero the key now. Idempotent, so calling it twice is fine. */
  end(): void;
};

/**
 * Open a session from a private key, a scope and a time to live.
 *
 * The key is handed to Mera's session, which keeps its own copy and zeroes it on `end`. This module
 * never holds the key past this call.
 */
export function openSession(opts: {
  privateKey: Uint8Array;
  scope: SessionScope;
  ttlMs: number;
  seams?: SessionSeams;
}): ScopedSession {
  const seams = opts.seams ?? {};
  const now = seams.now ?? (() => Date.now());
  const create = seams.createSession ?? createSecp256k1SigningSession;
  const adapt = seams.toAccount ?? toViemAccount;

  if (opts.ttlMs <= 0) {
    throw new SessionError("SESSION_EXPIRED", "a session needs a time to live greater than zero");
  }

  const session = create({ privateKey: opts.privateKey });
  const account = adapt(session);
  const openedAt = now();
  const expiresAt = openedAt + opts.ttlMs;
  let done = false;

  const end = (): void => {
    if (done) return;
    done = true;
    session.end();
  };

  const expired = (): boolean => now() >= expiresAt;

  const assertCanPay = (amountAtomic: bigint): void => {
    if (done) {
      throw new SessionError("SESSION_ENDED", "this session has ended, open a new one");
    }
    if (expired()) {
      // Notice the deadline, zero the key, then make the caller re-run the ceremony.
      end();
      throw new SessionError(
        "SESSION_EXPIRED",
        "this signing session has expired, sign in again to open a new one",
      );
    }
    if (amountAtomic > opts.scope.maxAmountAtomic) {
      throw new SessionError(
        "SCOPE_EXCEEDED",
        `this session may sign for at most ${opts.scope.maxAmountAtomic} atomic units, ${amountAtomic} was asked for`,
      );
    }
  };

  return {
    account,
    address: account.address,
    scope: opts.scope,
    openedAt,
    expiresAt,
    remainingMs: () => Math.max(0, expiresAt - now()),
    expired,
    ended: () => done,
    assertCanPay,
    end,
  };
}

/**
 * The whole browser path in one call: one passkey ceremony, then a scoped session on the account
 * key it derives.
 *
 * `connect` is the ceremony. In the app it is a wrapper over lib/passkey `signIn`, which is exactly
 * one prompt. In a test it is a counter that returns keys from a pinned PRF vector, so "one prompt
 * to onboard" and "the session signs prompt-free" are assertions about how many times `connect` ran
 * rather than a claim about a browser nobody can see.
 */
export async function connectAndOpenSession(opts: {
  connect: () => Promise<IrisKeys>;
  scope: SessionScope;
  ttlMs: number;
  seams?: SessionSeams;
}): Promise<{ session: ScopedSession; keys: IrisKeys }> {
  const keys = await opts.connect();
  const session = openSession({
    privateKey: keys.account.privateKey,
    scope: opts.scope,
    ttlMs: opts.ttlMs,
    seams: opts.seams,
  });
  return { session, keys };
}
