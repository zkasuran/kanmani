# 20. Cleanverse: identity coupled to settlement

Kanmani already holds money until a condition is met. Aqueous escrows a hire and pays out only when
the buyer releases. This document is about making a verified identity part of that condition, so the
money cannot reach a worker whose wallet is not cleared. That is the whole ask of the Cleanverse
bounty, quoted: priority to projects where identity verification is structurally coupled to asset
movement, not added as an optional layer.

The code is `contracts/src/CleanverseGate.sol`, its tests are `contracts/test/CleanverseGate.t.sol`
and `contracts/test/CleanverseGateFork.t.sol` and the off-chain read is `lib/cleanverse.ts`.

---

## 1. What Cleanverse provides and where the check lives

Cleanverse runs a compliance protocol with two primitives. A Cleanverse Verified Identity (CVI) is a
non-transferable on-chain credential bound to a wallet after KYC. A Cleanverse Verified Asset (CVA) is
a token that checks the recipient's CVI inside its own transfer, so a transfer to an uncleared wallet
reverts. Access USDC (`aUSDC`) is the CVA stablecoin.

The identity check is **on-chain**, not an API the app calls. Cleanverse publishes a Compliance
Validator contract with a view function:

```
complianceVerify(address pool, address user) returns (bool)
```

A business contract stores the validator address and calls `complianceVerify(address(this), user)`
before it moves value. True means the user's CVI satisfies the rule configured for that pool, false
means it does not. This is Cleanverse's Pattern 2, the single-contract validator. It was read from the
Cleanverse quickstart and the CVI, CVA and Supported Chains pages on 2026-09-23.

That on-chain shape is why the gate calls a contract rather than recovering a signed attestation. An
off-chain attestation would move the trust boundary to a signing key we would then have to protect.
The validator is already on chain, so the gate reads it directly and there is no attestor key.

### Verified on Monad, by hand

Every address below was read live on 2026-09-23 with `eth_getCode` and `eth_call`, on Monad mainnet
(chain 143) and testnet (chain 10143). Cleanverse's docs list these under a testnet column and leave
mainnet as `<TBD>`, but the same CREATE2 addresses answer on 143 too, so the caveat is stale the same
way Monad's own ERC-8004 guide was.

| Contract | Address on Monad | What it answered |
| --- | --- | --- |
| Compliance Validator | `0xA64529732B52EFFD2B245320E88226D72c23b788` | ERC-1967 proxy. `complianceVerify(0xdead, wallet)` reverts `PoolNotRegistered()` (`0x739f4185`) for an unregistered pool |
| Access USDC (CVA) | `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` | `name()` "Access USDC", `symbol()` "aUSDC", `decimals()` 6 |

The decimals matter. aUSDC is 6, like AUSD, not 18. A settlement amount carried over from an
18-decimal token would be wrong by a factor of 1e12.

---

## 2. Why the coupling is structural rather than a bolt-on

Aqueous is immutable with no admin, so a CVI check cannot be added to the deployed escrow. The gate is
a companion and the coupling comes from how it holds the money rather than from a flag it could drop.

The gate opens each hire through Aqueous as **both the buyer and the agent of record**. Aqueous checks
`msg.sender == buyer` on release and refund and `msg.sender == agent` on the agent claim path. In
every one of those checks the party is the gate. So the escrowed balance has exactly one controller,
the gate and the gate's only outbound path to a worker is `settle`, which verifies CVI first.

There is no route by which the escrow pays a worker except through a passing identity check. Removing
the check is not a configuration change, it is a rewrite of the one function that moves the money. That
is the difference between coupled and optional.

The worker payout uses the CVA, so it is guarded twice: the gate refuses an uncleared worker with a
clear reason before any balance leaves escrow and the CVA itself refuses the transfer if it somehow
reached one. The gate check runs first so funds are never stranded mid-transfer.

The lifecycle:

- `open(worker, token, amount, deadline, termsHash, salt)` pulls the escrow from the buyer, funds an
  Aqueous job with the gate as buyer and agent and records the worker the buyer named.
