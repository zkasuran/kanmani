# Security

This file is the threat model. One row per attacker and attack, the defence, the file that holds it
and the test that proves it. Where a defence has no automated test the row says so.

Report a vulnerability by opening a GitHub security advisory on this repository. Do not open a public
issue for anything that lets a stranger move money or forge a verdict.

Every file and test name below was read from this repository as it stands. The release gate is
`./verify.sh`, which runs the secrets scan, lint, the whole-repo typecheck, every test suite, the
dependency audits, the production build and the link check in one command. The contract suites run
under `forge test`, the TypeScript suites under `node --test`. `verify.sh` runs all of them.

## Fail closed, everywhere

The single rule that most of this rests on: when something cannot be determined, nothing asserts
that it was.

- A verifier that cannot read a document, cannot reach a chain or hits a provider error returns
  `unknown`, never `false`. An absent answer is not a negative one.
- A payment that verified and has not settled returns 402, not the work.
- A slash verdict that cannot be established does not slash.
- A URL that cannot be parsed or resolved is treated as forbidden rather than as allowed.

The difference between `unknown` and `false` is this project's whole subject, so our own code is held
to it.

## Surface A: the escrow contract

Attacker: anyone with a wallet. Loss here is irreversible, so this surface gets the most tests.

| Attacker and attack | Defence | File | Test |
|---|---|---|---|
| A relayer redirects the escrow to itself, since an EIP-3009 authorization signs no job terms | The nonce is derived from the terms, so any tamper fails the token's own signature check | `contracts/src/Aqueous.sol:278` `authNonceFor` | `AqueousExploit.t.sol` `test_FIXED_relayerCannotRedirectJobToItself`; `AqueousFork.t.sol` `test_fork_relayerCannotAlterTheTerms` against real USDC |
| A fee-on-transfer or rebasing token locks another user's funds | Balance-delta check. Anything not delivering the exact amount is refused at creation | `contracts/src/Aqueous.sol:546` `_requireExactlyReceived`, applied at `:287` and `:322` | `AqueousExploit.t.sol` `test_FIXED_feeOnTransferTokenIsRefusedAtCreation` |
| Reentrancy. Also a state write that lands after a transfer on a fund path | Checks-effects-interactions, so the terminal state is written before any transfer, plus a `nonReentrant` modifier | `contracts/src/Aqueous.sol:201` and the ordering across `_release` and `_refund` | `Aqueous.t.sol` `test_stateIsTerminalBeforeAnyTransfer` and `test_refundStateIsTerminalBeforeTransfer`. Both were mutation tested: they fail with the guard removed |
| Replay of a signed gasless action | Every authorised action is terminal, so a replay finds `Settled` or `Refunded` and reverts | `contracts/src/Aqueous.sol:369`, `:379`, `:393` | `AqueousGasless.t.sol` `test_replayIsBlockedByTerminalState` |
| A malformed, high-s or zero-address signature on a gasless exit. Also a cross-deployment replay | A wrapped `ecrecover` rejects the zero address, high-s and a bad v. The EIP-712 domain binds `chainId` and `address(this)` | `contracts/src/Aqueous.sol:489` `_recover` | `AqueousGasless.t.sol`, 11 tests, each asserting the buyer gained nothing. Five are mutation tested |
| A gasless buyer is stranded with no way out | Signed `releaseWithAuthorization`, `settleMeteredWithAuthorization` and `refundWithAuthorization`, with `units` inside the settle digest | `contracts/src/Aqueous.sol:369`, `:379`, `:393` | `AqueousGasless.t.sol` |
| A buyer or an agent is stranded by a silent counterparty | A deadline `refund` needs no counterparty. `claimDelivered` opens after a fixed public window | `contracts/src/Aqueous.sol:405` `claimDelivered`, `:417` `refund` | `Aqueous.t.sol` `test_agentClaimsAfterWindow` and `test_agentCannotClaimInsideWindow` |

## Surface B: bonds and slashing

