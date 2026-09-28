# 17. Security audit

**Reviewed 2026-09-18, before deployment.** The escrow has never been deployed, so nothing in it was
ever live and no user funds were ever at risk. The indexer and the deploy stack were running.

**Eight issues were found and fixed**, across all three components. Two were fund-loss bugs in the
escrow, one of them high severity and one that defeated the main feature. Both are published here with
the exploit, the fix and the proof, because an audit that only lists what it found clean is not
evidence of anything.

| Component | Reviewed | Found |
|---|---|---|
| `contracts/src/Aqueous.sol` | yes | 1 HIGH, 2 MEDIUM |
| `indexer/`, Retina handlers and schema | yes | 4, none exploitable, all publishing wrong numbers |
| `deploy/`, compose and Hasura tracking | yes | 1 HIGH for the judging window |

The indexer findings share one shape worth naming up front: **every one of them was a number the build
published and nobody had checked.** Three of the four were found by grepping for which code writes a
field, which took about a minute each.

| | |
|---|---|
| Method | manual review, then a written exploit or a query for every candidate finding |
| Reviewer | zkasuran, with AI assistance. See the disclosure at the end |
| Status after fixes | 61 contract tests (55 pass, 6 skip without a fork url), 0 compiler errors, indexer typecheck clean |
| Escrow deployed | Monad testnet `0xba2B1709eC4C3E76126043B3C3ef43Cc5d4F328C`. Mainnet not yet |

---

## Why the findings are stated as exploits

A finding described in prose is an opinion. A finding written as a test that passes against the old
code is a fact. The two escrow findings below were **first committed as passing exploit tests**, then fixed, then
kept as regression tests named `test_FIXED_*` so the reason they exist stays visible to anyone reading
the suite later.

That ordering matters for a second reason. It is how the fix gets checked: once the exploit is a test,
reverting the fix has to make it fail again. A fix nobody tried to break is a guess.

---

## Finding 1: a relayer could steal the entire escrow

**Severity: HIGH.** Loss of the full escrowed amount, for any buyer who used the relayed path.

**Location:** `createJobWithAuthorization`.

### The bug

An EIP-3009 authorisation signs exactly six fields:

```
TransferWithAuthorization(address from, address to, uint256 value,
                          uint256 validAfter, uint256 validBefore, bytes32 nonce)
```

**It says nothing about which agent gets paid, the deadline, the price or the terms of the work.** In
the original code every one of those came from the transaction's `Terms` argument, supplied by whoever
submitted it. The signature authorised a transfer into the escrow. It did not authorise what the escrow
would then do with the money.

### The exploit

1. The buyer signs an authorisation, intending to hire agent A.
2. The relayer submits it naming **itself** as the agent. The signature is still valid, because it
   never covered the agent.
3. The relayer calls `deliver()` immediately. This moves the job from `Open` to `Delivered` and
   **`refund()` requires `Open`**, so the buyer's exit is now permanently closed.
4. The relayer waits out `claimWindow` and calls `claimDelivered()`.

The escrow pays out in full, to the attacker, for work that never existed. The buyer has no recourse at
any point after step 2.

**This defeated the entire purpose of the relayed path**, which exists so a buyer who holds no MON can
hire without touching the chain. The feature that made the product usable was the feature that made it
unsafe.

### The fix

**Derive the nonce from the terms instead of accepting it from the caller.**

```solidity
function authNonceFor(Terms calldata t) public pure returns (bytes32) {
    return keccak256(abi.encode("kanmani.aqueous.v1", t));
}
```

The contract computes this and passes it to the token. Alter any field of `Terms` and the nonce changes,
so the digest changes, so **the token's own signature check rejects it.** Verification stays where it
belongs, inside the token and we never reimplement signature checking.

`Authorization` lost its `nonce` member as a result. **No second signature and no new field were needed:
the nonce already existed in the standard and was carrying no meaning.**

The buyer's flow is unchanged in effort. They call `authNonceFor(terms)`, sign a standard
`TransferWithAuthorization` using the result as the nonce and hand it to any relayer.

### The proof

`test_fork_relayerCannotAlterTheTerms`, run against **real USDC on a Monad mainnet fork**, so the
signature check is the deployed FiatTokenV2 rather than a mock of it. It tampers with the agent and
asserts the revert, then submits the unaltered terms and asserts success, so the revert is about
tampering rather than a broken test helper.

`test_FIXED_relayerCannotRedirectJobToItself` covers the same ground against a local token that
verifies signatures and checks **each** field independently: agent, deadline, price and terms hash.

**And the fix was checked by breaking it.** Making `authNonceFor` ignore the terms reproduces the
original behaviour and the fork test then fails with `next call did not revert as expected`. That is
the theft reappearing on demand, which is the only convincing evidence the fix is what stops it.

---

## Finding 2: a fee-on-transfer token permanently locks another user's funds

**Severity: MEDIUM.** Permanent, unrecoverable lockup. Requires a non-standard token, which any caller
can nominate.

**Location:** `createJob` and `createJobWithAuthorization`.

### The bug

The contract recorded `t.amount` as the escrowed value while the token may have credited less. It never
checked what actually arrived.

With a token that takes a fee on transfer:

1. Alice creates a job for 100. The contract receives 99 and records 100.
2. Bob creates a job for 100. The contract receives 99 and records 100.
3. The contract holds 198 and owes 200.
4. Alice releases and is paid 100, out of the shared balance.
5. **Bob can never be paid.** `release` reverts. `refund` reverts. The contract is immutable with no
   admin function, so nothing can recover it.

Aqueous advertises itself as token agnostic and lets any caller name any token address, so this is
reachable without any privileged position.

### The fix

Measure the balance delta and refuse anything that does not deliver exactly what was asked:

