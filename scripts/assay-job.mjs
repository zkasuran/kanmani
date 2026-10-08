#!/usr/bin/env node
/**
 * Assay job 1: send the five requests the terms name and keep what proving them needs.
 *
 *   node scripts/assay-job.mjs send      five requests, one fresh 32-byte salt each
 *   node scripts/assay-job.mjs retry     resend only requests that got no receipt (upstream errors)
 *   node scripts/assay-job.mjs check     fetch each receipt's proof and root, verify on chain, build the
 *                                        StandardMerkleTree root the host should deliver
 *
 * Terms: docs/jobs/assay-1.terms.txt. Inputs: docs/jobs/assay-1.inputs.json. Salts are the buyer's
 * secret (they are what lets us prove later what we asked), so they go to .hq/, never to the repo. The
 * public record docs/jobs/assay-1.results.json holds receipt hashes, answers and verification results.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createPublicClient, http, keccak256, encodeAbiParameters, concat } from "viem";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "https://34-45-1-81.sslip.io/mainnet";
const ANCHOR = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13";
const AGENT_ID = 10278n;
const MAX_TOKENS = 400;
const SECRET = join(ROOT, ".hq/outreach/assay-job-1.salts.json");
const PUBLIC = join(ROOT, "docs/jobs/assay-1.results.json");
const inputs = JSON.parse(readFileSync(join(ROOT, "docs/jobs/assay-1.inputs.json"), "utf8"));

const prompt = (doc) =>
  "Here is one ERC-8004 feedback document. Does it claim that a payment happened? " +
  'Answer as JSON: {"claimsPayment": true|false, "why": "one sentence", ' +
  '"fields": {"network": path|null, "txHash": path|null, "payer": path|null, "recipient": path|null, "amount": path|null}}, ' +
  "where path is a dotted path into the document.\n\nDocument:\n" + JSON.stringify(doc);

async function send() {
  if (existsSync(SECRET)) throw new Error(`${SECRET} exists: the five requests were already sent. Refusing to send twice.`);
  const kept = [];
  for (const { feedbackId, document } of inputs) {
    const salt = "0x" + randomBytes(32).toString("hex");
    const body = { model: "gemma-4-31b-it", messages: [{ role: "user", content: prompt(document) }], temperature: 0, max_tokens: MAX_TOKENS };
    const r = await fetch(`${HOST}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", "x-assay-salt": salt }, body: JSON.stringify(body) });
    const text = await r.text();
    const receiptHash = r.headers.get("x-assay-receipt-hash");
    kept.push({ feedbackId, salt, status: r.status, receiptHash, receipt: r.headers.get("x-assay-receipt"), response: text });
    console.log(`${feedbackId}  HTTP ${r.status}  receipt ${receiptHash ?? "none"}`);
    writeFileSync(SECRET, JSON.stringify(kept, null, 2));
  }
}

/**
 * Resend only the requests that got no receipt, each with a fresh salt, a few times with backoff. A
 * failed attempt is upstream trouble (the host passes its model provider's error through) and issues no
 * receipt, so it is not a unit. Every attempt is kept, so the record shows what failed.
 */