- `settle(jobId)`, buyer only, verifies the worker's CVI on chain, then releases the escrow and pays
  the worker. This is the compliant path and the only payout path.
- `refund(jobId)`, after the deadline, returns the escrow to the buyer when no settlement ran.

---

## 3. Unknown is never a pass

A gate that treats a failed identity read as approval is worse than one with no check, because it looks
safe. The validator can answer in three ways and the gate keeps them distinct:

- **Verified.** `complianceVerify` returned true. The worker settles.
- **Unverified.** It returned false. `settle` reverts `CviNotVerified` and no money moves.
- **Unknown.** It reverted, had no code or answered with fewer than 32 bytes. `settle` reverts
  `CviUnknown`. An unregistered pool lands here, because the real validator reverts `PoolNotRegistered`
  until the gate is registered.

The read is a low-level staticcall so those three are handled explicitly rather than collapsed. A
public view `cviStatus(worker)` returns the same three states without reverting, for a UI to read
before a settlement is attempted. `lib/cleanverse.ts` holds the same rule off chain: a network error,
a timeout or an unrecognised code is `"unknown"`, never `"unverified"` and only `data.code === 4`
under a `"0000"` envelope is `"verified"`.

---

## 4. The real-world compliance use case

The compliance case is verified settlement: an AI agent cannot be paid for work until its wallet
carries a verified identity. This is on the bounty's own ideas list beside Travel Rule payments and
permissioned DeFi and it is the shape that fits an agent marketplace. A buyer hiring an autonomous
agent has the same know-your-counterparty duty a bank has and the agent's wallet is the counterparty.
Gating the payout on a CVI, in a CVA, is that duty enforced by the settlement rail rather than by a
policy document. Because the payout asset is aUSDC, the funds are compliance-checked at the source and
a Travel Rule report can be pulled for the settlement transaction.

---

## 5. Reproduce it

```
# The gate logic, no network:
cd contracts && PATH=$HOME/.foundry/bin:$PATH forge test --match-contract CleanverseGateTest

# Against the real validator on Monad, forked:
forge test --match-contract CleanverseGateForkTest --fork-url https://rpc.monad.xyz

# The off-chain client:
npm test    # runs lib/cleanverse.test.ts among the rest

# Simulate the deploy and read the gas, no broadcast, no funds:
forge script script/DeployCleanverseGate.s.sol:DeployCleanverseGate \
  --rpc-url https://rpc.monad.xyz --sender 0xDB6c6340342e71A63cD11Ebac2185204b7777777
```

The fork test asserts the real validator is live and that the gate fails closed against it while the
pool is unregistered. The deploy simulation reported 1,846,462 gas and confirmed both dependencies
have code on chain 143.

---

## 6. The flow, end to end on Monad testnet (2026-09-30)

Cleanverse's sandbox writes to the testnet validator (`0xA645…b788` on chain 10143), so testnet is
where the whole flow can run with the credentials the bounty publishes. Every step below is a real
transaction or a live API answer. `scripts/cleanverse-sandbox.mjs` drives the API side.

