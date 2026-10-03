# 22. Aurora Intents Connect: fund a Monad job from any chain

Kanmani hires agents through an escrow, Aqueous, on Monad. To hire one you need USDC on Monad and a
Monad wallet. That is a real friction point for a buyer who holds funds somewhere else. This document
is about removing it: a buyer funds a job with an asset they already hold on another chain and never
bridges, switches wallets or acquires Monad USDC by hand first.

The code is `lib/intents.ts`, `lib/intents-recover.ts`, `lib/fund-sources.ts` and `lib/fund-ui.ts`,
with tests in `lib/intents.test.ts`, `lib/intents-recover.test.ts`, `lib/intents-sign.test.ts` and
`lib/fund-sources.test.ts`. The surface is the `app/fund/` page plus six server routes under
`app/api/fund/` (quote, create, [id], submit, recover, intermediary). Aqueous is read, never changed:
`contracts/src/Aqueous.sol`.

The live page is [`kanmani.xyz/fund`](https://kanmani.xyz/fund), where the flow, the shortfall guard
and the mainnet run below are all shown. The transaction breakdown is in
[25-PROOF](25-PROOF.md) rather than duplicated here.

---

## 1. What Intents Connect provides

Aurora Intents Connect bridges a source asset, delivers it to an intermediary account on the
destination chain that the source wallet owns through a Chain Signature, then executes destination
steps the caller supplies. Arbitrary contract calls are supported. Their own example is approve then
supply on Aave, so approve then createJob on Aqueous is the same shape.

Read from `https://docs.intents.aurora.dev/llms-full.txt` on 2026-09-23 and probed against the live
API the same day:

- Base URL `https://intents-connect-api.aurora.dev/api/v1`. Quote and plan both come from
  `POST /executions/{wallet}`. `dry: true` prices the batch without creating anything, `dry: false`
  creates the execution and prepares the signing payload.
- `x-api-key` is required on that endpoint, dry or not. Verified: a POST with no key returns
  `401 {"error":"missing or invalid api token"}`.
- A destination step is `{ to, functionSignature, parameters, value }` with an optional `metadata`.
  `functionSignature` is a Solidity signature like `approve(address,uint256)` and `parameters` is the
  argument list. The service encodes the call.
- The response nests under `result`. `result.quote.minAmountOut` is the worst-case delivered amount.
  `result.details.networkFee` is the gas fee the service carves out of the delivery. And
  `result.details.intermediaryAddress` is the account the funds land in.
- The service appends its own fee-transfer step to the echoed `result.steps`. We do not add it.

The intermediary is read separately with `GET /executions/{wallet}/intermediary`, which needs no key.

### Our own routes in front of all of it

Every call to Aurora goes through our own `/api/fund/*` routes, which read `AURORA_INTENTS_API_KEY`
server side and never put it (or the raw Aurora response) in a reply.

| route | method | what it does | needs the key |
|---|---|---|---|
| `/api/fund/quote` | POST | prices a batch without creating anything. Reports a shortfall rather than throwing, so the UI can say "the quote moved, this would be refused" instead of showing a 500 | yes |
| `/api/fund/create` | POST | creates the execution and returns the deposit address, the execution id, the wallet and the signing payload. `201`, falling to `409 "Quote cannot cover the job"` when the guard refuses | yes |
| `/api/fund/submit` | POST | relays the `secp256k1:<base58>` signature to Aurora | yes |
| `/api/fund/recover` | POST | builds a steps-only recovery execution, `refund` or `withdraw`. `dry: true` estimates only | yes |
| `/api/fund/{id}` | GET | one execution's live status. `?wallet=` is required, not optional | no |
| `/api/fund/intermediary` | GET | the intermediary account for a wallet plus its live Monad USDC balance | no |

Without a key wired the four key-requiring routes return `503 "Funding not configured"` for every
request rather than skipping a check, which is itself anonymously verifiable:

```bash
curl -i -sS https://kanmani.xyz/api/fund/quote -d '{}'   # 503
```

Two details worth stating. `/api/fund/{id}` requires `wallet` on the query string because Intents
Connect indexes executions by wallet and has no by-id endpoint, so a missing wallet is a 400 that says
why rather than a silent empty read. And `/api/fund/intermediary` returns `balance: null` when the
chain could not be read, never `0`: an empty intermediary and an unreachable RPC are different facts.

Bodies are capped (8,192 bytes on quote, create and recover, 4,096 on submit) and every field is
shape-checked before anything reaches Aurora. An Aurora response that cannot be read is `502` with
"Nothing was created", never a 500 carrying their error text.

---

## 2. The batch: approve then createJob

Aqueous.createJob takes one struct, read exactly from the source:

```
struct Terms {
    address agent;
    address token;
    uint128 amount;        // the ceiling for a metered job
    uint128 pricePerUnit;  // zero means a flat job
    uint64  deadline;
    bytes32 termsHash;
    bytes32 salt;
}
function createJob(Terms calldata t) external nonReentrant returns (bytes32 jobId);
```

`buildFundingSteps` in `lib/intents.ts` produces two steps. Step one is `approve(Aqueous, amount)` on
USDC. Step two is `createJob(Terms)` on Aqueous. Both are encoded with viem against the real ABIs, so
a wrong argument throws when the batch is built rather than reverting on chain. The selectors are
derived from those ABIs and checked in the tests: `approve` is `0x095ea7b3` and `createJob` is
`0x4eaad653`, which matches the selector found in the deployed bytecode.

The amount baked into `createJob` is the guaranteed delivered amount, which is the post-fee
`minAmountOut` from the quote. It is never the pre-fee figure. The approve amount equals it too, so no
stale allowance is left behind on a shared account.

---

## 3. Why the exact-amount revert composes safely

Aqueous is deliberately strict. `createJob` pulls `Terms.amount` with `transferFrom` and then runs
`_requireExactlyReceived`, which reverts unless the escrow balance grew by exactly `Terms.amount`. It
is a fee-on-transfer guard. It means the terms amount has to equal what actually arrives.

Intents Connect answers that requirement directly. `minAmountOut` is the amount the bridge guarantees
to deliver in the worst case, after the fee is carved out. The docs say it plainly: before signing,
compare `result.quote.minAmountOut` with the amount baked into the steps, they should be equal. If
the returned value is lower the batch will not have enough token to cover the call. So we set
`Terms.amount` to the guaranteed delivery and refuse to proceed when `minAmountOut` is below it.
`enforceShortfallGuard` is that refusal, on its own so it can be tested.

Two properties make the strictness safe rather than fragile.

- The intermediary is an account the source wallet owns. It is the caller for both steps, so it is
  the job's buyer of record. That is correct, because the user owns it.
- A revert does not lose the funds. On a revert the delivered assets stay in the intermediary.
  Recovery is a separate user-authorized withdrawal with Intents Connect covering the gas. So a short
  or wrong amount reverts and the funds are recoverable. That is the answer to the short-landing
  question: not a burned deposit, a recoverable state. Section 5 is the two shipped recoveries.

A pre-broadcast simulation on the service side catches many failures before a single transaction is
sent. The shortfall guard catches the specific one that matters here, a delivery below the terms
amount, before we ever ask the user to sign.

---

## 4. The signing step: sign right after create, before depositing

A created execution carries a `messageToSign`. The destination steps do not run until the wallet
signs it. The wallet signs with EIP-191 `personal_sign`, the 65-byte signature is normalised to `v`
0 or 1, base58 encoded, prefixed `secp256k1:` then posted to `/executions/{wallet}/submit`.

**Sign right after create and before the deposit**, so the batch runs by itself the moment the bridge
lands. We learned the order the hard way: the first mainnet run sat unsigned for three days because we
deposited first. The bridge had landed the money and the escrow was still empty. Aurora's guidance
(Chris Gutkowski, 2026-09-29) is the reverse of what we did. Our script now follows it.

The code is `findMessageToSign`, `toIntentsSignature` and `submitSignature` in `lib/intents.ts`, with
`parseSigningPayload` and `submitFundingSignature` beside them, tested in `lib/intents-sign.test.ts`.
`/api/fund/submit` is the surface. It validates the signature shape
(`^secp256k1:[1-9A-HJ-NP-Za-km-z]+$`) before relaying, so raw `0x` hex is refused by name rather than
forwarded to be rejected.

The signature is per-execution authorization the user produced. The only secret on this path is the
api key, which stays in the header to Aurora and never reaches a response. The signing payload itself
is public per-execution data the client has to have in order to sign.

---

## 5. Recovery: two one-click paths from the intermediary

A short landing or an expiry leaves USDC at the intermediary, which the source wallet owns through a
Chain Signature. There is no automatic refund and no claim call. Recovery is a **steps-only**
execution: no bridge, no deposit, run from the balance already there, with Aurora sponsoring the gas,
so the owner does not have to acquire Monad gas to get their own money back.

`classifyFunding` in `lib/intents-recover.ts` sorts a fund into five states:

| state | when | recoverable |
|---|---|---|
| `funded` | the execution reported `SUCCESS`, so the job was created | nothing to recover |
| `empty` | no balance at the intermediary | nothing to recover |
| `expired` | the status says `EXPIRED` or the deadline has passed, with a balance still there | yes |
| `short` | a balance below what the job needs, so `createJob` reverted | yes |
| `recoverable` | a balance that would cover the job, sitting unrun | yes |

`expired` is checked before `short` because the deadline is the clearer signal and the copy differs:
an expired fund speaks to the deadline, a short one to the delivery. Both recover the same way.

Two recoveries, both one click:

- **Re-fund.** `buildRefundSteps` rebuilds `approve` plus `createJob` sized to the balance that
  actually arrived. It reuses the forward builder, so the escrow's exact-amount guard is satisfied by
  construction and a `Terms` whose amount does not equal the balance is refused at build time rather
  than reverting on chain.
- **Withdraw.** `buildWithdrawStep` is a single `transfer(recipient, balance)` on Monad USDC, encoded
  with viem against the real ABI, so a bad argument throws when the step is built.

Both are served by `POST /api/fund/recover` with `mode: "refund"` or `mode: "withdraw"`. The public
page sends `dry: true`, which estimates and returns no signing payload at all. Signing and the
on-chain run are the owner's wallet's work, never the server's, which is a standing hard stop: the
reply carries the note "Signing and the on-chain steps-only run are done by the owner's wallet, never
by the server. A dry call only estimates."

The HTTP call and its parse live in `lib/intents.ts` beside the forward client
(`requestStepsExecution`, `parseStepsExecution`) and are reused here rather than reimplemented.
`classifyFunding`, `buildRefundSteps` and `buildWithdrawStep` are pure and unit-tested in
`lib/intents-recover.test.ts`. `components/fund/RecoveryPanel.tsx` is the UI.

---

## 6. Chains and the destination asset

Monad is supported as both a source and a destination. Verified live from `GET /supported_tokens` on
2026-09-23, which needs no key: Monad USDC is assetId
`nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx`, 6 decimals, contract
`0x754704bc059f8c67012fed69bc8a327a5aafb603` on chain 143. That is the same USDC Aqueous already
settles in, read off `lib/x402.ts`.

The source list the buyer picks from is six chains, named as constants in `lib/fund-sources.ts` rather
than read from a dropdown somebody typed:

| source | non-EVM | origin USDC assetId |
|---|---|---|
| Base | | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` |
| Arbitrum | | `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near` |
| Optimism | | `nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ` |
| Polygon | | `nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L` |
| Solana | yes | `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near` |
| NEAR | yes | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |

Two deliberate choices in that set. **Every default source is six-decimal**, so the eighteen-decimal
trap cannot sneak in through a default. And at least one is genuinely non-EVM, so the cross-VM claim
on the page is real rather than decorative. Solana is the primary non-EVM pick because it is the only
non-EVM chain supported as both a source and a destination.

The amount is always scaled by the source asset's own `decimals` through `scaleAmount`, never
assumed. Over-precise input is rejected rather than truncated. So adding an eighteen-decimal
source later cannot reintroduce a 1e12 carry-over.

Those assetId strings were read from the live `/supported_tokens` but copied through a summary, so
`assertSourcesLive` re-reads that endpoint and throws naming every id that has drifted. A stale id
fails the check rather than quoting a quote against an asset that moved.

`components/fund/MultiSourceQuotes.tsx` is the panel. `lib/fund-sources.test.ts` covers the scaling
and the drift check with an injected fetch.

The point of the flow is that the buyer never has to care which chain they are on. They pick it once
and the funded job appears on Monad.

---

## 7. The seven UI states, mapped onto Aurora's own

`lib/fund-ui.ts` is a pure state machine, unit-tested with no browser. The mapping is the point: **the
UI never shows a state Aurora did not report.** An unknown or missing state holds rather than guessing
`funded`, because showing "done" on a value you could not read is exactly the fail-open this project
exists to expose, so it does not happen to our own money flow.

| Aurora state | UI state |
|---|---|
| `CREATED`, `DEPOSIT_PENDING` | `awaiting-deposit` |
| `DEPOSIT_PROCESSING`, `OPERATION_PENDING`, `OPERATION_PROCESSING` | `bridging` |
| `SUCCESS` | `funded` |
| `OPERATION_FAILED` | `short-landing` |
| `EXPIRED`, `DEPOSIT_FAILED` | `expired` |
| anything unrecognised | holds at `awaiting-deposit`, with the raw string shown as unknown |

The other three UI states (`form`, `quote`, `signing`) are ours and precede any Aurora state.

**The refund split matters and is asserted in the tests.** `EXPIRED` and `DEPOSIT_FAILED` refund the
deposit. `OPERATION_FAILED`, a short landing, leaves the funds at the intermediary for client
recovery. Copying one case onto the other would tell a refunded user their money is stuck. It would
also tell a stuck user it was refunded.

Polling is a fixed 4 seconds (`POLL_DELAY_MS`), because Aurora says transitions are eventual and a
tighter poll buys nothing. `MAX_POLL_MS` is 30 minutes, a hard ceiling so a stuck execution never
polls forever. The poll stops on the three terminal states only.

---

## 8. What is verified and what is not

Verified locally, no funds moved:

- The unit tests pass against an injected fetch, so every branch runs with no network. Four mutations
  were made to prove the checks can fail: the guard dropped, the wrong selector encoded, the gross
  amount baked in and the approve step skipped. A test caught each, then each was restored.
- `GET /supported_tokens` returns 200 anonymously and lists Monad USDC, so the destination asset is
  real.
- `POST /executions/{wallet}` returns `401 missing or invalid api token` without a key, which confirms
  the endpoint and the key requirement.

Not verified here, with the reason for each:

- The live quote and the worst-case delivery number come from the create endpoint, which needs an
  Intents Connect key wired server side. The public instance has none, so `/api/fund/quote` and
  `/api/fund/create` return 503 and no quote is priced on the public page. The create and sign path
  itself was exercised once with a key to produce the mainnet run below, so it is proven rather than
  merely built.

### It has been done once, on mainnet

The full path has been run once on Monad mainnet. 0.12 USDT on BSC
(tx `0xcebbdd3a…85463469`) bridged to 119,255 USDC units at the intermediary `0x004F15d9…1b29B2`,
which then ran `approve` then `createJob` (tx `0x738af85c…a440b558`), landing 115,558 units in
Aqueous, exactly the amount the job asked for, with 2,505 units carved out as the Aurora fee.

It sat unsigned for three days first, because we deposited before signing. The payer and the agent are
both ours, so it proves the rail and nothing about demand.

No funds are moved from the public page. A real deposit is run from the operator's wallet, not from
there. [`kanmani.xyz/fund`](https://kanmani.xyz/fund) shows every row above with both transactions
linked. [25-PROOF](25-PROOF.md) carries the full breakdown.

AI assistance (Claude, Anthropic) was used in developing this change. The design, review and
verification were done by the author. Verified locally before submitting: `npm run typecheck`,
`npm test` and `npx next build`, all green.
