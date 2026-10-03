# 39. The receipt endpoints

Three paths under `/api/receipt`. Two do work, one points at them.

| endpoint | what it is |
|---|---|
| `GET /api/receipt` | an index. No verifier lives here |
| `POST /api/receipt/verify` | check a verification receipt's signature. Holds no key, verifies any receipt |
| `POST,GET /api/receipt/action` | publish and read who authorised a change to an agent's document |

The code is `app/api/receipt/route.ts`, `app/api/receipt/verify/route.ts`,
`app/api/receipt/action/route.ts`, with the cryptography in `lib/iris.ts` and `lib/authority.ts`.

## The identity that signs these is not a wallet

Both receipt kinds are signed by an ed25519 key derived from a passkey and published as a
`did:key:kanmani:<base64url>`. It reconstructs on any device from the same passkey and it **cannot
move money**. That is the whole point: a receipt can be attributed to a person without handing the
signer any spending authority. The derivation is in [32-PRF-PRIMITIVES](32-PRF-PRIMITIVES.md).

## `GET /api/receipt`

A courtesy index, so a reader who guesses the bare path lands somewhere real. It names the two
endpoints that do the work and says plainly that the attestation key owns nothing.

There is deliberately no verifier on this path. A second POST verifier would be a second thing that
can drift from the first.

## `POST /api/receipt/verify`

Open to anyone, no key and no payment.

```bash
curl -sS -X POST https://kanmani.xyz/api/receipt/verify \
  -H 'content-type: application/json' \
  -d '{"receipt":{"claimId":"143_10182_0xabc_1","outcome":"false",
        "checkedAtBlock":"106462031","checkedAt":"2026-09-20T00:00:00.000Z",
        "mapping":"execution-market.v1"},
       "signature":"<64 bytes hex>","publicKey":"<32 bytes hex or did:key:kanmani:…>"}'
```

```json
{
  "valid": false,
  "checked": {
    "claimId": "143_10182_0xabc_1", "outcome": "false",
    "checkedAt": "2026-09-20T00:00:00.000Z", "checkedAtBlock": "106462031",
    "mapping": "execution-market.v1"
  },
  "signedBytesFormat": "kanmani.receipt.v1\\n<claimId>\\n<outcome>\\n<checkedAtBlock>\\n<checkedAt>\\n<mapping>, UTF-8, ed25519 over exactly those bytes",
  "note": "This signature does not verify for these bytes under this key. Either the receipt was altered, the key is a different identity or the signature is not ours to check."
}
```

**A receipt we never issued verifies here exactly as well as one we did, provided the signature is
good.** That is the property worth having. An endpoint that only validated our own receipts would be a
loyalty check rather than a verification and it would be useless to the one reader who matters: the
person who does not trust us and does not run our code.

Three details make it usable by that reader:

- **A bad signature is `valid: false`, never an error.** Somebody checking a third party's receipt is
  doing the right thing and deserves an answer rather than a stack trace.
- **The signed bytes are canonical and published in the reply.** A versioned tag then the fields in
  fixed order, newline separated, UTF-8. So a third party reproduces the digest from the receipt alone
  and does not have to take our word for the encoding.
- **The `checked` block is echoed back**, so a caller sees exactly which bytes were checked rather
  than assuming their own object was parsed the way they meant it.

`publicKey` takes the raw 32-byte hex or the `did:key:kanmani:<base64url>` form the account page
publishes, because that is the form a reader has in hand. `signature` is 64 bytes of hex with or
without `0x`. The receipt is rebuilt field by field rather than spread, so an unexpected key cannot
ride along into the signed bytes.

A `valid: true` says who attested. It never says the outcome is correct.

| status | when |
|---|---|
| 400 | `Body is not JSON`, `Bad receipt`, `Missing fields`, `Bad signature` (not 64 bytes), `Bad public key` (not 32 bytes) |
| 200 | answered, with `valid` either way |

`GET` returns a usage document with a worked example receipt.

## `POST /api/receipt/action`

