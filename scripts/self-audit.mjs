#!/usr/bin/env node
/**
 * Audit every agent Kanmani operates with Kanmani's own tools plus the checks it applies to others.
 * Read-only and free: no payment, no transaction. Writes docs/31-SELF-AUDIT.md and public/self-audit.json.
 *
 * Per agent:
 *   document   the registry's agentURI equals the one we intend (registration.json onChainMatches)
 *   spec       Registrar's consequences on that document (the free tools may skip "can take a payment")
 *   unique     no other agent shares the document (the dead-shared-document pattern)
 *   indexed    our index holds its name and endpoint; x402 matches what it charges
 *   card       its A2A card answers and names the agent
 *   doctor     Doctor on its service URL: hireable over A2A
 *   linter     Linter on paid ones: a settleable x402 v2 challenge
 *   works      free ones answer their own example; paid ones answer an unpaid call with 402
 *   taifoon    an independent ERC-8004 directory's readiness verdict
 */
import { writeFileSync } from "node:fs";
const SITE = process.env.SITE ?? "https://kanmani.xyz";
const SLUGS = ["kanmani", "sentinel", "assay", "locator", "notary", "registrar", "ledger", "twin", "pulse", "doctor", "linter", "bondsman", "scribe"];
const FREE = new Set(["notary", "registrar", "doctor", "linter"]);
const j = async (u, o) => { try { const r = await fetch(u, { ...o, signal: AbortSignal.timeout(60_000) }); return { status: r.status, body: await r.json().catch(() => null) }; } catch (e) { return { status: 0, body: null, error: e.message }; } };
const post = (u, b) => j(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

const rows = [];
for (const slug of SLUGS) {
  const row = { slug, checks: {} };
  const set = (k, ok, saw) => (row.checks[k] = { ok, saw });
  const reg = (await j(`${SITE}/api/service/${slug}/registration.json`)).body;
  row.agentId = reg?.agentId ?? null;
  set("document", reg?.onChainMatches === true, reg?.onChainMatches === true ? "on chain = intended, byte for byte" : `onChainMatches ${reg?.onChainMatches}`);

  const chk = (await post(`${SITE}/api/registration/check`, { draft: reg.draft, agentId: String(reg.agentId) })).body?.data;
  const unmet = (chk?.consequences ?? []).filter((c) => !c.met && !(c.label === "can take a payment" && (FREE.has(slug))));
  set("spec", chk?.ready === true && unmet.length === 0, unmet.length ? `unmet: ${unmet.map((c) => c.label).join(", ")}` : `registration-v1, ${chk?.uriBytes} bytes, all consequences met`);

  const a = (await j(`${SITE}/api/agent/${reg.agentId}`)).body?.data;
  const shared = a?.registration?.sharedWithAgents;
  set("unique", shared === 0, shared === 0 ? "no other agent shares its document" : `shared with ${shared ?? "unknown"}`);
  const expectX402 = slug !== "kanmani" && !FREE.has(slug) ? true : slug === "kanmani" ? true : false;
  const idxOk = !!a?.name && (a?.endpoints?.length ?? 0) > 0 && a?.declaresX402 === expectX402;
  set("indexed", idxOk, `name "${a?.name}", ${a?.endpoints?.length ?? 0} endpoint(s), x402 ${a?.declaresX402} (expected ${expectX402})`);

  if (slug === "kanmani") {
    const wk = (await j(`${SITE}/.well-known/agent-registration.json`)).body;
    set("card", Array.isArray(wk?.registrations) && wk.registrations.length === SLUGS.length, `well-known lists ${wk?.registrations?.length} registrations`);
    const mcp = (await post(`${SITE}/api/service/doctor`, { url: `${SITE}/mcp` })).body?.answer;
    set("doctor", mcp?.hireable === true, `Doctor on /mcp: speaks ${mcp?.speaks?.join(",")}`);
    const lint = (await post(`${SITE}/api/service/linter`, { url: `${SITE}/api/verify` })).body?.answer;
    set("linter", lint?.ok === true, `Linter on /api/verify: ${lint?.ok ? "clean" : (lint?.findings ?? []).filter((f) => f.ok === false).map((f) => f.check).join(", ")}`);
  } else {
    const card = (await j(`${SITE}/api/service/${slug}/agent-card.json`)).body;
    set("card", card?.name === `Kanmani ${a?.name?.replace(/^Kanmani /, "")}` && card?.erc8004?.agentId === reg.agentId, `A2A card "${card?.name}", erc8004 #${card?.erc8004?.agentId}`);
    const doc = (await post(`${SITE}/api/service/doctor`, { url: `${SITE}/api/service/${slug}` })).body?.answer;
    set("doctor", doc?.hireable === true, `speaks ${doc?.speaks?.join(",") || "nothing"}`);
    if (FREE.has(slug)) set("linter", true, "free, no challenge to lint");
    else {
      const lint = (await post(`${SITE}/api/service/linter`, { url: `${SITE}/api/service/${slug}` })).body?.answer;
      set("linter", lint?.ok === true, lint?.ok ? `v2 challenge, ${lint.challenge.options} option(s), settleable` : (lint?.findings ?? []).filter((f) => f.ok === false).map((f) => f.check).join(", "));
    }
    const pre = (await j(`${SITE}/api/service/${slug}`)).body;
    if (FREE.has(slug)) {
      const r = await post(`${SITE}/api/service/${slug}`, pre.example);
      set("works", r.status === 200 && r.body?.answer !== undefined, `example answered HTTP ${r.status}`);
    } else {
      const r = await post(`${SITE}/api/service/${slug}`, pre.example);
      set("works", r.status === 402 && Array.isArray(r.body?.accepts) && r.body.accepts.length > 0, `unpaid call answered HTTP ${r.status} with ${r.body?.accepts?.length ?? 0} payment option(s)`);
    }
  }
  const tf = (await j(`https://www.taifoon.io/v1/agents/143/${reg.agentId}/readiness`)).body?.readiness;
  row.taifoon = tf?.verdict ?? "not listed";
  row.ok = Object.values(row.checks).every((c) => c.ok);
  rows.push(row);
  console.log(`  ${slug.padEnd(10)} #${row.agentId} ${row.ok ? "PASS" : "FAIL"}  ${Object.entries(row.checks).filter(([, c]) => !c.ok).map(([k, c]) => `${k}: ${c.saw}`).join(" | ")}  taifoon ${row.taifoon}`);
}

const at = new Date().toISOString();
writeFileSync(new URL("../public/self-audit.json", import.meta.url), JSON.stringify({ at, site: SITE, rows }, null, 2) + "\n");
const cols = ["document", "spec", "unique", "indexed", "card", "doctor", "linter", "works"];
const md = [
  "# Self-audit: every agent Kanmani operates, checked by Kanmani",
  "",
  `Run ${at.slice(0, 16)}Z by \`node scripts/self-audit.mjs\`. Read-only: no payment, no transaction. The`,
  "same checks Kanmani applies to the registry, applied to ourselves first. Machine-readable:",
  "[`/self-audit.json`](https://kanmani.xyz/self-audit.json).",
  "",
  `| agent | id | ${cols.join(" | ")} | taifoon |`,
  `|---|---|${cols.map(() => "---").join("|")}|---|`,
  ...rows.map((r) => `| ${r.slug} | ${r.agentId} | ${cols.map((c) => (r.checks[c] ? (r.checks[c].ok ? "pass" : "FAIL") : "n/a")).join(" | ")} | ${r.taifoon} |`),
  "",
  "What each column checks:",
  "",
  "- **document**: the registry's agentURI is the registration-v1 document we intend, byte for byte.",
  "- **spec**: every consequence our registration check reports is met (free tools take no payment by design).",
  "- **unique**: no other agent shares the document. 8,093 Monad agents share one dead one.",
  "- **indexed**: our index holds its name and endpoint and its x402 flag matches what it charges.",
  "- **card**: its A2A card answers and names the ERC-8004 agent (for Kanmani: the well-known file lists all 13).",
  "- **doctor**: our Doctor agent finds the endpoint hireable over A2A (for Kanmani: MCP).",
  "- **linter**: our Linter agent finds a settleable x402 v2 challenge on paid endpoints.",
  "- **works**: free agents answer their published example; paid ones answer an unpaid call with 402.",
  "",
  "Findings, when a check fails:",
  "",
  ...rows.flatMap((r) => Object.entries(r.checks).filter(([, c]) => !c.ok).map(([k, c]) => `- ${r.slug} ${k}: ${c.saw}`)),
  ...(rows.every((r) => r.ok) ? ["- none"] : []),
  "",
].join("\n");
writeFileSync(new URL("../docs/31-SELF-AUDIT.md", import.meta.url), md);
console.log(`\n  ${rows.filter((r) => r.ok).length} of ${rows.length} pass`);
