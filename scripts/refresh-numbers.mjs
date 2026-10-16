#!/usr/bin/env node
/**
 * The numbers the docs quote, kept in step with the live index.
 *
 * Every count in this repository's prose went stale at least once: the hero said 503 tests for days
 * after the real total was 511, and the docs carried 646 tests and 10,252 agents long after both had
 * moved. A number typed into a doc is true on the day it is typed. This makes the current figures
 * generated instead.
 *
 * Three pieces:
 *
 *  - `docs/numbers.json` is the committed snapshot: each value, the block it was read at and when.
 *  - A doc marks a current figure as `<!-- n:agents -->10,276<!-- /n -->`. The comment is invisible
 *    when rendered, so the doc reads as plain prose.
 *  - This script fills every marker from the snapshot and checks they agree.
 *
 * Only CURRENT figures carry a marker. A past reading recorded as such ("the census at the time said
 * 10,252", an audit table of what an endpoint returned on the day) is history and must not be
 * rewritten to today's value, so it is deliberately left unmarked.
 *
 *   node scripts/refresh-numbers.mjs              read live, write the snapshot, fill every marker
 *   node scripts/refresh-numbers.mjs --check      offline gate: markers match the snapshot and the
 *                                                 test counts match lib/counts.ts. verify.sh runs this
 *   node scripts/refresh-numbers.mjs --check --live   also fail if the snapshot no longer matches the
 *                                                 live site, allowing population counts to drift by
 *                                                 an allowance that grows with the snapshot's age, see
 *                                                 scripts/numbers-drift.mjs. The canary runs this
 *   node scripts/refresh-numbers.mjs --mark FILE...   adopt markers: wrap the snapshot's distinctive
 *                                                 figures in FILE where they appear unmarked
 *
 * The live source is the public site, the same population(), measurement() and clusterShape() reads
 * the pages render from, so the docs and the site cannot disagree. Reading it needs no key, which is
 * what lets the canary run it anonymously. SITE overrides the origin.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driftVerdict } from "./numbers-drift.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "docs/numbers.json");
const COUNTS = join(ROOT, "lib/counts.ts");
const SITE = (process.env.SITE ?? "https://kanmani.xyz").replace(/\/$/, "");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const LIVE = args.includes("--live");
const MARK = args.includes("--mark");
const markFiles = args.filter((a) => !a.startsWith("--"));

/** What each key means, so a snapshot is readable on its own and an unknown key is caught. */
const KEYS = {
  agents: "agents indexed on Monad (chain 143)",
  documents: "distinct registration documents behind them",
  feedbacks: "feedbacks on the Reputation Registry",
  withPointer: "feedbacks carrying an evidence pointer",
  goneAgents: "agents whose registration document returns a deletion",
  oneDocAgents: "agents sharing the single largest dead document",
  oneDocWallets: "distinct wallets behind that one document",
  claims: "documents that assert a payment (false plus true)",
  claimsFalse: "payment claims whose transaction is not on the chain named",
  claimsTrue: "payment claims whose transaction is there",
  claimsElsewhere: "false claims whose transaction is mined on a different chain",
  jobsSettled: "escrow jobs settled in USDC on Monad mainnet, counted from Settled events",
  noClaim: "documents that assert no payment",
  unknown: "documents that could not be checked",
  unknownHash: "unknown: bytes no longer match their on-chain hash",
  unknownMapping: "unknown: no published mapping reads the shape",
  unknownRateLimited: "unknown: the host would not answer",
  testsPassing: "tests passing across the three default suites",
  testsSkipped: "tests skipped across the three default suites",
  testsApp: "app suite passing",
  testsVerifier: "verifier suite passing",
  testsContracts: "contract suite passing, default profile",
  testsAppTotal: "app suite, tests run",
  testsVerifierTotal: "verifier suite, tests run",
  testsContractsTotal: "contract suite, tests run on the default profile",
  testsAppSkipped: "app suite skipped, waiting on a database",
  testsVerifierSkipped: "verifier suite skipped, waiting on a database",
  testsContractsSkipped: "contract suite skipped on the default profile",
  testsRootPassing: "`npm test` at the root, which runs the app and verifier suites together",
};


/** Figures distinctive enough to adopt automatically with --mark. Small ones are marked by hand. */
const AUTO_MARK = ["agents", "documents", "feedbacks", "withPointer", "goneAgents", "oneDocAgents", "oneDocWallets", "noClaim"];

const fmt = (n) => Number(n).toLocaleString("en-US");

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ sources */

