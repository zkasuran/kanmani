# 40. Alchemy: the trigger that re-verifies a repaired document

The verdict store has always been append-only. A repaired document was always meant to read as
`false -> true` with both timestamps kept, `/status` already lists every verdict that moved and
`/claim/<id>` already renders the history. What did not exist was anything to **start** the re-check,
so it had to be started by hand. An Alchemy webhook on the ERC-8004 Identity Registry is that
trigger. A Tenderly alert on the same registry is a second one into the same path. Alchemy is the
provider this document was written against. Tenderly is the one driving the live deliveries today,
after Alchemy paused its stream (see below).

The code is `lib/rehydrate.ts`, where everything happens and everything is tested.
`app/api/webhooks/alchemy/route.ts` is the Next.js surface and nothing else, the same split
`/api/verify` and `lib/check.ts` use.

## What it does

Alchemy watches the Identity Registry on Monad mainnet,
`0x8004a169fb4a3325136eb29fa0ceb6d2e539a432`. An agent updates its metadata, which is the signal that
the off-chain document may be different from the one we judged. We re-run the same ladder over that
agent's claims and append a new verdict per claim. Nothing is updated in place.

There is **no verification logic in this file.** `runLadder` defaults to `check()` in `lib/check.ts`,
which resolves the document through the SSRF guard and hands the bytes to the same `judge()` everything
else uses. A second ladder "for the webhook, but simpler" is how a site ends up disagreeing with its
own tool, so there is not one.

## Two events, read two different ways

Both topic hashes are computed from the signature at load rather than pasted and a test pins them to
the values `indexer/config.yaml` recorded from the chain.

| event | signature | `topic0` | agent id arrives in |
|---|---|---|---|
| `MetadataUpdate` | `MetadataUpdate(uint256)` | `0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7` | `data`, first 32-byte word |
| `URIUpdated` | `URIUpdated(uint256,string,address)` | `0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb` | `topics[1]` |

`MetadataUpdate` is ERC-4906 and is absent from the ERC-8004 draft. Its `_tokenId` is **not** indexed,
so the id is in the data blob. `URIUpdated` indexes `agentId`, so it is a topic and the data holds the
new URI string. Reading those two the same way round would read a string offset as an agent id. The
event names come off the vendored ABI in `indexer/abis/IdentityRegistry.json` rather than from memory.

An agent id that does not fit in a safe integer is refused rather than truncated. Monad agent ids run
to five digits, so anything near 2^53 is a crafted value that `Number()` would silently land on a
different agent.

## Confirmed against Alchemy's own documentation, not from memory

Read on 2026-09-23, because the whole value of this endpoint is that it rejects anything it did not
sign for.

- The header is `X-Alchemy-Signature`, read lowercase off the request.
- The digest is a hex HMAC SHA-256 over the **raw** body under the webhook's signing key. Alchemy's own
  sample says the input "must be raw string body, not json transformed version of the body", which is
  why the handler reads `req.text()` before anything parses JSON. Re-serialising an object changes key
  order plus whitespace and the digest with it.
- Alchemy's samples compare with plain equality. We use `timingSafeEqual`. A byte-at-a-time comparison
  against a secret-derived value leaks how much of a guess was right, which is enough to find the rest.
  The length check above the compare leaks nothing, because a sha256 hex digest is always 64
  characters, so a different length is a malformed header rather than a near miss.
- Both payload shapes carry `webhookId`, `id`, `createdAt`, `type` plus `event` at the top level.
  Custom webhooks report `type: "GRAPHQL"` with logs under `event.data.block.logs`, where a log names
  its contract as `account.address`. Address Activity reports `type: "ADDRESS_ACTIVITY"` with
  `event.activity[].log`. Both are accepted.

## The posture, because this endpoint is public and unauthenticated

**The order is the security property: raw body, then signature, then parse.** Anything that parsed the
JSON first would be running a parser over unauthenticated input and could not recover the exact bytes
the digest covers.

| situation | answer |
|---|---|
| no signing key wired | `503` for every request, never a skipped check |
| header missing | `401 "Missing signature"` |
| digest does not match | `401 "Signature does not verify"`, nothing read out of the body, nothing written |
| body is not a shape we read | `400` naming which of the two shapes it failed |
| no log we act on | `200` listing the reason each log was passed over |
| a copy of the same delivery still in flight | `409`, rather than racing it |
| already finished | `200 "replayed"`, nothing appended, the first attempt's result returned |
| the index has not reached this agent | `503` with the delivery marked failed, so a retry is processed |
| anything threw | `500` with the delivery marked failed and `retryable: true` |

