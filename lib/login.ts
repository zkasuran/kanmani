/**
 * The login session: what is kept, for how long and what it is never allowed to hold.
 *
 * ## What is kept
 *
 * Only public facts: the address, how it signed in (passkey or wallet) and when. There is one kind of
 * account: what it can do follows from what the address owns on chain, never from a flag set at sign-up. They live in `sessionStorage`, which the browser clears when the tab or the browser
 * closes. Logging out clears them at once. Nothing goes to `localStorage`, to a cookie or to our
 * server, so there is no login that outlives the tab.
 *
 * ## What is never kept
 *
 * A key. The passkey-derived keys stay in memory for as long as the page is open. After a reload the
 * session still shows who is logged in. The first action that needs a signature asks for the
 * passkey once to rebuild them. A wallet never hands us a key at all: it signs each request itself.
 *
 * Keeping keys in `sessionStorage` would make a reload one prompt shorter and would put a private key
 * where any script on the origin can read it. That trade is not worth one prompt.
 *
 * Everything in this file is pure so the rules above are tested rather than described.
 */
import { getAddress } from "viem";

export type LoginMethod = "passkey" | "wallet";

export type StoredSession = {
  v: 1;
  address: `0x${string}`;
  method: LoginMethod;
  /** Milliseconds since the epoch. Shown as "since", never used to extend anything. */
  since: number;
};

export const SESSION_KEY = "kanmani.session.v1";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read back what `sessionStorage` holds, trusting none of it.
 *
 * Anything malformed, from an older shape or carrying a field that looks like key material, is
 * rejected whole. A half-trusted session is worse than none, because the menu would then show an
 * address as logged in that nobody proved control of in this tab.
 *
 * One migration: sessions written before 2026-10-06 carried `kind: "agent" | "user"`. That field is
 * accepted with exactly those two values and dropped, so a tab open across the change stays logged in.
 * Any other value or any other extra field still rejects the whole record.
 */
export function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const allowed = new Set(["v", "address", "method", "since", "kind"]);
  if (Object.keys(r).some((k) => !allowed.has(k))) return null;
  if (r.v !== 1) return null;
  if (typeof r.address !== "string" || !ADDRESS.test(r.address)) return null;
  if (r.method !== "passkey" && r.method !== "wallet") return null;
  if ("kind" in r && r.kind !== "agent" && r.kind !== "user") return null;
  if (typeof r.since !== "number" || !Number.isFinite(r.since) || r.since <= 0) return null;
  return {
    v: 1,
    address: r.address.toLowerCase() as `0x${string}`,
    method: r.method,
    since: r.since,
  };
}

/** The exact object written. Built here so no caller can add a field the parser would then reject. */
export function sessionRecord(
  address: string,
  method: LoginMethod,
  now: number,
): StoredSession {
  if (!ADDRESS.test(address)) throw new Error(`${address} is not an address`);
  return { v: 1, address: address.toLowerCase() as `0x${string}`, method, since: now };
}

/**
 * The message a wallet signs to log in.
 *
 * Plain text so the wallet shows it readably. It names the site, says it costs nothing and moves
 * nothing and carries a one-time nonce with the time, so a signature copied from somewhere else
 * cannot be replayed as this login.
 */
export function walletLoginMessage(opts: {
  host: string;
  address: string;
  created: boolean;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    opts.created ? `Create a Kanmani account on ${opts.host}` : `Log in to Kanmani on ${opts.host}`,
    ``,
    `Address: ${opts.address}`,
    `This signature proves you control this address. It is not a transaction and it costs nothing.`,
    ``,
    `Nonce: ${opts.nonce}`,
    `Issued at: ${opts.issuedAt}`,
  ].join("\n");
}

/**
 * The address as a wallet shows it, EIP-55 checksummed.
 *
 * Stored lowercase so comparisons are exact, displayed checksummed so it matches what the reader
 * sees in their own wallet character for character.
 */
export function displayAddress(address: string): string {
  return ADDRESS.test(address) ? getAddress(address) : address;
}

/** `0x1234…abcd`, checksummed: enough to recognise, short enough for the bar. */
export function shortAddress(address: string): string {
  if (!ADDRESS.test(address)) return address;
  const a = getAddress(address);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/* ------------------------------------------------------------------ the one write path */

/**
 * The minimal storage surface a session write touches.
 *
 * Narrowed to `setItem` and `removeItem` on purpose, so the only thing that can reach a store is a
 * string this file produced. A fake with the same two methods is all a test needs to see every byte
 * that would be written, which is how the no-persist invariant is proven rather than asserted in a
 * comment.
 */
export type StorageLike = {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * Exactly the string that reaches storage.
 *
 * One function so there is a single place where a `StoredSession` becomes bytes. A key cannot leak
 * through a second serializer that nobody is watching, because there is no second serializer.
 */
export function serializeSession(s: StoredSession): string {
  return JSON.stringify(s);
}

/**
 * Write the session, or clear it when null.
 *
 * The component's `write` calls this and nothing else, so the test over this function is a test over
 * the real write path rather than a parallel copy. It only ever serializes a `StoredSession`, which
 * holds `{v, address, method, since}` and nothing derived, so no key can be written here.
 */
export function persistSession(storage: StorageLike, s: StoredSession | null): void {
  if (s) storage.setItem(SESSION_KEY, serializeSession(s));
  else storage.removeItem(SESSION_KEY);
}
