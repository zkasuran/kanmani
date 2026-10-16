# 21. Mera-powered UX: one passkey, a scoped session, a gasless Monad transaction

The account layer here is Mera and nothing else. A stranger lands on [`/pay`](https://kanmani.xyz/pay),
uses a passkey once, then pays for a verification. No seed phrase, no wallet extension, no email or
OTP, no MON in their pocket and no private key on our server. The transaction that settles on Monad
is signed in the browser by a key the passkey derives, relayed by a facilitator that pays the gas.

This document covers the flow, how the session is scoped and expired, the time to first transaction,
and the evidence that the browser-signed authorization is real. `/pay` is the live surface.
`/pay?net=testnet` is the free judge path on the same page.
`lib/session.ts` and `lib/pay.ts` are the code.

---

## 0. What shipped

| File | What it does |
| --- | --- |
| `lib/session.ts` | a scoped, expiring signing session over `createSecp256k1SigningSession` plus `toViemAccount` |
| `lib/pay.ts` | builds the EIP-3009 authorization, signs it through the session, drives one payment |
| `app/pay/page.tsx` | the page, its scope panel and the time-to-first-transaction panel |
| `app/pay/pay-flow.tsx` | the client flow: connect, session countdown, pay, result |
| `lib/session.test.ts` | 10 tests, all offline, against the pinned PRF vector |
| `lib/pay.test.ts` | 13 tests, all offline, signature recovery checked by hand |
| `lib/pay-net.ts` | the mainnet and testnet pay configs in one place, mainnet pulled from `lib/x402` so it cannot drift |
| `components/session-scope.tsx` | the live session panel: payee, cap, account, countdown, renew and end |
| `components/pay-measure.tsx` | the live taps and seconds measurement, posted to `/api/pay-runs` |
| `app/api/pay-runs/route.ts` | records a run in `fovea.pay_run`, a real mainnet run verified on chain before it joins the median |
| `app/api/testnet/{mint,verify}/route.ts` | the free judge path: a sponsored tUSDC mint and a settle on Monad testnet |
| `lib/pay-net.test.ts`, `lib/pay-run.test.ts` | 4 and 6 tests for the two-network config and the run metric |

The whole path reuses the account key from `lib/iris` (namespace `kanmani.iris.v1`) and the x402 wire
format from `lib/x402`. Neither is redefined. On mainnet the payload, price, token and network all
come from `requirements()` in `lib/x402`. `lib/pay-net.ts` is the one place that holds both the
mainnet and testnet configs. It pulls every mainnet value straight from `lib/x402` so the live
mainnet path cannot drift. A test asserts `requirementsFor("mainnet")` is byte-identical to
`requirements()`.

---

## 1. The flow

One passkey ceremony derives the account key. That key opens a signing session. The session signs
with no further prompt until it expires.

```
connect      getPasskeyPrfOutput({ rpId })      one WebAuthn prompt
             deriveKeys(prfOutput).account      secp256k1, an EVM address
openSession  createSecp256k1SigningSession      signs 32-byte digests, no prompt
             toViemAccount(session)             a viem account: signTypedData, signMessage
pay          sign EIP-3009 transferWithAuthorization, no prompt
             POST /api/verify with the X-PAYMENT header
             the facilitator relays it and pays the gas
```

Signing in on a fresh browser or a second device reaches the same account, because the key comes
from the passkey rather than from anything stored. That is the stateless test. The live storage
readout that proves nothing is kept is on [`/account`](https://kanmani.xyz/account).

---

## 2. Session scope and expiry

A prompt-free session is a private key held in a tab. So it is held on a short leash. The session
carries two limits and `assertCanPay` enforces both before the key is ever touched.

- **Scope.** The session names what it may sign, x402 verification payments, up to a ceiling. The
  default is 0.05 USDC. A single payment above the ceiling is refused with `SCOPE_EXCEEDED` and the
  key never signs it.
- **Expiry.** The session has a wall-clock deadline, five minutes by default. The deadline is
  checked on use rather than by a timer, so a backgrounded tab cannot sign either. The first action
  after the deadline ends the session, which zeroes the Mera key, then throws `SESSION_EXPIRED`. The
  UI answers that by re-running the one-prompt ceremony.

The countdown on the page reads `session.remainingMs()`. When it reaches zero the session is
dropped and the next action re-prompts. There is no silent extension and no signing on a session the
user has walked away from.

---

## 3. Time to first transaction

The criterion is taps and seconds from a cold landing to a confirmed Monad transaction.

The page measures it rather than only describing it. A tap is one trusted primary `pointerdown`,
counted in the capture phase so a synthetic click cannot inflate it. The OS passkey prompt fires no
DOM event, so it is counted apart and reported as "N taps plus 1 passkey confirmation". The clock
starts at first mount, which for a cold `/pay` load is the moment a judge sees the page. It stops at
a confirmed settlement, never at a free "already checked" answer. A real mainnet run posts to
`/api/pay-runs`, which verifies the cited transaction on chain before it joins the published median
in `fovea.pay_run`. A testnet run is recorded as `ci`.

1. Open `/pay`. Connect a passkey. One prompt.
2. The session opens on the same tap. Nothing else to approve.
3. On mainnet, fund the shown account with the USDC the payment moves, then pay. It settles on Monad.
   On `/pay?net=testnet` the house mints the tUSDC, so there is nothing to fund.

Gas is never on the user, because the facilitator pays it. On mainnet the one thing a stranger funds
is the payment itself, 0.01 USDC for one verification. On the testnet judge path even that is on the
house, so a brand-new passkey reaches a confirmed transaction with zero funding steps.

---

## 4. The authorization is real, checked against the live facilitator

The facilitator's `POST /verify` validates an authorization and its signature and does not move
funds. Only `POST /settle` moves funds. So the signature can be proven real without a settlement.
The account key, the session, the viem adapter and the EIP-712 signing are the exact browser path,
run headless against `https://x402-facilitator.molandak.org/verify`.

The EIP-712 domain is USDC's own on chain 143, read off the token rather than guessed:

```
name "USDC", version "2", chainId 143,
verifyingContract 0x754704Bc059F8C67012fEd69BC8A327a5aafb603
TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)
```

**A funded account is accepted.** The house wallet holds a little USDC, so a session-signed
self-payment authorization from it verifies:

```
account       0xDB6c6340342e71A63cD11Ebac2185204b7777777
HTTP          200
body          {"isValid":true,"payer":"0xDB6c6340342e71A63cD11Ebac2185204b7777777"}
```

**The passkey derivation path signs correctly too.** The account derived from the pinned PRF vector
holds no USDC, so `/verify` rejects it for balance, not for the signature. The reason is
`insufficient_funds` rather than an invalid signature, which is the facilitator confirming the
signature recovered to `from` before it checked the balance:

```
account       0x92c2a8984eb7b890FfB4c6B57560Ac4E4868454B
HTTP          400
body          {"isValid":false,"invalidReason":"insufficient_funds",
               "invalidReasonDetails":"Onchain balance is not enough to cover the payment amount","payer":""}
```

---

## 5. Tests and proving the checks can fail

`npm test` at the repo root runs <!-- n:testsRootPassing -->787<!-- /n --> passing tests, 0 failing: <!-- n:testsApp -->542<!-- /n --> in the app suite and
<!-- n:testsVerifier -->245<!-- /n --> in the verifier suite, with the skips waiting on a database or an archive node. The Mera UX
surface adds 33 tests, all offline, with no browser and no network: 10 in `lib/session.test.ts`, 13
in `lib/pay.test.ts`, 4 in `lib/pay-net.test.ts` and 6 in `lib/pay-run.test.ts`. The
session signs a real Mera signature and the test recovers the signer to prove it is the account key
rather than trusting that it was.

Four mutations, each applied on its own, run against the suite, then reverted:

| Mutation | Result |
| --- | --- |
| the session signs after expiry (expiry check disabled) | caught |
| a server key signs instead of the session (signDigest bypassed) | caught |
| the wrong EIP-712 domain, chainId 1 instead of 143 | caught |
| the X-PAYMENT header built from an unsigned authorization | caught |

Each mutation was caught by at least one test. The per-mutation failure counts from the original run
are not restated, because the experiment predates the testnet domain-separation tests in
`lib/pay.test.ts`, which cover a fifth case: settling a testnet signature under the mainnet domain.
The files were byte-identical to their backups afterwards and the suite went green again.

---

## 6. The one thing not done and the command that does it

A judge can already reach a confirmed on-chain settlement for free: `/pay?net=testnet` mints a little
tUSDC to the new account on the house, then settles the payment on Monad testnet, so the whole flow
costs the judge nothing and the transaction hash lands on the page. The one path still gated is a
settlement on Monad MAINNET, which spends real USDC, so it is the operator's call rather than
something this build does on its own. Everything up to it is done and the `/verify` acceptance above
proves the authorization the mainnet settle would use.

To run the final settle: open `/pay`, connect the passkey, copy the account address the page shows,
fund it with 0.02 USDC (0.01 for the payment, the rest for a second try), then click pay.

```bash
# fund the passkey account shown on /pay with 0.02 USDC (20000 atomic units, six decimals)
set -a && . ~/Downloads/hackathon-hq/.env && set +a
cast send 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 \
  "transfer(address,uint256)" <ACCOUNT_SHOWN_ON_PAY> 20000 \
  --private-key "$HOUSE_WALLET_PRIVATE_KEY" --rpc-url https://rpc.monad.xyz
```

The address is the one the page derives from the passkey the operator enrols, so it is read off the
screen rather than fixed here. The pinned-vector account `0x92c2a8984eb7b890FfB4c6B57560Ac4E4868454B`
is the deterministic stand-in used for a reproducible non-passkey run.

---

## 7. What is real and what is staged

The account layer, the derivation, the session, the signing and the `/verify` acceptance are real.
The two facilitator responses in section 4 came back from the live facilitator in this build, not
from a fixture. A settled payment on Monad TESTNET is live and free on `/pay?net=testnet`, funded by
the house. The one thing not yet run is a payment settled on MAINNET from the passkey-derived account,
because it spends real USDC. Mainnet x402 settlements from our agents do exist and are recorded in
[`28-X402-UPTO.md`](28-X402-UPTO.md). Those come from the house wallet rather than from a browser
passkey. That is stated plainly rather than implied. On either network the transaction hash appears on
the page and links to the explorer.

