import { test } from "node:test";
import assert from "node:assert/strict";
import { explorerTx, EXPLORER_TX_MAPPING } from "./explorer.ts";
import { judge } from "./verdict.ts";
import type { ChainReader, Receiptish } from "./locate.ts";

const H = "0x7e816f672e9d399cde5ec0ec2381c2dbd0d8cae40c0b9a1fcc80a5eef6aa73d4";
const blocked = { ok: false as const, reason: "HTTP 403" };

const reader = (r: Partial<Receiptish> | null, asked: string[] = []): (c: { key: string }) => ChainReader => (c) => {
  asked.push(c.key);
  return {
    getBlockNumber: async () => 1000n,
    getTransactionReceipt: async () => (r === null ? null : { blockNumber: 900n, status: "success", from: "0xa", to: "0xb", ...r }),
  };
};

test("reads only https explorer /tx/<hash> links, each to its own chain", () => {
  assert.deepEqual(explorerTx(`https://monadvision.com/tx/${H}`), { network: "monad", txHash: H, host: "monadvision.com" });
  assert.equal(explorerTx(`https://basescan.org/tx/${H}?x=1#y`)?.network, "base");
  for (const bad of [
    `http://monadvision.com/tx/${H}`, // not https
    `https://testnet.monadvision.com/tx/${H}`, // testnet is not a chain we judge payments on
    `https://monadvision.com/address/${H.slice(0, 42)}`, // not a tx
    `https://monadvision.com/tx/${H}/extra`, // anything after the hash
    `https://monadvision.com/tx/0x1234`, // not a 32-byte hash
    `https://evil.example/tx/${H}`, // unknown host
    "not a url",
  ]) assert.equal(explorerTx(bad), null, bad);
});

test("a link to a successful tx is the weak true: found, recipient not checked", async () => {
  const asked: string[] = [];
  const v = await judge({ feedbackUri: `https://monadvision.com/tx/${H}`, feedbackHash: H, fetched: blocked, readerFor: reader({}, asked) as never });
  assert.equal(v.outcome, "true");
  assert.equal(v.settlementChecked, false);
  assert.equal(v.mapping, EXPLORER_TX_MAPPING);
  assert.equal(v.declaredTx, H);
  assert.deepEqual(asked, ["monad"], "read the chain the explorer belongs to, nothing else");
  assert.match(v.reason, /names no recipient/);
});

test("a link to a tx that is not there is false, a reverted one is false", async () => {
  const missing = await judge({ feedbackUri: `https://monadvision.com/tx/${H}`, feedbackHash: H, fetched: blocked, readerFor: reader(null) as never });
  assert.equal(missing.outcome, "false");
  const reverted = await judge({ feedbackUri: `https://monadvision.com/tx/${H}`, feedbackHash: H, fetched: blocked, readerFor: reader({ status: "reverted" }) as never });
  assert.equal(reverted.outcome, "false");
});

test("an ordinary document URL still stops at could-not-read when the fetch fails", async () => {
  const v = await judge({ feedbackUri: "https://example.org/feedback/1.json", feedbackHash: H, fetched: blocked, readerFor: reader({}) as never });
  assert.equal(v.outcome, "unknown");
  assert.match(v.reason, /could not be read/);
});
