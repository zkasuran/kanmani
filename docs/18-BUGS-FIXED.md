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
rendered as a confident `0` for a registry holding 10,252 agents.

Fixed by reading at `latest`, which is what the number is for anyway: the row is overwritten each sweep
and `/status` compares against now, so a historical population has no reader. Write-up in the
[audit](17-CONTRACT-AUDIT.md#finding-7-the-freeze-detector-asked-a-non-archive-node-for-historical-state).

**Guard:** a clean index now publishes `counterSlotCount: 10252` against 10,252 rows counted by the
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

Fixed with `vm.skip`, which reports `[SKIP]` and is visible in the summary. The suite now reads
`31 tests passed, 0 failed, 6 skipped` without a fork URL and the 6 are named.

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

## Still open

Nothing known and unfixed in the escrow.

Nothing known and unfixed in the indexer either. The population sweep's failure rate went from every
sweep, to about 70%, to **13 per full resync**. The remaining few are logged with whatever the RPC
actually said rather than swallowed.

This log is appended to, never rewritten. An entry that turns out to be wrong gets a correction
underneath it rather than a quiet edit.