| step | what happened | evidence |
|---|---|---|
| deploy | gate `0xfc831E2F4FF21C4FB0B241684CB39203Bd137d2f`, escrow = testnet Aqueous `0xAbB8…c232`, `owner()` = our deployer | forge broadcast, `owner()` read on chain |
| register | `POST /validator/register`, AES-encrypted, owner signature over `monad` + gate | validator tx [`0x1fde7e51…`](https://testnet.monadexplorer.com/tx/0x1fde7e517ca70b15a8894f7f778c68747e8dcd29a91017e170c936b9f2d64cce), `is_register` returns `true` |
| rule | any active CVI, tier 1 or higher, no country blocked | tx [`0x87eb6dab…`](https://testnet.monadexplorer.com/tx/0x87eb6dabd44dfc2c51dfe80c896ba6241d8d8278d38e9248027f2459bdb333d9), read back with `validator/rules` |
| issue CVI | `generate_apass` for a testnet worker `0xaA51…0936`, no identity data sent (the field is optional). Tier 20, status active | tx [`0x6ae7f07b…`](https://testnet.monadexplorer.com/tx/0x6ae7f07b5da99abb8d93ef430ff3fea175b7e76507406bb98f9149f148aef057) |
| pass | job opened for the verified worker, `settle` paid it 1,000,000 tUSDC units | open [`0xb18196cb…`](https://testnet.monadexplorer.com/tx/0xb18196cb24acea15b5950f0542befee1604678dce0590c4485c2c143e05047de), settle [`0xea913ac3…`](https://testnet.monadexplorer.com/tx/0xea913ac399f270daec96bd6e1b374263a50803d84a4606a509dbc7176395174f), worker balance 0 then 1,000,000 |
| refuse | job opened for a fresh wallet with no CVI, `settle` reverted `CviNotVerified()` (`0xbfeb29e5`). The worker got nothing and the escrow still holds the job | open [`0xbd1bd65f…`](https://testnet.monadexplorer.com/tx/0xbd1bd65f8835fc1b8aca10431de7c782c4cda0ac4ba8f1a3da6acbb32d585a35), failed settle [`0xd381c3e1…`](https://testnet.monadexplorer.com/tx/0xd381c3e12f5535f05f066ff4ceabcf048075b593fd393f565c39a7017a0539d0), status 0 |

The validator and the gate agree in both directions: `complianceVerify(gate, worker)` is `true` and
`cviStatus` reads `Verified`. For our own wallet, which holds no CVI, it is `false` and `Unverified`.

**Two things this run found.**

1. **A gate with no owner cannot be registered.** Register Compliance Pool checks an EIP-191 signature
   against the pool's on-chain `owner()`. The first mainnet deploy (`0x06Ce09EA…c421`, 2026-09-30) had
   no such function, because the gate deliberately has no admin. Registration answered `Invalid
   contract owner signature.` The gate now records its deployer as an immutable `owner`. No function
   reads it and it holds no power over any job, balance or rule. It exists for that one check. The
   ownerless deploy is superseded and holds nothing.
2. **The docs' example rule names a group our credential cannot issue.** The example uses
   `allowed_group: "AB"`. CVIs issued with the published sandbox credential carry an empty group, so
   that rule rejected the CVI we had just issued. The rule now matches on tier and status only.

A first attempt at the failure case used `0x…dEaD` as the unverified worker. The validator passed it:
the sandbox already holds a tier-50 CVI for that address. Good test data needs checking too. The
failure case was rerun against a freshly generated wallet, confirmed `false` before the job was
opened.

**Mainnet.** The owner-bearing gate is deployed on Monad mainnet at
`0x4a21a5d8e24E683801ECC4CF19f178d7185e544A` (tx `0xc643e2be…`, block 109,259,685, Sourcify
`exact_match`). It cannot be registered with sandbox credentials: the sandbox rejects the owner
signature for a mainnet address and the production API answers `Forbidden` to the published api-id.
Until Cleanverse issues production credentials, the mainnet validator reverts `PoolNotRegistered`
for it and every settle fails closed, which is the designed behaviour.

## 7. Honest limits

- **The mainnet gate must be registered as a compliance pool** before it settles anything. On testnet it is.
  That is an off-chain step (Register Compliance Pool) plus a Cleanverse review and until it lands
  `complianceVerify` reverts for the gate and every settlement fails closed. This is safe, not broken,
  but it means the fully live payout is gated on that registration.
- **The off-chain client needs an IP allowlist.** Cleanverse rejects requests from an IP it has not
  allowlisted, so `lib/cleanverse.ts` is exercised against an injected fetch in tests rather than a
  live call. The on-chain check needs no allowlist and no key, which is another reason it is the
  load-bearing one.
- **`symbol()` on aUSDC reverts locally.** It returns a string built with an opcode this project's
  Shanghai EVM target does not activate, so the fork test reads `decimals()` (which works and is the
  load-bearing fact) and takes the symbol from the off-chain read.
