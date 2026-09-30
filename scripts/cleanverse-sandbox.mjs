#!/usr/bin/env node
/**
 * Drive the Cleanverse sandbox for the CleanverseGate flow on Monad testnet.
 *
 *   set -a; . ../../.env; set +a
 *   node scripts/cleanverse-sandbox.mjs register <gate>    register the gate as a compliance pool
 *   node scripts/cleanverse-sandbox.mjs rule <gate>        rule: any active CVI, tier >= 1, no country block
 *   node scripts/cleanverse-sandbox.mjs rules <gate>       read the pool's rules
 *   node scripts/cleanverse-sandbox.mjs issue              issue a CVI to the test worker (no identity data)
 *   node scripts/cleanverse-sandbox.mjs query [address]    read a wallet's CVI
 *   node scripts/cleanverse-sandbox.mjs verify <gate> [address]
 *
 * Needs CLEANVERSE_API_ID and CLEANVERSE_API_KEY (the sandbox pair the bounty publishes),
 * DEPLOYER_PRIVATE_KEY (the gate's owner, which signs the registration) and
 * CLEANVERSE_TEST_WORKER_KEY (a testnet-only worker wallet).
 *
 * Writes use AES-256-CBC with a fixed zero IV and the base64-decoded api-key, per Cleanverse's
 * Encryption page. Registration also needs an EIP-191 signature over `monad` + the lowercase gate
 * address from the gate's owner(). The sandbox writes to the testnet validator only. A mainnet pool
 * needs production credentials, which this script does not have.
 */
import crypto from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.CLEANVERSE_BASE ?? "https://uatapi.cleanverse.com/api/cooperate";
const API_ID = process.env.CLEANVERSE_API_ID;
const KEY_B64 = process.env.CLEANVERSE_API_KEY;
if (!API_ID || !KEY_B64) {
  console.error("CLEANVERSE_API_ID and CLEANVERSE_API_KEY must be set");
  process.exit(2);
}
const KEY = Buffer.from(KEY_B64, "base64");
const IV = Buffer.alloc(16, 0);
const CHAIN = "monad";

const encrypt = (o) => {
  const c = crypto.createCipheriv("aes-256-cbc", KEY, IV);
  return { data: Buffer.concat([c.update(JSON.stringify(o), "utf8"), c.final()]).toString("base64") };
};
const decrypt = (b) => {
  try {
    const d = crypto.createDecipheriv("aes-256-cbc", KEY, IV);
    return JSON.parse(Buffer.concat([d.update(Buffer.from(b, "base64")), d.final()]).toString("utf8"));
  } catch {
    return b;
  }
};
async function call(path, body, encrypted) {
  const r = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "api-id": API_ID, "X-Request-ID": crypto.randomUUID() },
    body: JSON.stringify(encrypted ? encrypt(body) : body),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({ code: `HTTP ${r.status}` }));
  if (typeof j.data === "string") j.data = decrypt(j.data);
  return j;
}
const account = (k) => privateKeyToAccount(k.startsWith("0x") ? k : `0x${k}`);
const need = (v, what) => {
  if (!v) {
    console.error(`missing ${what}`);
    process.exit(2);
  }
  return v;
};

// Any active CVI of tier 1 or higher, no country blocked. Our sandbox credential issues CVIs with an
// empty group, so a rule naming a group (the docs' example uses "AB") rejects every CVI it can issue.
const RULE = { allowed_group: "", allowed_sub_group: "", min_tier: 1, min_sub_tier: 0, is_black_list: true, countries: [] };

const [cmd, a1, a2] = process.argv.slice(2);
const worker = () => account(need(process.env.CLEANVERSE_TEST_WORKER_KEY, "CLEANVERSE_TEST_WORKER_KEY")).address;
let out;
switch (cmd) {
  case "register": {
    const gate = need(a1, "<gate>").toLowerCase();
    const owner = account(need(process.env.DEPLOYER_PRIVATE_KEY, "DEPLOYER_PRIVATE_KEY"));
    const owner_signature = await owner.signMessage({ message: CHAIN + gate });
    out = await call("validator/register", { chain: CHAIN, contract_address: gate, rule: RULE, owner_signature }, true);
    break;
  }
  case "rule":
    out = await call("validator/set_rule", { chain: CHAIN, contract_address: need(a1, "<gate>").toLowerCase(), rule: RULE }, true);
    break;
  case "rules":
    out = await call("validator/rules", { chain: CHAIN, contract_address: need(a1, "<gate>").toLowerCase() }, false);
    break;
  case "issue": {
    const w = worker();
    out = await call("generate_apass", { customerId: `kanmaniworker${w.slice(2, 10).toLowerCase()}`, expirationTime: 1863690034, wallet: { address: w, chain: CHAIN } }, true);
    break;
  }
  case "query":
    out = await call("query_apass", { address: a1 ?? worker(), chain: CHAIN }, false);
    break;
  case "verify":
    out = await call("validator/verify", { chain: CHAIN, contract_address: need(a1, "<gate>").toLowerCase(), user_address: a2 ?? worker() }, false);
    break;
  default:
    console.error("usage: cleanverse-sandbox.mjs {register|rule|rules|issue|query|verify} ...");
    process.exit(2);
}
console.log(JSON.stringify(out, null, 1));
process.exit(out?.code === "0000" ? 0 : 1);