Attacker: an agent operator. Also a claimant who wants someone else slashed.

| Attacker and attack | Defence | File | Test |
|---|---|---|---|
| A stranger bonds an agent they do not own, squatting the slot or planting an unslashable fake bond at `minTruthRateBps=0` | `ownerOf(agentId)` is read from the ERC-8004 Identity Registry and must equal the caller. The registry address is an immutable constructor argument with no setter | `contracts/src/Sclera.sol:295`, registry immutable at `:130` and `:216` | `Sclera.t.sol` `test_postBond_strangerCannotBondSomebodyElsesAgent` and three siblings. Mutation turns four of them red |
| A forged or replayed slash verdict | The verdict is authorised on the attestor's own signature, verdict nonces are monotonic per agent. A reverted report does not consume its nonce | `contracts/src/Sclera.sol` `onReport` | `ScleraCrossSign.t.sol` `test_crossSign_typescriptSignatureSlashesTheBond` and `test_verdict_smallSampleStillConsumesTheNonce` |
| A fee-on-transfer token in a bond | The same balance-delta check the escrow uses | `contracts/src/Sclera.sol` | `Sclera.t.sol` and `ScleraFork.t.sol` |

## Surface C: the fetcher and the verifier

Attacker: anyone who can put a URL on chain, which is anyone who can register an agent.

| Attacker and attack | Defence | File | Test |
|---|---|---|---|
| SSRF to loopback, a private range or cloud metadata, including the IPv4-mapped IPv6 forms | `isForbiddenAddress` screens the parsed address bytes and routes mapped `::ffff:`, compatible `::a.b.c.d` and NAT64 `64:ff9b::/96` through the IPv4 rules. An address it cannot parse is forbidden | `verifier/src/net/guard.ts:80`, NAT64 at `:176`, `screenUrl` at `:182` | `guard.test.ts`, 20 blocked notations including `169.254.169.254` in four spellings, plus `guardedFetch` through `[::ffff:127.0.0.1]` |
| DNS rebinding between the check and the connect | `resolvePublic` re-screens every resolved address and the socket is pinned to those addresses with a custom `lookup`, so the resolution that was screened is the one connected to | `verifier/src/net/guard.ts:224` | `guard.test.ts` rebind flip-flop test |
| A hanging resolver | The lookup races a 5 second timeout and a timeout is a refusal | `verifier/src/net/guard.ts:50` | `guard.test.ts` hanging-resolver cut-off |
| A hostile host serving a 10 GB document or a slow socket | A 64 KiB cap counted on bytes that arrive, never on `content-length`, three redirect hops maximum and an 8 second timeout | `verifier/src/net/fetch.ts:170`, `:69`, `:182` | `guard.test.ts` unbounded-chunked, honest-oversize and hanging-server cases |
| A probe of one endpoint turned into a request to another | The POST probe reports a redirect in `headers.location` and never follows it. The body is capped at 256 KiB and a capped read sets `truncated` | `verifier/src/net/probe.ts` | `probe.test.ts` redirect-not-followed, cap, truncation flag and timeout |
| A redirect into loopback after a public first hop | Every hop is re-screened | `verifier/src/net/fetch.ts` | `guard.test.ts` redirect-into-loopback refused at hop two |
| Path traversal inside an `ipfs://` reference, reaching a gateway path we did not intend | The reference is refused before any gateway is contacted. A `data:` URI is bounded before decoding as well as after | `verifier/src/ladder/resolve.ts:95`, `:119` | `resolve.test.ts` traversal case, cap-before-decoding, invalid base64 refused rather than truncated |
| A verdict of `true` when only a transaction exists and the value never arrived | `judge` runs `settledCheck`, so `true` requires the value to reach the claimed recipient on the named chain. A reverted transaction is `false` | `verifier/src/ladder/verdict.ts`, `verifier/src/ladder/settled.ts` | `verdict.test.ts` true only when value reached the recipient, reverted is false |
| Fail-open on a provider error, turning an outage into a clean bill of health | Every provider failure path returns `unknown` | `verifier/src/ladder/verdict.ts` | `verdict.test.ts` provider-failure stays unknown |
| A document crafted to make a parser throw and take down the sweep | Every parser returns a typed outcome. UTF-8 is decoded fatally and `JSON.parse` is guarded. An ambiguous atlas match is refused rather than resolved by array order | `verifier/src/ladder/parse.ts:207`, `:214`, `:242` | `parse.test.ts` plus `lib/parsers.fuzz.test.ts`, which throws seeded random bytes at six parsers and asserts none throws |

