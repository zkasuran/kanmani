# 04. The verification ladder

A feedback row on ERC-8004 carries a URI and a hash. That is all. Nothing about it says the document
behind the URI is reachable, that the bytes are the ones the author committed to, that anyone can
read the shape or that the payment it describes ever happened.

The ladder is how a claim is walked from "there is a URI" to a verdict. Five rungs, each answering a
question the one before it cannot. A claim stops at the first rung it fails and the verdict records
which rung that was. **A rung never exceeds its evidence.** If the document could not be fetched,
nothing downstream of `resolvable` gets an opinion about it.

The code is `verifier/src/ladder/`, seven source files: five that back the output rungs
(`resolve.ts`, `intact.ts`, `parse.ts`, `locate.ts`, `verdict.ts`) plus the two check modules
`payable.ts` and `settled.ts` that are not rungs, with `verifier/src/chains.ts` for the chain list.
Every rung below names the file that implements it.

---

## The rungs as implemented

| rung | question | decided by | stops here when |
|---|---|---|---|
| `declared` | is there a URI at all? | `resolve.ts` | the URI cannot be turned into bytes |
| `resolvable` | are these the committed bytes? | `intact.ts` | the hash does not match or cannot be compared |
| `intact` | can anyone read the shape? | `parse.ts` | no published mapping matches |
| `parsed` | did the cited transaction happen? | `settled.ts` / `locate.ts` | the document claims nothing or the chain says no or we could not look |
| `true` | | | nothing stops here, this is the end |

The `rung` field on a verdict records **the last rung cleared**, not the one being attempted. A
verdict at rung `declared` means the URI existed and the fetch failed. A verdict at rung `parsed`
means the document was read successfully, which covers three quite different endings: it claimed
nothing, it claimed something that is not on the chain or it claimed something we could not check.

### `declared`

**Question:** is there a URI and does it turn into bytes?

`resolveEvidence()` in `verifier/src/ladder/resolve.ts` dispatches on scheme. An empty URI, an
unsupported scheme, a failed fetch, a body over the cap: all of them end here.

The outcome is always `unknown`, never `false`. A document we could not read is not evidence that
the payment did not happen. It is evidence that we did not look.

```
reason: evidence document could not be read: <what resolve said>
```

Two claims in the live corpus sit here, both `HTTP 429`. The host was rate limiting us. That is our
problem rather than theirs and the verdict says so.

### `resolvable`

**Question:** are the bytes being served the bytes the author committed to on chain?

`intactCheck()` in `verifier/src/ladder/intact.ts` recomputes `keccak256` over the raw response and
compares it to `feedbackHash` from the `NewFeedback` event. Three answers: `true`, `false`,
`"unknown"`.

A mismatch stops the ladder. So does an unusable commitment. Both produce `unknown`, for different
reasons that the `reason` string distinguishes.

### `intact`

**Question:** does any published mapping read this document shape?

`parseDocument()` in `verifier/src/ladder/parse.ts` decodes UTF-8, parses JSON, then runs the atlas.
A shape nothing matches ends here as `unknown`, with the document's own keys attached so the gap can
be closed rather than guessed at.

```
reason: no published mapping reads this document shape: <why>
```

Three claims in the live corpus sit here today, each an intact document whose shape no published
mapping reads yet. The count is published whether it is zero or three, because a coverage gap that
only shows up once it is non-zero is not a measurement.

### `parsed`

**Question:** is the cited transaction on the chain the document names?

`locate()` in `verifier/src/ladder/locate.ts` resolves the declared network to a chain, gets a reader
for it, reads the head, then asks for the receipt. Three endings live at this rung:

- the document asserts no payment, so there is nothing to check (`noClaim`)
- the chain was read successfully and the transaction is not there (`false`)
- we could not look (`unknown`)

### `true`

**Question:** nothing. This rung is the end of the ladder.

Reached when the payment is confirmed on chain. When a settlement reader is supplied and the claim
names a recipient, `settledCheck` reads the receipt and confirms the transfer reached that
recipient. Otherwise `locate` confirms a successful transaction with the cited hash exists. The
verdict records the chain, its EIP-155 id, the block the transaction landed in and the chain head at
the moment of the check.

