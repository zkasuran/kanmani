/**
 * The `settled` rung, tested against the ways a transaction can exist and still have paid nobody.
 *
 * The four that matter: **`revertedIsFalse`**, because a reverted transaction has a receipt.
 * **`tokenIdIsNotAnAmount`**, because ERC-721 shares the exact event signature of a token transfer.
 * **`amountIsNotConvertedForYou`**, because a guessed decimals is wrong by 1e12 in the direction of
 * a confident false. **`providerFailureIsUnknown`**, for the same reason `locate` holds that line.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MIN_CONFIRMATIONS,
  TRANSFER_TOPIC,
  atomicAmount,
  decodeTransfer,
  normaliseAsset,
  settledCheck,
  type Log,
  type SettlementReader,
  type SettlementReceipt,
} from "./settled.ts";
import { connectionStringFrom } from "../store/store.ts";

const HASH = `0x${"a".repeat(64)}` as const;
const AGENT = "0xbc0e32c8fd8c57e50de41c388c759cef53719ba4";
const BUYER = "0xdb6c6340342e71a63cd11ebac2185204b7777777";
/** AUSD on Monad mainnet, 6 decimals. Read from the chain on 2026-09-12, not from a package. */
const AUSD = "0x00000000efe302beaa2b3e6e1b18d08d69a9012a";