```solidity
function _requireExactlyReceived(address token, uint256 balanceBefore, uint256 amount) private view {
    if (_balance(token) - balanceBefore != amount) revert TransferFailed();
}
```

**Refusing at creation is deliberate, rather than recording the amount that arrived.** Recording the
real amount would work for fee-on-transfer and would then be quietly wrong for rebasing tokens whose
balance moves after creation. For an immutable contract holding other people's money, a clean revert on
an unsupported token beats accounting that is subtly wrong in a case nobody tested.

This also rejects rebasing and deflationary tokens by construction. That is the intended outcome and it
is stated here rather than discovered later.

### The proof

`test_FIXED_feeOnTransferTokenIsRefusedAtCreation` builds a 1% fee token, attempts creation, asserts
the revert, then asserts the contract holds nothing and the buyer keeps their money.

---

## Finding 3: the deploy stack started with a known admin secret

**Severity: HIGH for the judging window.** Not exploitable as it stood, because every port is bound to
loopback. It becomes critical the moment the endpoint is published, which the submission requires.

**Location:** `deploy/docker-compose.yml` and `deploy/track-hasura.sh`.

### The bug

```yaml
HASURA_GRAPHQL_ADMIN_SECRET: ${HASURA_GRAPHQL_ADMIN_SECRET:-testing}
POSTGRES_PASSWORD: ${ENVIO_PG_PASSWORD:-testing}
```

Both defaulted to the literal string `testing` and neither was set anywhere, so the running stack was
using them. `track-hasura.sh` defaulted to the same value, so the pair worked together and nothing ever
prompted anyone to set either one.

The admin secret is the entire authentication story for Hasura. It grants the admin role, which is
schema and metadata access to the database behind it, not just read access to the data.

**Why it matters here specifically:** this index has to be publicly queryable by judges from Oct 14 to
Nov 3. The submission is a live GraphQL endpoint. So the plan was always to put a public address in
front of port 8081 and on the day that happened, admin access would have been available to anyone who
sent `x-hasura-admin-secret: testing`.

**And the default was in a repo that goes public at submission.** The secret was not merely weak, it was
published in the same artifact that tells you where to send it.

### The fix

Make both required, so compose refuses to start rather than starting insecure:

```yaml
HASURA_GRAPHQL_ADMIN_SECRET: ${HASURA_GRAPHQL_ADMIN_SECRET:?HASURA_GRAPHQL_ADMIN_SECRET is required, generate one, see .env.local}
```

`HASURA_GRAPHQL_ENABLE_CONSOLE` went to `false` at the same time, because the console is an admin
surface and nothing needs it on a published endpoint.

Anonymous reads stay on, deliberately. `HASURA_GRAPHQL_UNAUTHORIZED_ROLE: public` is the feature: a
judge queries the index with no credentials. What that role may touch is granted table by table in
`track-hasura.sh`, so a new entity is unreadable until it is listed, rather than exposed by default.

### The proof

Real values were generated, the Postgres role password was rotated on the live volume with `ALTER USER`
so the running stack matches the file and the stack was restarted. Then, against the live endpoint:

| Request | Result |
|---|---|
| `x-hasura-admin-secret: testing` | `access-denied`, `invalid "x-hasura-admin-secret"` |
| the new secret | 200, `Agent_aggregate` returns 10,252 |
| no credentials at all | 200, `Agent_aggregate` returns 10,252 |

The third row is the one that matters, because a fix that locked judges out would be its own failure.

---

## Finding 4: `distinctOwners` was a copy of `memberCount` and it is a published number

**Severity: MEDIUM.** No exploit. It published a wrong figure, in the one place this project claims to
be careful about figures.

**Location:** `indexer/src/handlers/Retina.ts`, the `Registered` handler.

### The bug

```ts
context.AgentRecord.set({
  ...rec,
  memberCount: rec.memberCount + 1,
  distinctOwners: rec.distinctOwners + 1,   // unconditional
});
```

Both incremented on every registration with no owner deduplication anywhere, so the two fields were
provably equal for every row in the table. `distinctOwners` counted agents, not owners.

**The number it gets wrong is the headline.** The finding this build leads with is that 8,093 agents
across **7,962 wallets** point at one deleted Vercel deployment. 8,093 is `memberCount`. 7,962 is
`distinctOwners` and this code could only ever have returned 8,093 for it. The schema comment
describing the field said the right thing while the code underneath it did not.

A wrong number in a build whose entire thesis is that other people's numbers are unchecked is worse
than a wrong number somewhere else.

### The fix

Deduplicate through a join entity rather than counting twice:

```ts
const ownerRowId = `${uriHash}_${event.params.owner}`;
const seenOwner = await context.AgentRecordOwner.get(ownerRowId);
// ...
distinctOwners: seenOwner ? rec.distinctOwners : rec.distinctOwners + 1,
```

Counted at registration time, deliberately. `Agent.owner` moves on every `Transfer`, so a live aggregate
would answer "who holds these agents now" when the published claim is about who registered them.
`AgentRecordOwner` also carries `agentCount`, so "this operator registered 41 agents against one dead
document" is now a query rather than a guess.

### The proof

A full reindex from block zero, then the two columns compared directly on the largest record. They now
differ and the difference is the operators who registered more than one agent against the same
document. Numbers are in [18-BUGS-FIXED.md](18-BUGS-FIXED.md).

---

## Finding 5: three published counters were declared and never written

**Severity: MEDIUM.** The cross-check that the project's own comments call load-bearing was dead.

**Location:** `indexer/schema.graphql` and the `PopulationCheck` block handler.

### The bug

`IndexState` declared `agentsFromLogs`, `feedbackCount` and `recordCount` as non-null. Grep found
exactly three references, all of them reads:

```ts
agentsFromLogs: existing?.agentsFromLogs ?? 0n,
feedbackCount:  existing?.feedbackCount  ?? 0n,
recordCount:    existing?.recordCount    ?? 0n,
```