```
reason: a successful transaction with this hash is on Monad at block 97452789
```

### Why the ladder stops at `true`

The original design had two more rungs after `true`:

- **`payable`**, could a buyer pay this agent right now.
- **`settled`**, did the value move to the claimed recipient and stay moved.

Neither is a value in the verdict's rung enum. `Rung` in `verifier/src/ladder/verdict.ts` is five
strings, `declared | resolvable | intact | parsed | true`, so a verdict never reports a sixth or a
seventh rung and the live `/method` shows five. Prove the enum:

```bash
grep -n "type Rung" verifier/src/ladder/verdict.ts
```

Both checks are built, as modules rather than rungs. `settledCheck` in
`verifier/src/ladder/settled.ts` is folded into `judge()`: when a settlement reader is supplied and
the claim names a recipient, it reads the receipt and confirms the transfer reached that recipient
before the outcome is allowed to be `true`, then records the result at the existing `parsed` or
`true` rung, never a new one. `payableCheck` in `verifier/src/ladder/payable.ts` runs as a
standalone probe behind `src/cli/payable.ts`. Both carry their own tests. Why they stayed checks
rather than rungs is in [14-GAPS.md](14-GAPS.md).

---

## The four outcomes

`true`, `false`, `noClaim`, `unknown`. **They are not a scale.** There is no ordering in which
`unknown` sits between `true` and `false` and no reading in which `noClaim` is a weak `true`. They
are four different answers to four different situations and collapsing any pair of them produces a
specific, nameable harm.

| outcome | means | the harm in collapsing it |
|---|---|---|
| `true` | the described payment is on the chain the document names | none, this is the only positive |
| `false` | we read that chain successfully and it is not there | |
| `noClaim` | the document asserts no payment, so there is nothing to be right or wrong about | folded into `false`, it accuses <!-- n:noClaim -->1,095<!-- /n --> documents of a claim they never made |
| `unknown` | we could not look or could not read | folded into `false`, an outage manufactures accusations at scale, automatically |

### The exact reason strings

These are produced by `judge()` in `verifier/src/ladder/verdict.ts`. Read them out of the live corpus
with:

```bash
psql "$FOVEA_DATABASE_URL" -c \
  "select outcome,
          regexp_replace(regexp_replace(reason,'0x[0-9a-f]{6,}','<addr>'),'[0-9]+','<n>') as shape,
          count(*)
     from fovea.verdict_latest group by 1,2 order by 3 desc;"
```

| outcome | reason | count |
|---|---|---|
| `noClaim` | `game rating, no payment asserted, so there is no payment claim to check` | 1,026 |
| `false` | `no transaction with this hash on Monad at block <n>` | 123 |
| `noClaim` | `plain text the author wrote as text/plain, no payment asserted, so there is no payment claim to check` | 66 |
| `true` | `a successful transaction with this hash is on Monad at block <n>` | 34 |
| `true` | `<n> atomic units of <addr> reached <addr> on Monad at block <n>, <n> blocks deep` | 25 |
| `unknown` | `the bytes served now do not match the hash committed on chain, so this document cannot be checked against what its author committed to` | 10 |
| `unknown` | `no published mapping reads this document shape: no mapping matches this shape` | 3 |
| `noClaim` | `conversation rating, no payment asserted, so there is no payment claim to check` | 3 |
| `unknown` | `evidence document could not be read: HTTP <n>` | 2 |

Nine distinct strings over <!-- n:withPointer -->1,292<!-- /n --> claims. Two of them are `true`: one from `locate` finding the cited
transaction, one from `settledCheck` watching the transfer reach the named recipient. Every one of them describes what was observed. None of them
describes what anyone intended. That is enforced by a test, not by a review habit:

```ts
const banned = /\b(lying|lied|fraud|fake|scam|dishonest|malicious)\b/i;
assert.doesNotMatch(v.reason, banned, `reason states intent: ${v.reason}`);
```

Somebody's reputation is attached to these strings. The difference between an observation and an
accusation is the whole reason this build claims to be worth reading.

---

## Resolve, per scheme

