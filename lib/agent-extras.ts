/**
 * Kanmani's working agents beyond Sentinel and Assay. Each one wraps a real capability of this site as
 * something another agent can hire over HTTP, A2A or MCP. Each answer says how it was produced.
 *
 * The filter for being here: a builder or broker on Monad would call it for a decision they are about
 * to make and nothing else answers it as directly. Nothing below invents a measurement. Where the
 * input cannot be decided, the answer is `unknown`, never a guess.
 *
 * Price: `priceAtomic` is the x402 upto ceiling in USDC atomic units; "0" means free. Free agents are
 * the build tools, because a builder who has to pay before learning their registration is broken will
 * not find out. Paid agents charge base + units actually used, never more than the ceiling.
 *
 * All are operated by Kanmani from one owner address. That is disclosed on /hire and in each record.
 */
import { agent, claimTruthWindow, claims, indexProgress, probedCluster } from "./queries.ts";
import { q, CHAIN_ID } from "./db.ts";
import { clusterFunder } from "./funders.ts";
import { funderSummary } from "./nansen.ts";
import { findTransaction, explain } from "./findtx.ts";
import { evidenceCheck, isFailure, registrationCheck } from "./build-server.ts";
import { bondFor, usdc } from "./bonds.ts";
import { meteredCharge, type Meter } from "./upto.ts";
import { resolveEvidence } from "../verifier/src/ladder/resolve.ts";
import { guardedRequest } from "../verifier/src/net/probe.ts";
import { diagnose, endpointsIn, lintChallenge } from "./doctor.ts";
import { EXTRA_META } from "./agent-meta.ts";

const meta = (slug: string) => {
  const m = EXTRA_META.find((x) => x.slug === slug);
  if (!m) throw new Error(`no metadata for ${slug}`);
  return { ...m };
};

export type Run = { answer: unknown; meter: Meter };
export type Extra = {
  slug: string;
  name: string;
  sells: string;
  why: string;
  priceAtomic: string;
  skillId: string;
  input: string;
  example: Record<string, unknown>;
  tags: string[];
  run: (input: Record<string, unknown>, ceiling: bigint) => Promise<Run>;
};

const meter = (unit: string, used: number, per: number, base: number): Meter => ({ unit, used, pricePerUnitAtomic: String(per), baseAtomic: String(base) });
const FREE = (unit: string, used = 1): Meter => ({ unit, used, pricePerUnitAtomic: "0", baseAtomic: "0" });

class InputError extends Error {}
export const isInputError = (e: unknown): e is InputError => e instanceof InputError;
const need = (ok: boolean, msg: string) => {
  if (!ok) throw new InputError(msg);
};
const agentIdOf = (i: Record<string, unknown>) => {
  const n = Number(i.agentId);
  need(Number.isInteger(n) && n > 0, "agentId must be a positive integer");
  return n;
};
const urlOf = (i: Record<string, unknown>) => {
  const u = String(i.url ?? "");
  need(/^https?:\/\/\S+$/.test(u), "url must be an absolute http(s) URL");
  return u;
};

