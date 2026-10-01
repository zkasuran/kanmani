#!/usr/bin/env node
/**
 * Propose a mapping for every Monad evidence shape the hand-written atlas could not read, then record
 * each as a reviewable row in fovea.mapping_proposal. This is the agentic Qwen step wired to the live
 * gap (flagship 9.1): plan, call the real parser as a tool, read, revise, converge or give up.
 *
 *   node --experimental-strip-types scripts/atlas-propose.mjs                 propose for the live gap
 *   ... --dry                                                                 show the gap, call nothing, write nothing
 *   ... --limit 50                                                            cap the claims scanned
 *   ... --shape <sorted,top,level,keys>                                       one shape only
 *   ... --require-qwen                                                        refuse to write unless the client is qwen3.8-max
 *
 * **A proposal never changes a verdict.** The verdict pipeline reads only ATLAS in parse.ts and
 * imports nothing from the queue this writes. Promotion is a reviewed code diff that adds the mapping
 * to ATLAS. So this runner, at worst, fills a queue with a candidate that is then rejected.
 *
 * It calls a real model, so it spends credits. The guard is: propose per distinct SHAPE, not per
 * claim (the three tab-settlement feedbacks collapse to one call), cap maxTurns at 6, and run it on
 * demand or a slow timer rather than on every sweep. Prefer DASHSCOPE_API_KEY against Model Studio so
 * the Qwen credit grant pays, with --require-qwen asserting the wire model before any row is written.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { keccak256 } from "viem";
import { CHAIN_ID, q } from "../lib/db.ts";
import { resolveEvidence } from "../verifier/src/ladder/resolve.ts";
import { induceMapping } from "../verifier/src/atlas/induce.ts";
import { qwenFromEnv } from "../verifier/src/atlas/qwen.ts";
import { shapeKey, toProposalRow, ProposalStore } from "../verifier/src/atlas/propose.ts";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const DRY = process.argv.includes("--dry");
const REQUIRE_QWEN = process.argv.includes("--require-qwen");
const LIMIT = Math.min(Math.max(Number(arg("limit", "200")) || 200, 1), 2000);
const ONLY_SHAPE = arg("shape", null);

// The exact rows behind the /method noMappingReadTheShape number: parsed intact, no mapping read it.
const rows = await q(
  `SELECT l.feedback_id, f."feedbackUri" AS uri, f."feedbackHash" AS hash
     FROM fovea.verdict_latest l JOIN "Feedback" f ON f.id = l.feedback_id
    WHERE f."chainId" = $1 AND l.outcome = 'unknown' AND l.rung = 'intact'
    ORDER BY f."blockNumber" ASC, f.id
    LIMIT $2`,
  [CHAIN_ID, LIMIT],
);

// Group the gap by shape, fetching each document through the same guarded resolver the sweep uses and
// re-checking its hash so we only ever propose from the intact bytes. N claims of one shape collapse
// to one Qwen call: that is the credit guard.
const shapes = new Map();
for (const r of rows) {
  const fetched = await resolveEvidence(r.uri);
  if (!fetched.ok) continue; // unreachable now, not a shape to map
  if (r.hash && /^0x[0-9a-fA-F]{64}$/.test(r.hash) && keccak256(fetched.bytes).toLowerCase() !== r.hash.toLowerCase()) {
    continue; // bytes moved since the verdict, so these are not the intact bytes to map
  }
  let doc;
  try {
    doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fetched.bytes));
  } catch {
    continue; // not JSON: a different gap, not an unmapped JSON shape
  }
  const key = shapeKey(doc);
  if (ONLY_SHAPE && key !== ONLY_SHAPE) continue;
  if (!shapes.has(key)) {
    shapes.set(key, { key, document: fetched.bytes, mediaType: fetched.mediaType, exampleUri: r.uri, feedbackIds: [] });
  }
  shapes.get(key).feedbackIds.push(r.feedback_id);
}

console.log(`atlas-propose: ${rows.length} unmapped claim(s), ${shapes.size} distinct shape(s)${DRY ? " (--dry)" : ""}`);
for (const s of shapes.values()) console.log(`  shape ${s.key}  covers ${s.feedbackIds.length} claim(s)`);

if (shapes.size === 0) {
  console.log("nothing to propose: the atlas reads every intact Monad shape right now");
  process.exit(0);
}

if (DRY) {
  console.log("\n--dry: no model call and no write. Re-run without --dry to propose.");
  process.exit(0);
}

// A real run needs a model. Prefer DASHSCOPE_API_KEY (Model Studio, the Qwen grant); qwenFromEnv
// throws a clear error naming the env var when none is present.
const client = qwenFromEnv();
if (REQUIRE_QWEN && client.label !== "qwen3.8-max") {
  console.error(`--require-qwen: client label is "${client.label}", not qwen3.8-max. Set QWEN_MODEL=qwen3.8-max.`);
  process.exit(1);
}
console.log(`\nproposing with ${client.label}`);

const store = await ProposalStore.open();
const here = dirname(fileURLToPath(import.meta.url));
const today = new Date().toISOString().slice(0, 10);
let written = 0;
let converged = 0;

for (const s of shapes.values()) {
  const result = await induceMapping({ client, document: s.document, mediaType: s.mediaType, maxTurns: 6 });
  const row = toProposalRow({ shapeKey: s.key, feedbackIds: s.feedbackIds, exampleUri: s.exampleUri, model: client.label, result });
  await store.record(row);
  written += 1;
  if (result.converged) converged += 1;
  console.log(`  ${result.converged ? "converged" : "gave up "} ${s.key}  ${result.converged ? result.mapping?.name : result.reason}`);

  // Record parity with the two existing inductions: a per-run JSON a reader can open, beside the DB
  // row, carrying the same transcript. Only written for a converged run, which is what produced a
  // named mapping.
  if (result.converged && result.mapping) {
    const file = join(here, `../verifier/src/atlas/inductions/${result.mapping.name}.${today}.json`);
    writeFileSync(
      file,
      JSON.stringify({ recordedAt: new Date().toISOString(), model: client.label, shapeKey: s.key, feedbackIds: s.feedbackIds, exampleUri: s.exampleUri, result }, null, 2) + "\n",
    );
    console.log(`  wrote ${file}`);
  }
}

await store.close();
console.log(`\natlas-propose: ${written} proposal(s) recorded, ${converged} converged. Each is a candidate for review, not a verdict.`);
process.exit(0);
