# 22. Aurora Intents Connect: fund a Monad job from any chain

Kanmani hires agents through an escrow, Aqueous, on Monad. To hire one you need USDC on Monad and a
Monad wallet. That is a real friction point for a buyer who holds funds somewhere else. This document
is about removing it: a buyer funds a job with an asset they already hold on another chain and never
bridges, switches wallets or acquires Monad USDC by hand first.

The code is `lib/intents.ts`, its tests are `lib/intents.test.ts` and the surface is `app/fund/`.
Aqueous is read, never changed: `contracts/src/Aqueous.sol`.

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
function createJob(Terms calldata t) external returns (bytes32 jobId);
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
  question: not a burned deposit, a recoverable state.

A pre-broadcast simulation on the service side catches many failures before a single transaction is
sent. The shortfall guard catches the specific one that matters here, a delivery below the terms
amount, before we ever ask the user to sign.

---

## 4. Chains and the destination asset

Monad is supported as both a source and a destination. Verified live from `GET /supported_tokens` on
2026-09-23, which needs no key: Monad USDC is assetId
`nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx`, 6 decimals, contract
`0x754704bc059f8c67012fed69bc8a327a5aafb603` on chain 143. That is the same USDC Aqueous already
settles in, read off `lib/x402.ts`.

The source list the buyer picks from includes Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche,
BNB Smart Chain, Solana, NEAR and more. The point of the flow is that the buyer never has to care
which of those they are on. They pick it once and the funded job appears on Monad.

---

## 5. What is verified and what is not

Verified locally, no funds moved:

- The unit tests pass against an injected fetch, so every branch runs with no network. Four mutations
  were made to prove the checks can fail: the guard dropped, the wrong selector encoded, the gross
  amount baked in and the approve step skipped. A test caught each, then each was restored.
- `GET /supported_tokens` returns 200 anonymously and lists Monad USDC, so the destination asset is
  real.
- `POST /executions/{wallet}` returns `401 missing or invalid api token` without a key, which confirms
  the endpoint and the key requirement.

Not verified here, with the reason for each:

- The live quote, the worst-case delivery number and the signing payload come from the create
  endpoint, which needs an Intents Connect API key we do not hold. That step is built and ready and is
  marked unverified rather than claimed.
- The final funded deposit spends real money across a real bridge. That is a standing hard stop. It is
  built up to the line and handed off with the exact inputs. No funds are moved from here.

AI assistance (Claude, Anthropic) was used in developing this change. The design, review and
verification were done by the author. Verified locally before submitting: `npm run typecheck`,
`npm test` and `npx next build`, all green.