No handler ever set them to anything else, so all three were pinned at 0 forever.

These exist so `/status` can compare the on-chain population counter against what the index actually
holds and say "the index is behind" instead of quietly reporting a stale number. With the log side
pinned at 0, the gap always read as maximal. The check could not have reported a healthy index and
nothing was watching it.

### The fix

Deleted, not backfilled. A denormalised counter can drift from the table it counts and Hasura answers
the same question exactly, for free, with no write on the hot path:

```graphql
query { Agent_aggregate { aggregate { count } } }
```

`/status` asks Hasura for the row counts and the indexer publishes only what Hasura cannot know, which
is the on-chain counter slot.

### The proof

The aggregate query was run against the live endpoint anonymously and returns 10,252 agents and 9,188
feedbacks, which matches the counter slot read independently from the chain.

---

## Finding 6: the schema could not express "unknown", in the one field built for it

**Severity: LOW.** Fixed together with Finding 5.

`counterSlotCount` was `BigInt!`, non-nullable. The handler that writes it carried this comment:

```ts
// Unknown stays unknown. A failed read must never be published as zero.
counterSlotCount: counter ?? existing?.counterSlotCount ?? 0n,
```

The comment forbids exactly what the line does. A failed RPC read on the first sweep published `0`,
because the type system left no other option. "Unknown is never zero" is this project's stated data
quality position and its own schema could not represent it.

Fixed by making the field nullable and dropping the `?? 0n`. A failed read now publishes null.

The same review added a 10 second `AbortSignal.timeout` to that RPC call. It had none and this index
runs unattended for six weeks, so a hung socket would have stalled the sweep indefinitely with no error
to see.

---

## Finding 7: the freeze detector asked a non-archive node for historical state

**Severity: MEDIUM.** The check that exists to catch a frozen index had never once produced a number.

**Location:** `readAgentCount` and `PopulationCheck` in `indexer/src/handlers/Retina.ts`.

### The bug

The population sweep read the registry's counter slot **at the block being indexed**:

```ts
params: [IDENTITY, COUNTER_SLOT, `0x${input.blockNumber.toString(16)}`],
```

`rpc.monad.xyz` is not an archive node. Asking it for state at an old block returns:

```
-32602  Block requested not found. Request might be querying historical state that is not
        available. If possible, reformulate query to point to more recent blocks
```

During a backfill every block being indexed is historical, so every sweep failed. Measured on a
throwaway index built for this review: **5,276 of 5,276 reads returned no result.** Not most of them.
All of them.

**So both halves of the cross-check were dead at the same time.** Finding 5 pinned the log side at 0,
this pinned the chain side at nothing and the `?? 0n` from Finding 6 rendered the pair as a confident
`0` for a registry holding 10,252 agents. The check whose only job was to notice a number had gone
stale was the stalest number on the page.

Nothing said so, because the failure path was a bare `catch { return null }` with no log. A silent null
is indistinguishable from a chain with nothing to report.

### The fix

Read at `latest`:

```ts
params: [IDENTITY, COUNTER_SLOT, "latest"],
```

Head is also what the number is for. `IndexState` is one row that every sweep overwrites and `/status`
compares "agents that exist now" against "rows we hold now". Nobody reads a historical population, so
asking for one bought nothing.

Two supporting changes in the same pass:

* **The failure path logs.** `context.log.warn` on both the empty-result branch and the thrown-error
  branch, naming the block and quoting what the RPC actually said. The silence is what let a 100%
  failure rate survive unnoticed.
* **The sweep stopped firing 52,875 times per resync.** `_every: 2000` from `start_block: 0` swept the
  whole chain, including the 53 million blocks before the registry existed, each an uncached call to a
  public endpoint, to write a row the next sweep immediately overwrites. Now `_every: 10000` with a
  `_gte` floor at a recent block.

### The proof

A clean index built from scratch after the fix. `counterSlotCount` holds **10252**, against **10,252**
agent rows produced by a completely independent path, the logs. The two agree, which is the comparison
the field was added for and the first time it has been possible to make it.

### A wrong theory, then the measurement that killed it

This section existed in an earlier draft of this document saying something else. It is worth
leaving the correction visible rather than quietly editing it.

After the `latest` fix, **about 70% of sweeps still failed during a backfill**: 2,140 RPC errors and
1,565 timeouts out of roughly 5,276, with the floor set at the registry's first registration. The
obvious reading was that the public endpoint throttles, so this document said a dedicated RPC endpoint
was the fix.

**That was wrong. One experiment showed it.** Wiring a dedicated endpoint through and confirming it
reached the container changed nothing: **3,705 failures became 3,869.** Slightly worse, well inside
noise. The endpoint was never the problem.

The cause was the sweep count itself. `IndexState` is a single row, so every historical sweep writes a
value the next one overwrites and only the last survives. Thousands of calls were being made to
produce one number. Raising the floor from the registry's deployment block to a recent block cuts a full
resync from 5,276 sweeps to about 76, because a historical population has no reader.

**Measured after that change: 13 failures, down from 3,869.** A 99.6% reduction, with `counterSlotCount`
still landing on 10252.

The floor never needs bumping. The chain only moves forward, so any floor below head keeps sweeping
forever. The value is only meaningful at head anyway.

---

## What was checked and came back clean

Stating coverage matters as much as stating findings. Silence about what was examined reads as a claim
that everything was.

