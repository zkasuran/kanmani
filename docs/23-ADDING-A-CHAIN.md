# 23. Adding a chain

**The whole point of this document is that it should be short.** Adding a chain is one entry in
[`../shared/erc8004-chains.json`](../shared/erc8004-chains.json), one environment variable, and a
test run that names anything still missing.

It was not always. Chains used to be declared in three places that nothing compared:
`verifier/src/chains.ts` for verification, `indexer/config.yaml` for indexing, and a hardcoded
address for writing. A chain could be added to one, missed in another, and still look integrated.
That is the same shape of defect this project exists to point at in other people's data, one floor
down, so it is now a test rather than a convention.

---

## The one fact that makes this cheap

**ERC-8004 registries are per-chain singletons and the mainnet deployments share one address set.**
A new chain therefore needs no new addresses.

| registry | address |
|---|---|
| identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| validation | `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` |

Established on chain rather than from a deployment list, because a wrong address indexes nothing and
still looks like a working integration. Confirm it on any new chain before trusting it:

```bash
RPC=<the new chain's rpc>

# all three should be an ERC-1967 proxy rather than empty
cast code 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 --rpc-url "$RPC" | wc -c

# the load-bearing check: each registry names its own identity registry, so the set is
# self-consistent ON CHAIN and nothing rests on a document
cast call 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 'getIdentityRegistry()(address)' --rpc-url "$RPC"
cast call 0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58 'getIdentityRegistry()(address)' --rpc-url "$RPC"
# both -> 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432

cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 'getVersion()(string)' --rpc-url "$RPC"   # 2.0.0
```

**If the addresses differ, do not edit the canonical set.** Add a `registries` object to that
chain's entry instead. Monad testnet is exactly this case, which is why the override exists rather
than an assumption that the addresses are universal.

---

## The steps

### 1. Append the entry

```json
{
  "id": 130,
  "key": "unichain",
  "displayName": "Unichain",
  "aliases": ["unichain", "uni"],
  "rpcEnv": "RPC_UNICHAIN",
  "explorer": "https://uniscan.xyz",
  "erc8004": { "startBlock": 1234567, "indexed": false }
}
```

`erc8004` is `null` when the registries are **not** deployed there. That is a first-class answer, not
a gap: it means we can read receipts on that chain while no agent lives there, which is what makes
"registered on Monad, paid on Base" a checkable statement. Ethereum is `null` today.

`indexed` is `true` only when the chain is **in the live database**, not when it is merely configured.
BNB Smart Chain is configured and not synced, so it is `false`. Setting it to `true` because the
config exists would be a published claim that a check contradicts.

**Aliases are the part that decides whether a claim is readable at all**, because authors type a word
rather than a chain id. They must be lowercase and must not collide with another chain: two chains
claiming `base` makes a document ambiguous, and the conformance test refuses it rather than resolving
by declaration order.

### 2. Find the start block, without scanning an empty chain

A backfill from block 0 on a chain with a 100M-block head wastes hours. The start block is the proxy
deployment. Ask HyperSync for the first log at the three addresses from block 0:

```bash
# Monad's equivalent is 52,952,790 and BSC's is 79,027,268, each found this way.
# Monad keeps start_block 0 deliberately: the population and the USDC rail are both there.
```

### 3. Set the endpoint

```bash
export RPC_UNICHAIN=https://…
```

**Without it the chain reads as uncovered**, and every claim naming it is `unknown`, never `false`.
That is not a degraded mode, it is the correct one: we did not look, so we cannot say.

### 4. Run the tests

```bash
npm test          # lib/chains.test.ts is the gate
```

17 tests, and the ones that matter here are the last three. They read
`verifier/src/chains.ts` and `indexer/config.yaml` and fail naming exactly what has drifted, so the
test tells you what is left to do rather than you remembering.

### 5. Update the other two declarations when the test says so

The registry is the source of truth; these two still hold their own copies and the drift tests bind
them. Collapsing them entirely is worth doing and is not done: the indexer is Envio and reads YAML,
so its config would have to be generated, which is a build step nobody has needed yet.

* `verifier/src/chains.ts` — add the same id, aliases and `rpcEnv`.
* `indexer/config.yaml` — add the chain **only if `erc8004` is not null**, with the addresses and the
  start block.

### 6. Say that it changed

**Widening coverage is a published change.** Adding a chain can turn a `false` into a `true`, which is
a correction with a before and an after rather than a number that quietly improves. The verdict store
is append only, so the flip renders on `/status` with both timestamps. Say so in a progress update
too.

---

## What a lazy test would have missed, found on the first run

The drift tests originally used `yaml.includes('- id: ' + id)`. `- id: 1` occurs inside `- id: 143`,
so the test reported Ethereum as present in a file that only mentions Monad and BSC. **A green test
asserting the opposite of the truth.** Both matchers are anchored to the end of the line now.

It is recorded here rather than quietly fixed because it is the project's own thesis happening to the
project: a check that passes on the shape of the data rather than its content.

---

## What this does not make easy

* **Escrow on another chain.** `Aqueous` is deployed on Monad. Settling elsewhere means either
  deploying it there or verifying the receipt cross-chain, and the second is already possible with
  `locate`. This document does not cover either.
* **Merging standing across chains.** `Chiasm` merges an operator's rows on the content hash of the
  registration document, which is the only key that means the same thing on both chains. It is built
  and it has nothing to merge until a second chain is in the live index. See
  [`14-GAPS.md`](14-GAPS.md).
* **Claiming "any chain".** The number of chains is on `/chains` beside every claim that depends on
  it. A chain outside the list is `unknown`. "Runs on any chain" would be precisely the unbacked
  claim this project exists to attack, and a reader would test it by naming one that is not there.
