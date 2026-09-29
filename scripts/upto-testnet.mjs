#!/usr/bin/env node
/**
 * x402 `upto` on Monad testnet, end to end, against the Monad facilitator.
 *
 * Follows the scheme as Devansh Purohit described it and as the EVM spec states it:
 *
 *   1. The buyer signs a Permit2 maximum (`permit2Authorization.permitted.amount`) before any work.
 *   2. /verify is called with `requirements.amount` = that maximum.
 *   3. The "work" runs and is metered.
 *   4. /settle is called with the SAME signed payload and `requirements.amount` = the actual charge.
 *   5. The facilitator moves only the actual charge. The remainder never leaves the buyer.
 *
 * Nothing here is asserted from the response alone. Balances are read from chain before and after and
 * the settlement transaction's Transfer log is decoded, so "the buyer kept the remainder" is measured.
 *
 * Usage:  node --experimental-strip-types scripts/upto-testnet.mjs [ceilingAtomic=100000] [actualAtomic=37000]
 * Needs:  DEPLOYER_PRIVATE_KEY in ../../.env (the buyer), testnet MON for the one-time Permit2
 *         approval and testnet USDC from https://faucet.circle.com (Monad Testnet).
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, decodeEventLog, erc20Abi, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { UptoEvmScheme, createPermit2ApprovalTx } from "@x402/evm/upto/client";
import { facilitatorAddressFrom, settlementRequirements, uptoRequirements } from "../lib/upto.ts";

const RPC = "https://testnet-rpc.monad.xyz";
const NETWORK = "eip155:10143";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const FACILITATOR = "https://x402-facilitator.molandak.org";

const ceiling = BigInt(process.argv[2] ?? "100000"); // 0.10 USDC
const actual = BigInt(process.argv[3] ?? "37000"); // 0.037 USDC
if (actual > ceiling) throw new Error("actual must not exceed the ceiling");

const env = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
const raw = env.match(/^DEPLOYER_PRIVATE_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!raw) throw new Error("DEPLOYER_PRIVATE_KEY missing");
const buyer = privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`);
// A recipient distinct from the buyer, otherwise balances cannot show who kept what. Derived
// deterministically so reruns pay the same place.
const payTo = privateKeyToAccount(keccak256(toHex("kanmani-upto-testnet-recipient"))).address;

const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: buyer, chain, transport: http(RPC) });
const bal = (a) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const post = async (path, body) => {
  const r = await fetch(`${FACILITATOR}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const log = (...a) => console.log(" ", ...a);

// ---- facilitator binding, read rather than typed
const supported = await (await fetch(`${FACILITATOR}/supported`)).json();
const facilitatorAddress = facilitatorAddressFrom(supported, NETWORK);
if (!facilitatorAddress) throw new Error("facilitator does not advertise upto on testnet");
log("facilitator upto", NETWORK, "address", facilitatorAddress);

const b0 = { buyer: await bal(buyer.address), payTo: await bal(payTo) };
log("buyer", buyer.address, "USDC", b0.buyer, "| payTo", payTo, "USDC", b0.payTo);
// PROBE=1 skips the funds check and stops after /verify, to test the signature path with no USDC.
const PROBE = process.env.PROBE === "1";
if (b0.buyer < ceiling && !PROBE) {
  console.error(`\n  buyer holds ${b0.buyer} atomic USDC on testnet, needs ${ceiling}. Fund it at https://faucet.circle.com (USDC, Monad Testnet).`);
  process.exit(2);
}

// ---- one-time Permit2 approval (the only thing the buyer pays gas for)
const allowance = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [buyer.address, PERMIT2] });
if (allowance < ceiling) {
  const tx = createPermit2ApprovalTx(USDC);
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data });
  const rc = await pub.waitForTransactionReceipt({ hash });
  log("permit2 approval", hash, rc.status);
} else log("permit2 approval already in place");

// ---- 1. requirements at the ceiling, 2. buyer signs the ceiling
const requirements = uptoRequirements({ network: NETWORK, asset: USDC, payTo, maximum: ceiling, facilitatorAddress });
const scheme = new UptoEvmScheme({ address: buyer.address, signTypedData: (m) => buyer.signTypedData(m) });
const { payload } = await scheme.createPaymentPayload(2, requirements);
const signedMax = payload.permit2Authorization?.permitted?.amount;
log("signed maximum (permitted.amount)", signedMax);
const paymentPayload = { x402Version: 2, accepted: requirements, payload };

const v = await post("/verify", { x402Version: 2, paymentPayload, paymentRequirements: requirements });
log("verify", v.status, JSON.stringify(v.body));
if (PROBE) process.exit(0);
if (!v.body.isValid) process.exit(1);

// ---- 3. the metered work would run here. 4. settle the actual charge with the SAME signed payload
const guard = settlementRequirements(requirements, payload, actual);
if (!guard.ok) throw new Error(`refusing to settle: ${guard.reason}`);
const settleReq = guard.requirements;
const s = await post("/settle", { x402Version: 2, paymentPayload, paymentRequirements: settleReq });
log("settle", s.status, JSON.stringify(s.body));
if (!s.body.success) process.exit(1);

// ---- 5. measure it on chain
const rc = await pub.waitForTransactionReceipt({ hash: s.body.transaction });
const moved = rc.logs
  .filter((l) => l.address.toLowerCase() === USDC.toLowerCase())
  .map((l) => { try { return decodeEventLog({ abi: erc20Abi, data: l.data, topics: l.topics }); } catch { return null; } })
  .filter((e) => e?.eventName === "Transfer");
const b1 = { buyer: await bal(buyer.address), payTo: await bal(payTo) };
console.log("\n  RESULT");
log("tx", s.body.transaction, "status", rc.status, "block", rc.blockNumber);
for (const t of moved) log("Transfer", t.args.from, "->", t.args.to, t.args.value);
log("signed ceiling", ceiling, "| settled", actual);
log("buyer  delta", b1.buyer - b0.buyer, "(expected", -actual, ")");
log("payTo  delta", b1.payTo - b0.payTo, "(expected", actual, ")");
log("remainder never moved:", ceiling - actual, "=", b0.buyer - ceiling + (ceiling - actual) === b1.buyer ? "confirmed on chain" : "MISMATCH");
