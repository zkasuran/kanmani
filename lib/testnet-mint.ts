/**
 * The policy behind the sponsored testnet mint, kept pure so it is tested with no chain and no clock.
 *
 * The free-judge path funds each new passkey account with a little tUSDC so a brand-new account
 * reaches a confirmed testnet transaction with zero funding steps. A sponsored mint is a spend, so it
 * is bounded three ways: idempotent per address (fund once), a per-IP window, a global daily ceiling.
 * All three live here as named constants rather than scattered through the route, per the hardening
 * rule on ceilings. The route is the plumbing, this is the decision.
 */

/** Below this balance a new account gets funded. 0.1 tUSDC. */
export const FUND_FLOOR = 100_000n;
/** What one funding mints. 0.25 tUSDC, far under the token's own MAX_MINT. */
export const FUND_AMOUNT = 250_000n;
/** The token's per-call mint cap (contracts/src/TestUSDC.sol MAX_MINT = 1_000_000e6). */
export const MAX_MINT = 1_000_000_000_000n;
/** The per-IP window and how many distinct addresses it may fund. */
export const IP_WINDOW_MS = 60 * 60_000;
export const IP_WINDOW_MAX = 5;
/** A global backstop so the whole faucet cannot be drained in a day. */
export const DAILY_MAX = 500;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A 0x-prefixed 20-byte hex string, checked before anything touches the chain. */
export function isWellFormedAddress(s: unknown): s is `0x${string}` {
  return typeof s === "string" && ADDRESS.test(s);
}

export type MintDecision =
  | { action: "skip"; balance: bigint }
  | { action: "mint"; amount: bigint };

/**
 * Fund an account only when it is below the floor, so a second request for a funded address sends no
 * transaction. This is what bounds total spend: each address is funded at most once.
 */
export function decideMint(opts: { balance: bigint }): MintDecision {
  if (opts.balance >= FUND_FLOOR) return { action: "skip", balance: opts.balance };
  return { action: "mint", amount: FUND_AMOUNT };
}

export type RateVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * A sliding window over distinct addresses per IP, plus a global daily counter.
 *
 * The clock is injected so expiry is deterministic in a test. The window is swept opportunistically on
 * each check, so the map cannot grow without bound on a long-lived process.
 */
export function createRateLimiter(opts?: {
  now?: () => number;
  windowMs?: number;
  perIp?: number;
  dailyMax?: number;
}) {
  const now = opts?.now ?? (() => Date.now());
  const windowMs = opts?.windowMs ?? IP_WINDOW_MS;
  const perIp = opts?.perIp ?? IP_WINDOW_MAX;
  const dailyMax = opts?.dailyMax ?? DAILY_MAX;

  const seen = new Map<string, { addr: string; at: number }[]>();
  let day = "";
  let dailyCount = 0;

  return {
    check(ip: string, address: string): RateVerdict {
      const t = now();
      const today = new Date(t).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        dailyCount = 0;
      }

      const addr = address.toLowerCase();
      const live = (seen.get(ip) ?? []).filter((e) => t - e.at < windowMs);
      const distinct = new Set(live.map((e) => e.addr));

      if (!distinct.has(addr) && distinct.size >= perIp) {
        seen.set(ip, live);
        return { allowed: false, reason: "too many testnet mints from this address range, try again later" };
      }
      if (dailyCount >= dailyMax) {
        seen.set(ip, live);
        return { allowed: false, reason: "the testnet faucet has reached its daily ceiling" };
      }

      live.push({ addr, at: t });
      seen.set(ip, live);
      dailyCount += 1;
      return { allowed: true };
    },
  };
}

/**
 * Serialize mint sends from the one minter account, so two concurrent mints never reuse a nonce.
 *
 * A module-level promise chain, because this app runs as one long-lived process. A viem nonceManager
 * would also work; this keeps the ordering guarantee in one obvious place.
 */
let sendChain: Promise<unknown> = Promise.resolve();
export function enqueueSend<T>(fn: () => Promise<T>): Promise<T> {
  const next = sendChain.then(fn, fn);
  sendChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
