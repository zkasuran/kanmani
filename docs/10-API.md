# 10. The API

**Base URL `https://kanmani.xyz`.** No API key, no account, no token, no signup. Three things cost
money: `POST /api/verify`, its testnet sibling `POST /api/testnet/verify` and the hireable agents
under `/api/service/<slug>`. Everything else is free, for a reason stated in the 402 body rather than
left for you to work out.

Three properties hold across everything:

| | |
|---|---|
| Envelope | every JSON body carries `version`, `chain`, `checkedAt`, `checkedAtBlock`, `reproduce` |
| Nulls | a field with no answer is `null`, never missing |
| `unknown` | a fourth outcome that is not `false` and not `0`. Nothing here collapses the two |

Field names and fixed strings below are copied from the route that emits them. Numbers come from
this build's own measurements. Timestamps and block numbers are from the moment you ask, so yours
will differ.

---

## The envelope

```json
{
  "version": 1,
  "chain": { "id": 143, "name": "Monad" },
  "checkedAt": "2026-09-20T18:44:02.118Z",
  "checkedAtBlock": "106470718",
  "reproduce": "curl -sS 'https://kanmani.xyz/api/claims?limit=1000' | jq ...",
  "data": { }
}
```

| field | type | why it is there |
|---|---|---|
| `version` | `1` | bumped when a field changes meaning, never when one is added |
| `chain` | `{id, name}` | every table is partitioned by chain id. A body that did not name its chain could silently mix two |
| `checkedAt` | ISO 8601 | when this response was computed. Not when the code was deployed |
| `checkedAtBlock` | string or null | the chain head the index had reached |
| `reproduce` | string | the exact command that gets the same answer without this API |
| `data` | object | the payload, different per endpoint |

`checkedAt` and `reproduce` exist for the same reason the site exists. A number with no time
attached is a number that was true once. A number with no way to re-derive it is a number the
reader has to take on trust. Neither is good enough when the subject is somebody else's reputation.

`checkedAtBlock` is the falsifiability field. A verdict of `false` means "we read the chain and the
transaction is not there". Without the head we looked at, a reader cannot tell whether we looked
before the transaction existed, which makes the negative unfalsifiable. **Only `/feed.json` sets
the envelope-level one today.** Elsewhere it is `null`, because those bodies carry a per-row
`checkedAtBlock` inside `data` that is the block each individual check was made at. That is the
number you want for a verdict.

Every JSON response:

```
content-type: application/json; charset=utf-8
cache-control: no-store
access-control-allow-origin: *
```

`no-store` is deliberate. These are read by software making a judgement about somebody, so a stale
verdict is worse than a slow one.

Errors are RFC 9457 problem+json (`application/problem+json; charset=utf-8`), so a client that
already understands that shape needs no special case:

```json
{
  "type": "https://kanmani.xyz/method",
  "title": "Unknown outcome",
  "status": 400,
  "detail": "outcome must be one of true, false, noClaim, unknown",
  "accepted": ["true", "false", "noClaim", "unknown"]
}
```

Keys beyond the RFC's five are per-error. They are documented with each endpoint.

**Examples below show only `data`** once an endpoint's envelope has been shown. The envelope is
always there.

---

## Nulls are answers

**A field with no answer is `null`. It is never absent.** An absent key invites a consumer to
default it to zero. Defaulting an unknown to zero is the exact failure this project exists to point
at. `null` says the question was asked and had no answer.

| you will see | it means |
|---|---|
| `"outcome": null` | never checked. Unchecked is not clean |
| `"rung": null` | same, no check has run |
| `"hashMatches": null` | the comparison was not made, usually because the document could not be fetched |
| `"foundOnChain": null` | we did not find it (or never got as far as looking) |
| `"checkedAtBlock": null` | the head could not be read at that moment |
| `"registration": null` | this agent declared no `tokenURI`. Declaring none is a state an agent can be in |
| `"declaredNetwork": null` | the document named no network |
| `"outcome": "unknown"` | a check ran and could not conclude. **This is not `false`** |

`null` means no check has run. `"unknown"` means a check ran and could not conclude. Both are
distinct from `false`, which is a positive statement that a chain was read successfully and the
transaction is not on it.

The four outcomes:

| outcome | meaning |
|---|---|
| `true` | the cited transaction is on the chain the document names |
| `false` | we read that chain successfully and it is not there |
| `noClaim` | the document read fine and asserts no payment, so there is nothing to check |
| `unknown` | we could not look (or could not read what we fetched). Never an accusation |

The five rungs, which say how far a claim got before it stopped: `declared`, `resolvable`,
`intact`, `parsed`, `true`.

---

## Endpoints

### `GET /api/claims`

The claim feed, filtered the same way the site's own `/claims` page filters it. Same query builder,
so the JSON and the HTML cannot drift. Free.

| parameter | type | default | notes |
|---|---|---|---|
| `outcome` | `true` \| `false` \| `noClaim` \| `unknown` | none | validated |
| `rung` | `declared` \| `resolvable` \| `intact` \| `parsed` \| `true` | none | validated |
| `mapping` | string | none | not validated. See below |
| `network` | string | none | not validated. Matches `declaredNetwork` exactly. Every payment claim on Monad names `monad` |
| `agent` | integer | none | the on-chain agent id. Validated `^\d{1,12}$`, so a non-numeric value is a 400 |
| `limit` | integer | 100 | floored at 1, capped at 1000 |
| `offset` | integer | 0 | floored at 0 |

**An unrecognised `outcome` or `rung` is refused with the list of accepted values.** It is not
silently ignored. A filter that gets quietly dropped returns plausible wrong data and nobody
notices: you ask for the failures, you get everything, the count looks reasonable, you publish it.
The 400 body is the problem+json shown above, with an `accepted` array. `rung` answers the same
shape with `"title": "Unknown rung"`.

**`mapping` and `network` are not validated against a list, on purpose.** Both are open sets: the
atlas grows when a new document shape is induced. `declaredNetwork` is whatever an author typed. An
unrecognised value is still applied as an equality filter rather than dropped, so you get
`"total": 0` with empty `items`, which is visibly empty rather than plausibly wrong. The six
mappings in the atlas today:

