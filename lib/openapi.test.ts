import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import test from "node:test";

import { agentCard, openapi } from "./openapi.ts";
import { buildGuide, skillMd, SKILL_DESCRIPTION, SKILL_NAME } from "./build-guide.ts";

const SITE = "https://kanmani.xyz";
/** `/api/agent/{id}` -> app/api/agent/[id]/route.ts */
const routeFile = (p: string) => `app${p.replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`;

test("every OpenAPI path is a real route file and every operationId is a unique tool name", () => {
  const spec = openapi(SITE);
  const ids = new Set<string>();
  for (const [p, ops] of Object.entries(spec.paths)) {
    assert.ok(existsSync(routeFile(p)), `${p} has no ${routeFile(p)}`);
    for (const op of Object.values(ops as Record<string, { operationId: string }>)) {
      assert.match(op.operationId, /^[a-z][a-z0-9_]{2,63}$/, op.operationId);
      assert.ok(!ids.has(op.operationId), `duplicate ${op.operationId}`);
      ids.add(op.operationId);
    }
  }
});

test("the build API is fully described: both free checks are in the spec", () => {
  const spec = openapi(SITE);
  assert.ok(spec.paths["/api/registration/check"]?.post);
  assert.ok(spec.paths["/api/evidence/check"]?.post);
  assert.equal(spec.openapi, "3.1.0");
});

/**
 * Does the app serve this path? Walks the segments, taking a literal directory when one exists and
 * any [dynamic] directory otherwise, then looks for a route.ts or page.tsx at the end.
 */
function served(path: string): boolean {
  const segs = path.split("/").filter(Boolean);
  const walk = (dir: string, i: number): boolean => {
    if (i === segs.length) return existsSync(`${dir}/route.ts`) || existsSync(`${dir}/page.tsx`);
    const lit = `${dir}/${segs[i]}`;
    if (!segs[i]!.startsWith("<") && existsSync(lit) && walk(lit, i + 1)) return true;
    return readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory() && /^\[[a-zA-Z]+\]$/.test(e.name) && walk(`${dir}/${e.name}`, i + 1));
  };
  return walk("app", 0);
}

test("every site URL the guide tells a tool to use is served by a route in this repo", () => {
  const guide = buildGuide(SITE);
  const paths = new Set([...guide.matchAll(/https:\/\/kanmani\.xyz(\/[a-zA-Z0-9_./<>-]*)/g)].map((m) => m[1]!.replace(/[.\/]+$/, "")));
  assert.ok(paths.size >= 8, "the guide should name the endpoints it relies on");
  for (const p of paths) if (p) assert.ok(served(p), `guide names ${p} but nothing serves it`);
});

test("SKILL.md frontmatter meets the agentskills.io limits", () => {
  assert.match(SKILL_NAME, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(SKILL_NAME.length <= 64);
  assert.ok(SKILL_DESCRIPTION.length > 0 && SKILL_DESCRIPTION.length <= 1024);
  const md = skillMd(SITE);
  assert.match(md, /^---\nname: kanmani-erc8004-agent\ndescription: .+\n/);
  // A strict parse of the description line: it must be a quoted scalar, so ": " inside cannot split it.
  const line = md.split("\n").find((l) => l.startsWith("description: "))!;
  assert.equal(JSON.parse(line.slice("description: ".length)), SKILL_DESCRIPTION);
});

test("the guide never asks for a key and always says the agent's own key sends", () => {
  const g = buildGuide(SITE);
  assert.match(g, /own key/);
  assert.match(g, /Never paste a private key/);
  assert.doesNotMatch(g, /send (us|Kanmani) (your|the) (private )?key/i);
});

test("the A2A card only lists interfaces that exist", () => {
  const c = agentCard(SITE);
  for (const i of c.supportedInterfaces) {
    const p = new URL(i.url).pathname;
    assert.ok(existsSync(routeFile(p)), `${i.url} is not served`);
  }
  assert.ok(c.skills.length >= 2);
});
