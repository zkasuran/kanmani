import assert from "node:assert/strict";
import test from "node:test";

import {
  facilitatorAddressFrom,
  meteredCharge,
  settlementRequirements,
  signedMaximum,
  uptoRequirements,
  type UptoPayload,
} from "./upto.ts";

const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as const;
const PAY = "0x2046C5bA6DFD28C403caA03F57C3B39CC797f496" as const;
const FAC = "0x7f6a2850669202519f0fe8aa912451238820db86" as const;

const asked = uptoRequirements({ network: "eip155:10143", asset: USDC, payTo: PAY, maximum: 100_000n, facilitatorAddress: FAC });
const payload = (over: Partial<UptoPayload["permit2Authorization"]> = {}, amount = "100000"): UptoPayload => ({
  signature: "0x00",
  permit2Authorization: {
    permitted: { token: USDC, amount },
    from: "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
    spender: "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002",
    nonce: "1",
    deadline: "9999999999",
    witness: { to: PAY, facilitator: FAC, validAfter: "0" },
    ...over,
  },
});

test("requirements carry the maximum and the facilitator binding", () => {
  assert.equal(asked.scheme, "upto");
  assert.equal(asked.amount, "100000");
  assert.equal(asked.extra.facilitatorAddress, FAC);
  assert.throws(() => uptoRequirements({ network: "eip155:10143", asset: USDC, payTo: PAY, maximum: 0n, facilitatorAddress: FAC }));
  assert.throws(() => uptoRequirements({ network: "eip155:10143", asset: USDC, payTo: "0x12" as never, maximum: 1n, facilitatorAddress: FAC }));
});

test("the facilitator address is read from /supported for the right scheme and network", () => {
  const s = { kinds: [{ scheme: "exact", network: "eip155:10143" }, { scheme: "upto", network: "eip155:10143", extra: { facilitatorAddress: FAC } }] };
  assert.equal(facilitatorAddressFrom(s, "eip155:10143"), FAC);
  assert.equal(facilitatorAddressFrom(s, "eip155:143"), null);
  assert.equal(facilitatorAddressFrom({ kinds: [{ scheme: "upto", network: "eip155:1", extra: { facilitatorAddress: "nope" } }] }, "eip155:1"), null);
});

test("settling less than the signed maximum sends the actual amount, not the ceiling", () => {
  const r = settlementRequirements(asked, payload(), 37_000n);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.requirements.amount, "37000");
    assert.equal(r.requirements.payTo, PAY);
  }
});

test("zero and exactly the maximum are both valid charges", () => {
  assert.ok(settlementRequirements(asked, payload(), 0n).ok);
  assert.ok(settlementRequirements(asked, payload(), 100_000n).ok);
});

test("a charge above the signed maximum is refused before it reaches the facilitator", () => {
  const r = settlementRequirements(asked, payload(), 100_001n);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /exceeds the signed maximum/);
  assert.equal(settlementRequirements(asked, payload(), -1n).ok, false);
});

test("a payload signed for another ceiling, token, recipient or facilitator is refused", () => {
  assert.match((settlementRequirements(asked, payload({}, "50000"), 1n) as { reason: string }).reason, /asked for a maximum of 100000/);
  assert.equal(settlementRequirements(asked, payload({ permitted: { token: PAY, amount: "100000" } }), 1n).ok, false);
  assert.equal(settlementRequirements(asked, payload({ witness: { to: USDC, facilitator: FAC, validAfter: "0" } }), 1n).ok, false);
  assert.equal(settlementRequirements(asked, payload({ witness: { to: PAY, facilitator: PAY, validAfter: "0" } }), 1n).ok, false);
});

test("signedMaximum rejects anything that is not a whole atomic amount", () => {
  assert.equal(signedMaximum(payload()), 100_000n);
  for (const bad of ["", "-1", "1.5", "0x10", "01"]) assert.equal(signedMaximum(payload({}, bad)), null, bad);
  assert.equal(signedMaximum(null), null);
});

test("metered charge is usage times price, rounded up per unit and capped at the maximum", () => {
  assert.equal(meteredCharge({ unit: "block", used: 37, pricePerUnitAtomic: "1000" }, 100_000n), 37_000n);
  assert.equal(meteredCharge({ unit: "block", used: 36.2, pricePerUnitAtomic: "1000" }, 100_000n), 37_000n);
  assert.equal(meteredCharge({ unit: "block", used: 500, pricePerUnitAtomic: "1000" }, 100_000n), 100_000n);
  assert.throws(() => meteredCharge({ unit: "block", used: -1, pricePerUnitAtomic: "1" }, 10n));
});