```
execution-market.v1               the current shape that asserts a payment. 159 claims
execution-market-transactions.v1  older shape, same publisher, hash under transactions.payment_tx. 23 claims
elo-record.v1                     game rating, asserts no payment. 1,026 documents
conversation-score.v1             conversation rating, asserts no payment. 3 documents
agent-card.v1                     capability description, asserts no payment
plain-text-comment.v1             66 data:text/plain documents. Prose, asserts no payment
```

```bash
curl -sS 'https://kanmani.xyz/api/claims?outcome=false&limit=2'
```

```json
{
  "total": 123, "limit": 2, "offset": 0,
  "next": "https://kanmani.xyz/api/claims?outcome=false&limit=2&offset=2",
  "items": [
    { "id": "143_10182_0x1030…13C7_2", "url": "https://kanmani.xyz/claim/143_10182_0x1030…13C7_2",
      "agentId": 10182, "leftBy": "0x1030…13C7", "feedbackUri": "https://execution.market/…",
      "feedbackHash": "0x…", "revoked": false, "operatorReply": null,
      "outcome": "false", "rung": "parsed", "mapping": "execution-market.v1",
      "reason": "no transaction with this hash on Monad at block 106462031",
      "declaredNetwork": "monad", "declaredTx": "0x…",
      "hashMatches": true, "foundOnChain": null,
      "checkedAt": "2026-09-19T21:03:55.900Z", "checkedAtBlock": "106462031",
      "recordedInBlock": 105993144, "recordedInTx": "0x…" }
  ]
}
```

Ids, addresses and hashes are elided there. The id shape is
`<chainId>_<agentId>_<clientAddress>_<feedbackIndex>`, so `143_10182_0x1030…13C7_2` is agent
10182's third feedback from that client on chain 143.

`reproduce` on this endpoint is the SQL that produced the body, verbatim, with bind parameters left
as placeholders. For the query above it ends `WHERE f."chainId" = $1 AND f."feedbackUri" <> '' AND
v.outcome = $2 ORDER BY f."blockNumber" DESC, f.id LIMIT $3 OFFSET $4`.

Ordering is block number descending then id, which is stable. `next` is `null` on the last page. It
carries every filter you sent, so paging never quietly changes the query underneath you.

Only feedbacks carrying a document are returned. A feedback with an empty `feedbackUri` has nothing
to verify: <!-- n:withPointer -->1,292<!-- /n --> of Monad's <!-- n:feedbacks -->9,288<!-- /n --> feedbacks carry a pointer.

Errors: `400` for an unknown `outcome`, an unknown `rung` or a non-numeric `agent`. Nothing else is
refused.

### `GET /api/agent/{id}`

One agent, including what is not known about it. Free. `{id}` accepts the internal id `143_10252`
or the bare registry id `10252`. The segment is URL-decoded before lookup.

```bash
curl -sS 'https://kanmani.xyz/api/agent/10252'
```

```json
{
  "agentId": 10252, "name": "Kanmani",
  "owner": "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
  "agentWallet": "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
  "registeredAtBlock": 106470711, "transferCount": 0, "metadataUpdateCount": 2,
  "declaresX402": true,
  "endpoints": ["https://kanmani.xyz/mcp", "https://kanmani.xyz/api/verify", "https://kanmani.xyz/openapi.json", "https://kanmani.xyz"],
  "bond": {
    "state": "released", "amountAtomic": "0", "token": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    "minTruthRateBps": 8000, "minSampleSize": 5,
    "postedAtBlock": "107460188", "maturesAtBlock": "107676188", "matured": true,
    "contract": "0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf"
  },
  "passkey": { "state": "none", "contract": "0x1E30531CD3ea6DE2958DB363418a5382C419dC24" },
  "registration": {
    "uri": "data:application/json;base64,…", "uriHash": "…",
    "state": "onchain", "reason": "1489 bytes read from data", "askedAt": "2026-10-01T03:35:12.997Z",
    "sharedWithAgents": 0, "sharedAcrossWallets": 1
  },
  "claims": {
    "onChain": 0, "checkable": 0, "checked": 0,
    "resolve": 0, "doNotResolve": 0, "couldNotCheck": 0, "assertNoPayment": 0,
    "items": []
  }
}
```

`reproduce` here is a `cast call` against the Identity Registry for that agent's `tokenURI`.

`bond` is the truth bond this operator posted, if any: its `state`, the staked `amountAtomic` in the
bond token, the `minTruthRateBps` and `minSampleSize` it is judged against, the blocks it was
`postedAtBlock` and `maturesAtBlock`, whether it has `matured` and the `contract` holding it. It is
`null` when no bond was posted or when the chain could not be read, which are not the same thing: an
unreachable chain returns `null` with no other bond fields, so a consumer must not read `null` as
unbonded. It is read live from the chain rather than from the index, because a window matures when a
block passes and emits no event.

`passkey` is the device passkey bound to this agent, verified by Monad's P256 precompile when it
signs. `state` is `bound`, `none` or `unknown`, where `unknown` means the chain could not be read.

`declaresX402` is the operator's own assertion, read out of their registration document. It is
labelled that way so a consumer never reads it as ours. We did not test that their endpoint answers
402.

