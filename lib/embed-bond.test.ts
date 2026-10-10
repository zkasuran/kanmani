/**
 * The badge's bond chip, run against a minimal fake DOM.
 *
 * The badge is served as a string and runs on somebody else's page, so it is tested the same way: the
 * real script text from the route, evaluated with a stub `document` and a stub `fetch` that returns a
 * chosen `/api/agent` body. Each case asserts what text a visitor would see and where it links.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/embed.js/route.ts";

type Node = { tag: string; className?: string; textContent?: string; title?: string; href?: string; style: Record<string, string>; children: Node[]; appendChild(n: Node): Node; [k: string]: unknown };

function node(tag: string): Node {
  const n: Node = { tag, style: {}, children: [], appendChild(c: Node) { n.children.push(c); return c; } };
  return n;
}

async function render(agentBody: unknown): Promise<Node[]> {
  const src = await (await GET()).text();
  const root = node("#shadow");
  const host = node("span");
  (host as Node & { setAttribute(): void; attachShadow(): Node; remove(): void }).setAttribute = () => {};
  (host as Node & { attachShadow(): Node }).attachShadow = () => root;
  (host as Node & { remove(): void }).remove = () => { root.children.length = 0; };
  const document = {
    currentScript: {
      getAttribute: (k: string) => (k === "data-agent" ? "10251" : null),
      parentNode: { insertBefore: () => {} },
      nextSibling: null,
    },
    createElement: (t: string) => (t === "span" && !hostUsed ? ((hostUsed = true), host) : node(t)),
  };
  let hostUsed = false;
  let done!: () => void;
  const settled = new Promise<void>((r) => (done = r));
  const fetch = async () => ({ ok: true, json: async () => agentBody });
  new Function("document", "fetch", src)(document, fetch);
  // Let the fetch chain run.
  setTimeout(done, 20);
  await settled;
  const all: Node[] = [];
  const walk = (n: Node) => { all.push(n); n.children.forEach(walk); };
  walk(root);
  return all;
}

const base = { agentId: 10251, registration: { state: "answered" }, claims: { resolve: 3, doNotResolve: 1, couldNotCheck: 0 } };
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const bondLink = (ns: Node[]) => ns.find((n) => n.tag === "a" && String(n.href).includes("/bond?agent="));

test("an active USDC bond shows its amount and links to the bond page", async () => {
  const ns = await render({ data: { ...base, bond: { state: "active", amountAtomic: "50000", token: USDC, minTruthRateBps: 8000, minSampleSize: 5 } } });
  const a = bondLink(ns);
  assert.ok(a, "chip rendered");
  assert.equal(a!.textContent, "bonded 0.05 USDC");
  assert.equal(a!.href, "https://kanmani.xyz/bond?agent=10251");
  assert.match(String(a!.title), /80% floor/);
  assert.match(String(a!.title), /at least 5 claims/);
});

test("a bond in a token we cannot price says bonded with no invented number", async () => {
  const ns = await render({ data: { ...base, bond: { state: "active", amountAtomic: "123", token: "0x0000000000000000000000000000000000000001", minTruthRateBps: 9000, minSampleSize: 3 } } });
  assert.equal(bondLink(ns)!.textContent, "bonded");
});

test("slashed and released bonds say so", async () => {
  const s = await render({ data: { ...base, bond: { state: "slashed", amountAtomic: "0", token: USDC, minTruthRateBps: 8000, minSampleSize: 5 } } });
  assert.equal(bondLink(s)!.textContent, "bond slashed");
  const r = await render({ data: { ...base, bond: { state: "released", amountAtomic: "0", token: USDC, minTruthRateBps: 8000, minSampleSize: 5 } } });
  assert.equal(bondLink(r)!.textContent, "bond returned");
});

test("no bond renders no chip, and the rest of the badge is unchanged", async () => {
  for (const bond of [null, undefined, { state: "none" }]) {
    const ns = await render({ data: { ...base, bond } });
    assert.equal(bondLink(ns), undefined);
    assert.ok(ns.some((n) => n.textContent === " claims resolve"), "claims line still there");
  }
});