## Surface D: the paid API

Attacker: a caller who wants the work without the payment.

| Attacker and attack | Defence | File | Test |
|---|---|---|---|
| Paid work delivered without a settled payment | Delivery is gated on a confirmed settle. Verified-but-unsettled returns 402 | `lib/x402.ts`, wired in `app/api/service/[slug]/route.ts` and `app/api/verify/route.ts` | `lib/x402.test.ts` |
| One authorization reused across N parallel calls | A single-flight reservation keyed on payer and nonce, released on completion | `lib/x402.ts:355` `reservePaymentNonce` | `lib/x402.test.ts` reserve-once, refuse-concurrent, free-on-release |
| A payment header that is valid base64 and not a payload. Also a v1 payload sent to a v2 endpoint | The base64 is round-tripped and a mismatch is refused. A v1 payload is named as such rather than called malformed | `lib/x402.ts:160` `paymentFrom` | `lib/x402.test.ts`, plus the fuzz pass over `paymentFrom` |
| A metered charge above what the buyer signed | The charge is checked non-negative and against the signed maximum before the facilitator is called | `lib/upto.ts:128` | `lib/upto.test.ts` charge-above-signed-max refused, wrong ceiling, token, recipient and facilitator each refused |
| An unauthenticated stranger posts a body of any size and makes the process buffer it | A byte ceiling counted on arrival, before anything parses. `content-length` is used only as an early refusal and never trusted as an allowance. 413 on refusal | `lib/body.ts`, wired at `app/api/service/[slug]/route.ts` and `lib/rehydrate.ts` | `lib/body.test.ts`, including an endless stream cut off after a few chunks and an understated `content-length` that buys nothing |
| A negative or oversized `limit` becomes `LIMIT -1` and a 500 | Clamped at both ends | `app/api/claims/route.ts:23`, `app/feed.json/route.ts` | Route-level clamp, no dedicated unit test |
| Unbounded signed writes to the vault or a receipt | Body, field-length and per-identity entry caps | `app/api/vault/route.ts`, `app/api/receipt/action/route.ts` | Route-level caps, no dedicated unit test |
| A session key signs a transfer to any recipient | `assertCanPay` pins `payTo`, so a key cannot pay somewhere it was not scoped to | `lib/session.ts:150` | `lib/session.test.ts` |
| A receipt names a signer its author does not control | An account-key binding signature is required and verified | `lib/authority.ts:207` `verifyBinding` | Binding path exercised in `lib/authority.test.ts` |
| A sealed vault blob tampered with, relabelled or replayed with a swapped nonce | AEAD with the label in the AAD, a fixed 12 byte nonce length and a 32 byte key. Unknown fields are dropped rather than carried | `lib/vault.ts:128`, `:60`, `:157` | `lib/vault.test.ts` bitflip, nonce swap, relabel breaks AAD, wrong-length nonce, `parseSealed` keeps nothing extra |
| A webhook body forged by someone without the signing key | HMAC SHA-256 over the raw bytes with `timingSafeEqual` and a length guard, verified before anything parses the JSON | `lib/rehydrate.ts` | `lib/rehydrate.test.ts` |
| A flood that exhausts the database connection pool | A per-IP 429 with `Retry-After`, tighter buckets on the free build and funding routes, plus database statement, query and idle timeouts | `proxy.ts:59`, pool timeouts in `lib/db.ts` | No automated test. The limiter is in-memory and is not a security boundary on its own. The durable backstops are the token's own limits and the database timeouts |
| A reflected raw error. Also a `javascript:` or `data:` URL stored as a safe link | Routes return a fixed error line and log the real one. The indexer keeps absolute http and https links only | `app/api/verify`, `app/api/service`, `indexer/src/handlers/Retina.ts` | Route behaviour, covered by indexer resync rather than a unit test |
| A caller misled about what `intact` means when no commitment was supplied | `hashWasSupplied` is returned alongside the verdict, so "the bytes match the chain commitment" and "we hashed what we were served" are distinguishable | `lib/check.ts` | `lib/check.test.ts`, including that a malformed commitment reads as not-supplied rather than as tampering |
| A bad input to a priced agent surfacing as a 500 and leaking an internal message | Input faults throw `InputError` and the route maps it to a 400. Everything else is a fixed 500 | `lib/agent-extras.ts:51`, mapped in `app/api/service/[slug]/route.ts` | `lib/agent-extras.test.ts`, which also asserts `isInputError` is false for a plain `Error` so an internal fault cannot be reflected as advice |