async function retry() {
  const kept = JSON.parse(readFileSync(SECRET, "utf8"));
  for (let round = 0; round < 6 && kept.some((k) => !k.receiptHash); round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, 20_000 * round));
    for (const k of kept.filter((x) => !x.receiptHash)) {
      const document = inputs.find((i) => i.feedbackId === k.feedbackId).document;
      const salt = "0x" + randomBytes(32).toString("hex");
      const body = { model: "gemma-4-31b-it", messages: [{ role: "user", content: prompt(document) }], temperature: 0, max_tokens: MAX_TOKENS };
      const r = await fetch(`${HOST}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", "x-assay-salt": salt }, body: JSON.stringify(body) });
      const text = await r.text();
      (k.failed ??= []).push({ at: new Date().toISOString(), status: k.status, response: k.response.slice(0, 300) });
      Object.assign(k, { salt, status: r.status, receiptHash: r.headers.get("x-assay-receipt-hash"), receipt: r.headers.get("x-assay-receipt"), response: text });
      console.log(`round ${round}  ${k.feedbackId}  HTTP ${r.status}  receipt ${k.receiptHash ?? "none"}`);
      writeFileSync(SECRET, JSON.stringify(kept, null, 2));
    }
  }
}

/**
 * OpenZeppelin StandardMerkleTree.of(values.map(v => [v]), ["bytes32"]).root, reimplemented exactly:
 * leaf = keccak256(keccak256(abi.encode(v))), leaves sorted, then the array tree of makeMerkleTree, where
 * node i = hashPair(node 2i+1, node 2i+2) and hashPair sorts the pair before hashing. Checked against
 * the library itself for 1 to 9 leaves (see the commit that added this).
 */
export function standardRoot(values) {
  const leaves = values.map((v) => keccak256(keccak256(encodeAbiParameters([{ type: "bytes32" }], [v])))).sort();
  const tree = new Array(2 * leaves.length - 1);
  leaves.forEach((l, i) => { tree[tree.length - 1 - i] = l; });
  for (let i = tree.length - 1 - leaves.length; i >= 0; i--) {
    const [a, b] = [tree[2 * i + 1], tree[2 * i + 2]].sort();
    tree[i] = keccak256(concat([a, b]));
  }
  return tree[0];
}

async function check() {
  const kept = JSON.parse(readFileSync(SECRET, "utf8"));
  const client = createPublicClient({ transport: http(process.env.RPC_MONAD || "https://rpc.monad.xyz") });
  const abi = [{ type: "function", name: "verifyReceipt", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32[]" }, { type: "bytes32" }], outputs: [{ type: "bool" }] }];
  const out = [];
  for (const k of kept) {
    const row = { feedbackId: k.feedbackId, receiptHash: k.receiptHash, httpStatus: k.status, answer: null, tokensOut: null, anchored: false, verifies: null, anchorTx: null };
    try { row.answer = JSON.parse(k.response).choices?.[0]?.message?.content ?? null; row.tokensOut = JSON.parse(k.response).usage?.completion_tokens ?? null; } catch {}
    if (k.receiptHash) {
      const r = await fetch(`${HOST}/v1/receipts/${k.receiptHash}`);
      if (r.ok) {
        const j = await r.json();
        const proof = j.proof ?? j.merkleProof ?? [];
        const root = j.root ?? j.batchRoot;
        row.anchorTx = j.anchorTx ?? j.tx ?? null;
        if (root) {
          row.anchored = true;
          row.verifies = await client.readContract({ address: ANCHOR, abi, functionName: "verifyReceipt", args: [AGENT_ID, k.receiptHash, proof, root] });
        }
      }
    }
    row.passes = row.verifies === true && (row.tokensOut === null || row.tokensOut <= MAX_TOKENS);
    out.push(row);
    console.log(`${k.feedbackId}  anchored ${row.anchored}  verifyReceipt ${row.verifies}  tokensOut ${row.tokensOut}  ${row.passes ? "PASS" : "not yet"}`);
  }
  const hashes = kept.map((k) => k.receiptHash).filter(Boolean);
  const expectedRoot = hashes.length === kept.length ? standardRoot(hashes) : null;
  writeFileSync(PUBLIC, JSON.stringify({ terms: "docs/jobs/assay-1.terms.txt", expectedDeliverableHash: expectedRoot, units: out.filter((r) => r.passes).length, receipts: out }, null, 2) + "\n");
  console.log(`expected deliverableHash ${expectedRoot}  passing units ${out.filter((r) => r.passes).length}/${kept.length}`);
}

const cmd = process.argv[2];
// ASSAY_JOB_IMPORT lets a test import standardRoot without running a command.
if (process.env.ASSAY_JOB_IMPORT) {}
else if (cmd === "send") await send();
else if (cmd === "retry") await retry();
else if (cmd === "check") await check();
else { console.error("usage: node scripts/assay-job.mjs send|retry|check"); process.exit(1); }