Three schemes appear in the corpus. They have nothing in common but the name "URI".

| scheme | count | how it resolves |
|---|---|---|
| `data:` | 1,095 | decoded in process, no network at all |
| `http(s):` | 195 | fetched through the SSRF guard |
| `ipfs://` | 2 | through a gateway, so still a guarded fetch |

**`data:`** is RFC 2397, `data:[<mediatype>][;base64],<data>`. Both encodings appear. The size cap is
checked against the *encoded* length before decoding, because base64 inflates by 4/3, so anything
that would decode under the cap is under the encoded bound too. That refuses a hostile payload
without first allocating it.

One trap here cost a test to find. `Buffer.from(payload, "base64")` is lenient: it silently drops
characters it cannot read and returns something shorter, so a corrupt payload decodes into a
plausible partial document. The fix is a round trip, re-encode the decoded bytes and compare.

**`ipfs://`** goes through a gateway, so it is a guarded fetch with a rewritten URL. The CID is
validated by segment. `.` and `..` are refused by name rather than by hoping a character class
excludes them. The first version allowed `.` in the CID character class, because CIDs sit next to
filenames in people's heads and `ipfs://../../etc/passwd` sailed straight through into a gateway
URL.

**`http(s):`** goes through `verifier/src/net/guard.ts`. The guard resolves the hostname once,
screens every address the resolver returned, then pins the survivor into the socket, so the address
that was checked is the address that gets connected to. Redirects are followed by hand and
re-screened every hop. The size cap is enforced on the bytes as they arrive, never on
`Content-Length`.

**The guard is the most security-critical file in this build. It is also the one that almost never
runs.** 1,095 of 1,292 claims are `data:` URIs, so 85% of this corpus touches no network at all. That
is stated plainly rather than left for a reader to work out, because a reader who assumes the guard
is on the hot path will mis-weigh both the risk and the performance story. There is a test that
proves the `data:` path cannot reach the network, by handing it a resolver that throws if called.

The risk on the `data:` path is different in kind. A caller controls the bytes directly, so the cap
is about memory rather than about where a request goes.

---

## Intact and why a mismatch stops the ladder

The rule is short. **If the bytes served are not the bytes committed, any claim read out of them is a
claim about a different document than the one on chain.** Parsing on would attribute words to an
author who never committed them.

So `judge()` stops:

```ts
if (i.intact === false) {
  // Stop here deliberately. The bytes served are not the bytes committed, so any claim read out
  // of them is a claim about a different document than the one on chain.
  return { ...base, rung: "resolvable", outcome: "unknown", hashMatches: false, ... };
}
```

The verdict carries `hashMatches: false` and the computed hash, so a reader can recompute it. It
carries no `declaredTx` and no `declaredNetwork`, because those were never read. A test asserts that
absence rather than the presence of a message.

**What gets hashed is the raw response, byte for byte, exactly as it arrived.** Never a re-encoded
copy. `intactCheck` takes a `Uint8Array` and there is no string overload, on purpose. Hashing a
`JSON.parse` then re-stringify would be a different claim: it would prove the *meaning* survived
where the author committed to *bytes*. It would fail against honest documents whose spacing differs
and, worse, it could be massaged until it passed.

Two cases are `unknown` rather than `false`, because there is nothing to compare against:

- the committed hash is not a bytes32. Reporting that as a mismatch would blame a document for a gap
  in the record.
- the document is empty. `keccak256` of empty input is a real, well-known value, so without this
  branch an empty body would compare against it and read as a considered answer.

### The ten on Monad

Ten documents are in exactly this state right now. All ten are on one host:

```bash
psql "$FOVEA_DATABASE_URL" -c \
  "select split_part(split_part(feedback_uri,'/',3),':',1) as host, count(*)
     from fovea.verdict_latest where outcome='unknown' and rung='resolvable' group by 1;"
```

```
      host      | count
----------------+-------
 grokandmon.com |    10
```

The URL is stable. The bytes are not. Each commitment was made at a different time against different
content, the endpoint serves one thing today, so **every historical commitment to that endpoint is
now unverifiable.** Not wrong. Unverifiable, which is a different and more awkward state.

