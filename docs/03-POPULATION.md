# 3. What the <!-- n:agents -->10,309<!-- /n --> agents actually are

Monad mainnet's ERC-8004 Identity Registry held <!-- n:agents -->10,309<!-- /n --> agents when we read it. This document is the
census: how many of those agents describe themselves with the same file, what those files do when
you ask them, what the feedback attached to them actually says.

Nothing below is a sample. The registry was read end to end, every distinct registration document
was asked exactly once, every bucket is checked against the registry total so a lost row shows up as
arithmetic rather than as a plausible-looking number. Section 9 reproduces all of it.

| what | count |
|---|---|
| agents | <!-- n:agents -->10,309<!-- /n --> |
| distinct registration documents | <!-- n:documents -->2,063<!-- /n --> |
| feedbacks | <!-- n:feedbacks -->9,291<!-- /n --> |
| feedbacks carrying an evidence URI | <!-- n:withPointer -->1,295<!-- /n --> |
| validations, before we wrote one | 0 |

Chain 143, Monad mainnet, RPC `https://rpc.monad.xyz`.

| registry | address |
|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Validation | `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` |

## 1. The registry does not enumerate itself

The obvious way to count an ERC-721 population is `totalSupply()`. On this registry it reverts, so
the population is not readable through the token interface at all. It lives in a storage slot, which
is the only source of population truth on this chain.

```bash
cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "totalSupply()(uint256)" \
  --rpc-url https://rpc.monad.xyz     # reverts

cast storage 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
  0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00 \
  --rpc-url https://rpc.monad.xyz     # 0x00...2824
```

`0x2824` is 10276. Ids are dense starting at zero, so `ownerOf` answers for every id below the
counter. `ownerOf(10252)` reverted before we registered. We then took id 10252 in
`0x07f7211e2699b9516bfb746c5d5bf2c8c1fe3768a7d2dc5b09cfd5e7e2b3c394` at block 106470711, so it
answers with our address now. That revert was the proof the counter and the id space agree.

A failed slot read has no fallback, so it must publish "unknown" rather than a zero that would be a
fabricated population. `IndexState.counterSlotCount` is nullable in `indexer/schema.graphql` for that
reason. The indexer publishes the slot beside its own row count, so a gap reads as "the index is
behind" rather than "these agents do not exist". A clean index publishes 10276 against 10,276 rows.

## 2. One row per document, not one row per agent

<!-- n:agents -->10,309<!-- /n --> agents resolve to **<!-- n:documents -->2,063<!-- /n --> distinct registration documents**. The index stores one row per
document (`AgentRecord`), joined from the agent by a stable hash of the URI string, with
`memberCount` for how many agents point at it plus `distinctOwners` for how many wallets registered
those agents. This is not storage economy. It is the only reason the interesting facts are visible.

| one row per agent | one row per document |
|---|---|
| <!-- n:oneDocAgents -->8,093<!-- /n --> copies of the same URL string | one row saying <!-- n:oneDocAgents -->8,093<!-- /n --> agents share it |
| the cluster is invisible until you group after the fact | the cluster is the row |
| a probe pass fetches one dead URL <!-- n:oneDocAgents -->8,093<!-- /n --> times | one fetch, answer attached to all <!-- n:oneDocAgents -->8,093<!-- /n --> |

The probe cost matters because the documents belong to other people. Fetching one expired Vercel
deployment <!-- n:oneDocAgents -->8,093<!-- /n --> times to learn the same thing once is not a slow pass, it is a small denial of
service aimed at somebody whose uptime we are about to publish a number about. So the queue is per
host, serial, with a gap between hits, concurrency across hosts rather than within one.

## 3. The cluster: <!-- n:oneDocAgents -->8,093<!-- /n --> agents, <!-- n:oneDocWallets -->7,962<!-- /n --> wallets, one 404

