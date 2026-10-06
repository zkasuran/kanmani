#!/usr/bin/env node
/**
 * Seed fovea.settled_job from HyperSync: every Settled log on Aqueous from before its deployment to
 * HyperSync's archive height, plus the cursor at that height. Prints SQL for psql, so it can run on a
 * machine HyperSync answers and be applied where the database is.
 *
 *   ENVIO_API_TOKEN=... node scripts/seed-settled-jobs.mjs | psql "$FOVEA_DATABASE_URL"
 */
const AQUEOUS = "0xd75f7786d0dd42c8f161bd78e87d37001044fc32";
const TOPIC = "0x7a9f2c7ad0c277bb2d581018d537473ef509de757f16c955da69691e9138a91d";
const token = process.env.ENVIO_API_TOKEN;
if (!token) { console.error("ENVIO_API_TOKEN is not set"); process.exit(1); }
const rows = [];
let from = 106_000_000, height = null;
for (;;) {
  const r = await fetch("https://143.hypersync.xyz/query", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ from_block: from, logs: [{ address: [AQUEOUS], topics: [[TOPIC]] }], field_selection: { log: ["block_number", "transaction_hash", "data", "topic2"] } }),
  });
  if (!r.ok) { console.error(`HyperSync answered ${r.status}`); process.exit(1); }
  const b = await r.json();
  for (const d of b.data ?? []) for (const l of d.logs ?? []) rows.push(l);
  height = b.archive_height;
  if (b.next_block > height) break;
  from = b.next_block;
}
const esc = (s) => s.replace(/'/g, "''");
console.log("BEGIN;");
for (const l of rows) {
  const paid = BigInt("0x" + l.data.slice(2 + 64, 2 + 128)).toString();
  console.log(`INSERT INTO fovea.settled_job (tx, block, agent, paid_atomic) VALUES ('${esc(l.transaction_hash.toLowerCase())}', ${l.block_number}, '0x${l.topic2.slice(-40).toLowerCase()}', ${paid}) ON CONFLICT (tx) DO NOTHING;`);
}
console.log(`INSERT INTO fovea.settled_cursor (id, through_block) VALUES (1, ${height}) ON CONFLICT (id) DO UPDATE SET through_block = GREATEST(fovea.settled_cursor.through_block, EXCLUDED.through_block);`);
console.log("COMMIT;");
console.error(`${rows.length} Settled log(s) through block ${height}`);
