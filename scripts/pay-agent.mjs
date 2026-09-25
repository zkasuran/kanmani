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
 * Usage: node scripts/pay-agent.mjs sentinel '{"agentId":10252,"maxAgeBlocks":64}'
 */

import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SITE = "https://kanmani.xyz";
const RPC = "https://rpc.monad.xyz";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const CHAIN = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const [slug, bodyJson] = process.argv.slice(2);
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
const req = (challenge.howToPay ?? challenge).accepts[0];
console.log(`  price  ${req.amount} atomic ${req.asset} on ${req.network}`);
console.log(`  payTo  ${req.payTo}`);
console.log(`  payer  ${account.address}${req.payTo.toLowerCase() === account.address.toLowerCase() ? "   (SAME WALLET, see header)" : ""}`);

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

const signature = await wallet.signTypedData({
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

const header = Buffer.from(
  JSON.stringify({ x402Version: 2, resource: { url: resource }, accepted: req, payload: { signature, authorization } }),
).toString("base64");

const res = await fetch(resource, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json", "PAYMENT-SIGNATURE": header },
  body: bodyJson ?? "{}",
});
const out = await res.json();
console.log(`  HTTP   ${res.status}`);
console.log(JSON.stringify(out, null, 2).slice(0, 1400));
process.exit(res.ok ? 0 : 1);