| field | value |
|---|---|
| document | `https://eve-8004.vercel.app/metadata/b.json` |
| agents pointing at it | <!-- n:oneDocAgents -->8,093<!-- /n --> |
| distinct wallets that registered them | <!-- n:oneDocWallets -->7,962<!-- /n --> |
| share of the registry | 78.76% |
| HTTP status | 404 |
| body | `DEPLOYMENT_NOT_FOUND` |

```bash
curl -sS -i https://eve-8004.vercel.app/metadata/b.json    # HTTP/2 404, DEPLOYMENT_NOT_FOUND
```

**Nobody did anything wrong here.** A Vercel preview deployment expired. Thousands of registrations
that were correct on the day they were written now point at nothing. That is an accident of hosting,
not misconduct, so no number in this document is an accusation.

The part worth knowing is what those <!-- n:oneDocAgents -->8,093<!-- /n --> agents look like to everyone else. The registrations are
still on chain, the ids still resolve, `tokenURI` still returns a well-formed https URL. Every
registry explorer will list all <!-- n:oneDocAgents -->8,093<!-- /n --> with no visible defect, because nothing on chain is broken.
**An agent can look perfectly healthy in a registry explorer while the only document describing it
has been gone for months.** You find that out by asking the URL, which the chain cannot do for you.

### <!-- n:oneDocAgents -->8,093<!-- /n --> agents but <!-- n:oneDocWallets -->7,962<!-- /n --> wallets

| reading | value |
|---|---|
| registrations against this document | <!-- n:oneDocAgents -->8,093<!-- /n --> |
| wallets that made at least one of them | <!-- n:oneDocWallets -->7,962<!-- /n --> |
| registrations beyond the first from a wallet already in the set | 131 |

The two differ by 131, so at most 131 wallets registered more than one agent against this document.
The difference is small next to 8,093, which is itself the finding: this is not one operator minting
thousands of agents, it is thousands of separate wallets arriving at the same starter template.

`distinctOwners` is counted at registration time through a `(record, owner)` row rather than
incremented alongside `memberCount`, so it is a real count rather than a copy of the other field.
Frozen at registration time on purpose: `Agent.owner` moves on every `Transfer`, so a live aggregate
would answer "who holds these agents today" while the published claim is about who registered them.

## 4. Eight states, because a boolean publishes a rate limit as a deletion

Every one of the <!-- n:documents -->2,063<!-- /n --> documents was asked once. The probe stores what happened
(`fovea.record_probe`). A separate view (`fovea.record_state`) decides what that means, so a better
definition reclassifies old probes without re-fetching anybody's server.

| state | documents | agents | % of registry | what it means |
|---|---|---|---|---|
| `gone` | 543 | <!-- n:goneAgents -->8,641<!-- /n --> | 84.08% | the host answered and said the document is not there, including 402s that are a suspended account rather than a real payment challenge |
| `answered` | 1,316 | 1,366 | 13.29% | fetched and read |
| `onchain` | 143 | 151 | 1.47% | the document is inside `tokenURI`. No host to ask |
| `unknown` | 35 | 36 | 0.35% | we could not find out. Ours, not theirs |
| `nohost` | 7 | 10 | 0.10% | the domain no longer resolves to any host |
| `malformed` | 9 | 9 | 0.09% | never a usable pointer |
| `paywalled` | 0 | 0 | 0% | a real x402 payment challenge. No document on Monad exposes one |
| `refused` | 0 | 0 | 0% | alive, will not serve it to us. No document on Monad did this |
| not probed | 1 | 1 | 0.01% | nothing has asked yet. Ours, written on chain after the pass ran |
| no document at all | 0 | 63 | 0.61% | registered with no `tokenURI`, nothing to ask |
| **total** | **2,054** | **10,277** | | |

Percentages are rounded to two places, so the column does not total exactly 100. `refused` and
`paywalled` read zero as a measurement rather than an omission. The big cluster is <!-- n:oneDocAgents -->8,093<!-- /n --> of the <!-- n:goneAgents -->8,641<!-- /n -->
`gone` agents, one dead Vercel document behind <!-- n:oneDocWallets -->7,962<!-- /n --> wallets.