**This is an argument about how evidence should be stored, not about anyone's conduct.** Editing your
own agent card is normal maintenance. Publishing it at a mutable URL is the default thing to do,
because that is what a web server is. The combination is what breaks: a hash commitment plus a
mutable endpoint means the commitment silently expires the first time the content changes and
nobody gets told.

The fix is not a rule about behaviour. It is content addressing or writing the record into
`tokenURI` as a `data:` URI so the bytes and the commitment cannot drift apart. Our own registration
does the second one: 2,017 bytes inline, no host to go stale.

There is a side effect worth naming. `agent-card.v1` is a published mapping in the atlas and it has
**zero rows** in the corpus, because the only ten documents it was written from now stop one rung
earlier. The mapping is real, it is tested and this corpus never exercises it.

---

## Parse and the atlas

The atlas is six published mappings: five hand-written and one proposed by Qwen 3.8 Max, then reviewed. Each carries a name, the date it was added from real documents (the code field is named `induced`) and a note. A test enforces the date and the note, because a mapping can move a verdict.

| mapping | induced | reads | rows in corpus |
|---|---|---|---|
| `execution-market.v1` | 2026-09-19 | `proof_of_payment.payment_tx` | 110 `false`, 49 `true` |
| `execution-market-transactions.v1` | 2026-09-19 | older shape, `transactions.payment_tx` | 13 `false`, 10 `true` |
| `elo-record.v1` | 2026-09-19 | a game rating, no payment | 1,026 `noClaim` |
| `conversation-score.v1` | 2026-09-19 | a conversation rating, no payment | 3 `noClaim` |
| `agent-card.v1` | 2026-09-19 | an ERC-8004 capability card, no payment | 0 |
| `plain-text-comment.v1` | 2026-09-19 | prose, no payment | 66 `noClaim` |

```bash
psql "$FOVEA_DATABASE_URL" -c \
  "select mapping, outcome, count(*) from fovea.verdict_latest
     group by mapping, outcome order by 3 desc;"
```

**These mappings are written against real documents, reviewed by a person, then published.** A reader re-running the pipeline
executes them deterministically, with no model anywhere in the loop and gets the same numbers. A
model's only job is to propose a mapping for a shape nobody has seen. The chain decides every
verdict, so a wrong proposal costs a retry and can never produce a wrong `true`.

### Two mappings matching one document is refused

Not resolved by declaration order. Refused.

```ts
if (hits.length > 1) {
  return { kind: "unparsed", reason: `ambiguous, ${hits.map((m) => m.name).join(" and ")} both match`, ... };
}
```

An ambiguous atlas would make the verdict depend on array order, which is invisible to a reader and
changes silently the next time someone appends a mapping. Picking the first hit would be a verdict
produced by a source-code detail nobody published. A test runs the five real corpus shapes past every
mapping and asserts exactly one hit each.

### An unrecognised shape comes back with its keys

```ts
return { kind: "unparsed", reason: "no mapping matches this shape", keys: Object.keys(doc).sort() };
```

The keys are the whole point. An unparsed document is a gap in **our** coverage and the keys are
what closes it. The older `execution-market-transactions.v1` mapping exists because running the atlas
over the live corpus left 23 documents unplaced and the keys said where to look.

### `noClaim` is a result, not a coverage gap

<!-- n:noClaim -->1,095<!-- /n --> of <!-- n:withPointer -->1,292<!-- /n --> documents assert no payment. **Most ERC-8004 feedback on Monad is not a payment claim
at all.** A document that never asserted a payment cannot be wrong about one, so counting it as
unparsed would inflate our own published gap number with documents that are perfectly well formed.

### The media-type rule

66 documents on Monad are `data:text/plain,Excellent%20service...`. They fail `JSON.parse`. Whether
that is a gap in our atlas or a perfectly good document depends entirely on what the author said they
were writing.

- declared `text/*` and not JSON: `noClaim`, mapped to `plain-text-comment.v1`. Prose asserts no
  payment. It is not broken.
- declared `application/json` and not JSON: `unparsed`. There the author and the bytes genuinely
  disagree and that disagreement is worth reporting.

