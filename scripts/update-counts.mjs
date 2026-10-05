#!/usr/bin/env node
/**
 * One command for the published test counts. Run it after adding or removing a test:
 *
 *   npm run counts
 *
 * It runs the three suites the way the release gate does (no database, default forge profile),
 * writes the measured numbers into lib/counts.ts, then refreshes every place that shows them:
 * the doc markers and README badge (refresh-numbers.mjs) and the README art (build-readme-art.py).
 * The site reads lib/counts.ts at build time, so a deploy carries the same figure.
 *
 * Before this, the counts were typed into lib/counts.ts by hand, a second copy of the sum was typed
 * into lib/counts.test.ts and the art had to be rebuilt separately. Each was a place a number could
 * be updated while another was not.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
// The published figure is defined as the default run without a database.
delete env.ENVIO_PG_PASSWORD;
delete env.FOVEA_DATABASE_URL;

function nodeSuite(glob) {
  const r = spawnSync("node", ["--test", "--experimental-strip-types", glob], { cwd: ROOT, env, encoding: "utf8", maxBuffer: 64 << 20 });
  const g = (k) => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)`, "m")) ?? [])[1]);
  const out = { pass: g("pass"), total: g("tests"), fail: g("fail") };
  if (!Number.isInteger(out.total) || out.fail > 0) {
    throw new Error(`${glob}: ${out.fail} failing or unreadable output. Fix the failures before publishing a count.`);
  }
  return out;
}

function forgeSuite() {
  const r = spawnSync("forge", ["test"], { cwd: join(ROOT, "contracts"), env, encoding: "utf8", maxBuffer: 64 << 20 });
  const m = r.stdout.match(/(\d+) tests passed, (\d+) failed, \d+ skipped \((\d+) total tests\)/);
  if (!m || Number(m[2]) > 0) throw new Error("forge test: failing or unreadable output. Fix it before publishing a count.");
  return { pass: Number(m[1]), total: Number(m[3]) };
}

const measured = { site: nodeSuite("lib/**/*.test.ts"), verifier: nodeSuite("verifier/src/**/*.test.ts"), contracts: forgeSuite() };

const path = join(ROOT, "lib/counts.ts");
let src = readFileSync(path, "utf8");
for (const [name, v] of Object.entries(measured)) {
  const re = new RegExp(`(${name}:\\s*\\{\\s*pass:\\s*)\\d+(,\\s*total:\\s*)\\d+`);
  if (!re.test(src)) throw new Error(`lib/counts.ts has no ${name} suite line`);
  src = src.replace(re, `$1${v.pass}$2${v.total}`);
}
writeFileSync(path, src);
const total = measured.site.pass + measured.verifier.pass + measured.contracts.pass;
console.log(`lib/counts.ts: site ${measured.site.pass}/${measured.site.total}, verifier ${measured.verifier.pass}/${measured.verifier.total}, contracts ${measured.contracts.pass}/${measured.contracts.total}, ${total} passing`);

execFileSync("node", ["scripts/refresh-numbers.mjs"], { cwd: ROOT, stdio: "inherit" });
execFileSync("python3", ["scripts/build-readme-art.py"], { cwd: ROOT, stdio: "inherit" });
console.log("Done. Commit lib/counts.ts, docs, README and public/readme together, then deploy so the site matches.");
