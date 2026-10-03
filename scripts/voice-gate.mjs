#!/usr/bin/env node
/**
 * The prose gate for this repository's documentation.
 *
 * The docs make claims a reader is meant to check, so they are held to one plain voice: no em dash,
 * no comma before "and" or "or", none of the filler words that make a sentence sound measured while
 * saying nothing. A style rule that depends on remembering it drifts, so it is a command instead and
 * `./verify.sh` runs it over every tracked markdown file.
 *
 *   node scripts/voice-gate.mjs FILE...          check files
 *   cat body.txt | node scripts/voice-gate.mjs   check stdin
 *   node scripts/voice-gate.mjs --json FILE...   machine-readable
 *
 * Exit 0 clean, 1 violations found, 2 bad invocation.
 *
 * A deliberate exception takes `voice-gate:allow` on the line. Quoted text that must stay byte for
 * byte, such as a licence grant, goes between `<!-- voice-gate:off -->` and `<!-- voice-gate:on -->`.
 */
import { readFileSync } from "node:fs";

const RULES = [
  { id: "em-dash", re: /\u2014/g, msg: "em dash. Use a comma, a period, parentheses, a colon or a rewrite." },
  { id: "comma-and", re: /,\s+(and|or)\b/g, msg: "comma before and/or. Drop the comma." },
  // Word-boundary matched, so "delved" and "leveraged" also hit.
  {
    id: "filler",
    re: /\b(it'?s worth noting|in conclusion|delve[ds]?|robust|seamless(ly)?|leverag(e|es|ed|ing)|utilise|utilize|furthermore|moreover|firstly|secondly)\b/gi,
    msg: "filler word. Say it plainly.",
  },
];

function check(text, name) {
  const out = [];
  let off = false;
  text.split("\n").forEach((line, i) => {
    if (/voice-gate:off/.test(line)) off = true;
    if (/voice-gate:on/.test(line)) {
      off = false;
      return;
    }
    if (off || /voice-gate:allow/.test(line)) return;
    for (const r of RULES) {
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(line)) !== null) {
        const from = Math.max(0, m.index - 34);
        out.push({
          file: name,
          line: i + 1,
          col: m.index + 1,
          rule: r.id,
          msg: r.msg,
          context: (from > 0 ? "…" : "") + line.slice(from, m.index + m[0].length + 30).trim(),
        });
      }
    }
  });
  return out;
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const files = args.filter((a) => !a.startsWith("--"));

const hits = [];
if (files.length === 0) {
  let buf = "";
  for await (const c of process.stdin) buf += c;
  if (!buf.trim()) {
    console.error("voice-gate: nothing on stdin and no files given");
    process.exit(2);
  }
  hits.push(...check(buf, "<stdin>"));
} else {
  for (const f of files) {
    try {
      hits.push(...check(readFileSync(f, "utf8"), f));
    } catch (e) {
      console.error(`voice-gate: cannot read ${f}: ${e.message}`);
      process.exit(2);
    }
  }
}

if (json) {
  console.log(JSON.stringify({ clean: hits.length === 0, count: hits.length, hits }, null, 2));
  process.exit(hits.length ? 1 : 0);
}

if (hits.length === 0) {
  console.log(`voice-gate: clean (${files.length || 1} input${files.length === 1 ? "" : "s"})`);
  process.exit(0);
}

const byRule = {};
for (const h of hits) {
  console.log(`${h.file}:${h.line}:${h.col}  ${h.rule}  ${h.msg}`);
  console.log(`    ${h.context}`);
  byRule[h.rule] = (byRule[h.rule] || 0) + 1;
}
console.log(
  `\nvoice-gate: ${hits.length} violation${hits.length === 1 ? "" : "s"}  (${Object.entries(byRule)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")})`,
);
process.exit(1);