/** The test counts, parsed from lib/counts.ts so that file stays the one place they are typed. */
function testCounts() {
  const src = readFileSync(COUNTS, "utf8");
  const suite = (name) => {
    const m = src.match(new RegExp(`${name}:\\s*\\{\\s*pass:\\s*(\\d+),\\s*total:\\s*(\\d+)\\s*\\}`));
    if (!m) fail(`lib/counts.ts has no readable ${name} suite`);
    return { pass: Number(m[1]), total: Number(m[2]) };
  };
  const site = suite("site");
  const verifier = suite("verifier");
  const contracts = suite("contracts");
  return {
    testsApp: site.pass,
    testsVerifier: verifier.pass,
    testsContracts: contracts.pass,
    testsAppTotal: site.total,
    testsVerifierTotal: verifier.total,
    testsContractsTotal: contracts.total,
    testsAppSkipped: site.total - site.pass,
    testsVerifierSkipped: verifier.total - verifier.pass,
    testsContractsSkipped: contracts.total - contracts.pass,
    testsRootPassing: site.pass + verifier.pass,
    testsPassing: site.pass + verifier.pass + contracts.pass,
    testsSkipped: site.total - site.pass + (verifier.total - verifier.pass) + (contracts.total - contracts.pass),
  };
}

async function get(path) {
  const res = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) fail(`${SITE}${path} returned ${res.status}`);
  return res.text();
}

/** One line of llms.txt, matched or a loud failure. Never a silent zero. */
function grab(text, re, what) {
  const m = text.match(re);
  if (!m) fail(`llms.txt no longer carries ${what}. The route changed shape; update the pattern here.`);
  return m.slice(1).map((s) => Number(s.replace(/,/g, "")));
}

async function live() {
  const feed = JSON.parse(await get("/feed.json"));
  const s = feed?.data?.summary;
  if (!s || !s.couldNotCheck) fail("feed.json has no data.summary.couldNotCheck");
  const llms = await get("/llms.txt");
  const [agents] = grab(llms, /- ([\d,]+) agents indexed\./, "the agents-indexed line");
  const [documents] = grab(llms, /- ([\d,]+) distinct registration documents/, "the documents line");
  const [goneAgents, oneDocAgents, oneDocWallets] = grab(
    llms,
    /- ([\d,]+) agents point at a document that returns a deletion\. ([\d,]+) of them share ONE document, registered by ([\d,]+) distinct wallets/,
    "the dead-cluster line",
  );
  const [claimsElsewhere] = grab(llms, /([\d,]+) of those are mined on a different chain/, "the mislabelled-network line");
  const [jobsSettled] = grab(llms, /- ([\d,]+) escrow jobs settled in USDC on Monad mainnet/, "the settled-jobs line");
  const [withPointer, feedbacks] = grab(llms, /- ([\d,]+) of ([\d,]+) feedbacks carry an evidence pointer/, "the feedbacks line");
  return {
    atBlock: feed.checkedAtBlock === null ? null : Number(feed.checkedAtBlock),
    values: {
      agents,
      documents,
      feedbacks,
      withPointer,
      goneAgents,
      oneDocAgents,
      oneDocWallets,
      claims: s.paymentClaims,
      claimsFalse: s.doNotResolve,
      claimsTrue: s.resolve,
      claimsElsewhere,
      jobsSettled,
      noClaim: s.assertNoPayment,
      unknown: s.couldNotCheck.total,
      unknownHash: s.couldNotCheck.bytesNoLongerMatchTheirCommitment,
      unknownMapping: s.couldNotCheck.noMappingReadTheShape,
      unknownRateLimited: s.couldNotCheck.documentWouldNotAnswer,
      ...testCounts(),
    },
  };
}

/* ------------------------------------------------------------------ markers */

const MARKER = /<!-- n:([A-Za-z]+) -->([^<]*)<!-- \/n -->/g;

/** Tracked markdown, so a scratch file never joins the check. */
function docs() {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
}

