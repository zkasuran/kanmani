import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("indexer/src/handlers/Retina.ts", "utf8");
const start = src.indexOf("function parseInlineRecord");
const end = src.indexOf("\n}\n", start) + 3;
let fn = src.slice(start, end)
  .replace(/function parseInlineRecord[\s\S]*?\| undefined \{/, "function parseInlineRecord(uri) {")
  .replace(/let text: string;/, "let text;").replace(/let doc: Record<string, unknown>;/, "let doc;")
  .replace(/const parsed: unknown =/, "const parsed =")
  .replace(/ as Record<string, unknown>/g, "").replace(/ as unknown\[\]\[\]/g, "")
  .replace(/const endpoints: string\[\] = \[\];/, "const endpoints = [];");
const parse = new Function(`${fn}; return parseInlineRecord;`)();

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const lines = readFileSync("/tmp/cands.tsv", "utf8").split("\n").filter(Boolean);
let ok = 0, skipped = 0;
const out = [];
for (const line of lines) {
  const tab = line.indexOf("\t");
  const agentId = line.slice(0, tab).trim();
  const uri = line.slice(tab + 1);
  const r = parse(uri);
  if (!r || !r.name) { skipped++; continue; }
  ok++;
  const eps = "ARRAY[" + r.endpoints.map(q).join(",") + "]::text[]";
  out.push(`UPDATE "Agent" SET name=${q(r.name)}, endpoints=${r.endpoints.length ? eps : "ARRAY[]::text[]"}, "declaresX402"=${r.declaresX402} WHERE "chainId"=143 AND "agentId"::text=${q(agentId)} AND name IS NULL;`);
}
writeFileSync("/tmp/backfill.sql", out.join("\n") + "\n");
console.log(`  parsed ${ok}, skipped ${skipped} (unreadable, deliberately left alone)`);
console.log("  sample:", out[0]?.slice(0, 150));
