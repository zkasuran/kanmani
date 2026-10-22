# Kanmani security audit

A deep security review of the whole system, component by component, with the highest-severity issues
fixed in this tree and the remainder specified for follow-up. This file is the public record of what
was examined, what was found, what was fixed and what still needs a deploy-time decision.

Scope: the Solidity contracts (Aqueous escrow, Sclera bond, AgentPasskey, CleanverseGate, TestUSDC),
the Next.js app and its API routes, the Leash and x402 payment paths, the verification ladder and its
SSRF guard, the WebAuthn and key-derivation layer, the Envio indexer, the Chainlink CRE slashing
oracle and the deploy and supply-chain surface. Method: full source review of every component plus
static analysis (slither, semgrep), a full-history secret scan (gitleaks over every commit),
per-workspace dependency audit and live header checks against the deployed site. Findings were
re-verified adversarially before being recorded here.

## Posture

The system is hardened to a high standard. No memory-safety bug, injection or committed secret was
found and the trust-sensitive primitives (WebAuthn and P256 verification, HKDF key derivation,
AES-256-GCM storage, the SSRF guard, the EIP-712 and EIP-3009 signature paths) hold up under review.
The issues that matter are a small number of correctness and trust problems in the money and
verification paths, plus routine hardening. The most important of those are fixed in this tree. The
rest are specified below with exact changes and the few that need a mainnet redeploy are called out
as such because the live contracts are immutable.

## Fixed in this tree (verified: `forge test` 182 run, 172 pass, 10 skip, `npm test` 751 pass, `tsc` clean)

| Area | Severity | What was wrong | The fix |
|---|---|---|---|
| Aqueous gasless create | HIGH | `createJobWithAuthorization` redeemed the buyer's EIP-3009 authorization with `transferWithAuthorization`, a bearer transfer anyone could submit straight to the token, moving the escrow in with no job created and no recovery path, which also let a mempool front-runner strand the funds and break the gasless path | switched to `receiveWithAuthorization`, which the token only lets the payee redeem, so funding is atomic with job creation. AUSD was confirmed on-chain to implement it. Contract plus token plus tests updated, with a regression test for the direct-redemption attempt |
| Verification ladder | MEDIUM / thesis | the `true` rung reported a transfer to the recipient without saying whether the recipient supplied the value itself, so a self or wash transfer read the same as an arm's-length payment | the settlement rung now computes and surfaces `selfFunded`, the verdict carries `settlementChecked`, `amountCompared` and `selfFunded` and the tx-exists fallback is marked `settlementChecked: false`, so a consumer can weigh a weak `true` lower |
| Verification ladder | LOW | the `locate` fallback accepted a transaction one block deep, below the two-confirmation floor the settlement rung enforces | `locate` now applies the same `MIN_CONFIRMATIONS` floor, so a reorg-prone shallow transaction is `unknown` on both paths |
| Indexer GraphQL | MEDIUM | the anonymous Hasura role had no row limit and left subscriptions open, so an unauthenticated client could pull unbounded result sets during the public judging window | the public select permission now caps rows at 1000, limits the query root fields and closes subscriptions. Depth and complexity ceilings are Enterprise-only on this image, so the row limit plus the Postgres statement timeout plus the loopback binding are the controls |
| Indexer dependencies | CRITICAL (advisory) | Envio's bundled express stack resolved `proxy-addr@2.0.7`, which carries a critical advisory fixed in 2.0.8 | added an `overrides` entry pinning `proxy-addr` to 2.0.8. Run `npm install` in `indexer/` to regenerate the lockfile, then a container smoke run. The ports stay loopback-bound regardless, which is the real control |
| Web headers | LOW | no HSTS header, so a first-contact downgrade was possible even with `upgrade-insecure-requests` in the CSP | added `Strict-Transport-Security` with a two-year max-age, subdomains and preload. The existing canary already asserts it |
| systemd workers | LOW | the four network workers ran as root | added `DynamicUser=yes` to the sweep, probe, recheck and nansen units. The usage unit reads the Caddy access log, so it needs a dedicated account in the log group rather than a dynamic user; see Open items |
| Indexer image | LOW | the container ran as root | the Dockerfile now `chown`s `/app` and drops to the unprivileged `node` user for the long-lived process. The install layer stays root |
| CRE oracle doc | LOW | a comment implied a CLI `--broadcast` flag arms the on-chain write path | corrected: the write path is armed only by `broadcast: true` in the committed JSON config, which is unset in both staging and production |
| Key derivation doc | INFO | a comment claimed the HKDF `info` strings were length-prefixed, which they are not | corrected to describe the real separation: distinct versioned constants from a closed set with no shared prefix and no attacker input |