| Area | Result |
|---|---|
| Reentrancy on every fund-moving path | Clean. Terminal state is written before any transfer, plus a guard. Both layers tested separately, see below |
| Double release, double refund, release after refund | Clean. Terminal states reject re-entry into any transition |
| Access control on `release`, `refund`, `settleMetered`, `claimDelivered`, `deliver` | Clean, including a fuzz over arbitrary callers |
| Metered split arithmetic and its cap | Clean. Fuzzed over amount, price and unit count: the agent plus the buyer always receive exactly what was escrowed and the payout never exceeds the ceiling |
| Job id squatting | Clean. Ids are derived from the buyer, so one buyer cannot occupy another's id space |
| A token that returns `false` rather than reverting | Clean, treated as failure |
| Buyer stranded by a silent agent | Clean. `refund` needs no counterparty after the deadline |
| Agent stranded by a silent buyer | Clean and this was a design gap found while writing the contract. `claimDelivered` was added |
| Unit count overflow in the metered split | Reverts rather than wrapping, under Solidity 0.8 checked arithmetic. The buyer controls the input, so the only party affected is the caller |
| `block.timestamp` dependence | Accepted. Validator drift is seconds and deadlines are days. Flagged by the linter, left deliberately |

### Reentrancy was tested as two layers, not one

Worth recording because it was nearly missed. The suite originally had one reentrancy test and
deliberately breaking checks-effects-interactions **left all 28 tests green**, because the
`nonReentrant` guard caught the attack instead.

The test proved the guard worked. It said nothing about whether the ordering was right. A backstop was
hiding the absence of the thing it backs up.

`test_stateIsTerminalBeforeAnyTransfer` now asserts the ordering directly, using a token that records
the job state at the moment it is called back. It fails whether or not the guard is present.

---

## Finding 8: a gasless entrance with no gasless exit

**Severity: MEDIUM.** Not a theft. A design hole that could strand a buyer's whole escrow.

**Location:** the buyer-facing lifecycle, before `releaseWithAuthorization` existed.

### The bug

`createJobWithAuthorization` let a buyer with no MON fund a job on someone else's gas. That was the
headline feature. Nothing else was gasless.

So a buyer who genuinely held no gas token could escrow their money and then do nothing with it.
`release` needs their transaction. So does `settleMetered`. So does `refund`. Every exit was shut.

Their only remaining move was to wait out the claim window and let the agent take the entire
amount through `claimDelivered`. **The feature that existed to help a buyer with no gas was the
feature that could cost them everything** and the more completely a buyer matched the target user
the more exposed they were. Someone who held a little MON was fine. Someone who held none was not.

It is worth being precise about why this counts as a finding rather than a missing nice-to-have.
The contract's stated property is that both sides always have an exit that does not depend on the
other answering. For a gasless buyer that was false and it was false in the exact configuration
the product was built to serve.

### The fix

Three signed entry points, mirroring the create path:

```solidity
function releaseWithAuthorization(bytes32 jobId, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)
function settleMeteredWithAuthorization(bytes32 jobId, uint256 units, uint256 validBefore, ...)
function refundWithAuthorization(bytes32 jobId, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)
```

Each recovers an EIP-712 signature and passes the recovered address into the same internal check
the direct path uses, so the two cannot drift: there is one set of checks per action, not two.
`releaseDigest`, `settleMeteredDigest` and `refundDigest` return the exact bytes to sign.
**The entry points call those same public functions** rather than rebuilding the layout.

Four properties worth naming, because each is a thing that goes wrong in this class of code:

* **`units` is inside the settle digest.** Otherwise a relayer holding a signature for 1 unit could
  submit 5 and pay the agent the whole ceiling.
* **No nonce, deliberately.** Every authorised action moves the job to a terminal state, so a
  replay finds it `Settled` or `Refunded` and reverts. A nonce would be a second mechanism for a
  property the state machine already has. `test_replayIsBlockedByTerminalState` asserts the reason
  rather than the outcome, so if someone later makes an action non-terminal the test says a nonce
  is now required.
* **The domain binds `chainId` and `address(this)`**, so a signature for the testnet deployment is
  useless against the mainnet one.
* **`ecrecover` is wrapped.** It returns the zero address for a malformed signature instead of
  reverting, so bad `v`, the high-`s` twin of a signature and the zero address are all turned into
  an explicit revert.

### The proof

Eleven tests in `AqueousGasless.t.sol` and a live run. Every test asserts `buyer.balance == 0` at
the end, because the moment the buyer needs one wei the claim is gone and a test that only checked
the token balances would not notice.

On the live testnet deployment, the demo buyer finished the whole lifecycle with
**a MON balance of 0 and a transaction count of 0.** A nonce of zero is the claim in one integer:
that address has never originated a transaction on the chain and it still hired an agent, had the
work delivered and received its refund.

**All five new checks were mutation tested.** Removing the high-`s` check, the zero-address check,
the expiry check, `units` from the digest or `address(this)` from the domain each makes a specific
test fail.

### What mutation testing found, which is the part worth reading

The `units` mutation **passed on the first attempt** and the reason is a better finding than the
mutation was.

The digest was built in two places: once in the public `settleMeteredDigest` view that clients sign
against and again inside `settleMeteredWithAuthorization`. Mutating one left the other intact, so
the test passed on a digest mismatch rather than on the property it claimed to check.

That duplication was itself the bug. Two copies of an EIP-712 layout drift and when they do the
symptom is every valid signature being rejected, which reads like a broken signer rather than a
broken contract. The entry points now call the same public functions clients call, so there is one
definition. With that collapsed, the mutation fails the test with
`next call did not revert as expected`, which is a relayer successfully settling for 5 units
against a signature for 1.

---

## Accepted risks, stated rather than omitted

* **Rebasing and fee-on-transfer tokens are unsupported** and rejected at creation. See Finding 2.
* **`block.timestamp`** decides deadlines and the claim window. A validator can move it by seconds,
  which cannot matter at day-scale deadlines.
* **A buyer may release before delivery** and may release a metered job at its full ceiling instead of
  settling it by usage. Both are allowed on purpose: overpaying is the buyer's choice to make.