Same bytes, different declaration, different answer. Both answers are honest. Two tests pin exactly
that, running the identical input through both declarations.

RFC 2397 says an omitted media type means `text/plain`, so `data:,Excellent service` is prose by
specification rather than by our guess. `dataUriMediaType()` applies that default.
`parseDocument()` itself stays strict: a caller that passes no media type gets `unparsed` rather than
a silently generous `noClaim`.

---

## Locate, the rung that does not exist elsewhere

Every other rung asks whether the paperwork is well formed. This one asks whether the event described
in the paperwork occurred.

`locate()` takes whatever the document called the network, whatever it cited as a transaction hash,
and a function that supplies a reader per chain. It resolves the network, gets the reader, reads the
head, then asks for the receipt. `ChainReader` is two methods, so the decision logic is testable with
no network at all.

### The chain coverage table

`verifier/src/chains.ts` is a published artifact rather than a config detail.

| chain | EIP-155 id | aliases read |
|---|---|---|
| Monad | 143 | `monad`, `monad mainnet`, `monad-mainnet`, `monadmainnet` |
| Ethereum | 1 | `ethereum`, `eth`, `mainnet`, `ethereum mainnet`, `homestead`, `l1` |
| OP Mainnet | 10 | `optimism`, `op`, `op mainnet`, `optimism mainnet`, `op-mainnet` |
| Base | 8453 | `base`, `base mainnet`, `base-mainnet` |
| Arbitrum One | 42161 | `arbitrum`, `arbitrum one`, `arb`, `arbitrum-one`, `arbone` |
| Polygon | 137 | `polygon`, `matic`, `polygon mainnet`, `polygon-pos` |
| BNB Smart Chain | 56 | `bsc`, `bnb`, `binance`, `bnb smart chain`, `binance smart chain`, `bnb chain` |

Three naming shapes are handled, because all three appear in the wild: a bare name (`"monad"`), a
CAIP-2 identifier (`"eip155:143"`) and a raw chain id as a number or a numeric string. Authors do not
write chain ids, they type a word, so the alias list is the part that decides whether a claim is even
readable.

**There is deliberately no fuzzy matching.** Guessing that `ethereum-goerli` means Ethereum would
turn an unknown into a confident wrong answer and a wrong `false` is the most expensive output this
system can produce.

### A provider failure is `unknown`, never `false`

This is the single most important property in the file. A timeout, a rate limit, a chain with no
endpoint configured: none of those are evidence that a transaction did not happen. They are evidence
that we did not look successfully.

`LocateOutcome` has four cases and the code never takes a shortcut between them. Six distinct
situations all return `unknown`:

| situation | reason |
|---|---|
| the cited hash is not 32 bytes | `cited transaction is not a 32 byte hash: <short>` |
| the network is not in the covered list | `network "<x>" is not in the covered list` |
| the chain is covered but has no endpoint | `no RPC configured for <chain>` |
| the head read threw | `<chain> head read failed: <msg>` |
| the receipt read threw | `<chain> receipt read failed: <msg>` |
| the document names no network | `document names no network` |

Only one situation returns `false`: the receipt read returned `null` after a successful head read.
That verdict carries `checkedAtBlock`, because a verdict is a measurement at a time.

### The match is on the error TYPE, not a message substring

Providers signal "no such transaction" by throwing about as often as by returning `null` and the two
are indistinguishable from the shape of a thrown error alone. So the translation lives in one file,
`verifier/src/rpc.ts` and it matches on the error name:

```ts
const name = (e as { name?: string })?.name ?? "";
if (name === "TransactionReceiptNotFoundError") return null;
throw e;
```

Everything else is rethrown for `locate` to record as `unknown`. Matching on a substring of the
message would work today and break silently later, because **a provider is free to reword a message
and nothing about that rewording is a breaking change to them.** viem's current text is
`Transaction receipt with hash "0x..." could not be found. The Transaction may not be processed on a
block yet.` A substring check against `could not be found` passes against that string right now. It
would also match any unrelated error whose message happens to contain the same five words, which
turns a failure into an accusation.

