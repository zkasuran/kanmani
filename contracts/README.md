# Aqueous: the escrow

Money is held until the work lands and the receipt is emitted by the settlement itself.

## Live on Monad testnet

| | address |
|---|---|
| **Aqueous** | [`0xAbB85ab157357676eBE7ae17A161168912A3c232`](https://testnet.monadexplorer.com/address/0xAbB85ab157357676eBE7ae17A161168912A3c232) |
| **tUSDC** (test token) | [`0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32`](https://testnet.monadexplorer.com/address/0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32) |

Chain 10143, `claimWindow` 259200 seconds (3 days), deployed from
`0xDB6c6340342e71A63cD11Ebac2185204b7777777`.

**Why a test token.** There is no USDC on Monad testnet. `eth_getCode` returns `0x` at USDC's
address on chain 10143 and so does AUSD and so do all three ERC-8004 registries. An escrow
there has nothing to escrow, so `TestUSDC` ships with it: 6 decimals like the real thing, real
`ecrecover` on `transferWithAuthorization`, an open mint so anyone can get some and a
constructor that **refuses to deploy on chain 143** so it can never be confused with real money.

Mainnet uses real USDC at `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` and deploys no token of
its own. The deploy script picks by chain id rather than by a flag, because a flag is a thing you
can get wrong.

### One complete job, already run against the live contract

A buyer holding **zero MON** signed one message, a relayer submitted it and paid the gas, the
agent delivered and the buyer settled a metered job for 2 of 5 units:

| | |
|---|---|
| escrowed | 25 tUSDC |
| paid to agent | 10 tUSDC (2 units at 5) |
| returned to buyer | 15 tUSDC |
| retained by the contract | 0 |

Read it back yourself, no key needed:

```bash
R=https://testnet-rpc.monad.xyz
cast call 0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32 "balanceOf(address)(uint256)" \
  0xafA4b628D7e8d5Ddb04cec0D24878D137f663B52 --rpc-url $R   # agent, 10000000
cast call 0xAbB85ab157357676eBE7ae17A161168912A3c232 "claimWindow()(uint64)" --rpc-url $R
```

The job creation transaction is
[`0xb28c44c2…e071bc`](https://testnet.monadexplorer.com/tx/0xb28c44c27fec131c3935be18f5502f7053a71dc45b90c59a0f423b4267e071bc)
and the settlement is
[`0xdef55b3c…75e6a8`](https://testnet.monadexplorer.com/tx/0xdef55b3c49313895a15a3e91dd7ca9078187102c3b181aa66fbcc7477975e6a8).

**One limitation this does not hide.** The relayed path removes the gas requirement from job
creation, which is the step a new buyer hits first and the one that otherwise stops them dead. It
does not remove it from `release` or `settleMetered`, because those are the buyer asserting the
work is good and that assertion has to come from the buyer's own key.

## Deploy it yourself

```bash
set -a && . ~/Downloads/hackathon-hq/.env && set +a

forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast \
  --private-key "$HOUSE_WALLET_PRIVATE_KEY"

forge script script/Demo.s.sol:Demo --rpc-url monad_testnet --broadcast \
  --private-key "$HOUSE_WALLET_PRIVATE_KEY"
```

## Build

```bash
forge install foundry-rs/forge-std   # not vendored, see below
forge build
forge test
```

`lib/` is deliberately not committed. forge-std is a dependency rather than our code and keeping
it out of the tree avoids vendoring another project's licence into this one.

## Security

Two fund-loss bugs were found and fixed before this ever went on chain, one of them a full theft
of the escrow by any relayer. Both are published with their exploits and the proofs in
[`docs/17-CONTRACT-AUDIT.md`](../docs/17-CONTRACT-AUDIT.md), alongside the wider defect log in
[`docs/18-BUGS-FIXED.md`](../docs/18-BUGS-FIXED.md).

## Why it is shaped this way

We measured 68 agent reputation documents on Monad. Every one was cryptographically perfect, every
one declared `network: monad` and 2 of the cited payments existed on Monad. That is a plumbing
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

```bash
forge test                                        # 43 pass, the 6 fork tests report as skipped
forge test --fork-url "$MONAD_RPC"                # 49 pass, the 6 against real USDC on mainnet
```

**The money path is now exercised three ways. Each answers something the others cannot.**

| | what it proves | what it cannot |
|---|---|---|
| unit suite, mock token | every branch and revert, plus fuzzed value conservation | nothing about signatures, the mock does no checking |
| mainnet fork, real USDC | the real bytecode, the real EIP-712 domain, the real nonce tracking | nothing about a deployed contract, it is a local fork |
| **live testnet deployment** | real transactions against real deployed bytecode, end to end | it is tUSDC, not real USDC, because testnet has neither |

The unit mock does **no signature checking at all**, on purpose, because a mock that pretends to
verify signatures tests the mock. The fork suite covers that gap against real USDC. The testnet
deployment covers what neither can: that the thing actually works once it is on a chain.

**Testnet could not replace the fork suite and that is not laziness.** USDC does not exist on Monad
testnet, `eth_getCode` at the mainnet address returns `0x` on chain 10143, so the testnet run uses
`TestUSDC`. Real USDC is only reachable on a mainnet fork until Aqueous deploys to mainnet itself.

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