The probe pass read one registration more than the census at the top of this page, so its total is
10,277 against that page's 10,276. That is the registry growing between two reads, which is the only
direction it moves. Both reads print their own total, so the difference cannot hide as a lost row.

**We classified 402 wrong at first. Publishing the correction is the honest move.** On the pass that found it, 539 documents
answer HTTP 402 and an earlier pass read them as `paywalled`, a host alive and asking for payment,
because x402 uses 402 to mean pay me. Recording the response headers showed all 539 carry
`x-vercel-error: DEPLOYMENT_DISABLED` and a `text/plain` body. They are one suspended hosting account,
545 agents behind it, not a payment surface. A status code is not a protocol. A 402 counts as
`paywalled` only when it carries a real challenge (`www-authenticate: x402` or a JSON body). Everything
else falls through to `gone`. The project's own thesis is that a claim's shape is not its truth. This
was the same mistake pointed inward, so it is corrected in the open rather than quietly.

**The `unknown` documents are our own failure to look, not their downtime.** On the pass that
found them, 14 of the 17 answered HTTP 429, which is our rate limit hitting their server rather
than a fact about their uptime. The rest are a timeout, a server error or a document past our own
size cap. Every one is us failing to find out. A boolean has nowhere to put "we could not tell", so
it puts them next to the 404s and turns our own politeness budget into somebody else's failure
rate. Same rule elsewhere in the system: a document with no probe row renders as unknown, never as
dead. Not having looked is a state.

`malformed` means the URI could not have worked on the day it was written. Among the nine: a
`localhost` URL that only ever resolved on its author's machine, plus two placeholder CIDs. Nothing
was deleted, so calling these "gone" would describe an event that did not happen.

## 5. The agents with no document, found by arithmetic

Sixty-three agents registered with no `tokenURI` at all. The registry allows it: the canonical
`IdentityRegistryUpgradeable` has three `register()` overloads, the no-argument one emits
`Registered(agentId, "", sender)`. An agent with no URI produces no `AgentRecord` row, so it has
nothing to probe, so a state query built as a join from `AgentRecord` never sees it. It does not
error. It does not warn. It drops out of the left side of the join.

| sum | value |
|---|---|
| state buckets, added up | 10,214 |
| registry | 10,277 |
| missing | 63 |

**On the day this was caught the buckets read 10,172 against a registry of 10,252 and nothing
complained.** Both numbers looked right alone. The gap was 0.78%, small enough to pass a glance,
large enough to be a whole class of
registration. It was caught by adding the parts up and comparing them to the total, the cheapest
correctness check there is. No query failed, no row was malformed, no test was red.

The count is now explicit (`agentsWithNoDocument` in `lib/queries.ts`), computed from the `Agent`
table rather than through the join. `/operators` prints the bucket sum against the registry total,
because a page whose parts do not add up to its own total is the failure this project is about.

## 6. Host concentration: a single point of failure nobody agreed to share

At the full probe pass, 1,862 of the distinct documents were http or https. Three hosts carry
1,771 of them, which is 95.1% of every http document behind three names.

| host | documents |
|---|---|
| `agent-arcade-steel.vercel.app` | 762 |
| `api.monadmogs.xyz` | 526 |
| `dashboard.dev.fun` | 483 |
| **those three** | **1,771** |
| every other host combined | 91 |

Ranking by documents and ranking by agents give different answers, which is why the site ranks by
agents. `eve-8004.vercel.app` holds one document behind <!-- n:oneDocAgents -->8,093<!-- /n --> agents. `agent-arcade-steel.vercel.app`
holds 762 documents. One host with two URLs behind thousands of agents matters more to a buyer than
one host with 762 URLs behind 762 agents, so the ordering follows dependence rather than row count.