* **On a metered job, a silent buyer pays the ceiling.** This one deserves stating plainly. The unit
  count is reported by the buyer in `settleMetered`, so the contract has no independent record of usage.
  If the buyer never reports, `claimDelivered` pays the agent the whole escrowed ceiling rather than the
  units actually consumed.

  There is no better answer available on chain. The alternative is stranding a delivered job forever,
  and a usage oracle is a trusted third party this contract exists to avoid. **What it means in practice
  is that the claim window is also the buyer's deadline to report usage**, so a buyer running a metered
  job has to answer within it. That is the trade and it is why the window is public and fixed.
* **The claim window is fixed at deployment** and public. Neither side can be surprised by it and
  neither side can change it.
* **A malicious token can misbehave within its own job.** A job is settled in the token it names and
  each job records its own token, so a bad token cannot reach another job's balance. Naming a worthless
  token harms only the buyer who chose it.
* **Nothing recovers funds sent to the contract outside `createJob`.** There is no sweep function,
  because a sweep function is also a way to take escrowed money. A stray transfer is stuck and that is
  the correct trade for an immutable escrow.

---

## One test bug, worth publishing

While writing Finding 1's regression test, it failed with `FiatTokenV2: invalid signature` on a case
that should have succeeded. That looks exactly like the contract rejecting valid terms.

**The cause was the test, not the contract.** In Solidity `Terms memory b = a` **aliases** rather than
copies, so tampering through the alias mutated the original struct and invalidated a signature made
earlier in the same test. Fixed with an explicit copy helper.

It is recorded because the failure shape is misleading: a correct contract looked broken and the
tempting response is to loosen the contract until the test passes.

---

## Reproduce this

```bash
cd contracts
forge install foundry-rs/forge-std
forge test                                   # 31 unit and regression tests
forge test --fork-url "$MONAD_RPC"           # +6 against real USDC on Monad mainnet
```

The fork tests **report as skipped rather than passed** without a fork URL. An earlier version used an
early return, which forge reports as `[PASS]`, so five tests that never touched a fork read as green.
The gas figure of roughly 2,400 was the tell.

To re-run the fix verification, make `authNonceFor` ignore `Terms` and confirm
`test_fork_relayerCannotAlterTheTerms` fails.

---

## AI disclosure

AI assistance (Claude, Anthropic) was used in writing this contract, its tests and this document. The
design, the review and the decisions are the author's and every finding here was verified by an
executable exploit rather than accepted as an assertion. Verified before publishing: 37 tests passing
across two suites, 0 compiler warnings and both fixes confirmed by reverting them and watching the
regression tests fail.

---

## Finding 9: anyone can post a bond for an agent they do not own

**Sclera. Found 2026-09-23 by the pre-deploy review. This is why Sclera is not deployed.**

### The bug

`postBond` takes an `agentId` and never asks who owns it.

```bash
grep -cE "ownerOf|IdentityRegistry|0x8004A169" contracts/src/Sclera.sol    # 0
```

The contract validates that the id is non-zero, that the amount is non-zero, that the rate is within
bounds and that no bond already exists. It then writes `b.agent = msg.sender` and pulls the token.
Nowhere does it consult the ERC-721 identity registry that decides who actually holds agent `id`.

### The exploit

Two things follow and the second is worse than the first.

**It is a denial of service on bonding.** `if (b.state != State.None) revert BondExists()` means one
bond per agent, forever, whoever got there first. A stranger posts the smallest bond the token allows
against agent 10182 and the real operator can never bond that agent again. The squatter is not out of
pocket: `release` pays `b.agent`, which is the squatter.

**It makes a bond prove nothing, which defeats the thesis.** The product claim is *"an agent stakes
against its own promise"* and *"trust stops being a badge and becomes a price"*. Without an ownership
check, a bond is not the agent's stake. A stranger can post one for any agent with
`minTruthRateBps = 0`, which no verdict can ever fall below, so the bond can never be slashed:

```
postBond(10182, USDC, 1, /* minTruthRateBps */ 0, window, minSample)
```

Agent 10182 now reads as bonded. A buyer who takes that as evidence the operator has money at risk
has been misled and the misleading is cheap, permanent and available to anyone. **A badge that costs
one atomic unit of USDC to fake is the exact thing this project was built to attack**, which is what
makes this a design failure rather than a missing input check.

### The fix, not applied here because it is a design decision

Three options and they are not equivalent:

1. **Require `ownerOf(agentId) == msg.sender`** at post time, reading the identity registry. Correct
   and costs an external call. It also means a bond cannot survive the agent being transferred, which
   has to be decided rather than discovered.
2. **Let anyone bond and publish who bonded.** A bond by a non-owner is then a third party's wager
   rather than the agent's stake, which is a different and defensible product, but every surface
   saying "the agent staked" would have to stop saying it.
3. **Allow one bond per (agent, poster)** instead of per agent, removing the denial of service while
   leaving option 2's disclosure problem.

Option 1 is what the thesis already claims is true, so it is the one that makes the documentation
correct rather than the one that makes the code match a weaker claim.

### The fix, applied

Option 1. `postBond` now reads ownership from the ERC-8004 Identity Registry and refuses anyone else:

```solidity
if (IIdentityRegistry(identityRegistry).ownerOf(agentId) != msg.sender) revert NotAgentOwner();
```

The registry address is an **immutable constructor argument with no setter**, so authority over who may
bond cannot be moved after deployment. It is an argument rather than a constant because the registries
are per-chain singletons at one address on every mainnet *and* at a different address on Monad testnet,
so a hardcoded value would be correct in production and untestable everywhere else. The deploy script
defaults to the canonical address and asserts there is code at it, because a wrong address makes the
contract inert rather than dangerous: every `postBond` would revert.

`ownerOf` reverts for an unregistered token, which is the behaviour we want, so there is no existence
check of our own. The mock in the tests reverts the same way on purpose. A mock returning
`address(0)` instead would let a test pass while the real registry reverted.

