/**
 * Dissent withdrawal receipts through the production atlas and the settled rung.
 *
 * Written by Alnitak (alnitak34/dissent, commit 64ef961, docs/demo/kanmani-parser-proposal.md) against a
 * test-only atlas, then moved here unchanged except for paths and the registered mapping. The fixtures are
 * saved from two real mainnet withdrawals. Receipts are reduced fields and traces are the original callTracer
 * output. No log is kept because the tests rely on native internal calls and not on payment events.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ATLAS, parseDocument } from "./parse.ts";
import { effectiveNativeCalls, settledCheck } from "./settled.ts";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/dissent-withdrawal-receipts.json", import.meta.url), "utf8"));
const savedEvidence = JSON.parse(readFileSync(new URL("./fixtures/dissent-trace-excerpts.json", import.meta.url), "utf8"));
const parse = (d: unknown) => parseDocument(new TextEncoder().encode(JSON.stringify(d)), ATLAS, "application/json");

for (const [i, name] of ["d001", "aqueous"].entries()) {
  test(`${name}: exact field mapping and saved real trace settle`, async () => {
    const f = fixtures[i];
    const p = parse(f);
    assert.equal(p.kind, "claim");
    if (p.kind !== "claim") return;
    assert.deepEqual(p.claim, {network:143,txHash:f.txHash,recipient:f.recipient,payer:f.core,amount:f.amountAtomic,token:"native"});
    const evidence = savedEvidence[name];
    const reader = {
      getBlockNumber: async () => BigInt(evidence.receipt.blockNumber) + 100n,
      getReceipt: async () => ({...evidence.receipt, blockNumber:BigInt(evidence.receipt.blockNumber)}),
      getNativeTransfer: async () => ({to:evidence.transaction.to,value:BigInt(evidence.transaction.value),hasInput:true}),
      getInternalNativeTransfers: async () => effectiveNativeCalls(evidence.trace),
    };
    const r = await settledCheck(p.claim, () => reader);
    assert.equal(r.settled, true);
    if (r.settled === true) assert.equal(r.amountCompared, true);
    assert.equal((await settledCheck({...p.claim,amount:String(BigInt(f.amountAtomic)+1n)},()=>reader)).settled,false);
    assert.equal((await settledCheck({...p.claim,recipient:"0x1111111111111111111111111111111111111111"},()=>reader)).settled,false);
    assert.equal((await settledCheck(p.claim,()=>({...reader,getInternalNativeTransfers:async()=>null}))).settled,"unknown");
  });
}

for (const field of ["chainId","txHash","recipient","core","amountAtomic","asset","version"]) {
  test(`missing ${field} refuses weaker verification`, () => {
    const d = {...fixtures[0]}; delete d[field];
    assert.equal(parse(d).kind,"unparsed");
  });
}
test("numeric, decimal, negative, zero and padded amounts are rejected", () => {
  for (const amountAtomic of [3.1,"3.10","-1","0","01",null])
    assert.equal(parse({...fixtures[0],amountAtomic}).kind,"unparsed");
});
test("other network, asset or version are not silently coerced", () => {
  for (const over of [{chainId:10143},{chainId:"143"},{asset:"USDC"},{version:2}])
    assert.equal(parse({...fixtures[0],...over}).kind,"unparsed");
});
test("fixture collection is not an individual feedback document", () => assert.equal(parse(fixtures).kind,"unparsed"));
test("ambiguous document refuses choosing a mapping", () => {
  assert.equal(parse({...fixtures[0],proof_of_payment:{payment_tx:fixtures[0].txHash}}).kind,"unparsed");
});

test("the production atlas matches a Dissent receipt with exactly one mapping", () => {
  assert.equal(ATLAS.filter((m) => m.matches(fixtures[0])).length, 1);
});
