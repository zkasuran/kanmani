# 18. Bugs found and fixed

A running log of real defects in this build: what broke, how it was caught and what now stops it
coming back. Published because a repo with no bug log is either very young or not looking.

Security findings in the escrow have their own document, [17-CONTRACT-AUDIT.md](17-CONTRACT-AUDIT.md),
with the exploits and the proofs. This page is the whole list, including the ones that were never
exploitable and the ones that were in the tests rather than the code.

Sorted by **how each was found**, because that is the part worth reusing. A bug you found by accident
teaches you nothing about the next one.

---

## Found by security review

### A relayer could steal the whole escrow

**Severity: HIGH. Never deployed, so nothing was ever at risk.**
`contracts/src/Aqueous.sol`, fixed in `2678753`.

An EIP-3009 signature covers six fields and none of them say who gets paid. A relayer holding a valid
authorisation could name itself as the agent, block the buyer's refund by marking the job delivered and
claim the escrow after the dispute window.

Fixed by deriving the EIP-3009 nonce from the job terms, so altering any term changes the nonce and the
token's own signature check rejects it. Full write-up, exploit and proof in the
[audit](17-CONTRACT-AUDIT.md#finding-1-a-relayer-could-steal-the-entire-escrow).

**Guard:** `test_FIXED_relayerCannotRedirectJobToItself` plus `test_fork_relayerCannotAlterTheTerms`
against real USDC. Reverting the fix makes the fork test fail.

### A fee-on-transfer token could permanently lock another user's funds

**Severity: MEDIUM.** Same commit.

The contract recorded the requested amount while the token may have credited less, so two jobs in such a
token left it owing more than it held, with no admin recovery because it is immutable.

Fixed with a balance-delta check that refuses anything not delivering exactly what was asked. Write-up
in the [audit](17-CONTRACT-AUDIT.md#finding-2-a-fee-on-transfer-token-permanently-locks-another-users-funds).

**Guard:** `test_FIXED_feeOnTransferTokenIsRefusedAtCreation`.

### The whole stack ran on the password `testing`

**Severity: HIGH for the judging window.** `deploy/docker-compose.yml`, `deploy/track-hasura.sh`.

Both the Hasura admin secret and the Postgres password defaulted to the literal string `testing` and
neither was ever set, so that is what the running stack used. `track-hasura.sh` defaulted to the same
value, which is why the pair worked and nothing ever asked anyone to set either one.

Loopback binding is the only reason this was not live. The submission requires a publicly reachable
GraphQL endpoint for six weeks of judging, so publishing it was the plan and the default was sitting in
a repo that goes public at the same time.

Fixed by making both required with `${VAR:?message}`, turning the Hasura console off, generating real
values and rotating the live Postgres role so the file and reality agree. Anonymous reads stay on,
because a judge querying without credentials is the point. Write-up and the before and after in the
[audit](17-CONTRACT-AUDIT.md#finding-3-the-deploy-stack-started-with-a-known-admin-secret).

**Guard:** compose refuses to start with the variables unset. Verified by sending the old secret and
getting `access-denied`, then the new one and getting data, then no credentials and still getting data.

---

## Found by grepping for who writes a field

Three bugs in one pass, all the same shape: **a field that is read but never written.** Worth doing on
any schema and it takes one command per field.

### `distinctOwners` was a copy of `memberCount`

**Severity: MEDIUM.** `indexer/src/handlers/Retina.ts`.

Both counters incremented on every registration with no owner deduplication anywhere, so the two fields
were equal in every row and `distinctOwners` counted agents rather than owners.

The number it got wrong is the one this build leads with: 8,093 agents across **7,962 wallets** sharing
one dead registration document. The 7,962 is `distinctOwners` and the code could only ever produce
8,093. The schema comment above the field described the right thing while the code under it did not.

Fixed with an `AgentRecordOwner` join entity keyed on `(record, owner)`, counted at registration time
because `Agent.owner` moves on every `Transfer`. Write-up in the
[audit](17-CONTRACT-AUDIT.md#finding-4-distinctowners-was-a-copy-of-membercount-and-it-is-a-published-number).

**Guard:** the two columns are now different numbers, checked after a full reindex.

### Three `IndexState` counters were declared and never written

**Severity: MEDIUM.** Same file, plus `indexer/schema.graphql`.

`agentsFromLogs`, `feedbackCount` and `recordCount` had exactly three references between them, all
reads of the form `existing?.field ?? 0n`. Nothing ever set them, so all three were pinned at 0.

They exist so `/status` can compare the on-chain population counter against what the index holds and
report a gap honestly. With the log side stuck at 0, the gap always read as maximal, so the check could
never have reported a healthy index. Nobody noticed because nothing was watching the thing that was
supposed to be watching.

Deleted rather than backfilled. They are row counts, so Hasura answers them exactly with
`Agent_aggregate { aggregate { count } }` and a stored copy can only drift from the table it counts.

### The schema could not express "unknown" in the field built for unknown

**Severity: LOW.** Same commit.

`counterSlotCount` was non-nullable, under a comment reading *"Unknown stays unknown. A failed read must
never be published as zero"*, on a line ending `?? 0n`. The comment forbade what the line did, because
`BigInt!` left nothing else to write.

Fixed by making the field nullable. A failed RPC read publishes null now.

**The transferable part:** when a comment and the code under it disagree, one of them is a bug and it is
worth knowing which. Here the comment was right and had been right for days.

The same pass added a 10 second timeout to that RPC call, which had none. Six weeks unattended is a long
time to be one hung socket away from a stalled sweep.

---

## Found by asking why a number was null

### The freeze detector asked a non-archive node for historical state

**Severity: MEDIUM.** `indexer/src/handlers/Retina.ts`.

After the three fixes above, `counterSlotCount` came back `null` through the public endpoint. Null was
the correct new behaviour for a failed read, so it would have been easy to call that done. It was not
done, it was the bug becoming visible for the first time.

The sweep read the registry counter at the block being indexed. `rpc.monad.xyz` is not an archive node,
so a read at block 53,010,000 returns `-32602 Block requested not found`. Every block in a backfill is
historical, so every sweep failed: **5,276 of 5,276**, measured on a throwaway index.

Together with the previous two bugs, that meant both halves of the cross-check were dead and the pair
rendered as a confident `0` for a registry holding 10,276 agents.

Fixed by reading at `latest`, which is what the number is for anyway: the row is overwritten each sweep
and `/status` compares against now, so a historical population has no reader. Write-up in the
[audit](17-CONTRACT-AUDIT.md#finding-7-the-freeze-detector-asked-a-non-archive-node-for-historical-state).

**Guard:** a clean index now publishes `counterSlotCount: 10276` against 10,276 rows counted by the
independent log path.

**One wrong theory along the way, kept visible.** After the `latest` fix about 70% of backfill sweeps
still failed. I assumed the public endpoint was throttling and wrote that a dedicated RPC was the fix.
Wiring one in turned 3,705 failures into 3,869. The endpoint was never the problem. The sweep count
was, because every historical sweep overwrites the one before it and only the last survives. Raising
the floor to a recent block took a full resync from 5,276 sweeps to about 76 and failures to **13**.

**The transferable part and it is the one I would keep:** a bare `catch { return null }` hid a 100%
failure rate for days. Fail closed, but say so. A silent null reads exactly like a quiet chain.

---

## Found by mutation testing

### Checks-effects-interactions was untested and the guard was hiding it

`contracts/test/Aqueous.t.sol`. No production bug, a hole in the evidence.

Breaking the ordering on purpose, moving the state write after the transfers, **left all 28 tests
green.** The `nonReentrant` guard caught the attack that the ordering was supposed to prevent, so the
suite proved the backstop worked and said nothing about the thing it backs up.

The fix was a test, not a code change. `StateSpyToken` records the job state at the moment the payout
transfer calls back, which reads the ordering directly instead of inferring it from an attack outcome.

**The transferable part:** defence in depth also means a broken layer looks fine from outside. Test each
layer on its own and mutate the code rather than only the inputs when the cost of being wrong is money.

**Guard:** `test_stateIsTerminalBeforeAnyTransfer` and `test_refundStateIsTerminalBeforeTransfer`. Both
fail whether or not the guard is present.

---

## Found by reading a number that looked wrong

### Fork tests reported PASS without ever touching a fork

`contracts/test/AqueousFork.t.sol`, fixed in `2678753`.

The fork suite skipped itself with an early `return` when `block.chainid != 143`. **forge reports an
early return as `[PASS]`.** So five tests that never connected to anything, never signed anything and
never called real USDC read as five green tests and a suite whose entire purpose is to exercise the
real token was passing in an environment where the real token does not exist.

Nothing in the output said so. The tell was the gas: roughly 2,400 per test, which is too small to have
done anything at all.

Fixed with `vm.skip`, which reports `[SKIP]` and is visible in the summary. The fork tests that need a
live RPC now show as `[SKIP]` without a fork URL rather than a green `[PASS]`, each one named. A bare
`forge test` over the whole contracts project reads 172 passed, 0 failed and 10 skipped.

**The transferable part:** a failure that looks like success is the worst kind and a skip must announce
itself. Also, read the cost of a passing test occasionally. Work that did not happen is cheap.

---

## Found while writing a test and it was the test

### `Terms memory b = a` aliases, it does not copy

`contracts/test/AqueousFork.t.sol` and `AqueousExploit.t.sol`.

The tamper tests build an intended set of terms, sign them, then modify a copy to prove the signature no
longer validates. Assigning a memory struct to a new variable in Solidity **aliases the original**, so
modifying the copy modified the signed terms too and the honest case then failed with
`FiatTokenV2: invalid signature`.

That error reads exactly like the contract rejecting valid terms. The tempting response is to loosen the
contract until the test passes, which would have removed the fix that was working correctly.

Fixed with an explicit `_copy()` helper in both suites, carrying a comment saying why it exists.

**The transferable part:** when a test fails in a way that indicts the code under test, check the test
first if the failure appeared at the same time as the test did.

---

## Found while writing the contract

### A silent buyer could strand a delivered job forever

`contracts/src/Aqueous.sol`, fixed before the first commit.

The first shape had `release` for the buyer and `refund` for the buyer after the deadline. The agent had
no exit at all. An agent who delivered real work to a buyer who then stopped answering had no way to be
paid and no way to get the escrow released, ever.

Fixed by adding `claimDelivered`: after delivery plus a fixed public claim window, the agent can settle
without the buyer. Both sides now have an exit that does not need the other to answer, which is the
property the contract is actually for.

**Guard:** `test_agentClaimsAfterWindow` and `test_agentCannotClaimInsideWindow`.

The cost of this fix is stated in the audit's accepted risks: on a metered job, a buyer who never reports
usage pays the ceiling, because the contract has no independent record of units consumed.

---

## Found by writing down a limitation and then reading it back

### A gasless entrance with no gasless exit

**Severity: MEDIUM.** `contracts/src/Aqueous.sol`.

This one was documented before it was fixed. The README carried a paragraph headed "one limitation
this does not hide", explaining that only job creation was gasless and that `release` and
`settleMetered` still needed the buyer's own gas.

Written out plainly like that, it stopped reading like a limitation and started reading like a
trap. A buyer who genuinely held no MON could fund an escrow and then reach none of the three
exits. Their only move was to wait out the claim window and let the agent take everything. **The
feature built to help a buyer with no gas was the feature that could cost them the lot** and the
more exactly someone matched the target user the more exposed they were.

Fixed with `releaseWithAuthorization`, `settleMeteredWithAuthorization` and
`refundWithAuthorization`, each taking an EIP-712 signature that anyone can submit. Write-up in the
[audit](17-CONTRACT-AUDIT.md#finding-8-a-gasless-entrance-with-no-gasless-exit).

**Guard:** 12 gasless tests. The three that run a full lifecycle each assert `buyer.balance == 0` at
the end, the other nine assert the relayer cannot move the money. On the live testnet
deployment the demo buyer finished the whole lifecycle with a MON balance of 0 **and a transaction
count of 0**. All five new checks were mutation tested.

**The transferable part:** if a documented limitation would be unacceptable stated as a user
outcome rather than as a technical caveat, it is a bug wearing a caveat's clothes. "Release needs
the buyer's own gas" sounds reasonable. "A buyer with no gas loses their escrow" does not and they
are the same sentence.

---

## Found by a fan-out security audit

On 2026-09-27 a review swept every surface at once: contracts, API routes, the verifier engine, the
server libraries, the indexer, the CRE workflow and the secrets posture. Full writeups with the exploits
and the proofs are in [17-CONTRACT-AUDIT.md](17-CONTRACT-AUDIT.md), findings 11 onward. The headline ones:

### The SSRF guard was bypassed by an IPv4-mapped IPv6 address

**Severity: CRITICAL. Source only, the deployed guard needed a redeploy.** `verifier/src/net/guard.ts`.

The guard matched the mapped form `::ffff:127.0.0.1` with a regex on the dotted spelling, but `new URL`
rewrites the host to the hex form `::ffff:7f00:1` first, so loopback, cloud metadata and internal hosts
read as public and the socket dialled them. Reproduced live against a loopback server. Fixed by screening
the parsed IPv6 bytes and routing any embedded IPv4 through the IPv4 rules.

**Guard:** a `screenUrl` test over every mapped notation that fails against the old regex, plus an
end-to-end `guardedFetch` against a real loopback server reached through `[::ffff:127.0.0.1]`.

### The verifier called a claim true when only the transaction existed

**Severity: HIGH.** `verifier/src/ladder/verdict.ts`.

`judge()` reported `true` on a transaction merely existing, so a reverted transaction or one paying a
different address read as a settled payment. The recipient check lived only in the CLI. Fixed by running
the real settlement check on the web path and the sweep, so `true` now means the value reached the
claimed recipient. This recomputes the stored counts on the next sweep.

**Guard:** six `verdict.test.ts` cases, including a transaction paying a different address being `false`,
which fails against the existence-only rung.

### The paid endpoints returned the result without a settled payment

**Severity: HIGH.** `app/api/verify`, `app/api/service/[slug]`.

Work was delivered whether or not settlement confirmed. One authorization fired in parallel could run
the work many times for one settle. Fixed with a single-flight lock on the authorization and by gating
delivery on a confirmed settle. The happy path is unchanged.

**Guard:** an `x402.test.ts` reservation test, reserve then refuse a concurrent second, free on release,
refuse once confirmed.

### Smaller fixes in the same pass

* The indexer stored `javascript:` and `data:` strings in a field the schema promised was http(s) only.
  Now filtered to absolute http and https URLs.
* A negative `limit` on `/api/claims` and `/feed.json` threw a 500. Both are floored now.
* `/api/receipt/action` and `/api/vault` took unbounded signed writes. Field shapes, sizes and per-identity
  counts are capped.
* Deliberate 500s echoed the raw exception message. They log it and return a fixed line now.
* `CleanverseGate._readCvi` reverted on a validator returning a dirty bool, breaking the never-reverts
  guarantee of `cviStatus`. It reads the word directly now and reports Unknown.
* The commit and push hooks now refuse any `.env`, a stray `.pyc` was untracked, five tracked files that
  named the private `.hq/` directory were restated and a CSP plus hardening headers were added.

### The second remediation wave

A follow-up pass closed the medium and low items the first pass deferred:

* The database pool got a `statement_timeout`, a `query_timeout` and an idle-in-transaction timeout, so
  no single read can pin a connection forever, plus TLS for a non-loopback host. A `proxy.ts` adds a
  generous per-IP rate limit that answers a flood with a 429.
* The SSRF guard's DNS lookup is bounded by a timeout, so a hanging resolver cannot stall the worker.
* A payment session pins its recipient, so it cannot be steered into paying a different address. The
  studio run gates on the session before signing.
* An action receipt is now bound: the account key signs it too and the publish route requires that
  binding, so a receipt cannot name a signer its author does not control.
* The indexer checksums `agentWallet` to match the other addresses and drops the dead `Verdict` entity.
* Smaller: the webhook info endpoint stops reflecting the raw database error, `usdc()` formats with
  BigInt, the self-registration read-back tolerates a revert and the Qwen client caps its response.

## Found in the bond contract

Two fixes landed in Sclera and are written up in full in the contract audit rather than repeated here,
so this page stays the whole list without duplicating them.

* **Anyone could post a bond for an agent they did not own.** `postBond` never checked ownership, so a
  stranger could bond any agent with a floor that can never be slashed and the agent would read as
  bonded. Fixed by reading `ownerOf` from the ERC-8004 Identity Registry, which is an immutable
  constructor argument. See
  [17-CONTRACT-AUDIT.md](17-CONTRACT-AUDIT.md#finding-9-anyone-can-post-a-bond-for-an-agent-they-do-not-own).
* **Every `ReportRefused` event was discarded.** The event was declared and never read, so a refusal
  left no trace. Removed rather than kept unused. See
[17-CONTRACT-AUDIT.md](17-CONTRACT-AUDIT.md#finding-10-every-reportrefused-event-is-discarded).

## Found by an outside reviewer, 2026-10-15

* **The settled rung called an internal native payout "no payment".** Dissent's reviewer re-ran two of
  their mainnet withdrawals (3.10 MON and 0.85 MON, both paid by DissentCore to the challenger)
  through `settledCheck` and got `settled: false`, "moved no the native token at all". Both payouts had
  succeeded. A withdrawal is a zero-value call into a contract that pays with an internal CALL.
  `getNativeTransfer` read only the outer transaction's `to` and `value`. That broke the rule this
  project holds hardest: failing to see a payment is `unknown`, never `false`. Fixed in three parts.
  The rung now reads internal CALLs from a `callTracer` trace (`effectiveNativeCalls`), skipping a
  frame that errored together with everything under it, plus DELEGATECALL and STATICCALL frames that
  carry a value without moving it. If the provider gives no trace for a transaction that carried
  calldata, the answer is `unknown` with a reason that says the gap is in what could be read. A plain
  transfer with no calldata still answers `false` without a trace. Both withdrawals now settle through
  the real reader on mainnet. Tests: `verifier/src/ladder/settled-internal.test.ts`, 11 unit and 2 live.
  Four deliberate breaks each fail at least one. Their proposed receipt format, with its own tests,
  was reviewed and adopted as `dissent-withdrawal-receipt.v1` (see the mapping's comment in `parse.ts`).
  Adopting it publishes nothing: no feedback and no bond exist for it yet.

## Found while answering a partner's bond questions, 2026-10-16

Dissent asked how a bond on their challenger would actually work. Writing the answer meant reading the
sampling query and the registry closely. Two things did not hold up.

* **A bonded agent's sample could be moved by a stranger.** The measurement counts every feedback
  about the agent from any wallet except its owner (the Reputation Registry reverts an owner
  publishing about its own agent with "Self-feedback not allowed", checked with a read-only call).
  It also never checked where the claimed payment went. So someone else could publish a false claim
  about a bonded agent and lower its rate. Fixed as an option, not a change: `/api/sla/{agentId}` now
  accepts `publishers` (up to 8 wallets) and `recipient` (an address, with `agent` meaning the agent's own
  owner or wallet). With neither, the answer is the same as before, byte for byte apart from the
  timestamp. The original SQL is pinned by hash in a test, an unscoped answer carries exactly the keys
  it always had. The scoped statement is a separate one. Tested against a throwaway Postgres
  (13 tests, four deliberate breaks each fail one). No schema change.
  A first deploy of this returned a 500 for every scoped request, because the recipient clause named a
  view (`fovea.settlement_check_latest`) that production does not have. Postgres will not plan a
  statement that names a missing relation even when the clause cannot run. The throwaway database I
  tested against had the full schema, so it hid this. The unscoped path, which is what every page and
  the recorded simulation use, was never affected. Fixed in a follow-up: a publishers-only statement no
  longer mentions the view. A recipient scope answers 501 "Scope unavailable" on a deployment that
  does not keep those records, instead of a 500 or an empty sample. A test pins the first. I checked
  both against a scratch database with the view dropped, as production is.
  **What this does not fix:** the bonds already posted (Sentinel on agent 10256 plus the earlier ones)
  are unscoped. `postBond` has no field for a scope and the contract is immutable, so a scope cannot be
  recorded on chain. It is a public off-chain term that the oracle is told. A new bond should publish
  its scope beside it before it is posted.

## Still open (found the same day)

* **A slash can lose a race with `release`.** The oracle workflow asks for a verdict over the whole
  bond window. The contract rejects a window that ends in the future, so the earliest such a verdict can
  land is the block at which anyone may call `release`. Whoever calls first wins. The contract does
  accept a verdict ending at the current block, so a mid-window verdict is possible. The workflow does
  not send one. It is not changed here because the workflow and its recorded simulation are part of the
  filed submission.
* **The one live v2 bond has measured nothing.** Sentinel's window holds zero feedbacks so far. No bond
  has been slashed live. The slash path has only run on fork tests and a dry-run simulation.

## Found while looking into two database timeout bursts, 2026-10-20

The server log held two bursts of "timeout exceeded when trying to connect" and "canceling statement due
to statement timeout": 262 errors in two minutes on 14 October, 48 in one minute on 19 October. Nothing
else in seven days. The host was idle during both (load under 1, no CPU wait), so it was not a resource
limit.

* **The cause was one query on every agent page.** The access log put a backlink scraper
  (SERankingBacklinksBot, one address) and Googlebot on `/agent/<id>` at the time. Timing each call the
  page makes on the server showed `claims({ agentId, limit: 100 })` taking 1,419 ms while every other call
  took under 110 ms. Two things made it slow. The agent filter was `f.agent_id = x OR a."agentId"::text =
  x`, which spans two tables and a cast, so no index could serve it and Postgres compared every feedback
  with every agent on both chains: 11.5 million candidate pairs. It also joined `fovea.verdict_latest`, a
  `DISTINCT ON` over the whole verdict table that was sorted on disk on every call. The pool has eight
  connections. A page holding one for 1.4 seconds caps the site at about five agent pages a second.
  Eight pages at once reproduced the incident on demand: 15 of 16 failed.
* **The fix returns the same rows.** The filter resolves the agent first and matches with `IN`. The
  verdict is looked up per feedback through the existing index, with the view's own ordering. A count that
  filters on nothing the verdict carries no longer joins it. On the real database that query went from
  2,824 ms to 61 ms. The page's claims call went from about 1,430 ms to about 40 ms. An earlier version made
  an unfiltered count slower (13 ms to 182 ms), which I caught by benchmarking every shared shape and fixed
  before shipping. Old and new statements were compared row for row on production data across outcomes,
  rungs, mappings, agents by id and by number, an unknown agent and a malformed id (9 tests, read-only).
* **Two guard rails.** The site now serves a `robots.txt` (it returned the 404 page before). It turns away
  the backlink and SEO scrapers and asks everyone else for a five second crawl delay. No search engine or
  AI agent is listed. A test holds that. The pool also logs one line, at most every thirty seconds, when
  three or more queries are waiting for a connection, so the next burst names its cause.
* **What I tried and dropped.** A tighter per-client request cap. The two bots made 10 to 18 requests a
  minute, far under any cap that would not also throttle a judge clicking through.

## Still open

In the escrow, the source is fixed. One item is still live on chain pending a redeploy: the `receiveWithAuthorization` fix for gasless create is in source and tested, but the deployed Aqueous is immutable and still carries the transfer-variant behaviour until a redeploy updates the cited address. No app route calls `createJobWithAuthorization`, so nothing on the live site exposes it. The security audit tracks this as an open high.

Nothing known and unfixed in the indexer either. The population sweep's failure rate went from every
sweep, to about 70%, to **13 per full resync**. The remaining few are logged with whatever the RPC
actually said rather than swallowed.

This log is appended to, never rewritten. An entry that turns out to be wrong gets a correction
underneath it rather than a quiet edit.