## Surface E: infrastructure, deploy, secrets and the web

| Attacker and attack | Defence | File | Test |
|---|---|---|---|
| A published default admin secret on Hasura or Postgres once the endpoint is reachable | Both are required with `${VAR:?}` so the stack refuses to start without them. The console is off and the anonymous role is read-only, granted table by table | `deploy/docker-compose.yml:30`, `:61`, `deploy/track-hasura.sh` | **No automated test. Verified manually** (doc 17 Finding 3: the old secret returns access-denied, the new one returns 200, no credentials still returns 200) |
| A secret committed on the public flip | Tracked hooks refuse any `.env` at any depth except a sample file. pre-commit reads what is staged; pre-push reads every commit being pushed, so a commit made with `--no-verify` is still caught. A value-scoped gitleaks allowlist and a full-history scan in the gate sit behind them | `.githooks/`, `scripts/install-hooks.sh`, `scripts/scan-secrets.sh`, `.gitleaks.toml` | `verify.sh` runs the full-history scan on every push. Last run: 0 findings across every ref |
| A secret read out of a process list | Keys are read from the environment, never passed in argv by application code. One ephemeral key is generated per run where a key is needed at all | `lib/*`, `scripts/*`, `verifier/src/cli/*` | No automated test. The Foundry deploy pattern `--private-key "$VAR"` does expose the value in the deploy host's own argv, which is a known limit below |
| XSS, clickjacking or content injection in the UI | A per-request nonce CSP with `strict-dynamic`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` and a `connect-src` that names its hosts (this origin plus the public chain RPCs from `shared/erc8004-chains.json`), so an injected script has nowhere to send what it reads. An agent's own document is fetched by the server through the SSRF guard (`app/api/agent/[id]/document`), never by the page, plus `nosniff`, a referrer policy, `x-frame-options: DENY` and a permissions policy | `proxy.ts` builds the CSP, `next.config.ts` sets the static headers | Header assertions in the end-to-end pass. `verify.sh` asserts the policy is built with `frame-ancestors 'none'` |
| Framework fingerprinting from response headers | `poweredByHeader: false`, so `x-powered-by` is not sent | `next.config.ts:12` | Covered by the build |
| One thrown render blanking a page, so a reader cannot tell a broken page from a claim with no answer | A route error boundary and a global error boundary, both saying plainly that the failure is ours and is not a verdict | `app/error.tsx`, `app/global-error.tsx` | No automated test. Both render through the normal build |
| A stale number presented as a live measurement | Every page renders per request and `staleTimes.dynamic` is 0, so the client router cannot serve a cached render. `/status` reports the index's own freshness | `next.config.ts` | `lib/counts.ts` tests and the live end-to-end numbers check |

## Known limits

Honest list. Each was confirmed still true against the code as it stands.

- Rebasing and fee-on-transfer tokens are unsupported. They are rejected at creation rather than
  handled.
- `block.timestamp` sets deadlines and the claim window. Validator drift is seconds and the windows
  are days, so this is taken on purpose. It is also why `deny_warnings` is not set on the contract
  build: the remaining warnings are these comparisons.
- On a metered job a silent buyer pays the ceiling. There is no on-chain usage oracle, so the claim
  window is the buyer's deadline to report usage.
- A buyer may overpay, either by releasing before delivery or by releasing a metered job at its
  full ceiling. Allowed on purpose.
- The contracts are immutable. There is no admin and no pause. Funds sent outside `createJob` are
  unrecoverable. There is no sweep by design.
- Sclera's attestor and its `slashBeneficiary` are the same principal in this deployment, so the
  slasher is also the receiver. This is an oracle-trust assumption and it is stated in the source. A
  future deployment can point `slashBeneficiary` elsewhere.
- The slashing oracle reads one HTTP source. Its sign-and-submit path sits behind a `broadcast`
  flag that the judged simulation leaves off. The write path is not exercised by the simulation.
- Cross-chain reference and Sybil counters in the indexer are permissionless and inflatable. The
  "found on no chain" split is not yet exhaustive. Both need a resync to change.
- The per-IP rate limiter is in-memory and is not a security boundary. The durable backstops are the
  token's own limits and the database timeouts.
- `envio` 3.10.0 in the indexer carries transitive advisories in its own express and ws tree. npm
  offers no non-breaking fix: the only suggested remedy is a major downgrade. The indexer is a
  server-side backfill process with no public HTTP surface. It is not part of the served app, so
  the finding is recorded rather than treated as zero. The verifier production audit is clean. The root
  production audit has one allowed finding, the next item.
- `@x402/core` and `@x402/evm` 2.27.0 each carry a nested `zod` 3.25.76. `npm audit` flags it as high
  (GHSA-mrhx-c7xc-m3w5, memory exhaustion validating a large array, fixed in zod 4.6.6) because the
  advisory's range is `< 4.6.6`. The vulnerable code is the zod 4 `$ZodArray` implementation. In 3.25.76
  `import "zod"` resolves to the v3 API, which contains no `handleArrayResult` (checked: 0 files). The two
  files that do sit under the `zod/v4` subpath that these packages never import. No patched 3.x release
  exists. The only remedy `npm audit fix --force` offers installs `@x402/evm` 0.0.1, which breaks the
  payment path. Our own `zod` is 4.6.6 and is not affected. `scripts/audit-gate.mjs` accepts exactly this
  advisory on exactly these two paths and fails on anything else, with tests that try to widen it. Look again
  when `@x402/core` moves to zod 4. This is a judgement from reading the installed code, not from a scanner.
- The lint toolchain pulls `braces` through `eslint-config-next`, which carries a stack-exhaustion
  advisory with no fixed version published. It is a development dependency, never served and never
  run against untrusted input. The gate audits production dependencies at zero findings and reports
  the development tree separately.
- HSTS is set at the reverse proxy in front of the app rather than in this repository, so it is
  verifiable on the live site and not from these bytes alone.
- The Foundry deploy pattern passes a key as `--private-key "$VAR"`, which puts the value in the
  deploy host's own process list at run time. No key value is committed. A keystore through
  `cast wallet import` would close this if argv strictness is wanted.
- The hooks are tracked in `.githooks/`, but git only runs them once a clone has run
  `./scripts/install-hooks.sh`. A clone that skips it has no local guard. The full-history secret
  scan in `verify.sh`, which CI runs on every push, is the backstop that does not depend on it.

## What is simulated

Stated plainly, because a reader cannot check a claim they were not told about. The
real-versus-simulated split for every surface is in `README.md` and the as-built docs. The one item
that matters here: the slashing oracle's write path is simulated, as noted above.
