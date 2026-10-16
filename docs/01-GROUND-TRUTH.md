# Ground truth

Every claim on the site traces back to a fact on this page. Every fact on this page carries the
command that produces it. A fact with no command behind it is a claim we are asking you to take on
faith, which is the thing this project exists to argue against. So if a number appears anywhere in
Kanmani, you can find it below beside a command you can run yourself, against a public RPC, with no
key and no account. This is the substrate: the verdicts, the escrow, the x402 endpoint and the
registry writes all sit on top of it. If a row here is wrong, something above it is wrong too.

Every command was run against mainnet at block `109750000` on 2026-10-02. Outputs are copied from
the terminal rather than retyped. Where a number moves on its own, the section says so. `cast` is
Foundry's CLI, version 1.7.1 here.

```bash
R=https://rpc.monad.xyz            # Monad mainnet
T=https://testnet-rpc.monad.xyz    # Monad testnet

ID=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432   # ERC-8004 Identity Registry
REP=0x8004BAa17C55a88189AE136b182e5fdA19dE9b63  # ERC-8004 Reputation Registry
VAL=0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58  # ERC-8004 Validation Registry
U=0x754704Bc059F8C67012fEd69BC8A327a5aafb603    # USDC on Monad mainnet
```

## 1. The chains

| fact | command | output |
|---|---|---|
| Monad mainnet chain id | `cast chain-id --rpc-url $R` | `143` |
| Monad testnet chain id | `cast chain-id --rpc-url $T` | `10143` |

Explorers are `https://monadscan.com` for mainnet and `https://testnet.monadscan.com` for
testnet. Chain id is the only chain identifier that is not a matter of opinion, which is why the
verifier resolves a document's declared network down to one before looking for anything.

## 2. The three ERC-8004 registries

All three are live on mainnet, each carrying 130 bytes of code, which is the size of a proxy rather
than an implementation. A nonzero code size is the whole test for "this address is a contract".

| registry | address | command | output |
|---|---|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `cast codesize $ID --rpc-url $R` | `130` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `cast codesize $REP --rpc-url $R` | `130` |
| Validation | `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` | `cast codesize $VAL --rpc-url $R` | `130` |
| Identity `name()` | | `cast call $ID "name()(string)" --rpc-url $R` | `"AgentIdentity"` |
| Identity `symbol()` | | `cast call $ID "symbol()(string)" --rpc-url $R` | `"AGENT"` |

The Identity Registry is an ERC-721 collection. These three addresses are listed in
`indexer/config.yaml` under chain `143`. They are the only ERC-8004 registry addresses anything here
talks to.

## 3. None of the three registries exist on Monad testnet

This is why Kanmani is a mainnet build. It is not a preference.

| contract | command | output |
|---|---|---|
| Identity Registry | `cast code $ID --rpc-url $T` | `0x` |
| Reputation Registry | `cast code $REP --rpc-url $T` | `0x` |
| Validation Registry | `cast code $VAL --rpc-url $T` | `0x` |
| USDC | `cast code $U --rpc-url $T` | `0x` |

`0x` means no code at that address on chain 10143. Nothing to index, no feedback to read, no
population to measure. USDC is absent at the same address, so there is nothing to pay with either.
Anything deployed elsewhere on testnet is not what this build reads. No claim on this page is
verified against it.

## 4. The agent population, plus why `totalSupply()` cannot give it

The Identity Registry is ERC-721 but not ERC-721Enumerable. It says so itself:

| interface | command | output |
|---|---|---|
| ERC-721 `0x80ac58cd` | `cast call $ID "supportsInterface(bytes4)(bool)" 0x80ac58cd --rpc-url $R` | `true` |
| Enumerable `0x780e9d63` | `cast call $ID "supportsInterface(bytes4)(bool)" 0x780e9d63 --rpc-url $R` | `false` |

So the usual population call reverts:

```bash
cast call $ID "totalSupply()(uint256)" --rpc-url $R
# Error: server returned an error response: error code 3: execution reverted, data: "0x"

cast storage $ID 0xa040f782729de4970518741823ec1276cbcd41a0c7493f62d173341566a04e00 --rpc-url $R
# 0x0000000000000000000000000000000000000000000000000000000000002824
cast to-dec 0x0000000000000000000000000000000000000000000000000000000000002824    # 10276
```