## Open items that need a mainnet redeploy (the live contracts are immutable)

- **Aqueous (HIGH).** The `receiveWithAuthorization` fix is in source and tested, but the deployed
  Aqueous still carries the transfer-variant behaviour. Making the fix live needs a redeploy and an
  update of the cited addresses. **Decision, 2026-10-22: the redeploy waits until the hackathon results
  are announced.** A second Aqueous address beside the live one would change what a judge sees while judging
  is open. The exposure is dormant. Until then the gasless-create path should be driven only by a trusted
  relayer that never exposes a signed authorization to a public mempool.
  **Checked ahead of the redeploy:** the fixed source builds, its unit suite passes (including
  `test_FIXED_directRedemptionCannotStrandTheEscrow`), the six fork tests pass against the real USDC on Monad,
  and the token's on-chain `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` equals the one the spec derives. A dry run of
  `Deploy.s.sol` against chain 143 succeeds. Nothing has been broadcast. No app route calls
  `createJobWithAuthorization` today, so nothing on the site exposes one.
  **`contracts/src/Aqueous.sol` in this tree is therefore no longer the deployed source.** The source
  behind `0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32` is `contracts/src/Aqueous.sol` at commit
  `f7fda7f`, which is what its verification matches.
- **Sclera (HIGH, trust concentration). Beneficiary half resolved 2026-10-10 by Sclera v2.** In version
  1 (`0x57aF4e4B…f0eaf`) the attestor and the slash beneficiary are the same operator, so the party that
  decides a slash also receives it. Version 2, `0xB4d641f016f53C683c409F271eE85e136041FE3f`
  (`contracts/src/ScleraV2.sol`, Sourcify exact match), fixes the beneficiary as a constant burn
  address in the bytecode, so no deploy can point it at anyone. It also allows a new bond after a release
  or slash. Every new bond on the site goes to v2. Version 1 still holds Kanmani's own earlier bonds.
  What remains: the attestor can still sign a zero-truth verdict that slashes any active bond. It no
  longer profits from doing so. The CRE broadcast flag is off in staging and production, so no
  automatic slash runs. Publishing the sampled claim ids so a slash is independently recomputable is
  still open.
- **AgentPasskey (LOW).** On-chain verification does not check the rpIdHash or the origin and the
  clientDataJSON offsets are caller-supplied substrings. The risk is low because WebAuthn credentials
  are origin-scoped at creation and the challenge carries the binding. Pinning the challenge offset
  structurally, with an optional rpIdHash check, needs a redeploy.

## Specified for follow-up (code-ready, no redeploy)

- **Leash gate.** Single-use is a process-local map today, so on the multi-instance runtime one
  on-chain payment can buy a fresh answer per instance or restart inside the 300 second window. Make it
  durable with a one-row-per-transaction Postgres table claimed atomically before the work runs, keep
  the map as a cache. Bind the proof to a server-issued single-use challenge so captured headers cannot
  replay or require a payment before returning any spend telemetry. Fold the chain id and the origin
  into the ref and proof preimage so deployments that share the house wallet cannot cross-accept
  payments. Reserve on the transaction hash before the chain reads, add a per-IP and per-agent rate
  limit and set explicit timeouts on the reads.