/** True when `i` falls inside an inline code span on its line, where a comment would render literally. */
function inCode(line, i) {
  return (line.slice(0, i).match(/`/g) ?? []).length % 2 === 1;
}

/** Apply `fn` to every line outside fenced code blocks. */
function eachProseLine(text, fn) {
  let fenced = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced ? line : fn(line);
    })
    .join("\n");
}

/**
 * The README test badge carries the count inside an image URL, where a comment cannot go. It is the
 * one figure handled by pattern rather than by marker.
 */
function badge(text, values) {
  return text
    .replace(/tests-\d+%20passing/g, `tests-${values.testsPassing}%20passing`)
    .replace(/alt="\d+ tests passing"/g, `alt="${values.testsPassing} tests passing"`);
}

function fill(values) {
  let changed = 0;
  for (const f of docs()) {
    const path = join(ROOT, f);
    const before = readFileSync(path, "utf8");
    let after = before.replace(MARKER, (_m, key, _old) => {
      if (!(key in KEYS)) fail(`${f} has a marker for an unknown key "${key}"`);
      return `<!-- n:${key} -->${fmt(values[key])}<!-- /n -->`;
    });
    if (f === "README.md") after = badge(after, values);
    if (after !== before) {
      writeFileSync(path, after);
      changed++;
      console.log(`wrote ${f}`);
    }
  }
  return changed;
}

function check(values) {
  const bad = [];
  let markers = 0;
  for (const f of docs()) {
    const text = readFileSync(join(ROOT, f), "utf8");
    for (const m of text.matchAll(MARKER)) {
      markers++;
      const [, key, shown] = m;
      if (!(key in KEYS)) bad.push(`${f}: unknown key "${key}"`);
      else if (shown !== fmt(values[key])) bad.push(`${f}: ${key} reads ${shown}, the snapshot says ${fmt(values[key])}`);
    }
    if (f === "README.md" && badge(text, values) !== text) bad.push(`README.md: the test badge is not ${values.testsPassing}`);
  }
  return { bad, markers };
}

/* ------------------------------------------------------------------ modes */

function readSnapshot() {
  if (!existsSync(SNAPSHOT)) fail("docs/numbers.json does not exist. Run: node scripts/refresh-numbers.mjs");
  return JSON.parse(readFileSync(SNAPSHOT, "utf8"));
}

if (MARK) {
  if (markFiles.length === 0) fail("--mark needs at least one file");
  const { values } = readSnapshot();
  for (const f of markFiles) {
    const path = join(ROOT, f);
    const before = readFileSync(path, "utf8");
    const after = eachProseLine(before, (line) => {
      // Leave lines that already carry markers alone, so a re-run never nests them.
      if (line.includes("<!-- n:")) return line;
      let out = line;
      for (const key of AUTO_MARK) {
        const lit = fmt(values[key]);
        const re = new RegExp(`(?<![\\d,.])${lit.replace(/,/g, ",")}(?![\\d,])`, "g");
        out = out.replace(re, (hit, offset, whole) => (inCode(whole, offset) ? hit : `<!-- n:${key} -->${hit}<!-- /n -->`));
      }
      return out;
    });
    if (after !== before) {
      writeFileSync(path, after);
      console.log(`marked ${f}`);
    }
  }
  process.exit(0);
}

if (CHECK) {
  const snap = readSnapshot();
  const fromCounts = testCounts();
  const bad = [];
  for (const [k, v] of Object.entries(fromCounts)) {
    if (snap.values[k] !== v) bad.push(`docs/numbers.json says ${k} ${snap.values[k]}, lib/counts.ts says ${v}`);
  }
  const r = check(snap.values);
  bad.push(...r.bad);

  if (LIVE) {
    // The registry grows every day, so an exact match would fail every scheduled run and teach everyone to
    // ignore it. The allowance grows with the age of the snapshot (see scripts/numbers-drift.mjs). The
    // drift is still printed. Claim, settlement and test figures have no tolerance: if one of those moves,
    // a sentence built on it may have stopped being true.
    const ageDays = (Date.now() - Date.parse(snap.measuredAt)) / 86_400_000;
    const now = await live();
    const notes = [];
    for (const [k, v] of Object.entries(now.values)) {
      const was = snap.values[k];
      if (was === v) continue;
      const line = `${k} is ${fmt(v)} live at block ${now.atBlock}, the snapshot says ${fmt(was)}`;
      const d = driftVerdict(k, was, v, ageDays);
      if (d.ok) notes.push(`${line}, within the ${(d.within * 100).toFixed(1)}% allowance for a ${ageDays.toFixed(1)} day old snapshot`);
      else bad.push(line);
    }
    for (const n of notes) console.log(`note  ${n}`);
  }

  if (bad.length) {
    console.error("FAIL  the numbers in the docs do not match:");
    for (const b of bad) console.error(`      ${b}`);
    console.error("      Run: node scripts/refresh-numbers.mjs   then commit the result.");
    process.exit(1);
  }
  console.log(
    `ok    ${r.markers} marked figures match the snapshot from block ${snap.atBlock}` +
      (LIVE ? ", and the snapshot matches the live site" : ""),
  );
  process.exit(0);
}

// Default: refresh from live.
const now = await live();
const snapshot = {
  note: "Generated by scripts/refresh-numbers.mjs. Do not edit by hand: change the source and re-run.",
  source: SITE,
  measuredAt: new Date().toISOString(),
  atBlock: now.atBlock,
  keys: KEYS,
  values: now.values,
};
writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`wrote docs/numbers.json at block ${now.atBlock}`);
const n = fill(now.values);
console.log(`${n} doc(s) updated`);
