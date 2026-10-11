# Proof: what each of the eleven layers actually is

**Do not trust this file. Run the script.**

```bash
./scripts/prove.sh
```

It reads only public endpoints and public chain state. No key, no env file and no access to our
infrastructure, so you can run it from a clean machine and compare against what the site claims.

## All eleven live

For three days this document said eight live and one built and that was the honest shape: Intents had
bridged real money to Monad and then stalled unsigned, so the escrow never funded. It turned green only
when the escrow actually received the money and the check reads that transfer off Monad rather than
trusting a status field from the bridge.

| # | layer | claim | status |
|---|---|---|---|
| 1 | Retina | index the evidence | live |
| 2 | Fovea | verify the claim | live |
| 3 | Aqueous | escrow the job | live |
| 4 | Iris · x402 | pay without a wallet | live |
| 5 | Optic | answer on chain | live |
| 6 | Sclera | bond the promise | live |
| 7 | Chiasm | read every chain at once | live |
| 8 | Intents | fund from any chain | live |
| 9 | Self-heal | heal a fixed record | live |
| 10 | AgentPasskey | a device passkey for an agent | live |
| 11 | Our agents | held to the checks we apply to others | live |

## What each check actually proves

"It returned 200" is not proof of much, so each line below says what the check proves.

* **Retina** answers with a claim count, so the index exists and is queryable.
* **Fovea** returns a verdict summary. A `false` there means the chain was read and the transaction was
  absent, never that we failed to look.
* **Aqueous** and **Optic** are checked by reading bytecode at their addresses. Optic is a 130-byte
  minimal proxy, which an earlier version of this script called dead because it used a 1000-byte floor.
* **Iris** must answer `402` with an `x402Version` body. The check deliberately omits curl's `-f`,
  because `402` is the expected answer and `-f` would discard the challenge.
* **Sclera** is checked three ways: the API reports a bond, the contract agrees on its state and
  `postBond` against an agent we do not own must revert with selector `0x390772fc`, which is
  `NotAgentOwner()`. That last one is audit Finding 9, matched on the selector rather than on the word
  "revert" so it cannot pass on an unrelated failure.
* **Chiasm** requires a second chain's population on the chains page.
* **Self-heal** checks that a document repaired on chain is reflected in the index, comparing the
  index's stored URI against what the registry returns right now in full, so it cannot pass against
  any earlier version of the document.
* **Intents** reads the destination transaction off Monad and requires a USDC transfer from the
  intermediary account into Aqueous, so it cannot pass on a bridge that only moved money into a
  holding address, which is exactly where this layer sat from 2026-09-25 to 2026-09-28.
* **AgentPasskey** sends the RIP-7212 reference vector straight to Monad's P256 precompile at
  `0x0100`, so the signature scheme is checked on mainnet rather than asserted. The contract has
  bound and unbound agent 10256 through that precompile, nonce 2.
* **Our agents** are held to the checks we run on everyone else: the well-known file lists all 13
  registrations we operate. Each carries its registration-v1 document on chain byte for byte.
* **Composability** reads the chain-143 receipt behind each stack link and requires status 1. The
  Mera-account row has no hash yet, so the panel is honest at 3 of 4.

## The first run of this script found four faults, all in the script

Recorded because it is the honest version. The first run reported four failures and every one was the
check being wrong rather than the layer: a broken pipe in a JSON helper, `-f` discarding the 402 body,
the bytecode floor above and a guard matching the word "revert" instead of the error selector. A proof
script that cries wolf is worse than none, so they were fixed before this file was written.

## Last recorded run

```
Kanmani proof run
  at   2026-10-03T11:04:18Z
  site https://kanmani.xyz
  rpc  https://rpc.monad.xyz
  head 110163536

1. Retina  ·  index the evidence  ·  expected LIVE
  PASS  the index answers and holds 1292 checkable claims
        checkedAtBlock 110160000
2. Fovea  ·  verify the claim  ·  expected LIVE
  PASS  verdicts exist: 185 payment claims, 62 resolve, 123 do not
        a false verdict means the chain was read and the transaction was absent, never that we failed to look
3. Aqueous  ·  escrow the job  ·  expected LIVE
  PASS  escrow deployed, 10901 bytes at 0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32
4. Iris · x402  ·  pay without a wallet  ·  expected LIVE
  PASS  the priced endpoint answers 402 with an x402 challenge
        asks 10000 atomic 0x754704Bc… on eip155:143
5. Optic  ·  answer on chain  ·  expected LIVE
  PASS  validation registry live at 0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58, 130 bytes (minimal proxy)
        our row is visible at https://kanmani.xyz/validate
6. Sclera  ·  bond the promise  ·  expected LIVE
  PASS  agent 10256 carries a bond: active 10000 floor 8000bps
        read live from the contract, not from an index, because a window matures without emitting anything
  PASS  the contract agrees: state 1 Active
  PASS  the ownership guard holds: postBond reverts NotAgentOwner() for an agent we do not own
7. Chiasm  ·  read every chain at once  ·  expected LIVE
  PASS  BSC indexed beside Monad: 362,682 agents on chain 56
        merged on the content hash of the registration document
8. Intents  ·  fund from any chain  ·  expected LIVE
  PASS  a cross-chain fund landed in the escrow: 115558 USDC units from the intermediary into Aqueous
        source 0.12 USDT on BSC, destination tx 0x738af85c2f6717da15f1cee3a447b05d0fc7b3c924b8027678afdde0a440b558
9. Self-heal  ·  heal a fixed record  ·  expected LIVE
  PASS  the index holds 10256's current on-chain document, so URIUpdated is being captured
        before this was wired, setAgentURI moved metadataUpdateCount and left the stored URI stale forever
  PASS  the optional Alchemy delivery path is deployed and answering (200)
        healing does not depend on it. The index captures URIUpdated directly and the delivery path runs live on top of that
10. AgentPasskey  ·  Monad's P256 precompile  ·  expected LIVE
  PASS  the P256 precompile at 0x0100 verifies the RIP-7212 reference signature on Monad mainnet
  PASS  AgentPasskey is deployed and agent 10256 has been bound and unbound through it (nonce 2)
        bind tx 0x399bdce466786717078e7ea95afd0e59d30e61c0901d24e6db38d28c0d9745f5, verified by the precompile inside bind()
11. Our agents  ·  held to the checks we apply to others  ·  expected LIVE
  PASS  the well-known file lists 13 ERC-8004 registrations we operate (spec domain verification)
  PASS  all 13 agents carry their registration-v1 document on chain, byte for byte
12. Composability  ·  each stack layer links a settled chain-143 tx  ·  expected status 1
  PASS  composability tx 0x94fc5e7098… mined success on chain 143
  PASS  composability tx 0x2b879b52d5… mined success on chain 143
  PASS  composability tx 0x399bdce466… mined success on chain 143
        the Mera-account row is hollow until plan 1.5 fills its hash, so the panel is honest at 3 of 4

-------------------------------------------------------------
PASS 19   FAIL 0   SKIP 0
All eleven layers live. If a FAIL appears above, the claim on the site is wrong and we
would rather you found it with this script than by trusting the page.
```
