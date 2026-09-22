# 2. Hash integrity is not claim truth

Every tool that reads an ERC-8004 evidence document checks that the bytes it served match the hash
committed on chain. All 85 payment claims on Monad pass that check. 73 of them cite a transaction
that is not on the chain the document names.

Those two sentences do not contradict each other. They measure different things. This document is
the argument for why the second measurement is the one worth having, written for a reader who does
not believe it yet.

---

## 1. The check that already exists

Monad's ERC-8004 Reputation Registry is `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` on chain 143.
It emits `NewFeedback`. Two of its non-indexed fields matter here. `feedbackURI` says where the
evidence document lives. `feedbackHash` is keccak256 over the bytes the author committed to.

The integrity check is: fetch the URI, hash the response, compare.

```bash
curl -sS '<the document url>' | cast keccak    # compare against feedbackHash from the event
```

`verifier/src/ladder/intact.ts` is that check in code. It hashes the raw response byte for byte
exactly as it arrived. It takes a `Uint8Array` with no string overload on purpose. Hashing a
re-encoded copy would be stable against whitespace, which sounds like an improvement until you
notice it proves a different thing: the author committed to bytes, not to meaning.

This check is worth having. It catches a host that quietly edits a document after the fact. It tells
you that what you are reading is what the author put their name to. It tells you nothing about
whether what the author wrote is true.

Every claim here that reaches a `true` or a `false` verdict passed it first. That is structural
rather than lucky: the ladder in `verifier/src/ladder/verdict.ts` stops at `unknown` when the bytes
do not match, so a verdict about a payment can only exist for a document whose bytes are intact.
Read it back out of the API on any row:

```bash
curl -sS 'https://kanmani.xyz/api/claims?outcome=false&limit=1' | jq '.data.items[0].hashMatches'
# true
```

## 2. The check nobody was making

Here is the shape that carries a payment claim on Monad, induced from the live corpus on 2026-09-19
and published in `verifier/src/ladder/parse.ts` as `execution-market.v1`:

```json
{ "network": "monad",
  "proof_of_payment": { "network": "monad", "payment_tx": "0x...", "status": "anchored" },
  "rating": { "target_address": "0x...", "score": 70 } }
```

Read what that asserts. A payment happened. It happened on a chain called `monad`. Here is the
transaction hash for it. The word `anchored` is in there too.

The hash check confirms those are the author's own words, unaltered since they were committed. It
does not go and look. Looking is one RPC call:

```bash
cast receipt <txHash> --rpc-url https://rpc.monad.xyz
```

For 73 of the 85 payment claims on Monad, that call comes back with nothing. No receipt. The
document is hash-perfect and the event it describes is not on the chain it names.

That is the whole gap. Integrity answers "are these the committed bytes". Nothing in the standard,
and nothing we found built on top of it, answers "did the thing described in the bytes happen".
`verifier/src/ladder/locate.ts` is the rung that asks the second question. It fetches the receipt on
the chain the document names, records the chain head at the moment of the read then returns one of
four outcomes with no shortcut between them.

## 3. The measurement

The denominator matters more than the headline. Retina indexes 10,252 agents on Monad mainnet,
matching the registry's own counter slot exactly. `totalSupply()` reverts on the Identity Registry,
so the slot is the only source of population truth:

```bash
cast storage 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
  0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00 \
  --rpc-url https://rpc.monad.xyz    # 10252
```

Those agents carry 9,188 feedbacks. Of those, 1,192 carry a URI. The other 7,996 point at nothing,
so there is nothing to fetch and nothing to check. The `/` page prints the SQL behind every one of
these numbers. It is the same query the site runs:

```sql
SELECT
  (SELECT count(*) FROM "Agent"    WHERE "chainId" = $1) AS agents_indexed,
  (SELECT count(*) FROM "Feedback" WHERE "chainId" = $1) AS feedbacks,
  (SELECT count(*) FROM "Feedback" WHERE "chainId" = $1 AND "feedbackUri" <> '') AS feedbacks_with_uri
```

Those 1,192 documents were each walked down the ladder. Four outcomes, no fifth:

| outcome | count | meaning |
|---|---|---|
| `noClaim` | 1,095 | read fine, asserts no payment, so there is nothing to be right or wrong about |
| `false` | 73 | we read the chain the document names and the transaction is not on it |
| `true` | 12 | the cited transaction is on the chain the document names, at a block we record |
| `unknown` | 12 | we could not look or could not read what we fetched |

