import { test } from "node:test";
import assert from "node:assert/strict";
import { payNet, requirementsFor, TESTNET_USDC_FALLBACK, usdcDomainFor } from "./pay-net.ts";
import { requirements } from "./x402.ts";

test("the mainnet requirements are byte-identical to lib/x402, so the live path did not move", () => {
  assert.deepEqual(requirementsFor("mainnet"), requirements());
});

test("the testnet requirements name TestUSDC, its own domain and the testnet chain", () => {
  const r = requirementsFor("testnet");
  assert.equal(r.scheme, "exact");
  assert.equal(r.network, "eip155:10143");
  assert.equal(r.amount, "10000");
  assert.equal(r.asset, process.env.TESTNET_USDC ?? TESTNET_USDC_FALLBACK);
  // The custom money parser: TestUSDC signs under its own name and version, NOT USDC v2.
  assert.deepEqual(r.extra, { name: "Kanmani Test USD", version: "1" });
});

test("the testnet EIP-712 domain is TestUSDC's, not mainnet USDC's", () => {
  const d = usdcDomainFor("testnet");
  assert.equal(d.name, "Kanmani Test USD");
  assert.equal(d.version, "1");
  assert.equal(d.chainId, 10143);
  assert.equal(d.verifyingContract, process.env.TESTNET_USDC ?? TESTNET_USDC_FALLBACK);

  const m = usdcDomainFor("mainnet");
  assert.equal(m.name, "USDC");
  assert.equal(m.version, "2");
  assert.equal(m.chainId, 143);
});

test("payNet carries the right explorer and payee per network", () => {
  const main = payNet("mainnet");
  const test = payNet("testnet");
  assert.equal(main.explorerTx, "https://monadscan.com/tx/");
  assert.equal(test.explorerTx, "https://testnet.monadscan.com/tx/");
  // The same house EOA is the payee on both chains.
  assert.equal(main.payTo, test.payTo);
  assert.equal(main.decimals, 6);
  assert.equal(test.decimals, 6);
});
