#!/usr/bin/env node
/**
 * Render docs/TRACTION.md from docs/outreach.json plus live GitHub state.
 *
 *   node scripts/outreach-status.mjs           fetch each thread, write the doc
 *
 * The outcome of a contact is typed in outreach.json only when it is a fact we hold evidence for
 * (a settlement on chain, a published write-up). Whether a thread is open, how many replies it has
 * and who spoke last are read from GitHub every run, so "no reply" cannot go stale silently.
 * Uses GITHUB_TOKEN when set; the public API is enough for a dozen threads.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OURS = "zkasuran";
const data = JSON.parse(readFileSync(join(ROOT, "docs/outreach.json"), "utf8"));
const headers = { accept: "application/vnd.github+json", "user-agent": "kanmani-outreach-status" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function gh(path) {
  const r = await fetch(`https://api.github.com/${path}`, { headers });
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${path}`);
  return r.json();
}

async function thread(repo, number) {
  const [issue, comments] = await Promise.all([gh(`repos/${repo}/issues/${number}`), gh(`repos/${repo}/issues/${number}/comments?per_page=100`)]);
  const theirs = comments.filter((c) => c.user.login !== OURS && !c.user.login.endsWith("[bot]"));
  return { state: issue.state, url: issue.html_url, replies: theirs.length, lastFrom: comments.at(-1)?.user.login ?? null, lastAt: comments.at(-1)?.created_at?.slice(0, 10) ?? null };
}

const rows = [];
for (const c of data.contacts) {
  let live = null;
  if (c.repo) live = await thread(c.repo, c.number);
  let pr = null;
  if (c.pr) {
    const p = await gh(`repos/${c.pr.repo}/pulls/${c.pr.number}`);
    pr = { state: p.merged_at ? "merged" : p.state, url: p.html_url };
  }
  const status =
    c.outcome === "settled" ? "settled on chain"
    : pr && pr.state === "open" ? "replied; our PR is open, waiting on their review"
    : pr && pr.state === "merged" ? "PR merged"
    : live && live.replies > 0 ? (live.lastFrom === OURS ? "replied, our turn done, waiting" : "replied, waiting on us")
    : c.outcome === "replied" ? "replied"
    : "sent, no reply yet";
  rows.push({ c, live, pr, status });
}

const today = new Date().toISOString().slice(0, 10);
const settled = rows.filter((r) => r.c.outcome === "settled");
const outsideBuyer = settled.filter((r) => r.c.buyer === "outside").length;
const weBought = settled.filter((r) => r.c.buyer === "us").length;
const replied = rows.filter((r) => (r.live?.replies ?? 0) > 0 || r.c.outcome !== "sent").length;
const link = (l) => `[${l.label}](${l.url})`;

const out = [
  "# Traction and outreach",
  "",
  `Every project Kanmani has contacted, what was offered and what came back. Thread status read from GitHub on ${today} by \`node scripts/outreach-status.mjs\`; anything settled links the transaction.`,
  "",
  `- **Contacted:** ${rows.length} projects.`,
  `- **Replied or acted:** ${replied}.`,
  `- **Paid work settled on chain:** ${settled.length}. ${outsideBuyer} with an outside buyer paying our agents, ${weBought} with an outside agent we hired. These are kept apart on purpose: only the first is demand that is not ours.`,
  "",
  "| date | project | what we offered | status | evidence |",
  "|---|---|---|---|---|",
  ...rows.map(({ c, live, pr, status }) => {
    const where = live ? `[${c.repo}#${c.number}](${live.url})` : "direct";
    const ev = [...(pr ? [{ label: `PR #${c.pr.number}, ${pr.state}`, url: pr.url }] : []), ...c.evidence].map(link).join(", ") || "none yet";
    return `| ${c.date} | ${c.project}, ${where} | ${c.offered} | ${status}${live ? ` (${live.replies} repl${live.replies === 1 ? "y" : "ies"})` : ""} | ${ev} |`;
  }),
  "",
  "## What came back",
  "",
  ...rows.filter((r) => r.c.result).map((r) => `- **${r.c.project}.** ${r.c.result}`),
  "",
];
writeFileSync(join(ROOT, "docs/TRACTION.md"), out.join("\n"));
// The same rows for the /traction page, so the site and the doc cannot disagree.
writeFileSync(
  join(ROOT, "docs/traction.json"),
  JSON.stringify(
    {
      generatedAt: today,
      counts: { contacted: rows.length, replied, settled: settled.length, outsideBuyer, weBought },
      rows: rows.map(({ c, live, pr, status }) => ({
        project: c.project, repo: c.repo, number: c.number ?? null, date: c.date, status,
        replies: live?.replies ?? null, lastAt: live?.lastAt ?? null, url: live?.url ?? null,
        pr: pr ? { number: c.pr.number, state: pr.state, url: pr.url } : null,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(`docs/TRACTION.md: ${rows.length} contacts, ${replied} replied or acted, ${settled.length} settled (${outsideBuyer} outside buyer, ${weBought} we bought)`);