An action receipt is proof of who authorised a change to an agent's document. Open to anyone, no key
and no payment, **because the signature is the authorisation.** Only the holder of that passkey could
have produced it, so gating submission behind an account would add a check that proves less than the
signature already does.

Body is `{ receipt, signature, binding }`, the exact object `/studio` offers to copy. The receipt
carries `action` (`register` or `setAgentURI`), `chainId`, `agentId` (null for a registration, because
the registry assigns the id after the fact), `uriHash`, `signer`, `identity` and `at`.

### What is verified before anything is written

Two signatures, both checked before the insert, never after.

**`verifyAction`** re-derives the canonical bytes and checks the ed25519 signature against the public
key carried inside the receipt's own `did:key`. A receipt cannot be verified against a key it does not
name. The canonical bytes are:

```
kanmani.agent-action.v1
<action>
<chainId>
<agentId or empty when null>
<uriHash>
<signer, lowercased>
<identity>
<at>
```

A refusal returns `400 "Signature does not verify"` and includes the canonical string, so a client can
find its own bug rather than guessing at ours.

**`verifyBinding`** checks a secp256k1 signature over the same digest and recovers it to the `signer`
address. This one is required and the reason is worth stating: the ed25519 signature says nothing
about an EVM address, so without the binding a receipt could name any address as its signer. A
mismatch is `400 "Binding does not verify"` and nothing is stored.

A receipt that does not check out is refused rather than kept with a flag. A stored-but-invalid row is
one query away from being rendered as if it were good.

### Ceilings, because an anonymous signed write is cheap to produce

| ceiling | value |
|---|---|
| body | 8,192 bytes |
| `signature`, `binding` | 200 characters each |
| `identity` | 200 characters |
| `at` | 40 characters and must parse as an ISO 8601 instant |
| rows per identity | 500, answered `429 "Too many receipts for this identity"` |

Every field is bounded in shape as well as type: `chainId` a positive integer, `agentId` null or a
non-negative safe integer, `uriHash` a `0x` 32-byte hash, `signer` a `0x` address. Without that, a
stranger can vary the `uriHash` to defeat the dedup and store an unbounded number of oversized rows,
since the signature is their own and costs them nothing to make.

The dedup is `ON CONFLICT (identity, uri_hash, action)`, so a replay is the same row rather than a
second one and the reply says `firstTime: false`. `201` on a first insert, `200` on a replay.

### What a stored receipt does not claim

It says one identity authorised one document. It does **not** say the transaction landed, that the
signer owns the agent or that the document is good. The registry decides ownership and the verdict
ladder decides truth. This is neither. An endpoint that implied otherwise would be manufacturing
standing out of a signature, which is the shape of claim this project exists to check rather than to
produce. The `note` field says so in every reply.

### Reading them back

`GET /api/receipt/action?agentId=<id>` returns that agent's receipts, newest first, capped at 100.
Without the parameter it returns the most recent 100 across all agents. Signatures and bindings are
included in every row, so a reader verifies them without trusting us, either through
`POST /api/receipt/verify` or offline against the `did:key` in each `identity`. A non-numeric
`agentId` is `400 "Bad agent id"`.

## One rough edge

**`GET /api/receipt/action` answers a framework 500 with an empty body on the live deployment today**,
with and without `agentId`. Checked three times on 2026-10-03 and reproducible. The parameter
validation runs first and still answers correctly (`?agentId=xx` returns the `400 "Bad agent id"`
problem+json), so the failure is in the read of `fovea.agent_action` rather than in the route's input
handling. The POST path is unaffected by this and the shape above is what the route returns, read off
the code. Published here rather than quietly omitted, because a reference that hides a 500 costs the
reader a debugging session.

## Related

- [32-PRF-PRIMITIVES](32-PRF-PRIMITIVES.md) the passkey ceremony these identities are derived from.
- [10-API](10-API.md) the rest of the HTTP surface, including the vault these receipts sit beside.
- [14-GAPS](14-GAPS.md) what the build does not do yet.