### The proof

Six tests and the mutation that proves they are load-bearing rather than decorative. Replacing the
check with `if (false) revert NotAgentOwner();` turns **four of them red**:

```
[FAIL: next call did not revert as expected] test_postBond_strangerCannotBondSomebodyElsesAgent
[FAIL: next call did not revert as expected] test_postBond_strangerCannotSquatTheSlot
[FAIL: next call did not revert as expected] test_postBond_unslashableBondCannotBeCreatedByAStranger
[FAIL: next call did not revert as expected] test_postBond_unregisteredAgentCannotBeBonded
Suite result: FAILED. 35 passed; 4 failed
```

Restored, the suite is green at 39. The specific shape that made a bond meaningless,
`minTruthRateBps = 0`, which no verdict can fall below, is named in its own test rather than left
implied.

### Status

**Closed 2026-09-24.** The gate is satisfied for this finding. The security review is gating rather
than advisory in this project, and this is the finding that gate exists for. No test covered it:

```bash
grep -niE "notOwner|ownerOf|squat" contracts/test/Sclera.t.sol    # no matches
```

## Finding 10: every ReportRefused event is discarded

**Sclera. Low severity and it makes debugging a live slashing harder.**

`onReport` emits a refusal reason and then reverts:

```solidity
emit ReportRefused(v.agentId, "bad signature");
revert BadSignature();
```

A revert discards the whole transaction including its logs, so **no `ReportRefused` event can ever be
observed.** The contract appears to publish why a report was refused and in fact publishes nothing.
Either the reason belongs in the revert data or the paths that are meant to be observable must
return rather than revert. The tests pass because they assert the revert selector, which is the part
that works.

### The fix, applied

**Closed 2026-09-24.** The event and all six unreachable `emit`s are removed and the declaration is
replaced by a comment explaining why so the absence does not read as an oversight. The custom errors
already carry the reason in revert data, where a caller can read it. Nothing was added: deleting a
thing that could never be observed is the smaller change than making it observable and no caller
could have depended on a log that was never emitted.

### What was checked and found sound

Recorded so the review is not only a list of complaints. Reentrancy: `nonReentrant` on all three
state-changing entry points, with effects written before token interaction in `onReport` and
`release`. Fee-on-transfer: `_requireExactlyReceived` refuses a token that does not deliver the exact
amount, which is Finding 2 from Aqueous already applied here. Replay: verdict nonces are monotonic per
agent and a reverted report correctly does **not** record its nonce, asserted directly in
`test_verdict_smallSampleStillConsumesTheNonce`. Forwarder trust: `onReport` deliberately ignores the
forwarder's metadata and authorises on the attestor's own signature, which is correct on a chain where
the forwarder validates nothing. The deploy script refuses the demo attestor by address, because that
key is derived from a test vector committed to this repository.

## The 2026-09-27 audit pass

A second review ran across the whole build, not just the contracts: the Solidity, the API routes, the
verifier engine, the server libraries, the indexer, the CRE workflow and the secrets posture. Each
surface was read on its own and every finding that survived was reproduced before it was fixed. The
findings below are ordered by severity. The ones marked applied ship with a test that fails against the
old code. The ones marked accepted or deferred say plainly why a code change was not the right answer.

## Finding 11: the SSRF guard was bypassed by an IPv4-mapped IPv6 address

### The bug

The verifier fetches URLs that strangers put on chain, so `verifier/src/net/guard.ts` screens every
address against the private, loopback and cloud-metadata ranges. The IPv6 branch recognised the
IPv4-mapped form only through a regex on the dotted spelling, `^::ffff:(\d+\.\d+\.\d+\.\d+)$`.

The WHATWG URL parser rewrites `[::ffff:127.0.0.1]` to the compressed hex form `::ffff:7f00:1` before
the guard ever runs. The regex matches the dotted spelling and never the hex one, so the address read
as public and Node's dual-stack socket then connected it straight to `127.0.0.1`.

### The exploit

An agent registers an evidence document at `http://[::ffff:169.254.169.254]/latest/meta-data/` or at
`http://[::ffff:10.0.0.5]/` for a host on our own network. Both passed the screen and were fetched. The
same held on the payable-probe path and on every redirect hop. Reproduced live against a loopback
server: the guarded fetch returned the server's body with status 200.

### The fix

Screen the parsed bytes, not a spelling. `isForbiddenAddress` now expands any IPv6 address to its eight
groups and routes any embedded IPv4, the mapped `::ffff:a.b.c.d`, the deprecated compatible `::a.b.c.d`
and the NAT64 `64:ff9b::/96` prefix, through the IPv4 rules. An address it cannot parse fails closed. A
public mapped address such as `::ffff:8.8.8.8` still resolves, so the fix blocks the attack without
breaking a legitimate fetch.

### The proof

`guard.test.ts` gained a `screenUrl` test over every mapped notation, which fails against the old regex,
and an end-to-end `guardedFetch` against a real loopback server reached through `[::ffff:127.0.0.1]`,
which asserts the body never comes back. The earlier test fed the dotted string straight to the
function, so it matched the regex and never exercised what the URL parser actually produces. The suite
is 18 green after the change.

## Finding 12: the verifier called a claim true when only the transaction existed

### The bug

`judge()` topped its ladder out at `locate`, which asks whether a transaction with the cited hash is on
the named chain. It then reported outcome `true`, whose own definition is that the described payment
happened. Existence is not payment. A cited transaction can revert or succeed while paying a different
address, so `judge()` read all three as `true`. The full check, which reads the receipt and matches
the recipient, lived in `settledCheck` and was wired only into the CLI, never into the web path or the
sweep that fills the stored verdicts.

### The exploit