const pad = (addr: string) => `0x${addr.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;

/** An ERC-20 Transfer log, as a node would hand it over. */
const transferLog = (from: string, to: string, value: bigint, asset = AUSD): Log => ({
  address: asset,
  topics: [TRANSFER_TOPIC, pad(from), pad(to)],
  data: word(value),
});

const receipt = (over: Partial<SettlementReceipt> = {}): SettlementReceipt => ({
  blockNumber: 900n,
  status: "success",
  from: BUYER,
  to: AUSD,
  logs: [],
  ...over,
});

function reader(over: Partial<SettlementReader> = {}): SettlementReader {
  return {
    getBlockNumber: async () => 1000n,
    getReceipt: async () => receipt(),
    getNativeTransfer: async () => null,
    ...over,
  };
}

/* ------------------------------------------------------------------ the derived constant */

test("the Transfer topic is derived, so it cannot be a remembered constant that is wrong", () => {
  assert.equal(TRANSFER_TOPIC, "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
});

/* ------------------------------------------------------------------ decoding a transfer */

test("a fungible Transfer decodes to from, to and value", () => {
  const t = decodeTransfer(transferLog(BUYER, AGENT, 1_000_000n))!;
  assert.equal(t.from, BUYER);
  assert.equal(t.to, AGENT);
  assert.equal(t.value, 1_000_000n);
  assert.equal(t.asset, AUSD);
});

test("tokenIdIsNotAnAmount: a four-topic Transfer is an NFT move and is not read", () => {
  // ERC-721 shares the signature exactly, with tokenId indexed as a third topic and empty data.
  // Reading that id as an amount would settle a payment claim for any number a minter chose.
  const nft: Log = {
    address: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
    topics: [TRANSFER_TOPIC, pad(BUYER), pad(AGENT), word(4273n)],
    data: "0x",
  };
  assert.equal(decodeTransfer(nft), null);

  // **The topic count has to be the thing that refuses it.** The case above is also refused by the
  // empty data word, so on its own it does not prove the count is checked at all. A four-topic log
  // carrying a perfectly well formed value word is the one that separates the two guards. A
  // non-standard token emitting both is not hypothetical.
  assert.equal(decodeTransfer({ ...nft, data: word(1_000_000n) }), null, "four topics is not the fungible event");
});

test("a log that is not a Transfer or is malformed decodes to nothing", () => {
  const good = transferLog(BUYER, AGENT, 1n);
  assert.equal(decodeTransfer({ ...good, topics: [`0x${"b".repeat(64)}`, pad(BUYER), pad(AGENT)] }), null);
  assert.equal(decodeTransfer({ ...good, topics: [TRANSFER_TOPIC] }), null, "two topics missing");
  assert.equal(decodeTransfer({ ...good, topics: [TRANSFER_TOPIC, "0xshort", pad(AGENT)] }), null);
  assert.equal(decodeTransfer({ ...good, data: "0x" }), null, "no value word");
  assert.equal(decodeTransfer({ ...good, data: "not hex" }), null);
  assert.equal(decodeTransfer({ ...good, topics: [] }), null);
});

/* ------------------------------------------------------------------ reading an amount */

test("amountIsNotConvertedForYou: only atomic integers are comparable", () => {
  assert.equal(atomicAmount("1000000"), 1_000_000n);
  assert.equal(atomicAmount(" 42 "), 42n);
  assert.equal(atomicAmount(1000), 1000n);
  assert.equal(atomicAmount(10n ** 30n), 10n ** 30n, "beyond Number, which is why strings are used");

  // Every one of these needs the token's own decimals() to mean anything. AUSD on Monad is 6
  // where the same code met 18 elsewhere, so a guess is wrong by 1e12.
  for (const bad of ["0.1", "1.0", "1e6", "$1.00", "1 USDC", "", "-5", null, undefined, {}, 0.5, NaN]) {
    assert.equal(atomicAmount(bad), null, `${JSON.stringify(bad)} must not be converted`);
  }
});

test("an asset is normalised to a token, to native or to nothing at all", () => {
  assert.equal(normaliseAsset(AUSD), AUSD);
  assert.equal(normaliseAsset(AUSD.toUpperCase()), AUSD, "case is not part of an address");
  assert.equal(normaliseAsset("native"), "native");
  assert.equal(normaliseAsset("MON"), "native");
  assert.equal(normaliseAsset(`0x${"0".repeat(40)}`), "native");
  // Undefined is not "native". A claim that names no asset could be on either rail and the check
  // reads both rather than guessing one.
  assert.equal(normaliseAsset(undefined), undefined);
  assert.equal(normaliseAsset("USDC"), undefined);
  assert.equal(normaliseAsset(""), undefined);
});

/* ------------------------------------------------------------------ the happy path */

const claim = (over: Record<string, unknown> = {}) => ({
  txHash: HASH,
  network: "monad",
  recipient: AGENT,
  ...over,
});

test("a token payment that reached the agent is settled, with the block and the depth", async () => {
  const r = await settledCheck(
    claim({ asset: AUSD, amount: "1000000" }),
    () => reader({ getReceipt: async () => receipt({ logs: [transferLog(BUYER, AGENT, 1_000_000n)] }) }),
  );
  assert.equal(r.settled, true);
  if (r.settled !== true) return;
  assert.equal(r.chain.id, 143);
  assert.equal(r.blockNumber, 900n);
  assert.equal(r.confirmations, 101n, "head 1000 minus block 900 plus one");
  assert.equal(r.transfer.value, 1_000_000n);
  assert.equal(r.amountCompared, true);
  assert.match(r.reason, /1000000 atomic units/);
});

test("a native payment settles even though it leaves no log", async () => {
  // prooflines.org prices its own endpoints in native MON under a monad-native-exact scheme, so a
  // token-only check would report half of one real agent's offers as unsettled.
  const r = await settledCheck(
    claim({ asset: "native", amount: "10000000000000000" }),
    () =>
      reader({
        getReceipt: async () => receipt({ logs: [] }),
        getNativeTransfer: async () => ({ to: AGENT, value: 10_000_000_000_000_000n }),
      }),
  );
  assert.equal(r.settled, true);
  if (r.settled !== true) return;
  assert.equal(r.transfer.asset, "native");
});

test("a claim naming no asset reads the token rail then the native one", async () => {
  let nativeAsked = false;
  const r = await settledCheck(claim(), () =>
    reader({
      getReceipt: async () => receipt({ logs: [] }),
      getNativeTransfer: async () => {
        nativeAsked = true;
        return { to: AGENT, value: 5n };
      },
    }),
  );
  assert.equal(nativeAsked, true, "no asset named means both rails get checked");
  assert.equal(r.settled, true);
});

test("a claim naming a token does NOT fall through to the native rail", async () => {
  // Falling through would let a gas refund settle a claim about a token payment.
  let nativeAsked = false;
  const r = await settledCheck(claim({ asset: AUSD }), () =>
    reader({
      getReceipt: async () => receipt({ logs: [] }),
      getNativeTransfer: async () => {
        nativeAsked = true;
        return { to: AGENT, value: 10n ** 18n };
      },
    }),
  );
  assert.equal(nativeAsked, false);
  assert.equal(r.settled, false);
});

test("a payment split across two transfers in one transaction is summed, not sampled", async () => {
  const r = await settledCheck(
    claim({ asset: AUSD, amount: "300" }),
    () =>
      reader({
        getReceipt: async () =>
          receipt({ logs: [transferLog(BUYER, AGENT, 100n), transferLog(BUYER, AGENT, 200n)] }),
      }),
  );
  assert.equal(r.settled, true);
  if (r.settled !== true) return;
  assert.equal(r.transfer.value, 300n);
});

test("the payer is recorded and never required, because a facilitator submits", async () => {
  // Under the x402 exact scheme the facilitator sends the transaction on the buyer's behalf, so
  // requiring the sender to match would fail every settlement using the rail as designed.
  const facilitator = "0x1111111111111111111111111111111111111111";
  const r = await settledCheck(claim({ asset: AUSD }), () =>
    reader({
      getReceipt: async () =>
        receipt({ from: facilitator, logs: [transferLog(facilitator, AGENT, 7n)] }),
    }),
  );
  assert.equal(r.settled, true);
  if (r.settled !== true) return;
  assert.equal(r.transfer.from, facilitator);
});

/* --------------------------------------------- the part that must never be wrong */

test("revertedIsFalse: a reverted transaction has a receipt and settled nothing", async () => {
  const r = await settledCheck(claim({ asset: AUSD }), () =>
    reader({ getReceipt: async () => receipt({ status: "reverted" }) }),
  );
  assert.equal(r.settled, false);
  if (r.settled !== false) return;
  assert.match(r.reason, /reverted on Monad at block 900, so no value moved/);
});

test("a transaction that paid somebody else is false and says what it did do", async () => {
  const other = "0x2222222222222222222222222222222222222222";
  const r = await settledCheck(claim({ asset: AUSD }), () =>
    reader({ getReceipt: async () => receipt({ logs: [transferLog(BUYER, other, 999n)] }) }),
  );
  assert.equal(r.settled, false);
  if (r.settled !== false) return;
  assert.equal(r.transfers.length, 1, "the transfer it did make is on the record");
  assert.match(r.reason, /none of them to /);
});

test("a transfer of a different token does not settle a claim about this one", async () => {
  const someToken = "0x3333333333333333333333333333333333333333";
  const r = await settledCheck(claim({ asset: AUSD }), () =>
    reader({ getReceipt: async () => receipt({ logs: [transferLog(BUYER, AGENT, 1_000_000n, someToken)] }) }),
  );
  assert.equal(r.settled, false);
});

test("an amount that differs is false, with both numbers stated as observation", async () => {
  const r = await settledCheck(
    claim({ asset: AUSD, amount: "1000000" }),
    () => reader({ getReceipt: async () => receipt({ logs: [transferLog(BUYER, AGENT, 1n)] }) }),
  );
  assert.equal(r.settled, false);
  if (r.settled !== false) return;
  assert.match(r.reason, /for 1 atomic units where the document states 1000000/);
});

test("an amount that cannot be compared is recorded as uncompared, not as a match", async () => {
  // The rung still clears: a transfer to the agent did settle. What went unchecked is its size,
  // and the reason says so rather than implying the number was verified.
  const r = await settledCheck(claim({ asset: AUSD, amount: "0.1" }), () =>
    reader({ getReceipt: async () => receipt({ logs: [transferLog(BUYER, AGENT, 100_000n)] }) }),
  );
  assert.equal(r.settled, true);
  if (r.settled !== true) return;
  assert.equal(r.amountCompared, false);
  assert.match(r.reason, /not compared because it is not in atomic units/);
});

test("providerFailureIsUnknown: a thrown read is never a false", async () => {
  for (const [name, over] of [
    ["receipt", { getReceipt: async () => { throw new Error("429 Too Many Requests"); } }],
    ["head", { getBlockNumber: async () => { throw new Error("upstream down"); } }],
    ["transaction", { getNativeTransfer: async () => { throw new Error("timeout"); } }],
  ] as const) {
    const r = await settledCheck(claim(), () => reader(over as Partial<SettlementReader>));
    assert.equal(r.settled, "unknown", `a thrown ${name} read must be unknown`);
  }
});

test("a transaction the chain does not have is false, carrying the block it was checked at", async () => {
  const r = await settledCheck(claim(), () => reader({ getReceipt: async () => null }));
  assert.equal(r.settled, false);
  if (r.settled !== false) return;
  assert.equal(r.checkedAtBlock, 1000n);
  assert.match(r.reason, /no transaction with this hash on Monad at block 1000/);
});

test("a receipt too shallow to rely on is unknown, whatever it says", async () => {
  // Checked before the receipt is interpreted. A reorg would take a revert and a transfer away
  // together, so a shallow receipt gives the same answer either way.
  for (const status of ["success", "reverted"] as const) {
    const r = await settledCheck(claim({ asset: AUSD }), () =>
      reader({
        getBlockNumber: async () => 900n,
        getReceipt: async () => receipt({ status, logs: [transferLog(BUYER, AGENT, 1n)] }),
      }),
    );
    assert.equal(r.settled, "unknown", `a ${status} receipt one block deep is too early to call`);
    if (r.settled === "unknown") assert.match(r.reason, /below the 2 this check requires/);
  }
  assert.equal(MIN_CONFIRMATIONS, 2n);
});

test("a head behind the receipt reads as zero depth rather than a negative one", async () => {
  const r = await settledCheck(claim({ asset: AUSD }), () =>
    reader({ getBlockNumber: async () => 800n, getReceipt: async () => receipt({ blockNumber: 900n }) }),
  );
  assert.equal(r.settled, "unknown");
  if (r.settled === "unknown") assert.match(r.reason, /is 0 blocks deep/);
});

test("a malformed hash or a missing recipient is unknown, because there is no claim to check", async () => {
  for (const bad of ["", "0x", "0x123", "not-a-hash", null, `0x${"z".repeat(64)}`]) {
    const r = await settledCheck(claim({ txHash: bad }), () => reader());
    assert.equal(r.settled, "unknown", `${String(bad)} is not a claim`);
  }
  for (const bad of ["", null, "0x123", "eip155:143:0xbc0e", undefined]) {
    const r = await settledCheck(claim({ recipient: bad }), () => reader());
    assert.equal(r.settled, "unknown", `${String(bad)} is not a recipient`);
    if (r.settled === "unknown") assert.match(r.reason, /no recipient address/);
  }
});

test("a chain outside the published list is unknown, so coverage never fakes a settlement", async () => {
  for (const net of ["solana", "monad-testnet", 10143, "", null]) {
    const r = await settledCheck(claim({ network: net }), () => reader());
    assert.equal(r.settled, "unknown", `${String(net)} must not resolve`);
  }
});

test("a chain we cover with no endpoint configured is unknown and says which", async () => {
  const r = await settledCheck(claim({ network: "base" }), () => null);
  assert.equal(r.settled, "unknown");
  if (r.settled === "unknown") {
    assert.match(r.reason, /no RPC configured for Base/);
    assert.equal(r.chain?.id, 8453);
  }
});

test("no chain is opened at all for a network that cannot be named", async () => {
  let touched = false;
  await settledCheck(claim({ network: "solana" }), () => {
    touched = true;
    return reader();
  });
  assert.equal(touched, false);
});

test("a mixed case hash and a mixed case recipient are both accepted", async () => {
  const r = await settledCheck(
    claim({ txHash: `0x${"A".repeat(64)}`, recipient: AGENT.toUpperCase(), asset: AUSD }),
    () => reader({ getReceipt: async () => receipt({ logs: [transferLog(BUYER, AGENT, 5n)] }) }),
  );
  assert.equal(r.settled, true);
});

test("no reason string states intent", async () => {
  const banned = /\b(lying|lied|fraud|fake|scam|dishonest|malicious)\b/i;
  const outcomes = await Promise.all([
    settledCheck(claim({ asset: AUSD }), () => reader({ getReceipt: async () => receipt({ status: "reverted" }) })),
    settledCheck(claim({ asset: AUSD, amount: "9" }), () =>
      reader({ getReceipt: async () => receipt({ logs: [transferLog(BUYER, AGENT, 1n)] }) }),
    ),
    settledCheck(claim(), () => reader({ getReceipt: async () => null })),
    settledCheck(claim({ txHash: "nope" }), () => reader()),
  ]);
  for (const o of outcomes) assert.doesNotMatch(o.reason, banned, `reason states intent: ${o.reason}`);
});

/* ------------------------------------------------------------------ against the real database */

/**
 * Gated on a real Postgres, skipped with a loud reason otherwise.
 *
 * Two kinds of claim live in the corpus. The 12 feedbacks whose cited transaction `locate` already
 * found on Monad are real settlement claims with real hashes, which is what the last test here
 * reads against a live chain. Separately, a registration document can declare its own settlement
 * through an `x402Support` object: measured 2026-09-23, the object form is served over HTTP by
 * `claw.tormund.io` while the two inline `x402Support` documents in the database use the boolean
 * form. So the corpus test below asserts what is actually stored rather than what one fetch showed,
 * and the object form is covered as a unit against the measured document in `payable.test.ts`.
 */
const TEST_DB = "fovea_settled_test";

let adminConn: string | null = null;
try {
  adminConn = connectionStringFrom();
} catch {
  adminConn = null;
}
const skip = adminConn ? false : "no database configured: set ENVIO_PG_PASSWORD or FOVEA_DATABASE_URL";

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

let indexer: pg.Client | null = null;
let scratch: pg.Client | null = null;

before(async () => {
  if (!adminConn) return;
  indexer = new pg.Client({ connectionString: adminConn });
  await indexer.connect();

  const admin = new pg.Client({ connectionString: withDatabase(adminConn, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  scratch = new pg.Client({ connectionString: withDatabase(adminConn, TEST_DB) });
  await scratch.connect();
  const here = dirname(fileURLToPath(import.meta.url));
  await scratch.query(readFileSync(join(here, "../store/schema.sql"), "utf8"));
});

after(async () => {
  await indexer?.end();
  await scratch?.end();
  if (!adminConn) return;
  const admin = new pg.Client({ connectionString: withDatabase(adminConn, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

test("every x402 declaration in the corpus is read without inventing a settlement", { skip }, async () => {
  const rows = await indexer!.query<{ uri: string }>(
    `SELECT uri FROM "AgentRecord"
      WHERE "chainId" = 143 AND uri LIKE '{%' AND uri LIKE '%x402Support%'`,
  );
  assert.ok(rows.rowCount! > 0, "the corpus holds at least one x402Support document");

  let boolean = 0;
  let withTx = 0;
  for (const row of rows.rows) {
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(row.uri);
    } catch {
      continue;
    }
    const s = doc.x402Support;
    if (typeof s === "boolean") {
      boolean++;
      continue;
    }
    if (typeof s !== "object" || s === null) continue;
    const tx = (s as Record<string, unknown>).donationTx;
    if (typeof tx !== "string") continue;
    withTx++;
    // A well formed hash is all this asserts. Whether it cleared is a chain read and belongs to
    // the live test below, not to one that has to pass offline.
    assert.match(tx, /^0x[0-9a-fA-F]{64}$/, "a declared settlement is a 32 byte hash");
  }
  assert.equal(boolean + withTx, rows.rowCount, "every declaration was one of the two known shapes");
  console.log(
    `  real corpus: ${rows.rowCount} inline x402Support documents, ${boolean} boolean, ${withTx} with a settlement tx`,
  );
});

test("settlement_check stores an outcome and refuses one the rung cannot produce", { skip }, async () => {
  await scratch!.query(
    `INSERT INTO fovea.settlement_check
       (subject, subject_kind, tx_hash, declared_network, recipient, claimed_asset, claimed_amount,
        settled, reason, found_chain, found_chain_id, found_block, confirmations,
        observed_asset, observed_amount, observed_from, amount_compared, transfer_count,
        checked_at, checked_at_block)
     VALUES ('f1','feedback',$1,'monad',$2,$3,'1000000','true','measured','Monad',143,900,101,
             $3,1000000,$4,true,1,now(),1000)`,
    [HASH, AGENT, AUSD, BUYER],
  );
  const q = await scratch!.query<{ settled: string; amount_compared: boolean; observed_amount: string }>(
    "SELECT settled, amount_compared, observed_amount FROM fovea.settlement_check_latest WHERE subject = 'f1'",
  );
  assert.equal(q.rows[0]!.settled, "true");
  assert.equal(q.rows[0]!.amount_compared, true);
  assert.equal(q.rows[0]!.observed_amount, "1000000");

  await assert.rejects(
    () =>
      scratch!.query(
        `INSERT INTO fovea.settlement_check (subject, subject_kind, tx_hash, recipient, settled, reason, checked_at)
         VALUES ('f2','feedback',$1,$2,'probably','measured',now())`,
        [HASH, AGENT],
      ),
    /violates check constraint/,
  );
  await assert.rejects(
    () =>
      scratch!.query(
        `INSERT INTO fovea.settlement_check (subject, subject_kind, tx_hash, recipient, settled, reason, checked_at)
         VALUES ('f3','guess',$1,$2,'true','measured',now())`,
        [HASH, AGENT],
      ),
    /violates check constraint/,
  );
});

test("a re-check appends rather than overwriting, same as every other table here", { skip }, async () => {
  for (const [settled, when] of [
    ["unknown", "2026-09-23T10:00:00Z"],
    ["true", "2026-09-23T11:00:00Z"],
  ] as const) {
    await scratch!.query(
      `INSERT INTO fovea.settlement_check (subject, subject_kind, tx_hash, recipient, settled, reason, checked_at)
       VALUES ('f4','record',$1,$2,$3,'measured',$4)`,
      [HASH, AGENT, settled, when],
    );
  }
  const all = await scratch!.query("SELECT settled FROM fovea.settlement_check WHERE subject = 'f4'");
  assert.equal(all.rowCount, 2, "both checks survive");
  const latest = await scratch!.query<{ settled: string }>(
    "SELECT settled FROM fovea.settlement_check_latest WHERE subject = 'f4'",
  );
  assert.equal(latest.rowCount, 1);
  assert.equal(latest.rows[0]!.settled, "true", "the newer read wins the view, the older one stays");
});

/* ------------------------------------------------------------------ against a real chain */

/**
 * The round trip, on Monad mainnet, against a transaction out of the live corpus.
 *
 * Double gated, on the database for the hashes and on `RPC_MONAD` for the read. It skips with
 * a loud reason rather than passing quietly. This is the only test here that can fail because
 * somebody else's node is having a bad minute, which is exactly why the rest of the file does not
 * touch a network.
 *
 * It proves the check can fail as well as pass: the observed recipient settles and a different
 * address, on the same transaction, does not.
 */
const liveSkip = skip
  ? skip
  : process.env.RPC_MONAD
    ? false
    : "RPC_MONAD is not set, so no live chain read: source .env.local to run this";

test("a real Monad transaction settles for its own recipient and for nobody else", { skip: liveSkip }, async () => {
  const { settlementReaderFor, resetSettlementReaderCache } = await import("../cli/settled.ts");
  const { CHAINS } = await import("../chains.ts");
  resetSettlementReaderCache();
  const monad = CHAINS.find((c) => c.id === 143)!;
  const reader = settlementReaderFor(monad)!;
  assert.ok(reader, "RPC_MONAD is set, so there is a reader");

  const rows = await indexer!.query<{ declared_tx: string }>(
    "SELECT declared_tx FROM fovea.verdict_latest WHERE outcome = 'true' AND declared_tx IS NOT NULL LIMIT 5",
  );
  assert.ok(rows.rowCount! > 0, "the corpus holds claims that locate already found on chain");

  // Walk the candidates until one has a transfer to read. A claim `locate` found is a real
  // transaction. Whether it moved value to anybody is the question this rung adds.
  let checked = 0;
  for (const row of rows.rows) {
    const hash = row.declared_tx.toLowerCase() as `0x${string}`;
    const receipt = await reader.getReceipt(hash);
    if (receipt === null || receipt.status !== "success") continue;

    const transfers = receipt.logs.map(decodeTransfer).filter((t) => t !== null);
    const native = transfers.length === 0 ? await reader.getNativeTransfer(hash) : null;
    const recipient =
      transfers[0]?.to ?? (native && native.value > 0n ? native.to?.toLowerCase() : undefined);
    if (recipient === undefined || recipient === null) continue;

    const claim = { txHash: hash, network: "monad", recipient };
    const good = await settledCheck(claim, () => reader);
    assert.equal(good.settled, true, `${hash} should settle for its own recipient: ${good.reason}`);

    // Same transaction, a recipient it never paid. This has to be false, not true.
    const bad = await settledCheck({ ...claim, recipient: `0x${"9".repeat(40)}` }, () => reader);
    assert.equal(bad.settled, false, "a recipient the transaction never paid must not settle");

    console.log(`  live Monad: ${hash} settled ${good.settled === true ? good.transfer.value : "?"} to ${recipient}`);
    checked++;
    break;
  }
  assert.equal(checked, 1, "one real transaction was checked both ways");
});