The operators behind those 762 registrations did not choose each other. Most do not know the others
exist. They share a DNS name, a certificate, a hosting account, an expiry date. When any of those
lapse, every registration behind that host stops describing anything at once, the way <!-- n:oneDocAgents -->8,093<!-- /n --> of them
already have. The failure is joint, the ownership is not, so nobody can fix it for everyone. The 143
documents written directly into `tokenURI` are the only ones that cannot acquire this problem later.

## 7. The feedback population and the sampling trap

The Reputation Registry holds **<!-- n:feedbacks -->9,291<!-- /n --> feedbacks**. Only **<!-- n:withPointer -->1,295<!-- /n -->** carry an evidence URI at all. A
feedback with no URI is not suspicious. There is nothing attached that anyone can verify, so it can
be neither confirmed nor contradicted.

| feedbacks | count | share |
|---|---|---|
| total | <!-- n:feedbacks -->9,291<!-- /n --> | 100% |
| carrying a URI | <!-- n:withPointer -->1,295<!-- /n --> | 13.91% |
| carrying nothing to check | 7,996 | 86.09% |

| scheme, of the <!-- n:withPointer -->1,295<!-- /n --> | count | share | network calls to read them |
|---|---|---|---|
| `data:` | 1,095 | 84.75% | 0 |
| `https://execution.market/...` | 182 | 14.09% | 182 |
| `https://grokandmon.com/...` | 10 | 0.77% | 10 |
| `https://gateway-mainnet-production.up.railway.app/...` | 3 | 0.23% | 3 |
| `ipfs://` | 2 | 0.15% | 2 |

**1,095 of 1,292 documents are `data:` URIs decoded in process with no network call at all.** The
whole document is in the transaction. There is no host to go down, no deployment to expire, no
certificate to lapse. Reading the entire evidence corpus costs 197 outbound requests.

### The sampling trap

Sampling this corpus recent-first gives the opposite impression, convincingly. The natural way to
read a feedback table is `ORDER BY "blockNumber" DESC LIMIT n`, which is how every claims page, every
API default, every quick console poke gets written. The head of this list is mostly https, so a
recent-first sample reads as a corpus of hosted documents making payment claims, when the corpus is
overwhelmingly self-contained JSON making no claim at all.

> An earlier 500-feedback sample, taken recent-first, produced 68 fetchable evidence documents. All
> 68 declared network `monad`. That pushed the early design toward hosted documents citing the wrong
> chain. The full pass over all 1,292 says 84.75% are `data:` URIs citing no chain, no transaction,
> no payment.

The head of a list is never a random sample. Ordering by recency correlates with whatever changed
recently, here a publisher that started writing https URIs after the bulk of the `data:` population
was already on chain. Nothing in a sample announces its own bias. The only fix was to stop sampling.

## 8. What the documents actually contain

All 1,095 `data:` URIs were decoded. 1,029 are valid JSON in exactly two shapes. The other 66 are
`data:text/plain` prose.

| shape | count | asserts a payment? |
|---|---|---|
| game ELO record (`elo-record.v1`), `game` is `melee` in all 1,026 | 1,026 | no |
| plain text comment (`plain-text-comment.v1`) | 66 | no |
| conversation score (`conversation-score.v1`) | 3 | no |
| execution.market payment claim (`execution-market.v1`) | 159 | yes |
| execution.market transaction list (`execution-market-transactions.v1`) | 23 | yes |
| no mapping reached the shape | 15 | not determined, these are the `unknown` rows |

The mappings live in `verifier/src/ladder/parse.ts`, five hand-written from real documents and one proposed by Qwen 3.8 Max and reviewed, each tagged with the date in a code field named `induced`. Exactly one must match a document. Two matching is refused rather than resolved by
declaration order, because a verdict that depends on array position is not a verdict.

