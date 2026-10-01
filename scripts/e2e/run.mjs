#!/usr/bin/env node
/**
 * Run every e2e suite against one URL.
 *
 * Done-when for flagship 0.1: `npm run e2e` runs every suite against a URL argument. This is that
 * entrypoint. It discovers suites rather than listing them, so flagship 1.4 and 2.1 (and 19) add a
 * suite file and it registers itself with no edit here, which is why there is no merge contention on
 * this file.
 *
 *   npm run e2e                              every suite against https://kanmani.xyz
 *   npm run e2e -- https://staging.example   npm forwards everything after -- to the script
 *   node scripts/e2e/run.mjs http://localhost:3400   retarget a local build
 *   E2E_ONLY=nav,numbers npm run e2e         run a subset by base name
 *
 * A suite exits 0 on pass, non-zero on fail, or 2 with a `SKIP <reason>` line to opt out of this
 * URL (a passkey suite that needs a local build the given URL does not expose). SKIP is counted
 * apart and never fails the run, matching how scripts/prove.sh treats a SKIP.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] ?? "https://kanmani.xyz";

const only = (process.env.E2E_ONLY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const suites = readdirSync(here)
  .filter((f) => f.endsWith(".mjs") && f !== "run.mjs" && f !== "lib.mjs")
  .sort()
  .filter((f) => only.length === 0 || only.includes(f.replace(/\.mjs$/, "")));

if (suites.length === 0) {
  console.error(only.length ? `no e2e suite matched E2E_ONLY=${only.join(",")}` : "no e2e suites found");
  process.exit(1);
}

console.log(`e2e: ${suites.length} suite(s) against ${url}\n`);

let pass = 0;
let fail = 0;
let skip = 0;
const failed = [];

for (const suite of suites) {
  console.log(`──────── ${suite}`);
  const r = spawnSync("node", [join(here, suite), url], { stdio: "inherit" });
  // A suite killed by a signal has no numeric code; treat that as a failure rather than a pass.
  const code = r.status === null ? 1 : r.status;
  if (code === 2) {
    skip += 1;
  } else if (code === 0) {
    pass += 1;
  } else {
    fail += 1;
    failed.push(suite);
  }
  console.log("");
}

console.log("─────────────────────────────────────────────");
console.log(`PASS ${pass} FAIL ${fail} SKIP ${skip}`);
if (failed.length) console.log(`failed: ${failed.join(", ")}`);
process.exit(fail ? 1 : 0);
