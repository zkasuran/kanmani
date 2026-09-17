# Aqueous: the escrow

Money is held until the work lands, and the receipt is emitted by the settlement itself.

## Build

```bash
forge install foundry-rs/forge-std   # not vendored, see below
forge build
forge test
```

`lib/` is deliberately not committed. forge-std is a dependency rather than our code, and keeping
it out of the tree avoids vendoring another project's licence into this one.

## Why it is shaped this way

We measured 68 agent reputation documents on Monad. Every one was cryptographically perfect, every
one declared `network: monad`, and 2 of the cited payments existed on Monad. That is a plumbing
problem rather than a lying problem. **If the money moves through this contract, the receipt names
the chain the money actually moved on, because the same transaction does both.**

Properties a reader can check rather than trust:

* **Immutable.** No proxy, no upgrade path, no admin function. Nothing here can take an escrowed
  balance, including us.
* **Token agnostic.** Amounts are base units, so USDC at 6 decimals and any other ERC-20 both work
  with no hardcoded scale.
* **Both sides have an exit that does not need the other to answer.** The buyer refunds after the
  deadline with no agent signature. The agent claims after delivering plus a public dispute window,
  so a silent buyer cannot strand delivered work.
* **Metered jobs return the remainder** in the same transaction that pays. Keeping it would be
  invisible to most buyers, which is exactly why it goes back.
* **The buyer never needs the chain's gas token.** `createJobWithAuthorization` takes an EIP-3009
  authorisation and anyone can relay it. The job belongs to the signer, never to the relayer.

## Monad specifics that shaped the code

Read from `docs.monad.xyz` before writing it, not after:

* Storage warms **per 128-slot page**, not per slot, so the job struct is packed into consecutive
  slots and a whole job reads for one cold page.
* Gas is charged on the **limit**, not on usage. The relayer pays the buyer's gas, so limits are
  estimated tightly rather than padded.
* The **10 MON reserve applies to EOAs, not contracts**, so this contract is unconstrained. The
  relayer is an EOA and is: consensus budgets its inflight gas against `min(10 MON, balance)` across
  roughly 3 blocks, so settlements are serialised rather than fired in a burst.
* Included-but-reverted is a normal outcome on this chain, so callers treat a mined transaction as
  pending until the receipt is read.

## Tests

`forge test` runs 30, including fuzz over value conservation and access control.

**The suite was mutation tested rather than trusted.** Three deliberate breaks:

| Mutation | Caught by |
|---|---|
| remove the metered payout cap | `test_meteredOvershootCapsAtEscrow` plus the fuzz, which found a counterexample |
| credit `msg.sender` instead of the authorisation signer | `test_authorizationCreditsTheSignerNotTheRelayer` |
| move the state write after the transfers (break checks-effects-interactions) | **nothing, on the first pass** |

That third one is the reason `test_stateIsTerminalBeforeAnyTransfer` exists. Every test passed with
CEI broken, because the reentrancy guard caught the attack instead. A guard is a second line of
defence, not evidence the first one is there, so the ordering is now asserted directly by a token
that records the job state at the moment it is called back.
