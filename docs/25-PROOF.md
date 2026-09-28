# Proof: what each of the nine layers actually is

**Do not trust this file. Run the script.**

```bash
./scripts/prove.sh
```

It reads only public endpoints and public chain state. No key, no env file and no access to our
infrastructure, so you can run it from a clean machine and compare against what the site claims.

## All nine live

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

## What each check actually proves

Worth being precise, because "it returned 200" is not proof of much.

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
* **Self-heal** checks that a document repaired on chain is reflected in the index, matched on a string
  that exists only in the repaired version so it cannot pass against the original.
* **Intents** reads the destination transaction off Monad and requires a USDC transfer from the
  intermediary account into Aqueous, so it cannot pass on a bridge that only moved money into a
  holding address, which is exactly where this layer sat from 2026-09-25 to 2026-09-28.

## The first run of this script found four faults, all in the script

Recorded because it is the honest version. The first run reported four failures and every one was the
check being wrong rather than the layer: a broken pipe in a JSON helper, `-f` discarding the 402 body,
the bytecode floor above and a guard matching the word "revert" instead of the error selector. A proof
script that cries wolf is worse than none, so they were fixed before this file was written.

## Last recorded run

```
Kanmani proof run
  at   2026-09-28T07:39:12Z
  site https://kanmani.xyz
  rpc  https://rpc.monad.xyz
  head 108693752

1. Retina  ·  index the evidence  ·  expected LIVE
  PASS  the index answers and holds 1287 checkable claims
        checkedAtBlock 108690000
2. Fovea  ·  verify the claim  ·  expected LIVE
  PASS  verdicts exist: 85 payment claims, 12 resolve, 73 do not
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
  PASS  BSC indexed beside Monad: 359,571 agents on chain 56
        merged on the content hash of the registration document
8. Intents  ·  fund from any chain  ·  expected LIVE
  PASS  a cross-chain fund landed in the escrow: 115558 USDC units from the intermediary into Aqueous
        source 0.12 USDT on BSC, destination tx 0x738af85c2f6717da15f1cee3a447b05d0fc7b3c924b8027678afdde0a440b558
9. Self-heal  ·  heal a fixed record  ·  expected LIVE
  PASS  a repaired document is reflected in the index, so URIUpdated is being captured
        before this was wired, setAgentURI moved metadataUpdateCount and left the stored URI stale forever
  PASS  the optional Alchemy delivery path is deployed and answering (200)
        healing does not depend on it. Zero deliveries have ever arrived and the layer is live anyway

-------------------------------------------------------------
PASS 12   FAIL 0   SKIP 0
All nine layers live. If a FAIL appears above, the claim on the site is wrong and we
would rather you found it with this script than by trusting the page.
```
