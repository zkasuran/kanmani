# 37. The testnet rail

A brand-new passkey account holds nothing. On mainnet that means a reader who wants to watch the
payment path work has to acquire USDC first. The testnet rail removes that: a sponsored mint funds the
account, then a paid check settles over x402 on Monad testnet, so a new account reaches a confirmed
transaction with zero funding steps and no MON.

Two endpoints, one token, one registry of network facts:

| surface | what it is |
|---|---|
| `POST /api/testnet/mint` | the sponsored tUSDC mint. Idempotent per address, rate limited per IP, capped per day |
| `POST /api/testnet/verify` | a sibling of `/api/verify` that settles in tUSDC on chain 10143 |
| `TestUSDC` | a USDC-shaped ERC-20 with real EIP-3009, six decimals, that refuses to deploy on mainnet |
| `lib/pay-net.ts` | the one place the mainnet and testnet payment configs live |

The code is `app/api/testnet/mint/route.ts`, `app/api/testnet/verify/route.ts`,
`lib/testnet-mint.ts` (the policy, kept pure), `lib/pay-net.ts` and `contracts/src/TestUSDC.sol`.

## The mainnet path did not move

`requirementsFor("mainnet")` pulls every value from `lib/x402.ts`, so it is byte-identical to
`requirements()`. A test asserts exactly that. The testnet rail was added **beside** the live payment
path rather than by threading a flag through `lib/x402.ts` or `lib/pay.ts`, because the mainnet `/pay`
and `/api/verify` carry real USDC and a refactor that touched them to serve a demo would be the wrong
trade.

| | mainnet | testnet |
|---|---|---|
| network | `eip155:143` | `eip155:10143` |
| asset | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | `0x841057C182b74408628FadAFba01Ad178cDA2E2f` |
| EIP-712 domain | `{name: "USDC", version: "2"}` | `{name: "Kanmani Test USD", version: "1"}` |
| decimals | 6 | 6 |
| price | `10000` atomic, 0.01 | `10000` atomic, 0.01 |
| payee | `0xDB6c6340342e71A63cD11Ebac2185204b7777777` | the same house EOA, so the payee pin holds on testnet too |
| explorer | `https://monadexplorer.com/tx/` | `https://testnet.monadscan.com/tx/` |

The domain is the part that bites. Monad's own guide says testnet "has no built-in entry and requires
the custom money parser", so a client that reuses `{name: "USDC", version: "2"}` on testnet produces a
signature the token will not recover. The two domains live in `lib/pay-net.ts` rather than coming from
an SDK default.

The testnet asset is read from `TESTNET_USDC` with
`TESTNET_USDC_FALLBACK = 0x841057C182b74408628FadAFba01Ad178cDA2E2f` when that is unset, so a build
with no env still points somewhere real and a redeploy is one env change rather than a code edit.

## TestUSDC and why the contract refuses mainnet

`contracts/src/TestUSDC.sol`, deployed on chain 10143 at
`0x841057C182b74408628FadAFba01Ad178cDA2E2f`. Read live from that chain: `name()` is
`Kanmani Test USD`, `symbol()` is `tUSDC`, `decimals()` is `6`, `DOMAIN_SEPARATOR()` is
`0x4c1d82db73979d84b50c6526ef059b9d43a75f7f1708f3b398996c9dda8ec1bc`.

```solidity
constructor() {
    if (block.chainid == 143) revert MainnetRefused();
    ...
}
```

The constructor reverts on Monad mainnet. That is the guarantee rather than a convention: a token with
an open `mint` and a USDC shape is exactly the thing that should never exist on a chain where somebody
could mistake it for money and this bytecode cannot be put there at all. `mint` is permissionless and
capped per call at `MAX_MINT = 1_000_000e6`. The name and symbol say what it is.

`transferWithAuthorization` is real EIP-3009, with the full set of refusals:
`AuthorizationNotYetValid`, `AuthorizationExpired`, `AuthorizationAlreadyUsed`, `InvalidSignature`.
The gasless path works because the token works, not because a facilitator was asked nicely.

## `POST /api/testnet/mint`

```bash
curl -sS -X POST https://kanmani.xyz/api/testnet/mint \
  -H 'content-type: application/json' -d '{"address":"0x…"}'
```

This is the first server-held signing key in the app, so it is scoped hard:

- A dedicated testnet-only minter, never the house mainnet key.
- It only ever calls `TestUSDC.mint` on chain 10143. The route reads `eth_chainId` before sending and
  returns `500 "Wrong chain"` if the configured RPC is anything else.
- With no `TESTNET_MINTER_KEY` the route is inert and answers `503`, so a build that ships only
  mainnet is safe by default. **The public deployment has no minter key wired, so a live POST returns
  that 503 today.** That is the fail-closed posture, the same one `/api/fund/*` takes.
