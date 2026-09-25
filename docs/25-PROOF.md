# Proof: what each of the nine layers actually is

**Do not trust this file. Run the script.**

```bash
./scripts/prove.sh
```

It reads only public endpoints and public chain state. No key, no env file and no access to our
infrastructure, so you can run it from a clean machine and compare against what the site claims.

## Eight live, one built

This is deliberately not a report of nine working things, because one of them is not a working thing
yet. Intents is proven **built**, meaning the code and its tests exist and nothing has run in
production. A script that printed nine greens would be the exact kind of claim this project
exists to catch.

| # | layer | claim | status |
|---|---|---|---|
| 1 | Retina | index the evidence | live |
| 2 | Fovea | verify the claim | live |
| 3 | Aqueous | escrow the job | live |
| 4 | Iris · x402 | pay without a wallet | live |
| 5 | Optic | answer on chain | live |
| 6 | Sclera | bond the promise | live |
| 7 | Chiasm | read every chain at once | live |
| 8 | Intents | fund from any chain | **built, never executed** |
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
* **Intents** proves the code exists and says plainly what has not happened.

## The first run of this script found four faults, all in the script

Recorded because it is the honest version. The first run reported four failures and every one was the
check being wrong rather than the layer: a broken pipe in a JSON helper, `-f` discarding the 402 body,
the bytecode floor above and a guard matching the word "revert" instead of the error selector. A proof
script that cries wolf is worse than none, so they were fixed before this file was written.

## Last recorded run

```
Kanmani proof run
  at   2026-09-25T05:23:46Z
  site https://kanmani.xyz
  rpc  https://rpc.monad.xyz
  head 107808650

1. Retina  ·  index the evidence  ·  expected LIVE
  PASS  the index answers and holds 1192 checkable claims
        checkedAtBlock 107800000
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
  PASS  BSC indexed beside Monad: 357,527 agents on chain 56
        merged on the content hash of the registration document
8. Intents  ·  fund from any chain  ·  expected BUILT, NOT live
  PASS  the module and its tests exist
        no cross-chain fund has been executed. This is proven BUILT, not live, on purpose
        run: npm test -- lib/intents.test.ts
9. Self-heal  ·  heal a fixed record  ·  expected LIVE
  PASS  a repaired document is reflected in the index, so URIUpdated is being captured
        before this was wired, setAgentURI moved metadataUpdateCount and left the stored URI stale forever
  PASS  the optional Alchemy delivery path is deployed and answering (200)
        healing does not depend on it. Zero deliveries have ever arrived and the layer is live anyway

-------------------------------------------------------------
PASS 12   FAIL 0   SKIP 0
Eight layers live, one built. If a FAIL appears above, the claim on the site is wrong and we
would rather you found it with this script than by trusting the page.
```