Empty revert data means there is no such function, not that a check failed. `totalSupply` is absent
from `indexer/abis/IdentityRegistry.json`. Nothing on this chain publishes the agent count through a
function call, so **the counter storage slot is the only source of population truth.** That slot
ends in a zero byte, which is the shape ERC-7201 namespaced storage produces. The deployment does
not publish the namespace string it hashed, so we cannot re-derive the slot. We found it by
inspection.

**That is not a reason to trust it. This is.** Ids are dense and start at zero, so a counter of `N`
means ids `0` through `N-1` exist while id `N` does not. Both halves are checkable. The check can
fail:

| id | command | output |
|---|---|---|
| `0` | `cast call $ID "ownerOf(uint256)(address)" 0 --rpc-url $R` | `0x89E9E1ab11dD1B138b1dcE6d6A4a0926aaFD5029` |
| `10252` | `cast call $ID "ownerOf(uint256)(address)" 10252 --rpc-url $R` | `0xDB6c6340342e71A63cD11Ebac2185204b7777777` |
| `10275` | `cast call $ID "ownerOf(uint256)(address)" 10275 --rpc-url $R` | `0x42478Ed9A429eC320d243469Fa5d6595BCc8daa5` |
| `10276` | `cast call $ID "ownerOf(uint256)(address)" 10276 --rpc-url $R` | revert `0x7e273289…2824` |

`0x7e273289` is the selector for `ERC721NonexistentToken(uint256)`, which `cast sig
"ERC721NonexistentToken(uint256)"` confirms. Its argument is `0x2824`, which is 10276. The slot
value and the first nonexistent id agree. A wrong slot would not agree.

**This number grows.** It read `10252` when the population survey ran, so that survey covers ids `0`
through `10251`. We then registered as id `10252`, which bumped the slot to `10253`. It reads
`10276` today, so 23 more agents have registered since. You will see the same or a higher number,
never a lower one. Running the indexer locally,
`SELECT count(*) FROM "Agent" WHERE "chainId" = 143` returns `10276` too. A gap between the
log-derived count and the slot is an indexer that has fallen behind, which is why both get published
rather than just the friendlier one.

## 5. USDC on Monad mainnet

| fact | command | output |
|---|---|---|
| address | | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| code size | `cast codesize $U --rpc-url $R` | `1798` |
| `decimals()` | `cast call $U "decimals()(uint8)" --rpc-url $R` | **`6`** |
| `name()` | `cast call $U "name()(string)" --rpc-url $R` | `"USDC"` |
| `symbol()` | `cast call $U "symbol()(string)" --rpc-url $R` | `"USDC"` |
| `version()` | `cast call $U "version()(string)" --rpc-url $R` | `"2"` |
| `DOMAIN_SEPARATOR()` | `cast call $U "DOMAIN_SEPARATOR()(bytes32)" --rpc-url $R` | `0xfe22123edc0dd4aeb912eb7948c5f0e531592c2053b3067612f427db342c93c6` |

`name` plus `version` are not decoration. They are the EIP-712 domain fields a transfer
authorisation is signed under, which is why `lib/x402.ts` reads them off the token instead of
hardcoding them.

**Six decimals, not eighteen.** A price literal carried over from an 18-decimal chain is wrong by a
factor of one million. It fails in the expensive direction: the server quietly asks for a million
times the price. `PRICE_ATOMIC` in `lib/x402.ts` is `"10000"`, which is 0.01 USDC at six decimals.

**EIP-3009 plus EIP-2612 are both present.** They are the reason a buyer never needs MON. Presence
is provable by calling their view functions and getting an answer rather than a revert. The returned
values do not matter. Answering at all is the fact and the third line below is the control that
proves the test can fail.

```bash
Z=0x0000000000000000000000000000000000000000
N=0x0000000000000000000000000000000000000000000000000000000000000000

cast call $U "authorizationState(address,bytes32)(bool)" $Z $N --rpc-url $R   # false   EIP-3009
cast call $U "nonces(address)(uint256)" $Z --rpc-url $R                       # 0       EIP-2612
cast call $U "notAFunction()(uint256)" --rpc-url $R                           # reverts, data "0x"
```