Each row is one command, with the outcome swapped:

```bash
curl -sS 'https://kanmani.xyz/api/claims?outcome=false&limit=1' | jq '.data.total'   # 73
# outcome=true -> 12, outcome=noClaim -> 1095, outcome=unknown -> 12
```

**The denominator for the headline is 85, not 9,188 and not 1,192.** 85 is `true` plus `false`: the
documents that assert a payment and that we read all the way to a chain. 73 of 85 is 86%. 73 of
9,188 would be under 1%. Quoting it that way would be arithmetic dressed up as modesty. Neither
framing is honest on its own, which is why the 85 and the 1,192 sit next to each other on the front
page.

1,095 documents assert no payment because most ERC-8004 feedback on Monad is not about payment.
1,026 of them are a chess ELO record. 66 are `data:text/plain` prose somebody typed. 3 are a
conversation score. None contains a transaction hash, a network name or any payment field. They are
not a coverage gap. Counting them as one would inflate our own failure number with documents working
exactly as intended. So `noClaim` is a first-class outcome in the type rather than a bucket for
leftovers:

```ts
/** The document asserts no payment, so there is nothing to be right or wrong about. */
| "noClaim"
```

1,095 of the 1,192 are `data:` URIs, decoded in process with no network call at all. Worth knowing
before anyone repeats this measurement: sampling the corpus recent-first gives the opposite
impression, because the head of the list is mostly https.

## 4. What we got wrong

This project was designed around a failure mode that is not the one happening. The design expected
documents citing one chain while the payment sat on another. That is why `parse.ts` prefers the
inner `proof_of_payment.network` over the outer `network` when both exist and why `locate.ts`
resolves a declared chain against a covered list of seven rather than assuming Monad. A document is
free to be about one chain while citing a transaction on another. Preferring the outer field would
quietly rewrite what the author said.

Then we ran it. Every single one of the 85 payment claims names `monad`. Not one names anything
else.

```sql
SELECT coalesce(declared_network, '(none stated)') AS network,
       count(*) FILTER (WHERE outcome = 'true')  AS resolve,
       count(*) FILTER (WHERE outcome = 'false') AS do_not_resolve
FROM fovea.verdict_latest
WHERE outcome IN ('true','false')
GROUP BY 1
ORDER BY 2 + 3 DESC
```

One row comes back. `monad`, 12 found, 73 not found.

The cross-chain machinery is real, tested and currently doing nothing. The failure turned out
simpler than the one designed for: these documents name the right chain and cite a transaction that
is not on it. The site says the simpler thing, because the simpler thing is what is true. The
multi-chain resolver stays in, since it costs nothing to keep and the next corpus may need it, but
it is not carrying the finding.

Stating this as a correction rather than quietly rewriting the pitch is deliberate. A build that
only ever reports the hypothesis it started with has not measured anything.

## 5. Why `unknown` is never `false`

This is the part that is not a design preference. These verdicts have real operators' names
attached. Every row names an agent, a wallet and a document somebody published. A verdict of `false`
on that row is a public statement that the transaction they cited is not on the chain. It had better
be a measurement.

A timeout is not a measurement. Neither is a rate limit, a DNS failure, a chain we do not cover, an
RPC endpoint with no key configured or a document larger than our 65,536 byte cap. Every one of
those is evidence that **we** failed to look. None is evidence that a payment did not happen.
`locate.ts` says so in the file header then never takes the shortcut:

> A timeout, a rate limit, a chain we do not cover: none of those are evidence that a transaction
> did not happen. They are evidence that we did not look successfully. Collapsing the two would let
> an outage manufacture accusations against people, at scale, automatically.

The specific trap is `getTransactionReceipt`. Providers signal "no such transaction" by throwing as
often as by returning null. The two are indistinguishable from the shape of the error alone. So
anything thrown is `unknown` and only a clean `null` from a successful read is `false`. The match is
on the outcome of the call rather than on a substring of an error message, because a provider is
free to reword its messages. Getting this backwards turns a bad afternoon at one host into a wave of
accusations against people who did nothing.

This showed up live rather than in a test. One endpoint returned HTTP 525 mid-run and the verdict
came back `unknown`, carrying the reason string the code builds for exactly that case:

```
evidence document could not be read: HTTP 525
```

