#!/usr/bin/env node
/**
 * Bring every agent we operate onto the document it should carry (ERC-8004 registration-v1, built in
 * lib/agent-drafts.ts, served at /api/service/<slug>/registration.json).
 *
 * For each: skip if the chain already matches; otherwise send the draft through /api/registration/check
 * with agentId and sender, refuse unless ready and canSend, send exactly the returned setAgentURI
 * calldata from the owner key and confirm the registry now returns the new URI byte for byte.
 *
 * Usage: DEPLOYER_PRIVATE_KEY=... node scripts/repoint-agents.mjs [--dry] [slug ...]
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SITE = process.env.SITE ?? "https://kanmani.xyz";
const DRY = process.argv.includes("--dry");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SLUGS = only.length ? only : ["kanmani", "sentinel", "assay", "locator", "notary", "registrar", "ledger", "twin", "pulse", "doctor", "linter", "bondsman", "scribe"];
const key = process.env.DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const chain = { id: 143, name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } } };
const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });
const REG = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const abi = parseAbi(["function tokenURI(uint256) view returns (string)"]);

for (const slug of SLUGS) {
  const want = await (await fetch(`${SITE}/api/service/${slug}/registration.json`)).json();
  if (want.onChainMatches) {
    console.log(`  ${slug.padEnd(10)} #${want.agentId} already current`);
    continue;
  }
  const r = await (await fetch(`${SITE}/api/registration/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: want.draft, agentId: String(want.agentId), sender: account.address }) })).json();
  const d = r.data;
  if (!d?.ready || d.agentURI !== want.agentURI) { console.log(`  ${slug.padEnd(10)} NOT READY ${JSON.stringify(d?.problems ?? r).slice(0, 200)}`); continue; }
  const unmet = d.consequences.filter((c) => !c.met).map((c) => c.label);
  if (d.canSend !== true) { console.log(`  ${slug.padEnd(10)} cannot send ${JSON.stringify(d.gas)}`); continue; }
  if (DRY) { console.log(`  ${slug.padEnd(10)} #${want.agentId} ready ${d.uriBytes}B, ${d.transaction.function}, gas ${d.gas.need}, unmet ${JSON.stringify(unmet)}`); continue; }
  const hash = await wallet.sendTransaction({ to: d.transaction.to, data: d.transaction.data });
  const rc = await pub.waitForTransactionReceipt({ hash });
  const now = await pub.readContract({ address: REG, abi, functionName: "tokenURI", args: [BigInt(want.agentId)] });
  console.log(`  ${slug.padEnd(10)} #${want.agentId} ${rc.status} ${hash} matches ${now === want.agentURI}`);
}