- **x402.** Re-check the funding shortfall against the created execution rather than the dry quote.
  Verify the transfer amount and the payer in the pay-runs on-chain check, not only the payee (or
  authenticate the metric), so the published median cannot be poisoned. Add a per-IP rate limit to the
  fund routes and to pay-runs; the limiter pattern already exists in `proxy.ts`.
- **Verification ladder.** Add an operator-configured allowlist of real settlement assets (AUSD plus
  native MON, decimals read at runtime) so an event-only or worthless token cannot satisfy the `true`
  rung. Have the published truth rate and the Sclera input count only a transfer that was
  settlement-checked, not self-funded and amount-compared as a strong truth, with the weaker tallies
  shown separately.
- **API routes.** Cap the request body on `evidence/check`, `registration/check` and `testnet/verify`
  by routing them through the existing `readBodyText`. Order the testnet faucet balance check before the
  daily-quota decrement. Integer-constrain the usage `days` parameter. Stop returning raw RPC error text
  on the testnet routes.
- **Indexer.** Cap the on-chain agentURI length before parse and storage so a huge data URI cannot
  exhaust memory. Guard AgentRecord against a content-key collision or move to a cryptographic key.
  Correct the schema comment that claims keccak where the code uses a 64-bit hash.
- **Smaller items.** The vault write message carries no monotonic counter, so a replayed write can roll
  an owner's own slot back (owner data only, no read gained). Tenderly binds the Date into its HMAC but
  does not check freshness (replay is bounded by the delivery-id ledger). Add a stale-running reclaim so
  a hard kill mid-delivery does not strand a webhook. Add SSRF tests for the alternate IP encodings.
  SHA-pin the GitHub Actions.

## Checked and verified clean

So the short finding list is not read as a shallow review, these are the properties that were examined
and hold:

- Contracts are immutable with no proxy, admin or pause. Every money path writes its terminal state
  before any transfer and carries a reentrancy guard. ECDSA recovery rejects a high `s`, a `v` outside
  {27, 28} and the zero address. EIP-712 domains bind the chain id plus the contract address and are
  rebuilt on a chain split. Fee-on-transfer tokens are rejected at deposit. The EIP-3009 relayer scope
  is bound into the nonce so a relayer cannot change any term. 172 contract tests pass.
- The SSRF guard pins the screened address into the socket (so DNS cannot change under it), parses IPv6
  to eight groups (so an IPv4-mapped address is screened as the IPv4 it carries), screens every DNS
  answer, re-screens every redirect hop, blocks the cloud-metadata range by name and caps bytes, time,
  and DNS latency.
- Key handling uses HKDF-SHA256 with a per-namespace info string plus an RFC-6979-shaped retry for the
  secp256k1 scalar. The vault is AES-256-GCM with a fresh random nonce and the context bound as
  additional authenticated data. No private key, seed or PRF value leaves the device, is logged or is
  committed.
- Webhooks verify the HMAC over the raw body before any parse, fail closed with no key and dedupe on a
  database primary key. API authorization is stateless signatures with no session cookie, so there is no
  CSRF surface and every executed query is parameterized.
- A gitleaks scan over all 246 commits found no secret. The CRE `secrets.yaml` is tracked but commits no
  key value.

## Known limits

- The self-funded flag catches a self-transfer and a document-declared self-payer. It does not catch a
  two-wallet sybil wash, which is undetectable on chain without external identity.
- The Sclera slash rests on one operator-run measurement API plus one operator key (on v2 that key can
  burn a bond but never receives one). Broadcast is off in
  production, so no automatic slash runs today.
- The indexer dependency advisories are reachable only through the Envio HTTP port and Hasura, both
  bound to loopback behind the Next proxy.

## Reproduce

```
cd contracts && forge test        # 172 pass, 10 skipped without an RPC
npm test                          # lib + verifier
npm run typecheck
cd indexer && npm audit           # proxy-addr clears after npm install regenerates the lockfile
gitleaks detect                   # no leaks over full history
```

This review combined automated analysis with manual verification and every fix recorded as applied was
checked against the test suites above.