A chain with no endpoint returns `null` from `readerFor` rather than a client pointed at a default. A
silent fallback would make an unconfigured chain look checked, which is the difference between "not
found" and "not looked for".

---

## Why coverage is published

**A `false` means nothing without the list of chains it was looked for on.** "Not found" is only a
fact relative to where you searched. An unpublished search list turns a headline number into a claim
about our own coverage, dressed up as a claim about somebody else's document.

So `coverageTable()` exists, the `locate` CLI prints it under every verdict and a test asserts that
an unconfigured chain shows as a hole rather than being hidden from the table.

Two consequences follow and both are load-bearing:

1. **A network outside the list is `unknown`, never `false`.** We did not look there, so we cannot
   say.
2. **Widening the list is a published change.** Adding a chain can turn a `false` into a `true`. That
   is a correction with a before and an after, not a number that quietly improves. The verdict store
   is append only for the same reason: a re-check writes a new row, so a fixed document shows as
   `false -> true` with both timestamps.

On the live corpus, all seven chains are configured. Every one of the 182 payment claims names
`monad`, so the other six carried no traffic in this sweep. They are in the table anyway, because the
table is what a `false` is relative to.

---

## One worked example, end to end

Claim id `143_10153_0x103040545AC5031A11E8C03dd11324C7333a13C7_1`. The id is
`chainId_agentId_clientAddress_feedbackIndex`.

**Step 0, what is on chain.** The `NewFeedback` event, as indexed by Retina:

```bash
psql "$FOVEA_DATABASE_URL" -x -c \
  "select \"feedbackUri\", \"feedbackHash\", \"blockNumber\" from public.\"Feedback\"
     where id = '143_10153_0x103040545AC5031A11E8C03dd11324C7333a13C7_1';"
```

```
feedbackUri  | https://execution.market/feedback/4dd25f98-8074-45dd-92e4-f20c5dbe3125/worker_rating_1787475212.json
feedbackHash | 0xc6634fe95c40e1f9b3ac48073bbdcde8a11551caf22f3c76720cd01204e56b26
blockNumber  | 98436195
```

**Step 1, `declared` to `resolvable`.** The URI is `https`, so it goes through the guard. It returns
794 bytes with status 200:

```json
{"comment":"Task completed and paid: Compro: el caso BULL de funding BTC positivo en ca",
 "created_at":"2026-08-23T08:53:32.388194+00:00","feedback_type":"worker_rating","network":"monad",
 "proof_of_payment":{"network":"monad",
   "payment_tx":"0x6e8bceb1ba0b212658e90dda06706c1c1fbcaae999868972ddee1b0e0e30f789",
   "status":"anchored"},
 "rating":{"max_score":100,"rater_id":"2106","rater_type":"agent","score":84,
   "target_address":"0xfa349fa115142cb1029648ae1fe61436ef9e3164","target_agent_id":10153,
   "target_type":"worker"},
 "task":{"bounty_usd":0.0,"category":"knowledge_access","id":"4dd25f98-...","title":""},
 "transactions":{"payment_tx":"0x6e8bceb1...","reputation_tx":""},
 "type":"execution_market_feedback","version":"1.0"}
```

**Step 2, `resolvable` to `intact`.** `keccak256` over those exact 794 bytes:

```
{"intact":true,"computed":"0xc6634fe95c40e1f9b3ac48073bbdcde8a11551caf22f3c76720cd01204e56b26"}
```

Identical to `feedbackHash`. These are the bytes the author committed to.

**Step 3, `intact` to `parsed`.** The atlas runs. This document carries *both*
`proof_of_payment` and `transactions`, so two mappings could plausibly fire. They do not, because
`execution-market-transactions.v1` matches only when `proof_of_payment` is absent. Exactly one hit:

```json
{"kind": "claim",
 "mapping": "execution-market.v1",
 "claim": {"network": "monad",
           "txHash": "0x6e8bceb1ba0b212658e90dda06706c1c1fbcaae999868972ddee1b0e0e30f789",
           "recipient": "0xfa349fa115142cb1029648ae1fe61436ef9e3164"}}
```

**Step 4, `parsed` to the verdict.** Read the cited transaction on the chain the document names:

