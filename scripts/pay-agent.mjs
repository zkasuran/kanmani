#!/usr/bin/env node
/**
 * Pay one of our own agents over x402 and record what came back.
 *
 * ## The disclosure that has to come first
 *
 * PAY_TO is the deployer wallet, which is also the only funded wallet here, so payer and payee are
 * the same address. That means this proves the rail works end to end (sign an EIP-3009 authorization,
 * the facilitator verifies it, it settles on Monad, the agent does the work and returns a receipt)
 * and it proves nothing whatsoever about demand. Calling a self-payment "revenue" would be the sort
 * of claim this whole project exists to catch, so it is labelled here and in the docs.
 *
 * Usage: node scripts/pay-agent.mjs sentinel '{"agentId":10252,"maxAgeBlocks":64}' [upto|exact]
 *
 * upto (default): sign a Permit2 maximum, the server settles the metered charge. Sends the one-time
 * Permit2 approval first if this wallet has not given it. exact: EIP-3009 for the listed price.
 */

import { createWalletClient, erc20Abi, http, publicActions } from "viem";
import { UptoEvmScheme, createPermit2ApprovalTx } from "@x402/evm/upto/client";
import { privateKeyToAccount } from "viem/accounts";

const SITE = process.env.SITE ?? "https://kanmani.xyz";
const RPC = "https://rpc.monad.xyz";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const CHAIN = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const [slug, bodyJson, schemeArg = "upto"] = process.argv.slice(2);
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
if (!slug) {
  console.error("usage: pay-agent.mjs <sentinel|assay> '<json body>'");
  process.exit(2);
}
const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!key) {
  console.error("DEPLOYER_PRIVATE_KEY is not set");
  process.exit(2);
}

const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) }).extend(publicActions);
const resource = `${SITE}/api/service/${slug}`;

// Ask what it costs rather than assuming. If the price moves, this client follows it.
const challenge = await (await fetch(resource, { headers: { accept: "application/json" } })).json();
const req = (challenge.howToPay ?? challenge).accepts.find((a) => a.scheme === schemeArg);
if (!req) {
  console.error(`  ${schemeArg} is not offered right now. Offered: ${(challenge.howToPay ?? challenge).accepts.map((a) => a.scheme).join(", ")}`);
  process.exit(2);
}
console.log(`  scheme ${req.scheme}  ${req.scheme === "upto" ? "ceiling" : "price"} ${req.amount} atomic ${req.asset} on ${req.network}`);
console.log(`  payTo  ${req.payTo}`);
console.log(`  payer  ${account.address}${req.payTo.toLowerCase() === account.address.toLowerCase() ? "   (SAME WALLET, see header)" : ""}`);

async function payWithUpto() {
  const allowance = await wallet.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] });
  if (allowance < BigInt(req.amount)) {
    const tx = createPermit2ApprovalTx(USDC);
    const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data });
    await wallet.waitForTransactionReceipt({ hash });
    console.log(`  permit2 approval ${hash}`);
  }
  const { payload } = await new UptoEvmScheme({ address: account.address, signTypedData: (m) => account.signTypedData(m) }).createPaymentPayload(2, req);
  return { x402Version: 2, resource: { url: resource }, accepted: req, payload };
}

const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: account.address,
  to: req.payTo,
  value: req.amount,
  validAfter: String(now - 60),
  validBefore: String(now + req.maxTimeoutSeconds),
  // 32 random bytes. EIP-3009 replay protection is per-nonce, so reusing one is how a second call
  // silently fails against an authorization the token already burned.
  nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`,
};

const signature = req.scheme === "upto" ? null : await wallet.signTypedData({
  domain: { name: req.extra.name, version: req.extra.version, chainId: CHAIN.id, verifyingContract: USDC },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  },
});

const paymentPayload = req.scheme === "upto"
  ? await payWithUpto()
  : { x402Version: 2, resource: { url: resource }, accepted: req, payload: { signature, authorization } };
const header = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

const res = await fetch(resource, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json", "PAYMENT-SIGNATURE": header },
  body: bodyJson ?? "{}",
});
const out = await res.json();
console.log(`  HTTP   ${res.status}`);
console.log(process.env.FULL ? JSON.stringify(out) : JSON.stringify(out, null, 2).slice(0, 1400));
process.exit(res.ok ? 0 : 1);