An agent cites any real Monad transaction in its evidence document, a reverted one, an unrelated one or
one paying somebody else, then earns a green `true`. Reproduced by feeding `judge()` a reverted receipt
and a receipt paying a different address: both returned `outcome: "true"` before the fix.

### The fix

`judge()` now runs the real settlement check whenever a settlement reader is available and the claim
names a recipient, which the execution.market shapes do. It reads the receipt, refuses a revert and
requires the value to reach the claimed recipient before `true`. A claim with no recipient falls back to
existence, where a revert is now a `false` rather than a `true`. The web path and the sweep both
pass the reader, so the site and the CLI agree and the stored verdicts get the real check on the next
sweep.

### The proof

`verdict.test.ts` gained six cases: a reverted transaction is `false`, a transaction paying a different
address is `false`, a transaction reaching the recipient is `true`, a reverted one through the settled
rung is `false` and a provider failure stays `unknown` rather than becoming an accusation. The
"different address is false" case fails against the existence-only rung. The suite is 14 green.

### The consequence to state plainly

This changes what the stored verdicts mean, so the headline counts are recomputed on the next full
sweep and the deployed site shows the previous numbers until it is re-swept and redeployed. That is a
correctness improvement in the one direction this project exists to move: a `true` now means the
payment reached the recipient, not that a transaction with that hash exists.

## Finding 13: the paid endpoints returned the result without a settled payment

### The bug

`/api/verify` and `/api/service/[slug]` verified a payment, did the priced work, then settled and
returned the answer whether or not settlement confirmed. There was no local record of a spent
authorization either, so one signed authorization fired many times in parallel each ran the work while
only one settle could ever land on chain.

### The exploit

A caller signs one authorization and fires N concurrent requests. Every one passes the facilitator
verify, every one does the fetch and the RPC and only one settles, so N minus one get the paid work
for nothing. Separately, a payment that verifies but never settles, a facilitator failure or an
authorization the payer consumes elsewhere, still returned the answer, so the settle step was optional.

### The fix

An in-memory single-flight lock keyed on the authorization's payer and nonce is taken before any work,
so one caller holds an authorization at a time and a used one is refused. Delivery is now gated on a
confirmed settlement: a verified-but-unsettled payment returns a 402 with no result, the reservation is
released and the authorization is left untouched so a genuine payer retries. The happy path where
settlement succeeds is unchanged, so the working demo still returns its verdict.

### The proof

`x402.test.ts` gained a test that reserves an authorization, refuses a concurrent second attempt,
frees it on release and refuses it once confirmed. The route change returns the verdict only after a
true settle.

## Finding 14: the indexer stored on-chain strings that the schema promised were http(s) only

**Applied.** `indexer/src/handlers/Retina.ts`. `parseInlineRecord` pushed any string from a registration
document into `Agent.endpoints`, so `javascript:`, `data:text/html`, relative paths and HTML fragments
all passed, while `schema.graphql` documents the field as absolute http(s) only. The indexer's own
writes are parameterised, so this is not injection at the indexer, but it makes the schema lie to a
consumer that then renders the value as a safe link. The fix parses each candidate and keeps it only
when it is an absolute http or https URL, so the field now means what the schema says. The change
applies to new and re-indexed rows, so a resync carries it over the existing data.

## Finding 15: several public inputs turned a bad request into a 500 or an unbounded write

**Applied.** A cluster of input-validation gaps on the API surface, each closed at the request boundary:

* A negative `limit` on `/api/claims` and `/feed.json` reached Postgres as `LIMIT -1` and threw a 500.
  Both are now floored as well as capped.
* `/api/receipt/action` accepted any number for `chainId` and `agentId` and any string for the rest, so
  an out-of-range value hit the database as a 500 and a stranger could vary the `uriHash` to defeat the
  dedup and store unbounded rows. It now validates every field's shape and length, caps the body and
  limits receipts per identity.
* `/api/vault` put no length on the ciphertext or the context and no cap on entries per address, so a
  self-signed write could store an unbounded blob or an unbounded number of them. All three are capped
  now. The signature proves control of an address, never that the address is scarce, so a cap is the
  right barrier.
* Deliberate 500s on `/api/verify` and `/api/service` returned the raw exception message. They now log
  the real error server-side and return a fixed line.

## Finding 16: a compliance validator returning a dirty bool reverted the gate instead of reading Unknown

**Applied.** `CleanverseGate.sol`. `_readCvi` decoded the validator's answer with `abi.decode(_, (bool))`,
which panics on a 32-byte word that is not exactly 0 or 1. `cviStatus` is documented to never revert and
this broke that, turning the Unknown state into a panic. The word is now read directly, so a dirty value
reads as Unknown rather than reverting. `test_settle_dirtyBoolIsUnknownNotPanic` proves it and fails
against the old decode. The live behaviour failed closed either way, a reverted settlement is a refused
settlement, so this is a correctness and observability fix rather than a fund risk.

## Finding 17: the secrets posture before the public flip

**Applied. It came back clean on the one that mattered.** No private key, mnemonic or live token is
tracked and the house signing key is absent from the whole lane, so the repo is safe to publish from a
secrets standpoint. Three smaller things were tightened: the commit and push hooks now refuse any `.env`
at any depth, not just `.hq/`, `submit/` and `build/`, so a forced add of `.env.local` cannot walk past
`.gitignore`; a stray committed `.pyc` was untracked and `__pycache__` gitignored; and five tracked
files referenced the private `.hq/` planning directory, one as a live markdown link that would 404 on
the public repo and leak the path, so all five were restated in plain text. A third party's email
address and some internal framing were removed from a public doc. A Content-Security-Policy and the
standard hardening headers were added, permissive on script and style sources because Next's hydration
needs it, strict on object, base-uri, frame-ancestors and form-action.

## Accepted risks and deferred fixes from this pass