```bash
cd verifier
set -a && . ../.env.local && set +a
node --experimental-strip-types src/cli/locate.ts \
  monad 0x6e8bceb1ba0b212658e90dda06706c1c1fbcaae999868972ddee1b0e0e30f789
```

```
declared network : monad -> Monad
declared tx      : 0x6e8bceb1ba0b212658e90dda06706c1c1fbcaae999868972ddee1b0e0e30f789

VERDICT  NOT found on Monad
  no transaction with this hash on Monad at block 106641361
  checkedAtBlock 106641361

coverage, which is what a NOT found is relative to:
  yes  Monad (143)
  yes  Ethereum (1)
  yes  OP Mainnet (10)
  yes  Base (8453)
  yes  Arbitrum One (42161)
  yes  Polygon (137)
  yes  BNB Smart Chain (56)
```

Final verdict: **`false` at rung `parsed`**. The document is reachable, the bytes match the on-chain
commitment, the shape is one we publish a mapping for and the transaction it cites is not on Monad.
Each of those four statements was established by a different rung and the verdict is only as strong
as the weakest one it cleared.

For contrast, the same CLI against a claim that checks out, claim id
`143_10169_0x103040545AC5031A11E8C03dd11324C7333a13C7_1`:

```
VERDICT  found on Monad
  block          97452789
  status         success
  from           0x103040545ac5031a11e8c03dd11324c7333a13c7
  to             0x9620dbe2bb549e1d080dc8e7982623a9e1df8cc3
  checkedAtBlock 106641619
```

Note `status success` is reported separately from `found`. A reverted transaction still happened. Whether
it succeeded is a different fact and it belongs in the verdict rather than in the lookup.

---

## How it was tested

```bash
cd verifier && npm test
```

```
# tests 225
# pass 198
# fail 0
# skipped 27
```

27 skip without a live dependency rather than failing. Six are the Postgres store tests, which skip
when `ENVIO_PG_PASSWORD` or `FOVEA_DATABASE_URL` is unset. The other 21 are live probes that
self-skip with a stated reason when their endpoint or key is unset: the `payable` and `settled`
checks, the Alchemy fallback probe in `rpc.test.ts`, the atlas proposer plus the two Nansen probes.
All of them pass against their live dependency. Everything else runs with no network and no
database.

The ladder's own share is 144 of those tests, counting the seven files in `src/ladder/`. Per file,
with `node --test --experimental-strip-types <file>`:

| file | tests |
|---|---|
| `src/ladder/payable.test.ts` | 45, 3 skipped without a live endpoint |
| `src/ladder/settled.test.ts` | 31, 4 skipped without a live endpoint |
| `src/ladder/parse.test.ts` | 20 |
| `src/net/guard.test.ts` | 19 |
| `src/ladder/locate.test.ts` | 14 |
| `src/ladder/verdict.test.ts` | 14 |
| `src/ladder/resolve.test.ts` | 13 |
| `src/atlas/induce.test.ts` | 10 |
| `src/atlas/propose.test.ts` | 9, 4 skipped without a live dependency |
| `src/cli/nansen-enrich.test.ts` | 8, 4 skipped without a live dependency |
| `src/optic.test.ts` | 8 |
| `src/store/records.test.ts` | 8 |
| `src/ladder/intact.test.ts` | 7 |
| `src/cli/nansen-funders.test.ts` | 7, 5 skipped without a live dependency |
| `src/rpc.test.ts` | 6, 1 skipped without a live fallback endpoint |
| `src/store/store.test.ts` | 6, all skipped without a database |

### Mutation testing

A passing test suite proves the tests pass. It does not prove they would fail if the code were
wrong. So the code was deliberately broken, one change at a time, to find out.

**17 mutations against the ladder, the chain list and the RPC seam. 16 caught, 1 survived.**

Each mutation was applied to a single file, the full suite was run, then the file was restored and
the restore was verified byte-exact with `diff -r`.

Caught, with the test that caught each one:

