#!/usr/bin/env node
/**
 * Register Kanmani's extra agents on Monad, through Kanmani's own registration check.
 *
 * For each agent in lib/agent-extras.ts without an id in lib/agent-ids.json: build the draft, POST it
 * to /api/registration/check, refuse to send unless ready and the gas check passes, send exactly the
 * returned calldata from the owner key, read the new id from the Transfer log and write it back.
 * Idempotent: an agent that already has an id is skipped.
 *
 * Usage: DEPLOYER_PRIVATE_KEY=... node --experimental-strip-types scripts/register-extras.mjs [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EXTRA_META as EXTRAS } from "../lib/agent-meta.ts";

const SITE = process.env.SITE ?? "https://kanmani.xyz";
const DRY = process.argv.includes("--dry");
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const chain = { id: 143, name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } } };
const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });
const idsPath = new URL("../lib/agent-ids.json", import.meta.url);
const ids = JSON.parse(readFileSync(idsPath, "utf8"));

for (const e of EXTRAS) {
  if (ids[e.slug]) {
    console.log(`  ${e.slug.padEnd(10)} already #${ids[e.slug]}`);
    continue;
  }
  const endpoint = `https://kanmani.xyz/api/service/${e.slug}`;
  const draft = {
    name: `Kanmani ${e.name}`,
    description: `${e.sells} ${e.why} Operated by Kanmani (kanmani.xyz). ${e.priceAtomic === "0" ? "Free." : `Priced by usage with x402 upto, ceiling ${Number(e.priceAtomic) / 1e6} USDC on Monad.`}`,
    url: "https://kanmani.xyz/hire",
    skills: [{ id: e.skillId, endpoint, x402: e.priceAtomic !== "0" }],
    refuses: ["custody of anyone's funds", "answering with a guess where the chain says unknown"],
  };
  const r = await (await fetch(`${SITE}/api/registration/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft, sender: account.address }) })).json();
  const d = r.data;
  if (!d?.ready) {
    console.log(`  ${e.slug.padEnd(10)} NOT READY: ${JSON.stringify(d?.problems ?? r)}`);
    continue;
  }
  if (d.canSend !== true) {
    console.log(`  ${e.slug.padEnd(10)} cannot send: ${JSON.stringify(d.gas)}`);
    continue;
  }
  if (DRY) {
    console.log(`  ${e.slug.padEnd(10)} ready, ${d.uriBytes} bytes, gas ${d.gas.need}`);
    continue;
  }
  const hash = await wallet.sendTransaction({ to: d.transaction.to, data: d.transaction.data });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") {
    console.log(`  ${e.slug.padEnd(10)} REVERTED ${hash}`);
    continue;
  }
  const mint = rc.logs.find((l) => l.address.toLowerCase() === d.transaction.to.toLowerCase() && l.topics.length === 4);
  const id = Number(BigInt(mint.topics[3]));
  ids[e.slug] = id;
  writeFileSync(idsPath, JSON.stringify(ids, null, 2) + "\n");
  console.log(`  ${e.slug.padEnd(10)} registered #${id}  ${hash}`);
}