| outcome, over all <!-- n:withPointer -->1,295<!-- /n --> | count | meaning |
|---|---|---|
| `noClaim` | <!-- n:noClaim -->1,095<!-- /n --> | read fine, asserts no payment |
| `false` | 123 | cites a transaction that is not on the chain the document names |
| `true` | 59 | the cited transaction is on the chain the document names |
| `unknown` | 15 | we could not look or could not read what we fetched |

The 1,095 `noClaim` rows are exactly the `data:` population: 1,026 plus 66 plus 3. The 12 unknowns split into 10 serving bytes that no longer match their own on-chain hash plus 2 that would not answer (HTTP 429). Three more were in a shape no published mapping read until 2026-10-04, when a Qwen-proposed mapping was reviewed and shipped. All three now read `true`. The 10 hash mismatches are the
`grokandmon.com` documents, which an earlier pass read as agent cards before their bytes moved.

**<!-- n:claims -->187<!-- /n --> of <!-- n:feedbacks -->9,291<!-- /n --> feedbacks assert a payment.** That is 1.99%. 182 come from one publisher, execution.market. The other 3 are tab-settlement receipts from a settlement gateway. Every one names Monad.

So the honest description of this registry is not a commerce record with some noise in it. **It is a
game leaderboard with <!-- n:claims -->187<!-- /n --> payment claims attached.** 1,026 melee ratings against <!-- n:claims -->187<!-- /n --> payment claims
is roughly 6 to 1. The registry is being used heavily for something the payment-verification reading
of ERC-8004 does not describe.

That changed what this project says. It was built expecting documents citing one chain while the
payment sat on another. Not what is happening: all <!-- n:claims -->187<!-- /n --> name the same chain, 123 cite a transaction
not on it. `noClaim` is first-class for the same reason. A document that never asserted a payment cannot
be wrong about one, so counting it as unparsed would inflate our own coverage gap by <!-- n:noClaim -->1,095<!-- /n --> rows.

## 9. Reproducing every number here

The index plus the probe results share one Postgres database, two schemas. `public` belongs to Envio
and is dropped on every resync. `fovea` is ours, append only, which is why it is not in `public`. Set
`FOVEA_DATABASE_URL` or the `ENVIO_PG_*` parts (`HOST` `127.0.0.1`, `PORT` `5434`, `USER` `postgres`,
`DATABASE` `envio-dev`, `PASSWORD` with no default on purpose). Re-running the probe writes new rows
rather than updating old ones, so a restored deployment reads as 404 then 200 with both timestamps.

```bash
export FOVEA_DATABASE_URL='postgres://postgres:PASSWORD@127.0.0.1:5434/envio-dev'
P=verifier/src/cli/probe-records.ts
node --experimental-strip-types $P                    # all 2,053: 4 hosts at once, 350ms apart
node --experimental-strip-types $P --limit 50 --dry   # 50 biggest clusters, writes nothing

# section 1, the population. totalSupply() reverts, so the slot is the only source
cast storage 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
  0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00 \
  --rpc-url https://rpc.monad.xyz    # 0x00...2824, which is 10276
cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "ownerOf(uint256)(address)" 10252 \
  --rpc-url https://rpc.monad.xyz    # us, since block 106470711

# section 3, the document 8,093 agents share
curl -sS -o /dev/null -w '%{http_code}\n' https://eve-8004.vercel.app/metadata/b.json   # 404
```

