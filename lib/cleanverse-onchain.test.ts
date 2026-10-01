import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interpretCviStatus,
  readCviStatus,
  evidenceCviState,
  txHref,
  COMPLIANCE_CHAINS,
  PASS_REFUSE_EVIDENCE,
  MAINNET_GATE,
  TESTNET_GATE,
  CLEANVERSE_VALIDATOR,
  type ComplianceChain,
} from "./cleanverse-onchain.ts";

/**
 * These prove the compliance read holds the same line as the off-chain client: only the `2` word is
 * verified, a `1` is a compliance refusal and everything else is unknown rather than a false pass.
 * Everything runs against an injected read, so no network is touched.
 */

/* ------------------------------------------------- Done-when 1: the lookup reads the chain on load */

test("the 2 word is the only path to verified", () => {
  const r = interpretCviStatus(2, true);
  assert.equal(r.state, "verified");
  assert.equal(r.raw, 2);
});

test("a 1 word is a compliance refusal, not an operational one", () => {
  assert.equal(interpretCviStatus(1, true).state, "unverified");
});

test("a 0 word on a registered chain is unknown and says the gate failed closed", () => {
  const r = interpretCviStatus(0, true);
  assert.equal(r.state, "unknown");
  assert.match(r.reason, /fails closed/);
});

test("a 0 word on an unregistered chain names the missing pool registration", () => {
  const r = interpretCviStatus(0, false);
  assert.equal(r.state, "unknown");
  assert.match(r.reason, /not yet registered as a compliance pool/);
});

test("an unrecognised word and a null are unknown, never a pass", () => {
  assert.equal(interpretCviStatus(7, true).state, "unknown");
  assert.equal(interpretCviStatus(null, true).state, "unknown");
});

test("readCviStatus returns the matching state for an injected 2, 1 and 0", async () => {
  const c = COMPLIANCE_CHAINS[1];
  assert.equal((await readCviStatus("0x1", c, {}, async () => 2)).state, "verified");
  assert.equal((await readCviStatus("0x1", c, {}, async () => 1)).state, "unverified");
  assert.equal((await readCviStatus("0x1", c, {}, async () => 0)).state, "unknown");
});

test("a thrown read is unknown, never unverified (transport failure is operational)", async () => {
  const c = COMPLIANCE_CHAINS[0];
  const r = await readCviStatus("0x1", c, {}, async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(r.state, "unknown");
  assert.notEqual(r.state, "unverified");
  assert.equal(r.raw, null);
});

test("a reader on load gets one result per chain, each carrying state and reason", async () => {
  const results = await Promise.all(
    COMPLIANCE_CHAINS.map(async (c: ComplianceChain) => ({
      chainId: c.chainId,
      ...(await readCviStatus("0x1", c, {}, async () => (c.registered ? 2 : 0))),
    })),
  );
  assert.equal(results.length, COMPLIANCE_CHAINS.length);
  for (const row of results) {
    assert.ok(["verified", "unverified", "unknown"].includes(row.state));
    assert.ok(typeof row.reason === "string" && row.reason.length > 0);
  }
});

/* ------------------------------------------------- Done-when 2: the pass and refuse rows */

const HEX66 = /^0x[0-9a-fA-F]{64}$/;

test("the evidence carries a pass settle row and a refuse settle row, each a 66-char hash", () => {
  const pass = PASS_REFUSE_EVIDENCE.find((r) => r.kind === "pass" && r.step.includes("settle"));
  const refuse = PASS_REFUSE_EVIDENCE.find((r) => r.kind === "refuse" && r.step.includes("settle"));
  assert.ok(pass, "a pass settle row exists");
  assert.ok(refuse, "a refuse settle row exists");
  assert.match(pass!.txHash, HEX66);
  assert.match(refuse!.txHash, HEX66);
  assert.equal(refuse!.revert, "CviNotVerified() 0xbfeb29e5");
});

test("each evidence row maps to its badge through the same mapper", () => {
  assert.equal(evidenceCviState("pass"), "verified");
  assert.equal(evidenceCviState("refuse"), "unverified");
  assert.equal(evidenceCviState("setup"), "unknown");
});

test("every evidence hash is a 66-char hex string", () => {
  for (const r of PASS_REFUSE_EVIDENCE) assert.match(r.txHash, HEX66);
});

test("txHref builds a chain-aware explorer link and null for an unknown chain", () => {
  assert.equal(txHref(10143, "0xabc"), "https://testnet.monadexplorer.com/tx/0xabc");
  assert.equal(txHref(143, "0xabc"), "https://monadexplorer.com/tx/0xabc");
  assert.equal(txHref(1, "0xabc"), null);
});

/* ------------------------------------------------- config integrity: addresses never drift */

test("COMPLIANCE_CHAINS carries the recorded broadcast addresses on both chains", () => {
  const mainnet = COMPLIANCE_CHAINS.find((c) => c.chainId === 143)!;
  const testnet = COMPLIANCE_CHAINS.find((c) => c.chainId === 10143)!;
  assert.equal(mainnet.gate, MAINNET_GATE);
  assert.equal(testnet.gate, TESTNET_GATE);
  assert.equal(mainnet.validator, CLEANVERSE_VALIDATOR);
  assert.equal(testnet.validator, CLEANVERSE_VALIDATOR);
  assert.equal(mainnet.registered, false);
  assert.equal(testnet.registered, true);
});