A missing function reverts with empty data. The two above it do not, so they are there.

## 6. USDC does not exist on Monad testnet, so a test token ships

`cast code $U --rpc-url $T` returns `0x`. An escrow on a chain with no stablecoin has nothing to
escrow, so `contracts/src/TestUSDC.sol` deploys alongside it on testnet only. Call these with
`TU=0x841057C182b74408628FadAFba01Ad178cDA2E2f`.

| fact | command | output |
|---|---|---|
| tUSDC address | | `0x841057C182b74408628FadAFba01Ad178cDA2E2f` |
| `decimals()` | `cast call $TU "decimals()(uint8)" --rpc-url $T` | `6`, matching real USDC |
| `name()` | `cast call $TU "name()(string)" --rpc-url $T` | `"Kanmani Test USD"` |
| `symbol()` | `cast call $TU "symbol()(string)" --rpc-url $T` | `"tUSDC"` |

It has an open mint, so anyone can get some. Its constructor contains
`if (block.chainid == 143) revert MainnetRefused();` at `contracts/src/TestUSDC.sol` line 90, so this
bytecode cannot reach mainnet through a wrong `--rpc-url` or a stale env var. **tUSDC is not money
and is not meant to look like it.**

## 7. Our own contracts

| contract | chain | address | code size | `claimWindow` |
|---|---|---|---|---|
| Aqueous | 143 | `0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32` | `10901` | `259200` |
| Aqueous | 10143 | `0xba2B1709eC4C3E76126043B3C3ef43Cc5d4F328C` | `10901` | `259200` |
| tUSDC | 10143 | `0x841057C182b74408628FadAFba01Ad178cDA2E2f` | | |

```bash
AQ=0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32
cast codesize $AQ --rpc-url $R                       # 10901
cast call $AQ "claimWindow()(uint256)" --rpc-url $R  # 259200
```

`claimWindow` is 259200 seconds, which is 3 days. It is `immutable` plus `public`, so neither side
of a job can be surprised by it and nobody can change it later. There is no `token()` getter and
calling one reverts. That is deliberate: the token is a field of each job's `Terms`, so the escrow
holds base units of whatever ERC-20 the job named, which means real USDC at six decimals needs no
special case. Deployer, owner, relayer and validator throughout is the EOA
`0xDB6c6340342e71A63cD11Ebac2185204b7777777`.

One metered job ran end to end in real USDC: 1.40 escrowed at 0.02 per call, 30 of 70 calls used.
Read it off the settle receipt, which cannot change:

```bash
A=0xafA4b628D7e8d5Ddb04cec0D24878D137f663B52    # agent, used once for this job

cast receipt 0x10d03f3155478f88ce90ae1deaa6a5fbd99af9ebaffa0512c9979367c9fce6c5 --rpc-url $R
# status 1 (success) / blockNumber 106463284
# from 0xDB6c6340342e71A63cD11Ebac2185204b7777777 (relayer) / to 0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32 (Aqueous)
# its two ERC-20 Transfer logs: escrow -> agent 0.60 USDC, escrow -> buyer 0.80 USDC

cast call $U "balanceOf(address)(uint256)" $A --rpc-url $R   # 600000   0.60 USDC earned, wallet used once
```

The settling transaction pays the agent and returns the remainder in the same call. The relayer is
the sender, never the buyer, so the buyer spent no gas. The agent wallet was used once for this job
and still reads what it earned. The buyer and escrow wallets were reused for later jobs, so their
live balances have moved on. The agent's 0.60 plus the buyer's 0.80 refund account for this job's
whole 1.40, so this job retained nothing, which the receipt's two transfer logs show directly.

**What this does not prove.** The agent in that run is ours. It is evidence the settlement machinery
works on mainnet in real USDC. It is not evidence that an agent did paid work for a stranger.

## 8. The x402 facilitator