```sql
-- intro table. agents_indexed and counterSlotCount must agree; a gap means the index is behind
SELECT
  (SELECT count(*) FROM "Agent"       WHERE "chainId" = 143)                         AS agents_indexed,
  (SELECT count(*) FROM "AgentRecord" WHERE "chainId" = 143)                         AS distinct_records,
  (SELECT count(*) FROM "Feedback"    WHERE "chainId" = 143)                         AS feedbacks,
  (SELECT count(*) FROM "Feedback"    WHERE "chainId" = 143 AND "feedbackUri" <> '') AS feedbacks_with_uri,
  (SELECT count(*) FROM "Validation"  WHERE "chainId" = 143)                         AS validations,
  s."counterSlotCount", s."atBlock"
FROM (SELECT * FROM "IndexState" WHERE "chainId" = 143 LIMIT 1) s;
-- section 4, the eight states
SELECT coalesce(p.state, 'not probed') AS state,
       count(*) AS records, sum(r."memberCount") AS agents, max(p.checked_at) AS probed_at
FROM "AgentRecord" r LEFT JOIN fovea.record_state p ON p.uri_hash = r.id
WHERE r."chainId" = 143 GROUP BY 1 ORDER BY agents DESC;
-- section 4, the 402s beside the 429s
SELECT state, http_status, count(*) FROM fovea.record_state
WHERE state IN ('paywalled', 'unknown') GROUP BY 1, 2 ORDER BY 1, 3 DESC;
-- section 5. Add `agents` from the state query to `no_document` here. It must equal `total`
SELECT count(*) AS total,
       count(*) FILTER (WHERE "uriHash" IS NULL OR "tokenUri" IS NULL OR "tokenUri" = '') AS no_document
FROM "Agent" WHERE "chainId" = 143;
-- section 3, the clusters
SELECT uri, "memberCount", "distinctOwners", "memberCount" - "distinctOwners" AS extra_per_wallet
FROM "AgentRecord" WHERE "chainId" = 143 ORDER BY "memberCount" DESC LIMIT 5;
-- section 6, the hosts plus the http denominator
SELECT split_part(split_part(uri, '://', 2), '/', 1) AS host,
       count(*) AS records, sum("memberCount") AS agents
FROM "AgentRecord" WHERE "chainId" = 143 AND uri LIKE 'http%'
GROUP BY 1 ORDER BY records DESC LIMIT 10;
SELECT count(*) FROM "AgentRecord" WHERE "chainId" = 143 AND uri LIKE 'http%';
-- section 7, the feedback corpus
SELECT count(*)                                              AS with_uri,
       count(*) FILTER (WHERE "feedbackUri" LIKE 'data:%')   AS data_uris,
       count(*) FILTER (WHERE "feedbackUri" LIKE 'http%')    AS http_uris,
       count(*) FILTER (WHERE "feedbackUri" LIKE 'ipfs://%') AS ipfs_uris
FROM "Feedback" WHERE "chainId" = 143 AND "feedbackUri" <> '';
-- section 7, the trap. Run this, then the query above, then compare the two data: shares
SELECT count(*) FILTER (WHERE "feedbackUri" LIKE 'data:%')     AS data_uris,
       count(*) FILTER (WHERE "feedbackUri" NOT LIKE 'data:%') AS everything_else
FROM (SELECT "feedbackUri" FROM "Feedback" WHERE "chainId" = 143 AND "feedbackUri" <> ''
      ORDER BY "blockNumber" DESC LIMIT 100) head;
-- section 8, the shapes beside the outcomes
SELECT coalesce(mapping, '(no mapping reached)') AS mapping, outcome, count(*) AS count
FROM fovea.verdict_latest GROUP BY 1, 2 ORDER BY count DESC;
```

## What this census does not claim

| not claimed | why |
|---|---|
| that any operator behaved badly | an expired preview deployment is an accident |
| that the <!-- n:oneDocAgents -->8,093<!-- /n --> agents are fake | real registrations by <!-- n:oneDocWallets -->7,962<!-- /n --> real wallets. Only the document they name is gone |
| that a `gone` document means a dead agent | the agent may work fine. Its self-description is what is missing |
| that the 545 monadmogs agents are fraudulent | their host is a suspended Vercel account, not a payment surface. The document is gone, nothing more |
| that the 36 `unknown` agents failed anything | we failed to find out. A rate limit, a timeout, a server error or our own size cap, never their uptime |
| that these counts are permanent | each is a measurement at a time |

Each state was measured once per document. A document restored tomorrow stays `gone` in this text
until somebody re-runs the probe, at which point the store holds both answers with both timestamps.
