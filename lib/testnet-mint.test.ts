import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRateLimiter,
  decideMint,
  enqueueSend,
  FUND_AMOUNT,
  FUND_FLOOR,
  isWellFormedAddress,
  IP_WINDOW_MAX,
  IP_WINDOW_MS,
  MAX_MINT,
} from "./testnet-mint.ts";

test("a malformed address is refused before anything touches the chain", () => {
  assert.equal(isWellFormedAddress("0xDB6c6340342e71A63cD11Ebac2185204b7777777"), true);
  assert.equal(isWellFormedAddress("0x123"), false);
  assert.equal(isWellFormedAddress("vitalik.eth"), false);
  assert.equal(isWellFormedAddress("DB6c6340342e71A63cD11Ebac2185204b7777777"), false);
  assert.equal(isWellFormedAddress(null), false);
  assert.equal(isWellFormedAddress(123), false);
});

test("funding is skipped at or above the floor and minted below it", () => {
  assert.deepEqual(decideMint({ balance: FUND_FLOOR }), { action: "skip", balance: FUND_FLOOR });
  assert.deepEqual(decideMint({ balance: FUND_FLOOR + 1n }), { action: "skip", balance: FUND_FLOOR + 1n });
  assert.deepEqual(decideMint({ balance: 0n }), { action: "mint", amount: FUND_AMOUNT });
  assert.deepEqual(decideMint({ balance: FUND_FLOOR - 1n }), { action: "mint", amount: FUND_AMOUNT });
});

test("one funding stays far under the token's own mint cap", () => {
  assert.ok(FUND_AMOUNT <= MAX_MINT, "a funding must never exceed MAX_MINT");
  assert.ok(FUND_AMOUNT < MAX_MINT, "and it is far under, not at the ceiling");
});

test("the rate limiter allows N distinct addresses per IP, blocks the next, then recovers", () => {
  const clock = { t: 1_700_000_000_000 };
  const rl = createRateLimiter({ now: () => clock.t, perIp: IP_WINDOW_MAX, windowMs: IP_WINDOW_MS });
  const ip = "203.0.113.7";

  for (let i = 0; i < IP_WINDOW_MAX; i++) {
    const addr = `0x${String(i).padStart(40, "0")}`;
    assert.equal(rl.check(ip, addr).allowed, true, `address ${i} should be allowed`);
  }
  // The next distinct address inside the window is blocked.
  const over = rl.check(ip, `0x${"f".repeat(40)}`);
  assert.equal(over.allowed, false);

  // A different IP is unaffected.
  assert.equal(rl.check("198.51.100.9", `0x${"a".repeat(40)}`).allowed, true);

  // After the window the old entries are swept and the IP can fund again.
  clock.t += IP_WINDOW_MS + 1;
  assert.equal(rl.check(ip, `0x${"e".repeat(40)}`).allowed, true);
});

test("the same address does not consume a new distinct slot", () => {
  const clock = { t: 1_700_000_000_000 };
  const rl = createRateLimiter({ now: () => clock.t, perIp: 2, windowMs: IP_WINDOW_MS });
  const ip = "203.0.113.7";
  const a = `0x${"1".repeat(40)}`;
  const b = `0x${"2".repeat(40)}`;
  assert.equal(rl.check(ip, a).allowed, true);
  assert.equal(rl.check(ip, a).allowed, true, "re-funding the same address is not a new distinct slot");
  assert.equal(rl.check(ip, b).allowed, true, "a second distinct address still fits under the cap of 2");
});

test("the global daily ceiling stops the whole faucet", () => {
  const rl = createRateLimiter({ now: () => 1_700_000_000_000, perIp: 1000, dailyMax: 3 });
  for (let i = 0; i < 3; i++) {
    assert.equal(rl.check(`10.0.0.${i}`, `0x${String(i).padStart(40, "0")}`).allowed, true);
  }
  assert.equal(rl.check("10.0.0.9", `0x${"c".repeat(40)}`).allowed, false);
});

test("enqueueSend runs tasks one at a time in order", async () => {
  const order: number[] = [];
  const task = (n: number, ms: number) =>
    enqueueSend(async () => {
      await new Promise((r) => setTimeout(r, ms));
      order.push(n);
      return n;
    });
  // Start three at once with decreasing delays. Serialized, so order is 1,2,3 despite the delays.
  const [a, b, c] = await Promise.all([task(1, 30), task(2, 20), task(3, 10)]);
  assert.deepEqual(order, [1, 2, 3]);
  assert.deepEqual([a, b, c], [1, 2, 3]);
});
