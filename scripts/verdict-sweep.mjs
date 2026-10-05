#!/usr/bin/env node
/**
 * Put every Monad evidence document that has no verdict yet through the ladder, then append what
 * came back. Run on a timer (ops/systemd/kanmani-sweep.*) so a new claim does not sit unchecked
 * until somebody remembers to look.
 *
 *   node --experimental-strip-types scripts/verdict-sweep.mjs            check up to 200 new claims
 *   ... --limit 50 --dry                                                  judge, print, write nothing
 *   ... --recheck-days 7                                                  also re-check verdicts older than 7 days
 *   ... --recheck-hours 6 --mutable-only                                  re-check documents that can change, every 6 hours
 *                                                                         (http and ipfs documents plus every unknown; a
 *                                                                         data: document is on chain and cannot change)
 *   ... --gap 300                                                         wait 300 ms between documents fetched over the network
 *   ... --recheck-reason 'the cited transaction moved %'                  re-check latest verdicts whose reason matches
 *   ... --recheck-ids 143_10182_0x…_4,143_10180_0x…_2                     re-check exactly these claims
 *                                                                         (after a parser fix, so the correction is appended)
 *
 * It is the same ladder as everything else: `check()` in lib/check.ts runs it and rehydrate's
 * append path writes the row. There is no second implementation. Append only, like every other
 * writer here. A run that could not reach a document writes `unknown` with the reason, never
 * `false`, because a failure to look is not evidence about anyone's payment.
 */
import { check } from "../lib/check.ts";
import { CHAIN_ID, q } from "../lib/db.ts";
import { couldNotCheck, liveAppendVerdict, refuseUnsupportedOutcome } from "../lib/rehydrate.ts";
import { findTransaction } from "../lib/findtx.ts";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const LIMIT = Math.min(Math.max(Number(arg("limit", "200")) || 200, 1), 2000);
const RECHECK_HOURS =
  arg("recheck-hours", null) !== null
    ? Math.max(Number(arg("recheck-hours")) || 0, 1)
    : arg("recheck-days", null) !== null
      ? Math.max(Number(arg("recheck-days")) || 0, 1) * 24
      : null;
// Only documents whose bytes can change. A data: URI is the document itself, written on chain, so
// rechecking it can only reproduce the same verdict. Unknowns are always eligible: a host that was
// down may be back.
const MUTABLE_ONLY = process.argv.includes("--mutable-only");
const GAP_MS = Math.min(Math.max(Number(arg("gap", "0")) || 0, 0), 10_000);
const DRY = process.argv.includes("--dry");
const RECHECK_REASON = arg("recheck-reason", null);
const RECHECK_IDS = (arg("recheck-ids", "") || "").split(",").map((x) => x.trim()).filter(Boolean);

// New claims first, oldest block first, so a backlog clears in the order it arrived.
const targets = await q(
  `SELECT f.id, f."feedbackUri" AS uri, f."feedbackHash" AS hash, 'new' AS why
     FROM "Feedback" f
    WHERE f."chainId" = $1 AND f."feedbackUri" <> ''
      AND NOT EXISTS (SELECT 1 FROM fovea.verdict v WHERE v.feedback_id = f.id)
    ORDER BY f."blockNumber" ASC, f.id
    LIMIT $2`,
  [CHAIN_ID, LIMIT],
);
if (RECHECK_HOURS !== null && targets.length < LIMIT) {
  const old = await q(
    `SELECT f.id, f."feedbackUri" AS uri, f."feedbackHash" AS hash, 'recheck' AS why
       FROM fovea.verdict_latest l JOIN "Feedback" f ON f.id = l.feedback_id
      WHERE f."chainId" = $1 AND l.checked_at < now() - make_interval(hours => $2)
        AND (NOT $4::boolean OR f."feedbackUri" NOT LIKE 'data:%' OR l.outcome = 'unknown')
      ORDER BY l.checked_at ASC
      LIMIT $3`,
    [CHAIN_ID, RECHECK_HOURS, LIMIT - targets.length, MUTABLE_ONLY],
  );
  targets.push(...old);
}

if (RECHECK_REASON !== null) {
  const hit = await q(
    `SELECT f.id, f."feedbackUri" AS uri, f."feedbackHash" AS hash, 'fix' AS why
       FROM fovea.verdict_latest l JOIN "Feedback" f ON f.id = l.feedback_id
      WHERE f."chainId" = $1 AND l.reason LIKE $2
      ORDER BY l.checked_at ASC
      LIMIT $3`,
    [CHAIN_ID, RECHECK_REASON, LIMIT],
  );
  targets.length = 0;
  targets.push(...hit);
}

if (RECHECK_IDS.length > 0) {
  const hit = await q(
    `SELECT f.id, f."feedbackUri" AS uri, f."feedbackHash" AS hash, 'fix' AS why
       FROM "Feedback" f WHERE f."chainId" = $1 AND f.id = ANY($2) ORDER BY f.id`,
    [CHAIN_ID, RECHECK_IDS],
  );
  if (hit.length !== RECHECK_IDS.length) {
    console.error(`--recheck-ids: ${RECHECK_IDS.length - hit.length} of ${RECHECK_IDS.length} ids are not indexed feedback on chain ${CHAIN_ID}`);
    process.exit(1);
  }
  targets.length = 0;
  targets.push(...hit);
}