```bash
F=https://x402-facilitator.molandak.org
curl -s $F/supported | jq -c '.kinds[] | {scheme,network,x402Version}'
# {"scheme":"batch-settlement","network":"eip155:10143","x402Version":2}
# {"scheme":"batch-settlement","network":"eip155:143","x402Version":2}
# {"scheme":"upto","network":"eip155:10143","x402Version":2}
# {"scheme":"exact","network":"eip155:10143","x402Version":2}
# {"scheme":"exact","network":"eip155:143","x402Version":2}
# {"scheme":"upto","network":"eip155:143","x402Version":2}

curl -s $F/supported | jq -r '.signers | to_entries[] | "\(.key) \(.value[0])"'
# eip155:10143 0x7f6a2850669202519f0FE8aa912451238820Db86
# eip155:143   0x7f6a2850669202519f0FE8aa912451238820Db86
```

So: x402 version `2` on every kind, schemes `exact`, `upto` plus `batch-settlement`, networks
`eip155:143` plus `eip155:10143`, one signer `0x7f6a2850669202519f0FE8aa912451238820Db86` on both.
Kanmani uses `exact` on `eip155:143` only. This endpoint is served live, so what you see is whatever
is current: the header comment in `lib/x402.ts` records three kinds read on 2026-09-20 against the
six above.
That is the endpoint changing under us rather than a disagreement.

Our own x402 payment settled on mainnet, submitted by that signer:

```bash
cast receipt 0xf044c7543ef4519d0db8d29c9cd5e6baa3a5611e735905d4173ce401ee526d8a --rpc-url $R
# status 1 (success) / blockNumber 106462031
# from 0x7f6a2850669202519f0FE8aa912451238820Db86 / to 0x754704Bc059F8C67012fEd69BC8A327a5aafb603
```

**It was a self-payment of 0.01 USDC.** Net USDC movement is zero. It proves the machinery works. It
does not prove a stranger paid us.

## 9. The Validation Registry authorization rule

This one took a reverted transaction to learn. It explains a number we had measured and could not
account for: the Reputation Registry held <!-- n:feedbacks -->9,415<!-- /n --> feedbacks while the Validation Registry held zero
rows. **Only an agent's NFT owner can open a validation. They name the validator when they do.**

Reproduce it with three simulated callers. Nothing is sent, nothing is signed, no key is needed.
`cast call --from` runs the call as if it came from that address.

```bash
H=$(cast keccak "kanmani-ground-truth-probe")   # 0x02df73cf…975bde
sim () { cast call $VAL "validationRequest(address,uint256,string,bytes32)" \
  0xDB6c6340342e71A63cD11Ebac2185204b7777777 111 "https://kanmani.xyz/probe" $H \
  --from "$1" --rpc-url $R ; }
```

Agent `111` is somebody else's agent, picked because its declared wallet differs from its owner.
Read the owner first so the callers below are not taken on trust: `cast call $ID
"ownerOf(uint256)(address)" 111 --rpc-url $R` returns `0xF5061Dc33Bc2b0744de51dDa6A65FF4921a86225`.
Its declared `agentWallet`, `0x9e0ea69753531553623c4b74bb3fd2279e10fc9b`, comes from the
`MetadataSet` event the registry emits at registration.

| `sim <caller>` | who it is | result |
|---|---|---|
| `0xDB6c6340342e71A63cD11Ebac2185204b7777777` | us, an arbitrary validator | revert `Not authorized` |
| `0x9e0ea69753531553623c4b74bb3fd2279e10fc9b` | the agent's own declared wallet | revert `Not authorized` |
| `0xF5061Dc33Bc2b0744de51dDa6A65FF4921a86225` | the agent's NFT owner | passes, output `0x` |

Both failing callers return the same thing, verbatim:

```
Error: ... execution reverted: Not authorized, data: "0x08c379a0…4e6f7420617574686f72697a6564…"
```

That hex decodes to the string `Not authorized`. The owner's `0x` is a successful simulation with no
return data.

So the permissionless half of ERC-8004 fills up while the half needing consent stays empty. Anyone
can leave feedback about anyone. Only an owner can invite a check. That is a design decision we
agree with: a permanent on-chain verdict about your agent, written by a stranger you never engaged,
should not be something anyone can do to you. It also settles what Kanmani may write.
`verifier/src/optic.ts` answers requests addressed to us rather than publishing unsolicited
verdicts, because the contract makes the second one impossible.