Stated rather than omitted, the same as the accepted risks above.

**Sclera's attestor and beneficiary are the same principal.** Only the attestor key can sign a slash,
so no third party can grief an agent for profit. When the attestor key and the `slashBeneficiary` are
the same operator, though, the party that decides a slash is the party that receives it, so an unjust
slash is profitable to whoever holds the key. That is the oracle-trust assumption the whole design
rests on and the misleading comment that implied nobody could profit is corrected in the source. A
deploy that wants to retire even that assumption should point `slashBeneficiary` at a burn address or a
party distinct from the attestor. The contract is immutable, so this is a note for the next deploy.

**The slashing oracle reads one HTTP source.** Every CRE node fetches the same origin, so the median
across nodes tolerates a flaky node but not a compromised source: a manipulated body is seen identically
by all nodes and the median is the manipulation. The rate is recomputed from the counts, which is right,
but the counts have no second source or on-chain cross-check. This matters only once the write path is
wired, which it is not: the workflow reads, decides and encodes a report and no code in the repo signs
or submits it, so the "verdict carries its own authorization" property lives entirely in the deployed
Sclera and is not exercised by a simulation. Both are disclosed in the CRE writeup.

**Session scope is advisory and a receipt's signer is not bound to its identity.** The browser session
gate checks the amount but not the recipient or the action and the generic account it exposes can sign
anything a caller hands it, so the separation between paying and authorising an agent change is not
enforced in code. Separately, an action receipt names an EVM `signer` and an ed25519 `identity` and the
signature only proves the identity, so a receipt can name any address as its signer. Both are
client-side changes that need the passkey flow to verify and both are partly disclosed already. The
fix is a scope-enforcing account wrapper that runs the gate inside every signing method, a `payTo` in
the scope and an account-key binding signature stored beside the receipt. Deferred to a change that can
exercise the browser path rather than shipped unverified.

**Indexer items that need a resync.** The cross-chain reference counters are permissionless and can be
inflated by registering a throwaway agent on the other chain with the same URI, the dead `Verdict`
entity resolves an always-empty relation on the indexer's GraphQL and `agentWallet` is stored lowercase
while Envio checksums the other addresses. The app already compares addresses case-insensitively, so the
last is cosmetic. Each needs codegen and a resync to change stored data, so they are recorded here and in
the gaps doc rather than changed blind against a live index.

**The mislabelled split cannot yet prove "nowhere".** The count of false verdicts found on no chain
mixes "searched every reachable chain and found nothing" with "some chains could not be searched" and
the type no longer calls that number fabricated. Splitting it honestly needs the backfill to record which
chains it reached per verdict, which is a data-model change flagged in the gaps doc.

## Second remediation wave

A follow-up pass closed the medium and low items the first pass had deferred or left open. Each carries a
test where the surface is testable.

- **Server flood and pool starvation.** The database pool now sets a 10s `statement_timeout`, a 12s
  `query_timeout` and a 15s idle-in-transaction timeout, so no single read can pin one of eight
  connections forever. TLS is required when the host is not loopback. A `proxy.ts` adds a generous
  per-IP rate limit (600 a minute) that answers a flood with a 429 and a Retry-After rather than a silent
  drop, loose enough that a judge or the canary never trips it.
- **DNS with no deadline.** `resolvePublic` in the SSRF guard now races the lookup against a 5s bound, so
  a hostname pointed at a hanging resolver is a clean refusal rather than a stalled worker. Test added.
- **Session scope was advisory.** A payment session now pins its recipient: `assertCanPay` refuses a
  transfer to any address other than the one the scope names, the pay path passes the recipient and the
  studio run calls the gate before the key signs rather than handing a raw signer to viem. Test added.
- **A receipt's signer was not bound to its identity.** `signAction` now also signs the canonical bytes
  with the account key, `verifyBinding` recovers that signer and requires it equals the receipt's
  `signer`. The publish route requires and stores the binding. A receipt can no longer name an
  address its author does not control. Test added. The schema carries a nullable `binding` column so
  older rows still read.
- **Indexer address split and a dead entity.** `agentWallet` is checksummed to the same EIP-55 form Envio
  stores the other addresses in, so a row no longer holds one address in two spellings and the unused
  `Verdict` entity with its always-empty derived relation is removed from the schema. Both take effect on
  the next resync.
- **Low-tier cleanups.** The webhook info endpoint returns a fixed line and logs the real database error
  rather than reflecting it; `usdc()` formats with BigInt so a large bond does not lose precision to a
  float; the self-registration read-back tolerates the registry's revert-on-unknown-hash; and the Qwen
  client caps its response size.

### What remains and why

The deployed Aqueous and Sclera are immutable and verified against their on-chain bytecode, so their
design findings (the metered ceiling on a silent buyer, no buyer dispute after delivery, a bond postable
once per agent, the attestor and beneficiary being one principal) cannot be changed in source without a
redeploy that spends real gas and orphans existing state. They stay documented as accepted for this
deployment. A redeploy is the operator's call. The CRE workflow now carries the sign-and-submit path,
gated behind a `broadcast` flag that the judged targets leave off, so the simulation reads and decides
without ever touching it. The signing is cross-checked to match the app's proven signer, so it is
correct by construction. The submit itself, the CRE report plus the forwarder write, is exercised only
by a real `cre workflow simulate --broadcast`, which needs the operator's CRE auth and the attestor key
as a secret, spends gas and can slash a live bond. That broadcast stays a hard stop rather than a design
limit: the forwarder and Sclera are both deployed and the wallet holds gas, so none of those is the
blocker. The indexer's cross-chain Sybil counters are inherent to permissionless data and the
`memberCount` drift after a re-point plus the "nowhere" exhaustiveness split are counting changes that
need a full reindex to verify, so they are recorded in the gaps doc rather than changed blind against the
live index.
