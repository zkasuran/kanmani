#!/usr/bin/env node
/**
 * The production-dependency audit gate, with one narrow, written-down exception.
 *
 *   npm audit --omit=dev --json | node scripts/audit-gate.mjs
 *
 * `npm audit --audit-level=high` has no way to accept a single advisory on a single path, so one finding
 * that cannot be fixed would either fail the gate forever or push the whole threshold down. This reads the
 * same audit and fails on everything except what ALLOWED names. A new advisory, a second copy of the same
 * package or the same advisory on a different path all still fail.
 *
 * Add to ALLOWED only with the reason, the evidence and a date to look again. Mirror it in SECURITY.md.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LEVELS = ["info", "low", "moderate", "high", "critical"];

/**
 * 2026-10-24. GHSA-mrhx-c7xc-m3w5: zod below 4.6.6 can exhaust memory validating a large array, in the zod 4
 * `$ZodArray` code (`handleArrayResult`). @x402/core and @x402/evm 2.27.0 each depend on zod ^3.24 and carry
 * their own nested 3.25.76. npm flags it by version number only. In 3.25.76 `import "zod"` resolves to the v3
 * API, which does not contain that code (0 files with `handleArrayResult`; the 2 files that do are under the
 * `zod/v4` subpath, which @x402 never imports). No patched 3.x exists. `npm audit fix --force` would
 * downgrade @x402/evm to 0.0.1, which breaks the payment path. Our own zod is 4.6.6 and is not affected.
 * Look again when @x402/core moves to zod 4.
 */
export const ALLOWED = [
  {
    advisory: "GHSA-mrhx-c7xc-m3w5",
    package: "zod",
    nodes: ["node_modules/@x402/core/node_modules/zod", "node_modules/@x402/evm/node_modules/zod"],
    // Flagged only because they depend on the allowed zod copies.
    dependents: ["@x402/core", "@x402/evm"],
  },
];

/**
 * @param {{ vulnerabilities?: Record<string, any> }} audit parsed `npm audit --json`
 * @param {number} minLevel index into LEVELS; findings below it are ignored
 */
export function evaluate(audit, minLevel = LEVELS.indexOf("high"), allowed = ALLOWED) {
  const vulns = audit?.vulnerabilities ?? {};
  const unexpected = [];
  const accepted = [];
  for (const [name, v] of Object.entries(vulns)) {
    if (LEVELS.indexOf(v.severity) < minLevel) continue;
    const rules = allowed.filter((a) => a.package === name || a.dependents.includes(name));
    const why = explain(name, v, rules);
    (why === null ? accepted : unexpected).push(why === null ? { name, severity: v.severity } : { name, severity: v.severity, why });
  }
  return { ok: unexpected.length === 0, unexpected, accepted };
}

/** null when this finding is fully covered by an allowance, otherwise the reason it is not. */
function explain(name, v, rules) {
  if (rules.length === 0) return "not covered by any allowance";
  const direct = (v.via ?? []).filter((x) => typeof x !== "string");
  if (rules.some((r) => r.package === name)) {
    if (direct.length === 0) return "no advisory recorded to match against an allowance";
    for (const adv of direct) {
      const rule = rules.find((r) => (adv.url ?? "").endsWith(r.advisory));
      if (!rule) return `advisory ${adv.url ?? adv.source} is not the allowed one`;
      const stray = (v.nodes ?? []).filter((n) => !rule.nodes.includes(n));
      if (stray.length > 0) return `installed at a path the allowance does not cover: ${stray.join(", ")}`;
    }
    return null;
  }
  // A dependent: every reason it is flagged must be the allowed package or another allowed dependent.
  const okNames = new Set(rules.flatMap((r) => [r.package, ...r.dependents]));
  const other = (v.via ?? []).filter((x) => typeof x !== "string" || !okNames.has(x));
  return other.length === 0 ? null : "flagged for a reason other than the allowed package";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let audit;
  try {
    audit = JSON.parse(readFileSync(0, "utf8"));
  } catch (e) {
    console.error(`FAIL  could not read the audit JSON: ${e.message}`);
    process.exit(1);
  }
  if (audit?.error) {
    console.error(`FAIL  npm audit could not run: ${audit.error.summary ?? JSON.stringify(audit.error).slice(0, 200)}`);
    process.exit(1);
  }
  const r = evaluate(audit);
  for (const a of r.accepted) console.log(`note  ${a.severity} ${a.name}: allowed, see scripts/audit-gate.mjs and SECURITY.md known limits`);
  if (!r.ok) {
    for (const u of r.unexpected) console.error(`FAIL  ${u.severity} ${u.name}: ${u.why}`);
    process.exit(1);
  }
  console.log(`ok    no unallowed finding at high or above (${r.accepted.length} allowed)`);
}
