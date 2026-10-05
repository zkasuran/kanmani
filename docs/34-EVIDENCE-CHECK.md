# 34. The two free build checks

Two endpoints exist so a builder can find out what is wrong before anything is on chain. Both are
free, both take POST, neither signs, stores or keeps anything.

| endpoint | what it answers |
|---|---|
| `POST /api/registration/check` | is this ERC-8004 registration draft ready, what will each field commit you to and what is the exact transaction to send |
| `POST /api/evidence/check` | what outcome will this evidence document get once published and if it will be `false`, why |

The code is `app/api/registration/check/route.ts`, `app/api/evidence/check/route.ts` and the shared
`lib/build-server.ts`. The same two functions are the `check_registration` and `check_evidence` tools
on [the MCP server](33-MCP.md), so the browser studio, a shell script and an agent get one answer.

## Why a pre-publish check is worth an endpoint

A registration lands on chain once. A bad `agentURI` is a second transaction to repoint and an
`https://` document that later goes dead takes the agent's whole identity with it. An evidence
document is worse: it is hashed and committed, so a mislabelled `network` field is permanent and reads
as a false payment claim forever. 123 of the <!-- n:claims -->187<!-- /n --> payment claims on Monad cite a transaction that is
not on the chain the document names. A free check before publishing is the cheapest place to catch
that.

## `POST /api/registration/check`

Body:

```json
{
  "draft": {
    "name": "Scout",
    "description": "Finds agents worth hiring",
    "url": "https://example.com",
    "skills": [{ "id": "find", "endpoint": "https://example.com/find", "x402": false }],
    "refuses": ["custody of funds"]
  },
  "kind": "data",
  "chainId": 143
}
```

| field | notes |
|---|---|
| `draft.name` | required. Everything else in the draft is optional |
| `kind` | `data` (default) puts the document on chain, so it cannot go dead. `https` points at a URL you host |
| `hostedAt` | only for `kind: "https"` |
| `agentId` | only when repointing an agent the sender already owns. Switches the calldata to `setAgentURI(uint256,string)` |
| `sender` | optional. The address that will send, so the reply can say whether it can pay the gas |

The reply's `data` carries `ready`, `problems`, `consequences`, `document`, `agentURI`, `uriBytes`,
`transaction`, `send`, `next`, `gas` and `canSend`.

```bash
curl -sS -X POST https://kanmani.xyz/api/registration/check \
  -H 'content-type: application/json' \
  -d '{"draft":{"name":"Scout","description":"Finds agents worth hiring"}}' | jq .data.transaction
```

```json
{
  "chainId": 143,
  "to": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  "function": "register(string)",
  "data": "0xf2c298be…",
  "value": "0"
}
```

`send` carries the same call as a `cast` line and a viem snippet. `next` spells out what to do with
the receipt: read the new agent id from the `Transfer` log (topic 3), then watch
`/api/agent/<id>` once the index reaches it.

**Nothing is signed here and nothing can be.** Whoever sends the transaction becomes the owner, so the
agent's own key has to send it. An endpoint that offered to relay it would be asking for the key that
owns the agent.

`ready` is about the document. `canSend` adds the sender's gas and it is deliberately three-valued:
`false` when the draft is not ready, `true` when the draft is ready and the sender can pay, `null`
when no `sender` was given or the chain could not be read. An unreadable chain is not a no. The chain
decides.

`gas` is `null` without a `sender`. With one it is `{state, have, need}` and, when short, a `short`
amount plus a `fix` sentence naming who has to fund it. `state` is `enough`, `short` or `unknown`.

Errors: `400 "Body is not JSON"` or `400 "The draft could not be read"` carrying an `errors` array
naming each field.

## `POST /api/evidence/check`

Send the document itself. URLs are not fetched, which means there is no fetch to abuse and no SSRF
surface on this path.

```bash
curl -sS -X POST https://kanmani.xyz/api/evidence/check \
  -H 'content-type: application/json' \
  -d '{"document":{"network":"base","proof_of_payment":{
        "network":"base",
        "payment_tx":"0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a",
        "status":"anchored"}}}'
```

```json
{
  "outcome": "false",
  "rung": "parsed",
  "reason": "no transaction with this hash on Base at block 52117943",
  "declaredNetwork": "base",
  "declaredTx": "0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a",
  "mapping": "execution-market.v1",
  "foundOnChain": { "chain": "monad", "chainId": 143, "block": 106462031 },
  "advice": [
    "The cited transaction is on monad (chain 143) at block 106,462,031, not on the chain this document names. That is a mislabelled network rather than a missing payment and it is fixable by correcting one field.",
    "Change the network field from \"base\" to the chain named above. That one edit turns this into a checkable claim."
  ],
  "note": "Judged exactly as a published document would be. The `intact` rung needs the on-chain hash, so it is decided only after publishing."
}
```

That is the whole value of this endpoint in one body. The claim is false as written, the payment is
real, the fix is one field. A verifier that only said `false` would leave the builder guessing which
of the two it was.

`document` takes a JSON object, a JSON string or a `data:` URI. `outcome` is `true`, `false`,
`noClaim` or `unknown` and it is a **string**: compare it with `=== "true"`, never for truthiness,
because `"false"` and `"unknown"` are truthy strings. `rung` says how far the check got.
`foundOnChain` is `null` unless a `false` was located elsewhere and it uses the key `block`, the same
as the list endpoints.

The `intact` rung is not decided here. It compares the served bytes against the hash committed on
chain and there is no commitment until the document is published. The `note` says so in every reply
rather than leaving a reader to assume a clean result covers it.

`checkedAtBlock` sits in the envelope rather than in `data`, because it is the chain head the check
was made at. `reproduce` reads "POST the same body again; the judge is deterministic for a given chain
state."

Errors: `400 "Body is not JSON"`, `400 "No document to check"` when the body carries no usable
document or carries a URL and `503 "The check did not complete"` with `retryable: true` when the
check threw. A failure to look is never reported as `false`.

`GET` on either endpoint returns a small usage document instead of a 405, because a human opens these
in a browser before any agent posts to them. `OPTIONS` returns 204.

## The same judge, not a lighter one

`evidenceCheck` calls `check()` in `lib/check.ts`, which is the same function behind the paid
`POST /api/verify`, the nightly sweep, the CLI and the Alchemy re-verify webhook. There is no
"preview judge" with its own rules. A second, simpler ladder is how a site ends up disagreeing with
its own tool, so there is not one.

The `false` branch also runs `findTransaction` in `lib/findtx.ts` across the configured chains, which
is what produces `foundOnChain` and the one-field advice above.

## Related

- [33-MCP](33-MCP.md) the same two checks as MCP tools.
- [35-MACHINE-SURFACES](35-MACHINE-SURFACES.md) `/openapi.json` describes both endpoints and
  `/skill.md` is the step-by-step guide they belong to.
- [04-VERIFICATION-LADDER](04-VERIFICATION-LADDER.md) what each rung can and cannot say.
- [10-API](10-API.md) the rest of the HTTP surface.
