#!/usr/bin/env node
/**
 * Hire one of our agents the A2A way (message/send + the a2a-x402 extension), as a broker would.
 * 1. message/send with the call; the agent answers a Task in input-required with x402.payment.required.
 * 2. Sign the upto option (Permit2 maximum) and resend with x402.payment.payload and the same taskId.
 * Self-payment: payer and payTo are the same wallet, which proves the rail and nothing about demand.
 * Usage: node scripts/pay-agent-a2a.mjs sentinel '{"agentId":10256,"maxAgeBlocks":64}'
 */
import { createWalletClient, http, publicActions, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { UptoEvmScheme, createPermit2ApprovalTx } from "@x402/evm/upto/client";
const SITE = process.env.SITE ?? "https://kanmani.xyz";
const [slug, data] = process.argv.slice(2);
const key = process.env.DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const chain = { id: 143, name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } } };
const wallet = createWalletClient({ account, chain, transport: http() }).extend(publicActions);
const url = `${SITE}/api/service/${slug}`;
const rpc = async (params, id) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-a2a-extensions": "https://github.com/google-a2a/a2a-x402/v0.1" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "message/send", params }) })).json());

const first = await rpc({ message: { kind: "message", role: "user", messageId: crypto.randomUUID(), parts: [{ kind: "data", data: JSON.parse(data) }] } }, 1);
const t = first.result; const meta = t.status.message.metadata;
console.log(`  1. ${t.status.state} · ${meta["x402.payment.status"]} · task ${t.id.slice(0, 8)}`);
const req = meta["x402.payment.required"].accepts.find((a) => a.scheme === "upto");
const allowance = await wallet.readContract({ address: req.asset, abi: erc20Abi, functionName: "allowance", args: [account.address, "0x000000000022D473030F116dDEE9F6B43aC78BA3"] });
if (allowance < BigInt(req.amount)) { const tx = createPermit2ApprovalTx(req.asset); await wallet.waitForTransactionReceipt({ hash: await wallet.sendTransaction(tx) }); }
const { payload } = await new UptoEvmScheme({ address: account.address, signTypedData: (m) => account.signTypedData(m) }).createPaymentPayload(2, req);
const second = await rpc({ message: { kind: "message", role: "user", messageId: crypto.randomUUID(), taskId: t.id, contextId: t.contextId, parts: [{ kind: "data", data: JSON.parse(data) }], metadata: { "x402.payment.status": "payment-submitted", "x402.payment.payload": { x402Version: 2, resource: { url }, accepted: req, payload } } } }, 2);
const r = second.result; const m2 = r.status.message.metadata;
console.log(`  2. ${r.status.state} · ${m2["x402.payment.status"]} · same task ${r.id === t.id}`);
console.log(`     receipt ${JSON.stringify(m2["x402.payment.receipts"]?.[0])}`);
const a = r.artifacts?.[0]?.parts?.[0]?.data;
console.log(`     charged ${a?.payment?.chargedAtomic} of ${a?.payment?.ceilingAtomic} · answer ${JSON.stringify(a?.answer).slice(0, 140)}`);
