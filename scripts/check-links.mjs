#!/usr/bin/env node
/**
 * Offline dead-link scan of README.md and the docs (flagship 0.3).
 *
 * Parses markdown links and inline HTML href/src, resolves every LOCAL target against the repo and
 * fails on any missing file. External https links are only checked with --external (off by default),
 * so the gate stays offline and deterministic.
 *
 *   node scripts/check-links.mjs README.md docs
 *   node scripts/check-links.mjs --external README.md docs    # also HEAD-check external links
 *
 * Distinct from scripts/e2e/nav.mjs and numbers.mjs, which drive the live site. This reads files.
 */
import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join, extname } from "node:path";

const args = process.argv.slice(2);
const external = args.includes("--external");
const targets = args.filter((a) => a !== "--external");
if (targets.length === 0) {
  console.error("usage: node scripts/check-links.mjs [--external] <file-or-dir> ...");
  process.exit(1);
}

/** Expand a dir to its .md files (one level is enough for docs/, but recurse to be safe). */
function markdownFiles(path) {
  const st = statSync(path);
  if (st.isFile()) return path.endsWith(".md") ? [path] : [];
  const out = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(p));
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = [...new Set(targets.flatMap(markdownFiles))].sort();

// [text](target) and inline HTML href="..." / src="..."
const MD_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_ATTR = /(?:href|src)\s*=\s*"([^"]+)"/gi;

let checked = 0;
let dead = 0;
const external$ = [];

function isExternal(t) {
  return /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//");
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const base = dirname(file);
  const seen = new Set();
  const collect = (re) => {
    let m;
    while ((m = re.exec(text))) seen.add(m[1]);
  };
  collect(MD_LINK);
  collect(HTML_ATTR);

  for (const raw of seen) {
    const target = raw.trim();
    if (target === "" || target.startsWith("#") || target.startsWith("mailto:") || target.startsWith("data:")) continue;
    if (isExternal(target)) {
      if (/^https?:/i.test(target)) external$.push({ file, target });
      continue;
    }
    // Strip any #anchor or ?query from a local path.
    const path = target.replace(/[?#].*$/, "");
    if (path === "") continue;
    checked += 1;
    const abs = resolve(base, path);
    if (!existsSync(abs)) {
      dead += 1;
      console.log(`  DEAD  ${file} -> ${target}`);
    }
  }
}

console.log(`\n  ${checked - dead} of ${checked} local links resolve${dead ? `, ${dead} DEAD` : ""}`);

if (external) {
  let extDead = 0;
  for (const { file, target } of external$) {
    try {
      const res = await fetch(target, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        extDead += 1;
        console.log(`  EXT ${res.status}  ${file} -> ${target}`);
      }
    } catch (e) {
      extDead += 1;
      console.log(`  EXT ERR  ${file} -> ${target}  (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  console.log(`  ${external$.length - extDead} of ${external$.length} external links answered 200`);
  if (extDead) dead += extDead;
} else if (external$.length) {
  console.log(`  (${external$.length} external links not checked; pass --external to HEAD-check them)`);
}

process.exit(dead ? 1 : 0);