Two more behaviours of this contract, both found by running it. First, `getValidationStatus` reverts
on a hash it does not know rather than returning a zero address, so a revert here is the answer "no
such request" and gets read as one. The first version of Optic treated it as a plain query, the
revert propagated, then two validations failed before anything was written. Second, our own row is
the first in this registry.

```bash
S="getValidationStatus(bytes32)(address,uint256,uint8,bytes32,string,uint256)"

cast call $VAL "$S" $(cast keccak "no-such-request") --rpc-url $R
# Error: ... execution reverted: unknown, data: "0x08c379a0…756e6b6e6f776e…"

cast call $VAL "getAgentValidations(uint256)(bytes32[])" 10252 --rpc-url $R
# [0x72c07ee9c59badfa32fefb18126a356fc0bf0f8dfdce2a3e6c471470899f23bd]

cast call $VAL "$S" 0x72c07ee9c59badfa32fefb18126a356fc0bf0f8dfdce2a3e6c471470899f23bd --rpc-url $R
# 0xDB6c6340342e71A63cD11Ebac2185204b7777777 / 10252 / 100
# 0x37f8457e88a0872f8bc5bddba62bae650dc5b581a084d08fc8f80428c1aef336
# "kanmani.payment-claim.v1" / 1789909568

cast call $VAL "getSummary(uint256,address[],string)(uint64,uint8)" \
  10252 "[0xDB6c6340342e71A63cD11Ebac2185204b7777777]" "kanmani.payment-claim.v1" --rpc-url $R
# 1 / 100
```

`100` means the cited payment was found. `0` means it was not. There is no third value, because
`getSummary` averages the `uint8` and an average over incomparable states is a number with no
meaning. A verdict of `unknown` or `noClaim` is never written at all. The absence of a row is the
signal that we did not check.

## 10. Four facts that surprised us

Each broke an assumption already baked into the design. Each is one command.

**`totalSupply()` reverts, so the population is a storage slot.** `cast call $ID
"totalSupply()(uint256)" --rpc-url $R` answers `execution reverted, data: "0x"`. The registry is
ERC-721 without Enumerable. Every agent count this project publishes comes from slot
`0xa040f782…a04e00`, checked against `ownerOf` at both ends. See section 4.

**The registries do not exist on Monad testnet.** `cast code $ID --rpc-url $T` returns `0x`. A
testnet-first plan does not survive that. No ERC-8004 data at these addresses on 10143 and no USDC
either, so the whole product had to be built against mainnet with real money.

**USDC has 6 decimals, not 18.** `cast call $U "decimals()(uint8)" --rpc-url $R` returns `6`. A price
literal copied from an 18-decimal chain is wrong by a factor of one million, in the direction that
overcharges. 0.01 USDC is `10000` atomic units. Not `10000000000000000`.

**The Validation Registry is live while Monad's own guide calls it "coming soon".** The contract
answers calls at `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` with 130 bytes of code. The guide does
not list it:

```bash
G=https://docs.monad.xyz/guides/erc-8004
curl -s $G | grep -c  '3-validation-registry-coming-soon'            # 3
curl -s $G | grep -ic '0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58'   # 0
curl -s $G | grep -ic '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'   # 1
```

The guide's heading reads "3. Validation Registry (coming soon)" and its Contract Addresses section
gives an address for Identity plus Reputation while Validation reads "(coming soon)". Read
2026-10-02. This is not a complaint. It is the reason nobody had used the registry. It is also why
"check the chain, not the documentation" is a habit here rather than a slogan.

## What this page does not establish

Stated here so it is never blurred elsewhere.

* **The x402 settlement was a self-payment.** Net USDC movement is zero.
* **The agent in the settled escrow is ours.** The machinery is proven on mainnet. Demand for it is
  not.
* **The counter slot's derivation namespace is unpublished.** The slot is trusted because its value
  agrees with `ownerOf` at both ends, not because we can re-derive it.
* **The agent count moves.** Any number read from it is a reading at a block. This page names the
  block.
* **The facilitator is somebody else's service.** Its `/supported` response changed between
  2026-09-20 and 2026-09-21. It will change again.

Licence: `LicenseRef-zkasuran-SAND-1.0`, source-available with no derivatives. See `LICENSE`.