Collapsed the tempting way, that run would have published "this transaction does not exist" on the
strength of somebody else's TLS outage, automatically, with no human in the loop. Nothing would have
looked wrong. The number would just have been bigger, which is precisely why this rule lives in the
type system rather than in somebody's good intentions.

Two consequences follow. Both are visible in the shipped code. `unknown` is never rendered as `0`,
because a zero looks like a measurement. And only `true` or `false` ever reach the Validation
Registry on chain, because `getSummary` averages the `uint8` response, so a row for something we
could not check would put a number where there is no measurement.

## 6. What this does not claim

Nobody here is accused of lying. No verdict on this site says or implies that.

The most likely explanation for a claim that does not resolve is boring. A preview deployment
expired. A template wrote the same URL into thousands of registrations. A testnet hash was pasted
into a mainnet document. A pipeline wrote the evidence before the settlement landed and never went
back. We did not investigate intent for any of the 73. We are not in a position to.

That restraint is enforced by what the code is allowed to write. `verdict.ts` opens with the rule:

> **Never state intent.** "The cited transaction was not found on the network this document names"
> is the sentence. "This agent is lying" is not and is not ours to say.

Here are the reason strings, verbatim from the source. Nothing else ever reaches a page:

| situation | the string the code produces |
|---|---|
| found | `cited transaction is on Monad at block <n>` |
| not found | `no transaction with this hash on Monad at block <head>` |
| host would not answer | `evidence document could not be read: HTTP 429` |
| provider threw | `Monad receipt read failed: <message>` |
| chain not covered | `network "<name>" is not in the covered list` |
| no endpoint for a covered chain | `no RPC configured for <chain>` |
| hash is not 32 bytes | `cited transaction is not a 32 byte hash: <first 21 chars>...` |
| no payment asserted | `game rating, no payment asserted, so there is no payment claim to check` |
| bytes moved | `the bytes served now do not match the hash committed on chain, so this document cannot be checked against what its author committed to` |

Every one describes what was observed. None describes what anyone meant. The difference between an
observation and an accusation is the reason this measurement can be published at all.

The same restraint covers the 12 unknowns. 10 serve bytes that no longer match their own on-chain
hash, which happens when an author edits a document for perfectly good reasons. 2 would not answer
at all, HTTP 429. We do not know whether any of those 12 assert a payment, because the ladder
stopped before it found out, so none of them is counted in the 85.

A verdict is a measurement at a time, never a permanent label. Every row carries `checkedAt` plus
the chain head it was checked against. The store is append only, so a re-check writes a new row
rather than overwriting the old one. A claim that does not resolve today can resolve tomorrow. The
record will show both readings.

## 7. Why this matters to somebody spending money

An agent looking for another agent to pay has a registry with 10,252 entries and no way to tell a
working counterparty from a registration that has been dead for months. Measure it the cheapest
possible way. All 2,012 distinct registration documents, probed once each: 8,640 agents point at a
document whose host answers and says it is not there. That is 84.3% of the registry. 8,093 of those
agents, across 7,962 distinct wallets, point at one single URL:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://eve-8004.vercel.app/metadata/b.json
# 404
```

The body is `DEPLOYMENT_NOT_FOUND`. It is an expired preview deployment. It is nobody's misconduct
and it is not fraud. It is also fatal to anyone trying to use this registry to find somebody to pay,
because four out of five entries resolve to nothing at all while the registry itself reports no
difference between those and the live ones.

Integrity checking cannot help here. A 404 has no bytes to hash. The registration is still a valid
on-chain record with a valid owner and a valid URI. It will stay that way forever. The only question
that separates a usable counterparty from a dead one is whether anything it points at still answers,
then whether what it says is true.

That is the product. Not a reputation score. Not a trust rating. A filter that answers, for any
agent in the registry, whether its evidence still resolves and whether the payments it claims are on
the chain it names. When we registered ourselves as agent 10252 we wrote our own record into
`tokenURI` as a 554 byte `data:` URI rather than hosting it at a URL, because we had just finished
measuring what happens to hosted records. A `data:` URI cannot 404.

---

## Reproducing all of it

```bash
cd verifier && npm test                                         # 94 pass
node --experimental-strip-types verifier/src/cli/locate.ts monad <txHash>
```

`locate.ts` prints the verdict then the coverage table under it, because a "not found" only means
something next to the list of chains it was tested against. Every page on the site prints the SQL
behind its own numbers. If a number on a page disagrees with the command next to it, the page is
wrong.