| mutation | caught by |
|---|---|
| `locate`: a thrown receipt error returns `false` instead of `unknown` | `A THROWN PROVIDER ERROR IS UNKNOWN, NEVER FALSE` and 1 more |
| `locate`: an uncovered network returns `false` | `a network outside the covered list is unknown` |
| `locate`: opens a reader before the network is resolved | `no chain is read at all when the network cannot be resolved` and 1 more |
| `intact`: the empty-body branch removed | `an empty document is unknown, not a considered mismatch` |
| `intact`: a malformed commitment reported as a mismatch | `a malformed commitment is unknown rather than a mismatch` |
| `parse`: ambiguity resolved by taking the first hit | `two mappings matching one document is refused rather than resolved by array order` |
| `parse`: the outer `network` wins over `proof_of_payment.network` | `the network attached to the PAYMENT wins over the document's own` |
| `parse`: every non-JSON body treated as prose | 3 tests, including `the same bytes declared as JSON stay unparsed` |
| `parse`: `unparsed` stops returning the document's keys | `an unrecognised shape is unparsed AND hands back its keys` |
| `verdict`: parses on through a hash mismatch | `BYTES THAT NO LONGER MATCH THE COMMITMENT STOP THE LADDER` |
| `verdict`: an unreadable document becomes `false` | `an unreadable document stops at declared and judges nothing further` |
| `chains`: fuzzy prefix matching added | `an uncovered or unreadable network is not guessed at` |
| `chains`: `coverageTable` hides unconfigured chains | `the coverage table says which chains are actually configured` |
| `resolve`: the base64 round-trip check removed | `invalid base64 is refused rather than silently truncated` |
| `resolve`: the CID character class allows dots again | `PATH TRAVERSAL in an ipfs URI is refused before any gateway is contacted` |
| `resolve`: the size cap moved to after decoding | `the cap applies before decoding, so a hostile payload is never allocated` |

### The one that survived

**`verifier/src/rpc.ts`: replace the error-name check with a message substring check.**

```diff
- const name = (e as { name?: string })?.name ?? "";
- if (name === "TransactionReceiptNotFoundError") return null;
+ const m = String((e as Error)?.message ?? "");
+ if (m.includes("could not be found")) return null;
```

Full suite still green. `# fail 0`.

Two things this taught, both worth more than the mutation cost:

**One, `chainReaderOf` is still not tested.** Every `locate` test supplies a fake `ChainReader`,
which is what makes the decision logic testable with no network. `src/rpc.test.ts` now imports
`rpc.ts` and exercises the Monad fallback composition, `readerWithFallback` and
`settlementReaderWithFallback`, but it injects its own `ChainReader`, so the translation inside
`chainReaderOf` from a viem error into `null`-or-rethrow, the exact line this mutation edits, is
never run. `chainReaderOf` is not exported and the only path that builds it, `readerFor`, opens a
real client, so no offline test reaches it:

```bash
grep -rn "from \"\.\./rpc\|from \"\./rpc" verifier/src --include=*.test.ts
```

```
src/rpc.test.ts:4:import { readerWithFallback, settlementReaderWithFallback } from "./rpc.ts";
```

The one hit is the fallback runner, above the seam. The property that a provider failure is
`unknown` is covered above the seam and not at it, so this mutation still survives.

**Two, this mutation is behaviour-preserving today and wrong later.** viem's current message contains
`could not be found`, so the mutated code returns `null` for exactly the cases the original did. A
test asserting today's behaviour would pass against both versions and prove nothing. The mutation
only bites when viem or a provider rewords the string, at which point every genuine absence silently
becomes `unknown` and the `false` count collapses to zero with no error anywhere. The reverse failure
is worse: any unrelated error whose message happens to contain those words gets read as absence and
a failure turns into an accusation.

That is a real gap, it is recorded in [14-GAPS.md](14-GAPS.md) and it is published here rather than
quietly closed, because a mutation report listing only the kills is a report nobody had to be honest
to write. Closing it needs a test at the seam: construct a `TransactionReceiptNotFoundError` with a
rewritten message and assert it still maps to `null`, then throw a generic error whose message does
contain `could not be found` and assert it is rethrown. A mutation score of 16 out of 17 with the
survivor named is a more useful number than 17 out of 17 with the survivor deleted.