- The minter key is never in an error. A failure is logged server-side and answered as
  `502 "The mint did not land"` with `retryable: true`.

A sponsored mint is a spend, so it is bounded three ways. All three are named constants in
`lib/testnet-mint.ts` rather than scattered through the route:

| constant | value | what it bounds |
|---|---|---|
| `FUND_FLOOR` | `100_000` (0.1 tUSDC) | below this an account is funded, at or above it nothing is sent |
| `FUND_AMOUNT` | `250_000` (0.25 tUSDC) | what one funding mints, far under the token's own `MAX_MINT` |
| `IP_WINDOW_MS` / `IP_WINDOW_MAX` | 1 hour / 5 | distinct addresses one IP may fund in a sliding window |
| `DAILY_MAX` | 500 | a global backstop so the faucet cannot be drained in a day |

The floor is what bounds total spend: each address is funded at most once, so a second request for a
funded address sends no transaction and answers `alreadyFunded: true` with the balance and the floor.
`decideMint` is pure and the rate limiter takes an injected clock, so expiry is deterministic in a
test with no network.

Sends are serialised through `enqueueSend`, a module-level promise chain, so two concurrent mints from
the one minter never reuse a nonce.

| status | when |
|---|---|
| 200 | funded already, nothing minted or the mint landed with `txHash` and `explorerTx` |
| 400 | body is not JSON or `address` is not a 20-byte hex address |
| 413 | body over 1,024 bytes |
| 429 | too many mints from this address range or the daily ceiling is reached |
| 500 | the configured RPC is not chain 10143. Refusing to mint |
| 502 | the testnet RPC is unreachable, the balance could not be read or the mint did not confirm |
| 503 | no minter key on this deployment |

## `POST /api/testnet/verify`

The same work as `/api/verify`, settled in tUSDC on chain 10143. An unpaid `GET` or `POST` returns the
402 challenge for `eip155:10143`:

```bash
curl -sS https://kanmani.xyz/api/testnet/verify
```

```json
{
  "x402Version": 2,
  "error": "This endpoint takes POST and settles on Monad testnet.",
  "accepts": [{
    "scheme": "exact", "network": "eip155:10143", "amount": "10000",
    "asset": "0x841057C182b74408628FadAFba01Ad178cDA2E2f",
    "payTo": "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
    "maxTimeoutSeconds": 60,
    "extra": { "name": "Kanmani Test USD", "version": "1" }
  }]
}
```

An empty body checks a self-contained `data:` document instead of refusing. That is deliberate: the
demo target resolves with no network call, so the paid path always runs and a settlement always lands
even when there is no external document to fetch. A caller may still pass `{"uri": "…"}`.

`paymentFrom` is called with `eip155:10143` rather than the mainnet default, so a correctly signed
testnet payment is accepted and a mainnet-shaped one is refused by name.

The order is identical to mainnet: read the header, verify with the facilitator, reserve the nonce, do
the work, settle, confirm, respond. A facilitator outage is `503` and never `402`, so a client does
not re-sign and burn a nonce for nothing. A settlement that verifies but does not confirm releases the
nonce and answers `402 "Payment did not settle"` with `charged: false` and `retryable: true`, so the
paid result is never handed back on an unconfirmed settle. A paid `200` therefore always carries
`payment.settled: true`.

The paid body adds a `txUrl` built from the testnet explorer base plus the note "A settled testnet
payment, relayed and paid for by the facilitator. The account held no MON." The account really does
hold no MON: the facilitator relays the signed EIP-3009 authorization and pays the gas.

Monad's facilitator serves this. Its `/supported` lists `exact`, `upto` and `batch-settlement` on both
`eip155:143` and `eip155:10143`, with signer `0x7f6a2850669202519f0FE8aa912451238820Db86`.

## One rough edge

The `help.price` line in the testnet challenge body reads "0.01 USDC on Monad, chain 143, six
decimals". That string is shared with the mainnet challenge, so on the testnet endpoint it names the
wrong chain and the wrong token while `accepts[0]` beside it is correct. `help` is not part of the
x402 specification and no client pays from it, so this misleads a human reading the body rather than
breaking a payment. Stated here rather than left for somebody to find.

## Related

- [21-MERA-UX](21-MERA-UX.md) one passkey, a scoped session and the gasless mainnet transaction.
- [10-API](10-API.md) the mainnet `/api/verify` and the x402 flow in full.
- [01-GROUND-TRUTH](01-GROUND-TRUTH.md) the contract facts read from an RPC.
- [38-PAY-RUNS](38-PAY-RUNS.md) the time-to-first-transaction this rail is measured by.