`registration.state` is one of `onchain`, `answered`, `gone`, `paywalled`, `refused`, `nohost`,
`malformed`, `unknown`. It is `null` when nothing has probed that document yet. Never-looked is a
state. It is not `gone`. Monad has <!-- n:documents -->2,054<!-- /n --> distinct registration documents behind <!-- n:agents -->10,277<!-- /n --> agents. <!-- n:goneAgents -->8,641<!-- /n -->
of those agents point at a document that answers with a deletion, one document behind <!-- n:oneDocAgents -->8,093<!-- /n --> of
them. The live count in each `record_state` bucket moves with every probe run, so it is published on
[`/status`](https://kanmani.xyz/status) rather than frozen here. The buckets themselves are defined in
`lib/queries.ts`.

`sharedWithAgents` is how many **other** agents point at the same document, so `0` means nobody
else does. `sharedAcrossWallets` is how many distinct wallets registered it. Monad's largest
cluster is one document shared by <!-- n:oneDocAgents -->8,093<!-- /n --> agents across <!-- n:oneDocWallets -->7,962<!-- /n --> wallets.

`claims.items` is capped at 200, newest first, with no paging here. Use `/api/claims` for more.

```
HTTP 404
{ "title": "No such agent",
  "detail": "Agent 99999 is not in this index. That is not the same as it not existing on chain." }
```

That detail is not padding. Our index is not the registry, so a 404 here is a statement about us.

### `GET /feed.json`

The whole checked population plus its distribution, in one request. Free. One parameter: `limit`,
default 2000, floored at 1 and capped at 5000. Out-of-range values are clamped rather than refused.

```bash
curl -sS 'https://kanmani.xyz/feed.json?limit=5'
```

```json
{
  "summary": {
    "paymentClaims": 182, "resolve": 59, "doNotResolve": 123, "assertNoPayment": 1095,
    "couldNotCheck": { "total": 15, "documentWouldNotAnswer": 2,
                       "bytesNoLongerMatchTheirCommitment": 10, "noMappingReadTheShape": 3 },
    "claimsWithAUriAndNoVerdict": 0
  },
  "note": "unknown is never false. A claim we could not check is not a claim we judged. If you aggregate these rows, carry the unknowns through rather than dropping them.",
  "returned": 5, "totalCheckable": 1292, "items": []
}
```

This is the only endpoint whose envelope `checkedAtBlock` is populated. It carries the index head.

The distribution sits at the top of the same document as the rows on purpose. A consumer that takes
only the `false` rows and publishes a count has, at that moment, dropped the denominator and the
unknowns. Having both in one body makes that a deliberate act rather than an accident of
pagination.

`claimsWithAUriAndNoVerdict` is the honesty field: claims carrying a document that nothing has
checked yet. Unchecked is not clean, so it is published next to the verdicts.

`items` carry a smaller shape than `/api/claims` and use `foundOnChain.block` rather than
`blockNumber`. See [Known rough edges](#known-rough-edges). No errors.

### `POST /api/verify`

Check a document. **The one endpoint that costs money.** The payment mechanics are in
[the x402 flow](#the-x402-flow-on-apiverify) below.

| field | type | notes |
|---|---|---|
| `uri` | string | `https://`, `data:` or `ipfs://`. Required unless you send `id` |
| `feedbackHash` | string | the commitment recorded on chain, `0x` plus 64 hex. Optional |
| `id` | string | a claim id in this index. Resolves to both the URI and its commitment |

Send `uri` or `id`. `id` is the stronger request: it resolves to the document **and** its on-chain
commitment, so the check is a real verification rather than a hash of whatever the host feels like
serving today.

Without a `feedbackHash` the `intact` rung cannot be decided, so the check hashes whatever it was
served and `intact` is trivially true. `hashWasSupplied` in the response says which happened. "The
bytes match the commitment" is evidence. "We hashed what we got" is not.

**A malformed `feedbackHash` is treated as absent rather than as an error.** The pattern is
`^0x[0-9a-fA-F]{64}$`. If yours does not match, the check still runs and `hashWasSupplied` comes
back `false`. That is how you find out.

Paid response:

```json
{
  "paid": true,
  "payment": {
    "settled": true,
    "transaction": "0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a",
    "reason": null, "payer": "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
    "amount": "10000", "asset": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    "network": "eip155:143", "headerUsed": "PAYMENT-SIGNATURE",
    "note": "This settlement is itself an x402 payment on Monad, so it can be checked by this same endpoint."
  },
  "verdict": {
    "rung": "true", "outcome": "true",
    "reason": "cited transaction is on Monad at block 106462031",
    "declaredNetwork": "monad", "mapping": "execution-market.v1",
    "declaredTx": "0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a",
    "hashMatches": true,
    "computedHash": "0x679e20a6dfc1917b221e376bdbf15d6fd9d5535aba4739608b3208a5c1b3a8ec",
    "foundOnChain": { "chain": "Monad", "chainId": 143, "blockNumber": "106462031" },
    "checkedAt": "2026-09-20T18:44:02.118Z", "checkedAtBlock": "106470902"
  },
  "hashWasSupplied": false, "bytesRead": 160,
  "mediaType": "application/json", "source": "data",
  "coverage": [ { "chain": "Monad", "id": 143, "configured": true }, … ]
}
```

`coverage` lists all seven chains in the published list (Monad 143, Ethereum 1, OP Mainnet 10, Base
8453, Arbitrum One 42161, Polygon 137, BNB Smart Chain 56) with a `configured` flag each. It is
part of the claim rather than decoration: a `false` means "not found on the chains in this list",
so the list has to be visible. A chain with `"configured": false` has no endpoint set, which makes
any claim naming it `unknown`. We did not look.

`source` is `data`, `http` or `ipfs`. `bytesRead` is the exact byte count that was hashed.

| status | when | body |
|---|---|---|
| 400 | body is not JSON | `"Body is not JSON"`, detail names the two accepted shapes |
| 400 | neither `uri` nor `id` | `"Nothing to check"` |
| 404 | `id` is not in this index | `"No such claim"` |
| 402 | unpaid request, a rejected payment or an authorization already in flight | the full x402 challenge, not problem+json |
| 402 | the payment verified but settlement did not confirm | problem+json `"Payment did not settle"`, `charged: false`, `retryable: true`. Retry the same authorization |
| 500 | the check itself threw | `"The check did not complete"`, with `"charged": false` and `"retryable": true` |
| 503 | the facilitator could not be reached | `"We could not check your payment"`, `"retryable": true` |

A refused document is not an error. Pointing at something private, oversized or unreachable returns
`200` with `outcome: "unknown"` and a reason, because a failure to fetch is a finding about the
document rather than a fault in the request.

`GET /api/verify` returns `402` with the challenge body and the error string "This endpoint takes
POST. Here is what it costs and why." A human will open this in a browser long before any agent
posts to it, so it answers with something readable rather than a 405. `OPTIONS /api/verify` returns
`204` with an empty body.

### The static machine surfaces

| path | content-type | what it is |
|---|---|---|
| `GET /schema.json` | `application/json` | JSON Schema for the envelope, the verdict and the record states, plus an endpoint summary. Hand-written, because the descriptions are the point: a generated schema would carry the types and lose the sentence saying `unknown` is not `false` |
| `GET /llms.txt` | `text/plain` | the whole site as plain text with live numbers, for a model that will read one file and nothing else |
| `GET /agents.md` | `text/markdown` | the safe-access contract, addressed to software |
| `GET /sitemap.xml` | `application/xml` | capped at 200 operator clusters and 500 claims, with the cap stated in an XML comment inside the file so nobody mistakes it for completeness |
| `GET /.well-known/agent-registration.json` | `application/json` | our own ERC-8004 record, protocol version 0.3.0, two skills, the registries we index, a `refuses` list |

The last two JSON files carry no envelope. They describe rather than measure, so there is nothing
to timestamp. Our own registration record asserts no payment claim, because we have not been paid
through it. A document that claims nothing cannot be wrong about it.

The eight machine surfaces this table omits (`/openapi.json`, `/skill.md`, `/build/AGENTS.md`,
`/.well-known/agent-card.json`, `/mcp`, `/embed.js`, `/og.png` and the static `/self-audit.json`) are
catalogued in [35-MACHINE-SURFACES](35-MACHINE-SURFACES.md).

### Every handler, in one table

Twenty-six route handlers ship under `app/api`, plus twelve machine endpoints outside it. Four of
them have a full section in this document: `/api/claims`, `/api/agent/{id}`, `/api/verify` and
`/api/vault`. This table is all twenty-six, so nothing is reachable on the live site without a line
here saying what it is. Reproduce the list with `find app -name route.ts`.

| endpoint | methods | what it is | in full |
|---|---|---|---|
| `/api/claims` | GET | the claim feed, filtered | above |
| `/api/agent/{id}` | GET | one agent, including what is not known about it | above |
| `/api/verify` | GET, POST, OPTIONS | check a document. Paid, 0.01 USDC over x402 | above |
| `/api/vault` | GET, PUT | AES-256-GCM ciphertext the server cannot read | above |
| `/api/registration/check` | GET, POST, OPTIONS | **free.** Validate an ERC-8004 registration draft and get the exact `register()` calldata | [34](34-EVIDENCE-CHECK.md) |
| `/api/evidence/check` | GET, POST, OPTIONS | **free.** Run a document through the real judge before publishing it | [34](34-EVIDENCE-CHECK.md) |
| `/api/account/{address}` | GET | every agent an address owns with live bond state, plus its MON and USDC balances. Public state only, no login | |
| `/api/sla/{agentId}` | GET | an agent's claim-truth rate over a block window, which is what a slashing oracle reads. `rateBps` is `null` on an empty sample rather than 0 | [26](26-CRE-SIMULATION.md) |
| `/api/usage` | GET | who uses Kanmani without tracking anyone. `?days=` 1 to 60, default 7. Counts, software names and public chain events only, beside a `notMeasured` list | |
| `/api/pay-runs` | GET, POST | time to first transaction, as runs each tied to a real settlement. A `real` block and a `ci` block, kept apart | [38](38-PAY-RUNS.md) |
| `/api/compliance/{address}` | GET | the on-chain CVI status of a wallet on both Monad chains | [36](36-COMPLIANCE.md) |
| `/api/testnet/mint` | POST | the sponsored tUSDC mint. Idempotent per address, rate limited per IP, capped per day | [37](37-TESTNET.md) |
| `/api/testnet/verify` | GET, POST, OPTIONS | the paid check, settled in tUSDC on Monad testnet | [37](37-TESTNET.md) |
| `/api/receipt` | GET | an index pointing at the two receipt endpoints that do the work | [39](39-RECEIPTS.md) |
| `/api/receipt/verify` | GET, POST | check a verification receipt's signature. Holds no key, verifies any receipt | [39](39-RECEIPTS.md) |
| `/api/receipt/action` | GET, POST | publish and read who authorised a change to an agent's document | [39](39-RECEIPTS.md) |
| `/api/service/{slug}` | GET, POST, OPTIONS | the twelve hireable agents. GET is the free 402 carrying the price, POST does the work | [30](30-AGENTS.md) |
| `/api/service/{slug}/agent-card.json` | GET | the A2A card that agent's ERC-8004 registration points at | [30](30-AGENTS.md) |
| `/api/service/{slug}/registration.json` | GET | the ERC-8004 document that agent should carry. `onChainMatches` byte-compares the live `agentURI` | [30](30-AGENTS.md) |
| `/api/fund/quote` | POST | a dry cross-chain funding quote. 503 without an Intents Connect key | [22](22-AURORA.md) |
| `/api/fund/create` | POST | create the execution and return its signing payload. 409 on a shortfall | [22](22-AURORA.md) |
| `/api/fund/{id}` | GET | one execution's live status. `?wallet=` is required | [22](22-AURORA.md) |
| `/api/fund/submit` | POST | relay the signed execution signature to Aurora | [22](22-AURORA.md) |
| `/api/fund/recover` | POST | one-click recovery of funds left at the intermediary. `refund` or `withdraw` | [22](22-AURORA.md) |
| `/api/fund/intermediary` | GET | a wallet's intermediary account with its live Monad USDC balance. Keyless | [22](22-AURORA.md) |
| `/api/webhooks/alchemy` | GET, POST, OPTIONS | the signed Alchemy delivery that triggers a re-verify. GET describes it | [40](40-ALCHEMY.md) |

Three rules hold across all of them, including the ones with their own doc.

- **The envelope is everywhere.** Each of these returns `version`, `chain`, `checkedAt`,
  `checkedAtBlock` and `reproduce` beside its `data`. The machine surfaces that describe rather than
  measure are the exception.
- **A null is an answer.** `/api/account` returns `null` balances when the RPC could not be read and
  never `0`. `/api/fund/intermediary` does the same with the intermediary balance.
  `/api/sla` returns a `null` rate on an empty sample, because `0` reads as "every claim was false"
  and would slash an agent nobody has rated yet.
- **A missing key is a 503, never a skipped check.** `/api/fund/*` without `AURORA_INTENTS_API_KEY`,
  `/api/testnet/mint` without `TESTNET_MINTER_KEY` and `/api/webhooks/alchemy` without
  `ALCHEMY_WEBHOOK_SIGNING_KEY` all refuse every request rather than running without the thing that
  makes them safe.

`/openapi.json` carries eight of these as importable tool definitions. It is a subset on purpose
rather than a generated mirror. `lib/openapi.test.ts` asserts every path in it maps to a route
file, so it describes nothing that is gone.

---

## The x402 flow on `/api/verify`

**Price: 0.01 USDC, `10000` atomic units at six decimals**, read off the token rather than assumed.
USDC on Monad is `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` with `decimals()` 6, `name()` `USDC`,
`version()` `2`. A literal carried over from an 18-decimal chain would ask for a million times the
price.

### 1. The challenge

An unpaid POST returns `402` with this body, x402 v2 shaped:

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://kanmani.xyz/api/verify",
    "description": "Fetch and check one evidence document: resolve it, compare its bytes against the hash committed on chain, read the cited transaction on the chain the document names.",
    "mimeType": "application/json"
  },
  "accepts": [
    { "scheme": "exact", "network": "eip155:143", "amount": "10000",
      "asset": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      "payTo": "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
      "maxTimeoutSeconds": 60, "extra": { "name": "USDC", "version": "2" } }
  ],
  "extensions": {},
  "help": {
    "meaning": "402 here means pay me, not broken.",
    "price": "0.01 USDC on Monad, chain 143, six decimals.",
    "why": "This endpoint fetches a document from somebody else's server and reads a chain. Reading what is already checked costs us a query, so that is free: GET /api/claims.",
    "facilitator": "https://x402-facilitator.molandak.org",
    "headers": "Send the payload base64 in PAYMENT-SIGNATURE. The older X-PAYMENT is accepted too."
  }
}
```

`help` is not in the spec. It is there because a human will open this endpoint in a browser long
before any agent posts to it. A bare machine challenge tells them nothing. `extra` is the EIP-712
domain the signature is made under, read off the token: its `DOMAIN_SEPARATOR()` on Monad is
`0xfe22123edc0dd4aeb912eb7948c5f0e531592c2053b3067612f427db342c93c6`.

### 2. v1 against v2, which is where a round trip gets lost

**v2 moved the chosen method into an `accepted` object and renamed `maxAmountRequired` to
`amount`.** Writing the payload from memory produces a v1 shape. The live facilitator answers that
with `unsupported_scheme`, which tells a client nothing about how to fix it. So a v1-shaped payload
is named as v1 here rather than called malformed:

```
"this payload is x402 v1 shaped: v2 carries the chosen method in an `accepted` object rather
 than `scheme` and `network` at the top level"
```

The fix is a client change. A client cannot guess that from the word "invalid".

Two more v2 differences: `resource` is its own object beside `accepts` rather than three loose
fields inside each requirement. `network` is CAIP-2 (`eip155:143`) rather than a bare chain name.

### 3. The headers, both generations

| header | generation | status here |
|---|---|---|
| `PAYMENT-SIGNATURE` | v2 | preferred. Wins when both are sent |
| `X-PAYMENT` | older | accepted. `payment.headerUsed` says which one was read |

Both carry the same thing: the payment payload as JSON, base64-encoded. Refusing a client for using
last year's header name helps nobody.

The base64 is round-tripped rather than trusted. `Buffer.from(x, "base64")` drops characters it
does not like instead of failing, so a corrupt payload decodes to something shorter and plausible.
Re-encoding and comparing is the only way to notice. The refusal reads `payment header is not valid
base64`.

### 4. The payload

```json
{
  "x402Version": 2,
  "resource": { "url": "https://kanmani.xyz/api/verify", "mimeType": "application/json" },
  "accepted": {
    "scheme": "exact", "network": "eip155:143", "amount": "10000",
    "asset": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    "payTo": "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
    "maxTimeoutSeconds": 60, "extra": { "name": "USDC", "version": "2" }
  },
  "payload": {
    "signature": "0x…",
    "authorization": {
      "from": "0x27a8ae37f59BDcd147b09dDc1F35Ac64697c1F92",
      "to": "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
      "value": "10000", "validAfter": "0", "validBefore": "1790000000", "nonce": "0x…"
    }
  },
  "extensions": {}
}
```

Checked before anything is forwarded: `accepted` must exist, `accepted.scheme` must be `exact`,
`accepted.network` must be `eip155:143`, `payload` must carry a string `signature` plus an object
`authorization`. Each refusal names what is wrong, because a client that cannot tell "your base64
was wrong" from "the server broke" will retry the same broken request forever.

The `authorization` object and its signature are the EIP-3009 `TransferWithAuthorization` fields
`(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32
nonce)`. We do not validate them ourselves. They go to the facilitator, which is the thing that can
check a signature against chain state.

### 5. The facilitator

`https://x402-facilitator.molandak.org`, overridable with `X402_FACILITATOR`. Its `/supported` lists
`exact`, `upto` and `batch-settlement` on both `eip155:143` and `eip155:10143`, all at x402Version 2,
with signer `0x7f6a2850669202519f0FE8aa912451238820Db86`. This endpoint settles `exact` on
`eip155:143`. Two calls, both POST, 20 second timeout:

```
POST /verify  { x402Version: 2, paymentPayload, paymentRequirements }
POST /settle  { x402Version: 2, paymentPayload, paymentRequirements }
```

The requirements go again beside the payload so the facilitator checks the payment against what the
server asked for, not only against what the client claims it was asked for.

### 6. Work first, settle second

**The check runs before the money moves.** If the check throws, nothing has been settled and the
payer still holds a valid authorization they can spend elsewhere:

```
HTTP 500
{ "title": "The check did not complete",
  "charged": false,
  "retryable": true,
  "note": "Your payment was verified and deliberately not settled, because we did not deliver. The authorization is still yours to spend." }
```

A settlement that verifies but does not confirm does not hand back the paid result. The response is
`402 "Payment did not settle"`, `charged: false`, with the facilitator's reason in `detail` and the
authorization released so a genuine payer can retry the same signed message. A paid `200` therefore
always carries `payment.settled: true`.

### 7. The receipt header

When settlement produced a transaction:

```
x-payment-response: <base64 of {"success":true,"transaction":"0x…","network":"eip155:143","payer":"0x…"}>
```

`payer` is omitted when the facilitator did not return one. The header is in
`access-control-expose-headers`, so a browser client can read it back.

### 8. A worked example

Fully reproducible, because the document is a `data:` URI you can build yourself.

```bash
# An execution.market shaped claim citing a transaction that really is on Monad.
DOC='data:application/json;base64,eyJuZXR3b3JrIjoibW9uYWQiLCJwcm9vZl9vZl9wYXltZW50Ijp7Im5ldHdvcmsiOiJtb25hZCIsInBheW1lbnRfdHgiOiIweGYwNDRjNzU0M2VmNDUxOWQwZGI4ZDI5YzljZDVlNmJhYTNhNTYxMWU3MzU5MDVkNDE3M2NlNDAxZWU1MjZkOGEiLCJzdGF0dXMiOiJhbmNob3JlZCJ9fQ=='

# 1. Ask without paying. 402 plus the challenge.
curl -sS -i -X POST 'https://kanmani.xyz/api/verify' \
  -H 'content-type: application/json' \
  -d "{\"uri\": \"$DOC\"}"

# 2. Sign an EIP-3009 authorization for 10000 units of USDC to payTo, build the v2 payload
#    from step 1's `accepts[0]`, base64 it, ask again.
curl -sS -i -X POST 'https://kanmani.xyz/api/verify' \
  -H 'content-type: application/json' \
  -H "PAYMENT-SIGNATURE: $(printf '%s' "$PAYLOAD_JSON" | base64 -w0)" \
  -d "{\"uri\": \"$DOC\"}"

# 3. Pass the commitment too, so `intact` means something.
curl -sS -X POST 'https://kanmani.xyz/api/verify' \
  -H 'content-type: application/json' \
  -H "PAYMENT-SIGNATURE: $(printf '%s' "$PAYLOAD_JSON" | base64 -w0)" \
  -d "{\"uri\": \"$DOC\", \"feedbackHash\": \"0x679e20a6dfc1917b221e376bdbf15d6fd9d5535aba4739608b3208a5c1b3a8ec\"}"
```

That document decodes to 160 bytes whose keccak256 is
`0x679e20a6dfc1917b221e376bdbf15d6fd9d5535aba4739608b3208a5c1b3a8ec`. It matches
`execution-market.v1`, declares network `monad` and cites
`0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a`, which is on Monad at block
106462031. The verdict is `true` at rung `true`, with `hashWasSupplied: false` on calls 1 and 2,
`true` on call 3.

That transaction is this project's own x402 settlement, submitted by the facilitator signer for
0.01 USDC. **It was a self-payment, so the net USDC movement is zero.** It proves the machinery
works. It does not prove a stranger paid us. Checking it through this endpoint is the loop closing:
the thing that audits payments is paid for over the rail it audits. Its own settlement is readable
by the same check.

---

## The free preview

**A caller cannot consent to a price without seeing what it buys.** An unpaid POST gets the full
shape of the answer in the 402 challenge. Beyond that, a document already in our index returns its
verdict for nothing:

```bash
curl -sS -X POST 'https://kanmani.xyz/api/verify' \
  -H 'content-type: application/json' -d '{"id": "143_10182_0x1030…13C7_2"}'
```

```json
{
  "paid": false,
  "whyFree": "This document is already in our index with a recorded verdict, so nothing was fetched and nothing was charged. Re-checking it on demand would cost a request on somebody else's server and you can ask for that by posting without a feedbackHash.",
  "claimId": "143_10182_0x1030…13C7_2",
  "url": "https://kanmani.xyz/claim/143_10182_0x1030…13C7_2",
  "verdict": {
    "outcome": "false", "rung": "parsed", "mapping": "execution-market.v1",
    "reason": "no transaction with this hash on Monad at block 106462031",
    "declaredNetwork": "monad", "declaredTx": "0x…",
    "hashMatches": true, "foundOnChain": null,
    "checkedAt": "2026-09-19T21:03:55.900Z", "checkedAtBlock": "106462031"
  }
}
```

`whyFree` is said in the response rather than implied by the absence of a charge. An agent reading
this will not read the docs.

**The pricing line.** Reading a verdict we already hold costs a database query, so it is free.
Fetching a URL on somebody else's server and making an RPC call spends their bandwidth, so it is
priced. That is the honest line between the two. It is stated in the 402 body rather than left for
a caller to work out, because charging twice for work done once is a toll rather than a price.

Two conditions gate the free path:

1. **You sent a `feedbackHash`** (or an `id` that resolves to one). With no commitment there is
   nothing to match against the index, so the request takes the paid path.
2. **A claim with that hash is in the most recent 1,000 indexed claims carrying a document, with a
   recorded verdict.** The lookup scans that window ordered by block number descending. A match
   further back falls through to the paid path rather than erroring.

To force a fresh check of a document already in the index, post its `uri` with no `feedbackHash`.
That is the paid path. Use it when you think a document has changed.

---

## Error semantics that matter

| status | meaning | your money |
|---|---|---|
| 200 | answered, including `outcome: "unknown"` | charged, if you paid |
| 400 | the request is wrong. Names what | untouched |
| 401 | vault write with no signature | n/a |
| 402 | pay (the facilitator rejected your payment or settlement did not confirm) | untouched |
| 403 | vault write whose signature recovered a different address | n/a |
| 404 | not in this index. Not the same as not existing on chain | untouched |
| 500 | the check threw after your payment verified | **verified, deliberately not settled** |
| 503 | we could not reach the facilitator | untouched. Nonce unburned |

**A facilitator outage answers 503 and never 402.** This is the most important error rule here. A
client told its payment is invalid will re-sign. Re-signing burns a nonce for nothing. So "we could
not check your payment" and "your payment is not valid" get different status codes:

```
HTTP 503
{ "title": "We could not check your payment",
  "detail": "could not reach the facilitator: …",
  "retryable": true,
  "note": "Your payment was not rejected. We could not reach the facilitator to look at it. Nothing was charged and your authorization is untouched." }
```

Retry the same signed authorization. Do not re-sign.

| facilitator behaviour | our answer |
|---|---|
| unreachable, timed out at 20s | 503 |
| HTTP 5xx | 503 |
| a body that is not JSON | 503 |
| JSON with `isValid: false` | 402, carrying its own `invalidReasonDetails` |

**Work is performed before settlement**, so a failed check never charges. The order is: read the
payment header, verify with the facilitator, run the check, settle, respond. A throw anywhere
before the settle call leaves the authorization spendable.

---

## The vault

`/api/vault` holds AES-256-GCM ciphertext. The server never holds a key. The content key is derived
in the browser from a passkey PRF output through HKDF-SHA256 under the info string
`kanmani.vitreous.v1`. The account key that signs a write comes from the same ceremony under
`kanmani.iris.v1`, so one passkey prompt gives both.

### `GET /api/vault`

| parameter | type | notes |
|---|---|---|
| `address` | string | required, `^0x[0-9a-fA-F]{40}$`, matched case-insensitively |
| `context` | string | optional. Returns one blob instead of all of them |

```bash
curl -sS 'https://kanmani.xyz/api/vault?address=0x92c2a8984eb7b890FfB4c6B57560Ac4E4868454B'
```

```json
{
  "address": "0x92c2a8984eb7b890FfB4c6B57560Ac4E4868454B",
  "note": "These are AES-256-GCM blobs. Reads are open because there is nothing here that access control could protect: the key is derived from a passkey this server never sees.",
  "blobs": [
    { "context": "kanmani.vault.agent-memory.v1",
      "sealed": { "v": 1, "context": "kanmani.vault.agent-memory.v1", "nonce": "…", "ct": "…" },
      "signature": "0x…", "updatedAt": "2026-09-20T18:20:11.004Z" }
  ]
}
```

**Reads are open and that is deliberate.** Anyone can fetch anyone's blob. It is ciphertext and the
key is derived from a passkey we never see, so there is nothing here that access control could
protect. Gating it would imply the confidentiality comes from us saying no, which would be a worse
claim than the true one.

An address with nothing stored returns `200` with `"blobs": []`. There is no 404, because "we hold
nothing for this address" is an answer rather than a missing resource. The only error is `400 "Bad
address"`.

### `PUT /api/vault`

Body: `address`, `sealed` as `{v: 1, context, nonce, ct}`, `signature` as 65 bytes of hex.

**Writes are not open**, for a different reason than reads. Without a signature anyone could
overwrite anyone's blob. They still could not read it. Destroying somebody's only copy is damage
enough on its own. The signature is stored alongside the ciphertext and returned on read, so you
can check it yourself rather than trusting that we did.

The exact message that gets signed is six fields, newline-joined, in this order:

```
kanmani.vault.write.v1
<address, lowercased>
<sealed.context>
<sealed.v as a decimal string>
<sealed.nonce>
<sealed.ct>
```

Then `keccak256` over those UTF-8 bytes, signed with the secp256k1 account key. The server recovers
the public key, derives the address, compares it to the `address` in the request. A mismatch is a
refusal, never a warning.

Four details a client gets wrong, where the failure looks identical each time:

1. **No EIP-191 prefix.** A raw secp256k1 signature over `keccak256(message)`. Output from
   `personal_sign` will not verify, because that hashes a prefixed message.
2. **The recovery byte is 0 or 1**, not 27 or 28. Anything else is refused.
3. **Exactly 130 hex characters after the `0x`.** Not 128, not 132.
4. **Fixed field order, `\n` separator.** `JSON.stringify` would depend on whoever built the
   object, so two correct clients could produce different bytes for the same write. The one
   implementation of this message lives beside the code that checks it.

Success returns `stored`, the lowercased address, the context, the ciphertext length, plus the note
"Stored as ciphertext. This server cannot read it and holds nothing that could."

| status | title | when |
|---|---|---|
| 400 | `Body is not JSON` | the body did not parse |
| 400 | `Bad address` | `address` missing or malformed |
| 400 | `Bad envelope` | `sealed` is not `{v:1, context, nonce, ct}` with string fields |
| 401 | `Unsigned write` | no `signature`. Carries a `sign` field spelling out the message |
| 403 | `Signature does not match this address` | recovered a different address. Nothing was written |
| 413 | `Body too large` | the request body is over 65,536 bytes |
| 413 | `Envelope too large` | `context` is over 128 or `ct` over 32,768 characters |
| 429 | `Too many vault entries for this address` | this address already holds 100 contexts and the write is a new one |

The 403 carries a `check` field naming the likely client bug rather than leaving you to guess at
ours. The primary key is `(address, context)`, so a second write to the same context replaces the
first. There is no DELETE.

Every blob is bound to its purpose: the `context` string goes in as AES-GCM additional
authenticated data, so a job brief cannot be opened as agent memory even though both use the same
content key. The three contexts in use are `kanmani.vault.job-brief.v1`,
`kanmani.vault.agent-memory.v1` and `kanmani.vault.deliverable.v1`.

A body is capped at 65,536 bytes, `ct` at 32,768 characters and `context` at 128 characters. One
address may hold at most 100 distinct contexts, so a new context over that is refused with 429 while
updates to the contexts it already holds still work. A signature proves control of an address, not
that addresses are scarce: anyone can make a keypair and sign their own blobs, so the ceiling is per
address rather than global.

Stored: address, context, version, nonce, ciphertext, signature, timestamp. Not stored: any
credential id, any PRF salt, any session, any cookie. A dump of that table is a pile of blobs plus
a list of addresses that are public anyway.

---

## For agents

**Never collapse `unknown` into `false`.** Build on this API and treat them as the same and you
will publish accusations on the strength of a rate limit. Every response keeps them apart and so
should yours. Same for `null`, which means nothing has checked yet. It is not zero.

Free, no payment, no key:

```
POST https://kanmani.xyz/api/registration/check
POST https://kanmani.xyz/api/evidence/check
GET  https://kanmani.xyz/api/claims?outcome=false&limit=100
GET  https://kanmani.xyz/api/agent/<agentId>
GET  https://kanmani.xyz/api/account/<address>
GET  https://kanmani.xyz/api/vault?address=0x…
GET  https://kanmani.xyz/feed.json
GET  https://kanmani.xyz/schema.json
GET  https://kanmani.xyz/openapi.json
GET  https://kanmani.xyz/llms.txt
GET  https://kanmani.xyz/agents.md
GET  https://kanmani.xyz/skill.md
POST https://kanmani.xyz/mcp
```

The two `check` endpoints are the ones to start with if you are building an agent rather than reading
about one. See [34-EVIDENCE-CHECK](34-EVIDENCE-CHECK.md). `/mcp` is the same surface as MCP tools,
see [33-MCP](33-MCP.md). The full endpoint catalogue is below.

Paid: `POST /api/verify`, 0.01 USDC over x402. `POST /api/testnet/verify` is the same work settled in
tUSDC on Monad testnet ([37-TESTNET](37-TESTNET.md)). The hireable agents under
`/api/service/<slug>` are priced separately ([30-AGENTS](30-AGENTS.md)).

**Rate limits.** There is no rate limiting on the free read endpoints documented above. No token
bucket, no quota, no `retry-after`. That is a statement about what is built rather than a promise
about the future. If a limit is added it goes into `/agents.md` before it is enforced. The response
will carry `retry-after`. Paid verification is one document per payment with no burst allowance to
discover by hitting a wall. One endpoint does ship a limiter: `POST /api/testnet/mint` is capped per
IP and per day, because a sponsored mint is a spend.

**What we do with what you send.** A `POST /api/verify` fetches the URI you give us. We record the
verdict, the URI and the time, because the site is an append-only record of checks. **We do not
record who asked.** No request log ties a payer to a query. No cookie, no session.

What happens to a URI you hand us, because it shapes what comes back:

| behaviour | detail |
|---|---|
| private addresses | refused. Loopback, RFC1918, carrier-grade NAT, link-local including `169.254.169.254`, multicast, IPv4-mapped IPv6 forms of all of them |
| DNS | resolved once, every answer screened, the survivor pinned into the socket. A record that answers public then private cannot slip through |
| redirects | followed by hand, re-screened every hop, 3 maximum |
| size cap | 64 KB, enforced on arriving bytes. `Content-Length` is never consulted |
| timeout | 8 seconds per request |
| `data:` URIs | decoded in process with no network call. Most of Monad's 1,292 checkable documents are these |
| `ipfs://` | through `https://ipfs.io/ipfs/`, so still a guarded fetch. The CID is validated segment by segment |

A refusal comes back as `outcome: "unknown"` with the reason. Never a hang. Never `false`.

**What we will not do.** We will not tell you an agent is fraudulent, we report what was observed.
We will not return a score, there is no ranking number here to optimise against. We will not return
`false` for something we failed to fetch.

**Reproducing anything.** Every JSON response carries `reproduce` with the exact command that gets
the same answer without us. If our answer and that command ever disagree, ours is wrong.

---

## Known rough edges

Published rather than quietly smoothed over, because a reference that hides its own inconsistencies
costs you a debugging session.

**`foundOnChain` uses two key names.** The list endpoints (`/api/claims`, `/feed.json`,
`/api/agent/{id}`) emit `{chain, chainId, block}`. `/api/verify` emits `{chain, chainId,
blockNumber}`, which is what `/schema.json` documents. Read both if you consume both.

**CORS advertises `x-payment` but not `payment-signature`.** The `access-control-allow-headers`
value on `/api/*` is `content-type, x-payment`. A browser client sending the v2 header cross-origin
is stopped at preflight, so from a browser today `X-PAYMENT` is the one that gets through.
Server-side clients are unaffected, since preflight does not apply to them.

**`access-control-allow-methods` does not list `PUT`.** A cross-origin browser write to
`/api/vault` will not pass preflight. The site's own account page writes same-origin, so it works
there.

**`www-authenticate` is exposed but never set.** The 402 challenge lives in the response body.
There is no `WWW-Authenticate` header to read.

**`limit` is clamped at both ends.** `/api/claims` floors `limit` at 1 and caps it at 1,000, so a
negative or zero value is treated as 1 rather than reaching the database as a negative `LIMIT`.
`/feed.json` does the same with a cap of 5,000. `offset` is floored at 0. All of them are clamped
silently rather than refused.

**The free preview window is 1,000 rows.** A hash older than that window takes the paid path
instead of the free one, with no signal that it did.

**`/api/agent/{id}` does not page its claims.** At most 200, newest first. Use `/api/claims` for
the rest.

---

## Licence

Source-available, no derivatives. `LicenseRef-zkasuran-SAND-1.0`, in [`LICENSE`](../LICENSE). You
may run this for any purpose including commercially, read it, decompile it, benchmark it and
publish what you find. Redistribution and derivative works are withheld.

## AI disclosure

AI assistance (Claude, Anthropic) was used in writing this document. Every field name, status code,
literal string and limit above was read out of the route that emits it before it was written down.
The worked example was run through the shipped resolver and atlas: the 160 byte length, the
keccak256 digest and the `execution-market.v1` mapping are that run's output rather than an
assertion.
