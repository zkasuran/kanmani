import { clusterShape, freshness, measurement, population, registryHealth } from "@/lib/queries.ts";
import { SITE } from "@/lib/api.ts";

export const dynamic = "force-dynamic";

/**
 * The whole site in plain text, for a model that will read one file and nothing else.
 *
 * Written so that a reader who stops after the first paragraph still has the correct headline and
 * the correct caveat. The numbers are live rather than baked in, because a summary that was true
 * at build time is the exact failure the rest of this site is about.
 */
export async function GET() {
  const [m, pop, shape, health, fresh] = await Promise.all([
    measurement(),
    population(),
    clusterShape(),
    registryHealth(),
    freshness(),
  ]);
  const d = m.rows;
  const p = pop.rows;
  const s = shape.rows;
  const h = health.rows;
  const n = (x: number) => x.toLocaleString("en-US");
  const gone = h.byState.find((b) => b.state === "gone");
  const paywalled = h.byState.find((b) => b.state === "paywalled");

  const body = `# Kanmani

> Every payment claim in Monad's ERC-8004 agent registry, checked against the chain it names.

Measured live at ${new Date().toISOString()}, against Monad mainnet (chain 143), index at block ${
    fresh.rows.latestIndexedBlock === null ? "unknown" : n(fresh.rows.latestIndexedBlock)
  }.

## The finding

${n(d.doNotResolve)} of ${n(d.paymentClaims)} payment claims on Monad cite a transaction that is not on the chain the document names.

Every one of those documents is hash-perfect: the bytes served today match the hash committed on
chain, so every tool that checks integrity calls them verified. Integrity is not truth. This site
checks the second thing.

## The whole distribution, so the headline cannot be read out of context

- ${n(d.noClaim)} documents assert no payment at all. Mostly game ratings and plain-text comments. They cannot be wrong about a payment.
- ${n(d.doNotResolve)} cite a transaction that is not on the chain they name.
- ${n(d.resolve)} cite a transaction that is.
- ${n(d.unknownUnreachable + d.unknownBytesMoved + d.unknownUnparsed)} could not be checked: ${n(d.unknownBytesMoved)} serve bytes that no longer match their own on-chain hash, ${n(d.unknownUnreachable)} would not answer.

A failure to look is recorded as unknown, never as false. That distinction is the reason this can
be published at all: collapsing them would let somebody else's outage publish as our accusation.

## The registry underneath

- ${n(p.agentsIndexed)} agents indexed. The registry's own counter slot says ${p.counterSlotCount === null ? "unknown" : n(p.counterSlotCount)}.
- ${n(s.records)} distinct registration documents behind those agents.
- ${gone ? `${n(gone.agents)} agents point at a document that returns a deletion. ${n(s.largestMemberCount)} of them share ONE document, registered by ${n(s.largestDistinctOwners)} distinct wallets.` : ""}
- ${paywalled ? `${n(paywalled.agents)} agents point at a document that returns HTTP 402, asking for payment before it will describe its own agent.` : ""}
- ${n(p.feedbacksWithUri)} of ${n(p.feedbacks)} feedbacks carry an evidence pointer. The rest point at nothing.

## What to read next

- ${SITE}/method       how each rung is decided, with the command to re-derive every one by hand
- ${SITE}/operators    the registry clustered by registration document
- ${SITE}/status       how fresh every number here is and what is stale
- ${SITE}/schema.json  the shape of every JSON response
- ${SITE}/agents.md    the safe-access contract, if you are an agent reading this

## Machine-readable

- GET  ${SITE}/feed.json              every checked claim
- GET  ${SITE}/api/claims?outcome=false   filterable claim feed
- GET  ${SITE}/api/agent/<id>         one agent
- POST ${SITE}/api/verify             check a document you supply

Every JSON response carries checkedAt, checkedAtBlock and the command to re-derive it.

## What this site does not claim

It does not say anyone lied. A verdict describes what was observed and never what anyone intended.
The most common cause of a claim not resolving is an expired preview deployment or a template that
wrote the same URL for thousands of registrations, which is nobody's misconduct.

It does not rank agents by a hidden score. Every list states its ordering rule in one sentence.

It does not know what it has not checked. ${n(fresh.rows.claimsWithNoVerdict)} claims carry a URI and no verdict,
and ${n(h.notProbedRecords)} registration documents have never been asked whether they still answer.
`;

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