A log from a contract that is not the Identity Registry is refused rather than trusted, because the
webhook's dashboard configuration is not something this code can see.

A delivery that did nothing says why it did nothing. Each refused log is listed with its reason rather
than summarised, because a webhook that returns `200` and says nothing is indistinguishable from one
that is broken.

## Idempotency is the database's, not a flag

`delivery_key` is the primary key of `fovea.webhook_delivery`, so the guard is the table's own
uniqueness rather than a read followed by a write. Two copies of one retry arriving at the same instant
cannot both win the insert.

The key is Alchemy's own delivery `id`. When a payload arrives without one, a sha256 of the raw body is
used instead, which is weaker (two genuinely distinct deliveries with identical bytes would collide)
and is recorded in `keyed_on` as the weaker choice rather than presented as the same thing.

`ON CONFLICT` re-claims a key whose previous attempt **failed** and leaves a `done` or `ignored` one
alone. That is the difference between a retry repairing a dropped delivery and a retry appending a
second copy of a verdict we already recorded.

## Budgets and what happens to what does not fit

`MAX_AGENTS_PER_DELIVERY` is 25 and `MAX_CLAIMS_PER_AGENT` is 25. Both are real limits rather than
round numbers: one agent carries 518 claims that point at a document and fetching all of them inside
one webhook request would time the delivery out, which looks to Alchemy like a failure and earns a
retry that times out the same way.

Whatever does not fit is reported as `deferred` with its count rather than dropped quietly.

Claims are ordered worst first, by `v.outcome IS DISTINCT FROM 'true'` descending. A metadata update is
most likely a repair, so the claims worth spending a capped budget on are the ones a repair would move.

## Two refusals that protect somebody else's reputation

**A re-check that did not complete appends `unknown`, always.** There is deliberately no branch in
`couldNotCheck` that can return `false`. A failure to look is not evidence that a payment did not
happen. A webhook that turned our own timeout into a negative verdict about somebody else would be the
worst bug this project could ship.

**`refuseUnsupportedOutcome` refuses a verdict whose outcome outruns its evidence.** Both rules are read
off `verifier/src/ladder/verdict.ts`, which produces `false` in exactly one place: the `parsed` rung,
after a chain read that returned a head block. A `false` arriving from any other rung did not come from
the ladder and neither did one carrying no block. Neither gets written. It is exported because this one
branch is the honesty position and a refactor that widened it would be invisible in a diff.

Every claim gets a row either way. A claim whose document still fails appends an `unknown` with the
reason, because the store is a record of measurements and "we looked again and still could not read it"
is a measurement. Writing only the rows that improved would make the history lie by omission.

## Read it without posting to it

A human opens a webhook URL in a browser long before any provider posts to it, so the `GET` answers
rather than 405s:

```bash
curl -sS https://kanmani.xyz/api/webhooks/alchemy
```

It reports `signingKeyConfigured` as a boolean, the contract and both events with their topic hashes,
the budgets and the last twenty deliveries from the ledger. The key itself is never in a response and
a ledger read that fails is reported as the fixed line "the delivery ledger could not be read" with a
`503`, because the raw database error would hand a stranger our internals.

**On the public deployment today `signingKeyConfigured` is `true` and the ledger carries live
deliveries.** The `503`-on-no-key row in the table above is the tested fail-closed behaviour, not the
current state. The live trigger is a Tenderly alert on the Identity Registry rather than Alchemy.
Alchemy delivered 4,907 signed webhooks on 2026-10-03, every one correctly ignored because the
registered query was unfiltered so none carried a registry event, which used up the month's compute
units and Alchemy paused the stream. Tenderly now posts to its own signed route,
`/api/webhooks/tenderly`, which checks its signature and then runs this same shared re-verification
path, so the last twenty deliveries read `TENDERLY_ALERT`. The real-against-simulated accounting for
this path is in [14-GAPS](14-GAPS.md).

## Related

- [04-VERIFICATION-LADDER](04-VERIFICATION-LADDER.md) the ladder this re-runs.
- [14-GAPS](14-GAPS.md) what is real on this path and what is not.
- [10-API](10-API.md) the rest of the HTTP surface.
