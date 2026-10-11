# Aqueous: the escrow

Money is held until the work lands and the receipt is emitted by the settlement itself.

## Live on Monad mainnet

| | address |
|---|---|
| **Aqueous** | [`0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32`](https://monadscan.com/address/0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32) |
| **USDC** (real) | [`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`](https://monadscan.com/address/0x754704Bc059F8C67012fEd69BC8A327a5aafb603) |

Chain 143, `claimWindow` 259200 seconds (3 days), 10,901 bytes of deployed code, from
`0xDB6c6340342e71A63cD11Ebac2185204b7777777`. No token of its own: mainnet has real USDC, so the
deploy script picks the shape by chain id rather than by a flag, because a flag is a thing you can
get wrong.

### One complete job, in real USDC, already settled on mainnet

**The buyer held zero MON at every point in this, start to finish.** Not "started with none and we
topped it up". Zero, throughout, while creating an escrow and settling it. The script asserts that
at both ends rather than printing it, so if the claim ever stops being true the run fails instead
of quietly passing.

| step | transaction | what it did |
|---|---|---|
| fund | [`0x441886bf…f615ebe`](https://monadscan.com/tx/0x441886bf5f92e4d938f8604f728e968b71b9bcb934b502d7a37988156f615ebe) | 1.40 USDC to the buyer. USDC only, deliberately no MON |
| escrow | [`0x2b879b52…417b57e`](https://monadscan.com/tx/0x2b879b52d51d1d2044b224da76fee3f041d8214940e3799599d132c1b417b57e) | `createJobWithAuthorization`, buyer signed, relayer paid |
| gas | [`0x9b5b16d6…3594ec`](https://monadscan.com/tx/0x9b5b16d6d2b19517ff4e6f3738328aef7a6ecd06cf18df27c9af6d8f723594ec) | 0.05 MON to the **agent**, which pays for its own work |
| deliver | [`0xc259c7a6…82a6724`](https://monadscan.com/tx/0xc259c7a6067c051c01ed75a2b12d5c64380216275a43417ddf407913582a6724) | the agent delivers, from its own wallet |
| settle | [`0x10d03f31…c9fce6c5`](https://monadscan.com/tx/0x10d03f3155478f88ce90ae1deaa6a5fbd99af9ebaffa0512c9979367c9fce6c5) | `settleMeteredWithAuthorization`, buyer signed, relayer paid |

The shape is a metered API at 2 cents a call. 1.40 USDC escrowed is a ceiling of 70 calls, 30 were
used, so 0.60 is earned and **0.80 goes back in the same transaction that pays**.

| | |
|---|---|
| escrowed | 1.40 USDC |
| paid to agent | 0.60 USDC (30 units at 0.02) |
| returned to buyer | 0.80 USDC |
| retained by the contract | 0 |
| **MON spent by the buyer** | **0** |

Read every one of those back yourself, no key needed:

```bash
R=https://rpc.monad.xyz
U=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
B=0x27a8ae37f59BDcd147b09dDc1F35Ac64697c1F92   # buyer
A=0xafA4b628D7e8d5Ddb04cec0D24878D137f663B52   # agent

cast balance $B --rpc-url $R                                  # 0, the whole claim
cast call $U "balanceOf(address)(uint256)" $B --rpc-url $R     # 800000
cast call $U "balanceOf(address)(uint256)" $A --rpc-url $R     # 600000
cast call $U "balanceOf(address)(uint256)" \
  0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32 --rpc-url $R      # 0, retained nothing
```

**What this does not prove**, said here so it never gets blurred in a writeup: the agent in this
run is ours, so this is evidence the settlement machinery works on mainnet in real USDC. It is not
evidence that an agent did useful work for a stranger.

The escrow ceiling is 1.40 rather than a round 2.00 because that is what the funding wallet held
(1.434081 USDC, one transfer, block 106,352,992). The per-call price is the load-bearing number
and it is unchanged. A script that asserts a precondition its wallet cannot meet is not a safety
check, it is a script that never runs.

## Also live on Monad testnet

| | address |
|---|---|
| **Aqueous** | [`0xba2B1709eC4C3E76126043B3C3ef43Cc5d4F328C`](https://testnet.monadscan.com/address/0xba2B1709eC4C3E76126043B3C3ef43Cc5d4F328C) |
| **tUSDC** (test token) | [`0x841057C182b74408628FadAFba01Ad178cDA2E2f`](https://testnet.monadscan.com/address/0x841057C182b74408628FadAFba01Ad178cDA2E2f) |

Chain 10143, same `claimWindow`, same deployer.

**Why a test token.** There is no USDC on Monad testnet. `eth_getCode` returns `0x` at USDC's
address on chain 10143 and so does AUSD and so do all three ERC-8004 registries. An escrow
there has nothing to escrow, so `TestUSDC` ships with it: 6 decimals like the real thing, real
`ecrecover` on `transferWithAuthorization`, an open mint so anyone can get some and a
constructor that **refuses to deploy on chain 143** so it can never be confused with real money.

The testnet job that ran first is
[`0x675fcf6e…47eb5f`](https://testnet.monadscan.com/tx/0x675fcf6ed72811f90e841936d02a352ef1c565847adf1c55c546746c4047eb5f)
and its settlement is
[`0xcb4b8810…4e8223`](https://testnet.monadscan.com/tx/0xcb4b8810d835a2131c169f3385fc2e15b9ece1a4ad2c82dd3f512667704e8223):
25 tUSDC escrowed, 10 paid, 15 returned, with a buyer nonce that is still zero.

**Gasless all the way through, which it was not at first.** The original build made only job
creation gasless. A buyer who genuinely held no MON could fund an escrow and then be stuck: no
release, no settle, no refund, with their only remaining move being to wait out the claim window
and let the agent take everything. A gasless entrance with no gasless exit is worse than no
gasless entrance, because it strands people mid-flow.

`releaseWithAuthorization`, `settleMeteredWithAuthorization` and `refundWithAuthorization` close
it. Each takes an EIP-712 signature from the buyer and anyone can submit it. Call
`releaseDigest`, `settleMeteredDigest` or `refundDigest` to get the exact bytes to sign, so no
client rebuilds EIP-712 by hand.

The agent still pays for its own `deliver`, deliberately. Agents run infrastructure, so holding
gas is part of the job. The buyer is the party who should never need to.

## Deploy it yourself

```bash
set -a && . ~/Downloads/hackathon-hq/.env && set +a

forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast \
  --private-key "$HOUSE_WALLET_PRIVATE_KEY"

forge script script/Demo.s.sol:Demo --rpc-url monad_testnet --broadcast \
  --private-key "$HOUSE_WALLET_PRIVATE_KEY"
```

The mainnet walkthrough above is `script/MainnetDemo.s.sol`, which refuses to run on any chain but
143 and asserts the buyer's MON balance is zero at both ends.

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