export const EXTRAS: Extra[] = [
  {
    ...meta("locator"),
    input: '{ "txHash": "0x…64 hex", "declaredChainId": 143 }',
    example: { txHash: "0x7a745af82bb127d125f4f5878d2562c41874d25a6d60c4a85bf423c8583937ab", declaredChainId: 143 },
    tags: ["transaction", "cross-chain", "payment", "verification"],
    async run(i) {
      const h = String(i.txHash ?? "");
      need(/^0x[0-9a-fA-F]{64}$/.test(h), "txHash must be 0x followed by 64 hex characters");
      const declared = i.declaredChainId === undefined ? null : Number(i.declaredChainId);
      const r = await findTransaction(h, Number.isInteger(declared) ? declared : null);
      return {
        answer: { txHash: h, found: r.found, searchedChainIds: r.searched, unreachable: r.unreachable, sentence: explain(r), checkedAt: r.checkedAt },
        meter: meter("chain searched", r.searched.length, 500, 1000),
      };
    },
  },
  {
    ...meta("notary"),
    input: '{ "document": { ...the evidence JSON... } }',
    example: { document: { network: "monad", proof_of_payment: { network: "monad", payment_tx: "0x94fc5e709885b40e7149791c4329ff2611d2e52545f4533f6e96fe1f6c0397d8" }, rating: { score: 90, target_address: "0xDB6c6340342e71A63cD11Ebac2185204b7777777" } } },
    tags: ["evidence", "reputation", "verification", "build"],
    async run(i) {
      const r = await evidenceCheck({ document: i.document });
      if (isFailure(r)) throw new InputError(r.error);
      return { answer: r, meter: FREE("document") };
    },
  },
  {
    ...meta("registrar"),
    input: '{ "draft": { "name": "...", "description": "...", "skills": [...] }, "sender": "0x…" }',
    example: { draft: { name: "Scout", description: "Finds agents worth hiring on Monad" } },
    tags: ["registration", "erc-8004", "build"],
    async run(i) {
      const r = await registrationCheck({ ...i, chainId: 143 });
      if (isFailure(r)) throw new InputError(r.error);
      return { answer: r, meter: FREE("draft") };
    },
  },
  {
    ...meta("ledger"),
    input: '{ "agentId": 10182 }',
    example: { agentId: 10182 },
    tags: ["reputation", "claims", "due-diligence"],
    async run(i) {
      const id = agentIdOf(i);
      const head = await indexProgress();
      const [c, w] = await Promise.all([claims({ agentId: String(id), withUri: true, limit: 50 }), head === null ? null : claimTruthWindow(String(id), 0n, BigInt(head))]);
      const rows = c.rows;
      const byOutcome = rows.reduce<Record<string, number>>((m, r) => ((m[r.outcome ?? "unknown"] = (m[r.outcome ?? "unknown"] ?? 0) + 1), m), {});
      return {
        answer: {
          agentId: id,
          window: w ? w.rows : null,
          newestClaims: rows.slice(0, 10).map((r) => ({ id: r.id, outcome: r.outcome, rung: r.rung, url: `https://kanmani.xyz/claim/${r.id}` })),
          outcomesInNewest50: byOutcome,
          atBlock: head,
          reproduce: `curl -s 'https://kanmani.xyz/api/claims?agent=${id}'`,
        },
        meter: meter("claim read", rows.length, 100, 1000),
      };
    },
  },
  {
    ...meta("twin"),
    input: '{ "agentId": 10182 }',
    example: { agentId: 10182 },
    tags: ["sybil", "cluster", "due-diligence"],
    async run(i) {
      const id = agentIdOf(i);
      const a = await agent(String(id));
      need(!!a, `agent ${id} is not in this index`);
      if (!a!.uriHash) return { answer: { agentId: id, shared: null, why: "The agent declares no registration document, so there is nothing to compare." }, meter: meter("sibling", 0, 50, 1000) };
      const cluster = await probedCluster(a!.uriHash);
      const sib = await q<{ agentId: string; owner: string }>(`SELECT "agentId", owner FROM "Agent" WHERE "chainId" = $1 AND "uriHash" = $2 AND "agentId" <> $3 ORDER BY "agentId" DESC LIMIT 25`, [CHAIN_ID, a!.uriHash, id]);
      // The first-funder sample for this cluster, read from our own fovea store (no Nansen call, so
      // Twin's meter is unchanged). unknown when nobody in the cluster has been sampled yet.
      const fund = funderSummary(await clusterFunder(a!.uriHash));
      return {
        answer: {
          agentId: id,
          shared: (cluster?.memberCount ?? 1) > 1,
          agentsSharingDocument: cluster?.memberCount ?? 1,
          distinctOwners: cluster?.distinctOwners ?? 1,
          documentState: cluster?.state ?? null,
          siblings: sib.map((s) => ({ agentId: Number(s.agentId), owner: s.owner })),
          firstFunderSample:
            fund.status === "sampled"
              ? {
                  sentence: fund.sentence,
                  sampled: fund.sampled,
                  found: fund.found,
                  distinctFunders: fund.distinctFunders,
                  topFunder: fund.topFunder,
                  topFunderLabel: fund.topFunderLabel,
                  topFunderWallets: fund.topFunderWallets,
                  exampleTx: fund.exampleTx,
                  source: "nansen:profiler/address/related-wallets (First Funder relation, 1 credit a wallet)",
                }
              : { status: "unknown", why: fund.sentence },
          reproduce: `curl -s https://kanmani.xyz/api/agent/${id} | jq .data.registration`,
        },
        meter: meter("sibling", sib.length, 50, 1000),
      };
    },
  },
  {
    ...meta("pulse"),
    input: '{ "agentId": 10256 }',
    example: { agentId: 10256 },
    tags: ["liveness", "uptime", "due-diligence"],
    async run(i) {
      const id = agentIdOf(i);
      const a = await agent(String(id));
      need(!!a, `agent ${id} is not in this index`);
      const doc = a!.tokenUri ? await resolveEvidence(a!.tokenUri) : null;
      // Endpoints from the document as it reads NOW, not from the index: the point is today's state,
      // and the index can lag a repointed document. Falls back to the indexed list.
      const fromDoc = doc && doc.ok ? endpointsIn(doc.bytes) : [];
      const eps = [...new Set([...fromDoc, ...(a!.endpoints ?? [])])].filter((e) => /^https?:\/\//.test(e)).slice(0, 5);
      const probes = await Promise.all(
        eps.map(async (url) => {
          const r = await guardedRequest(url, { method: "GET", timeoutMs: 6000, maxBytes: 16 * 1024 });
          return r.ok ? { url, answered: true, status: r.status, ms: r.ms, paymentRequired: r.status === 402 } : { url, answered: false, reason: r.reason, ms: r.ms };
        }),
      );
      return {
        answer: {
          agentId: id,
          registration: a!.tokenUri
            ? { source: a!.tokenUri.startsWith("data:") ? "on chain" : "hosted", resolves: doc ? doc.ok : null, reason: doc && !doc.ok ? doc.reason : null }
            : { source: "none", resolves: null, reason: "no registration document declared" },
          endpoints: probes,
          anyAnswered: probes.length ? probes.some((p) => p.answered) : null,
          checkedAt: new Date().toISOString(),
        },
        meter: meter("endpoint called", probes.length, 1000, 1000),
      };
    },
  },
  {
    ...meta("doctor"),
    input: '{ "url": "https://your-agent.example/endpoint" }',
    example: { url: "https://kanmani.xyz/api/service/sentinel" },
    tags: ["a2a", "mcp", "x402", "readiness", "build"],
    async run(i) {
      const url = urlOf(i);
      const [a2a, mcp, get] = await Promise.all([
        guardedRequest(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: "doctor-a2a", method: "message/send", params: { message: { kind: "message", role: "user", messageId: "doctor", parts: [{ kind: "text", text: "readiness check from kanmani doctor" }] } } }) }),
        guardedRequest(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: "doctor-mcp", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "kanmani-doctor", version: "1" } } }) }),
        guardedRequest(url, { method: "GET" }),
      ]);
      return { answer: { url, ...diagnose({ a2a, mcp, get }) }, meter: FREE("endpoint") };
    },
  },
  {
    ...meta("linter"),
    input: '{ "url": "https://api.example/paid-endpoint" }',
    example: { url: "https://kanmani.xyz/api/verify" },
    tags: ["x402", "payments", "build"],
    async run(i) {
      const url = urlOf(i);
      const [get, post] = await Promise.all([guardedRequest(url, { method: "GET" }), guardedRequest(url, { method: "POST", body: "{}" })]);
      const supported = await fetch("https://x402-facilitator.molandak.org/supported", { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
      return { answer: { url, ...lintChallenge({ get, post, supported }) }, meter: FREE("challenge") };
    },
  },
  {
    ...meta("bondsman"),
    input: '{ "agentId": 10256 }',
    example: { agentId: 10256 },
    tags: ["bond", "sclera", "risk"],
    async run(i) {
      const id = agentIdOf(i);
      const [b, head] = await Promise.all([bondFor(id), indexProgress()]);
      if (!b) return { answer: { agentId: id, bond: null, why: "No bond found for this agent. It is also possible the contract could not be read. Those are not told apart here." }, meter: meter("bond read", 1, 0, 1000) };
      const w = head === null ? null : (await claimTruthWindow(String(id), BigInt(b.postedAtBlock), BigInt(head))).rows;
      const decided = w?.sampleSize ?? 0;
      const rateBps = w?.rateBps ?? null;
      const wouldSlash = b.state !== "active" ? null : decided < b.minSampleSize || rateBps === null ? false : rateBps < b.minTruthRateBps;
      return {
        answer: {
          agentId: id,
          state: b.state,
          amount: `${usdc(b.amountAtomic)} USDC`,
          floorPct: b.minTruthRateBps / 100,
          minSample: b.minSampleSize,
          postedAtBlock: b.postedAtBlock,
          maturesAtBlock: b.maturesAtBlock,
          matured: b.matured,
          sinceBond: { decidedClaims: decided, rateBps },
          wouldSlashNow: wouldSlash,
          why:
            wouldSlash === null ? `The bond is ${b.state}; nothing can be slashed.` : decided < b.minSampleSize ? `Only ${decided} decided claims since the bond, below its minimum sample of ${b.minSampleSize}: no verdict can slash yet.` : wouldSlash ? "Measured claim truth is below the floor: a signed verdict would slash it." : "Measured claim truth is at or above the floor.",
          contract: b.address,
        },
        meter: meter("bond read", 1, 0, 1000),
      };
    },
  },
  {
    ...meta("scribe"),
    input: '{ "document": { ...an evidence JSON in an unfamiliar shape... } }',
    example: { document: { agentId: 7, value: "10000", valueDecimals: 2, tag1: "uptime", endpoint: "https://x.example" } },
    tags: ["llm", "qwen", "evidence", "schema"],
    async run(i) {
      need(i.document !== undefined && typeof i.document === "object" && i.document !== null, "document must be a JSON object");
      const bytes = new TextEncoder().encode(JSON.stringify(i.document));
      need(bytes.length <= 64 * 1024, "document is over 64 KB");
      const { induceMapping } = await import("../verifier/src/atlas/induce.ts");
      const { qwenFromEnv } = await import("../verifier/src/atlas/qwen.ts");
      let client;
      try {
        client = qwenFromEnv();
      } catch {
        throw new Error("Qwen is not configured on this server");
      }
      const r = await induceMapping({ client, document: bytes, maxTurns: 4 });
      const turns = r.transcript.filter((t) => (t as { kind?: string }).kind === "model" || (t as { kind?: string }).kind === "assistant").length || r.iterations;
      return {
        answer: {
          converged: r.converged,
          mapping: r.converged ? (r as { mapping: unknown }).mapping : null,
          reason: r.converged ? null : (r as { reason?: string }).reason ?? null,
          iterations: r.iterations,
          toolCalls: r.toolCalls,
          model: client.label,
          note: "A mapping is returned only after the verifier read the document with it and the result round-tripped. claim null means the shape asserts no payment.",
        },
        meter: meter("model turn", Math.max(1, turns), 2000, 2000),
      };
    },
  },
];

export const extraBySlug = (slug: string) => EXTRAS.find((e) => e.slug === slug);

/** The charge for an extra's run, capped at its ceiling. */
export function extraCharge(e: Extra, m: Meter): bigint {
  return e.priceAtomic === "0" ? 0n : meteredCharge(m, BigInt(e.priceAtomic));
}