const tally = {};
let written = 0;
let changed = 0;
const before = new Map(
  (targets.length
    ? await q(`SELECT feedback_id, outcome FROM fovea.verdict_latest WHERE feedback_id = ANY($1)`, [targets.map((t) => t.id)])
    : []
  ).map((r) => [r.feedback_id, r.outcome]),
);
for (const t of targets) {
  // Other people's servers: one document at a time, with a gap when it goes over the network.
  if (GAP_MS > 0 && !t.uri.startsWith("data:")) await new Promise((r) => setTimeout(r, GAP_MS));
  const checkedAt = new Date().toISOString();
  let row;
  try {
    const r = await check({ uri: t.uri, feedbackHash: t.hash });
    const refusal = refuseUnsupportedOutcome(r.verdict);
    const v = r.verdict;
    row = refusal
      ? { feedbackId: t.id, feedbackUri: t.uri, ...couldNotCheck(refusal, checkedAt) }
      : {
          feedbackId: t.id,
          feedbackUri: t.uri,
          rung: v.rung,
          outcome: v.outcome,
          reason: v.reason,
          declaredNetwork: v.declaredNetwork,
          declaredTx: v.declaredTx,
          mapping: v.mapping,
          hashMatches: v.hashMatches,
          computedHash: v.computedHash,
          foundChain: v.foundOnChain?.chain,
          foundChainId: v.foundOnChain?.chainId,
          foundBlock: v.foundOnChain?.blockNumber,
          checkedAt: v.checkedAt,
          checkedAtBlock: v.checkedAtBlock,
        };
  } catch (e) {
    row = { feedbackId: t.id, feedbackUri: t.uri, ...couldNotCheck(e?.message ?? String(e), checkedAt) };
  }
  // A cited transaction that is not on Monad may be a real one on another chain with the network
  // mislabelled, which is a one-field fix rather than a missing payment. Look before recording it,
  // so the false is split the way /claims splits it. A search that finds nothing records nothing:
  // unsearched chains stay unsearched, never "nowhere".
  if (row.outcome === "false" && !row.foundChain && /^0x[0-9a-fA-F]{64}$/.test(row.declaredTx ?? "") && /^no transaction with this hash/.test(row.reason)) {
    try {
      const f = await findTransaction(row.declaredTx, CHAIN_ID);
      if (f.found) {
        row.foundChain = f.found.key;
        row.foundChainId = f.found.chainId;
        row.foundBlock = String(f.found.blockNumber);
        tally.elsewhere = (tally.elsewhere ?? 0) + 1;
      }
    } catch {
      // The cross-chain search is extra context. Failing it leaves the Monad verdict exactly as it was.
    }
    // A transaction once found mined on another chain is still there: a mined block does not un-mine.
    // So when this search came back empty, most often because a provider refused (the Alchemy chains
    // answered 429 for days once the account hit its monthly cap), carry forward the earlier finding
    // for the SAME cited hash rather than dropping it. Without this, every re-check during the outage
    // rewrote 113 real transactions on Arbitrum, Ethereum, Optimism, Base and Polygon as found nowhere.
    // The finding keeps its original block, so the row still says exactly where it was seen.
    if (!row.foundChain) {
      const prior = await q(
        `SELECT found_chain, found_chain_id, found_block FROM fovea.verdict
          WHERE feedback_id = $1 AND declared_tx = $2 AND found_chain IS NOT NULL
          ORDER BY checked_at DESC LIMIT 1`,
        [t.id, row.declaredTx],
      ).catch(() => []);
      if (prior[0]) {
        row.foundChain = prior[0].found_chain;
        row.foundChainId = prior[0].found_chain_id == null ? undefined : Number(prior[0].found_chain_id);
        row.foundBlock = prior[0].found_block == null ? undefined : String(prior[0].found_block);
        tally.elsewhere = (tally.elsewhere ?? 0) + 1;
        tally.carried = (tally.carried ?? 0) + 1;
      }
    }
  }
  tally[row.outcome] = (tally[row.outcome] ?? 0) + 1;
  if (before.has(t.id) && before.get(t.id) !== row.outcome) {
    changed++;
    console.log(`  changed ${t.id}: ${before.get(t.id)} -> ${row.outcome}  ${row.reason.slice(0, 90)}`);
  }
  if (DRY) console.log(`  ${t.why.padEnd(7)} ${row.outcome.padEnd(8)} ${row.rung.padEnd(10)} ${t.id}  ${row.reason.slice(0, 80)}${row.foundChain ? `  [on ${row.foundChain}]` : ""}`);
  else {
    await liveAppendVerdict(row);
    written++;
  }
}
console.log(
  `verdict sweep: ${targets.length} claim(s) judged, ${written} written${DRY ? " (--dry)" : ""}. ` +
    Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", ") +
    (before.size ? `. ${changed} changed verdict` : ""),
);
process.exit(0);
