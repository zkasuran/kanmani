# 36. The compliance surface

Two shipped surfaces read a wallet's Cleanverse Verified Identity straight off the chain:

- `/compliance`, the page. The flow drawn, the live status of three wallets read on load, the pass and
  the refuse as real transactions.
- `GET /api/compliance/{address}`, the same read as JSON, for any address, on both Monad chains.

The code is `lib/cleanverse-onchain.ts` (the deployment facts, the read, the pure interpreter),
`app/api/compliance/[address]/route.ts` and `app/compliance/page.tsx`. The gate contract and the
reasoning behind identity-coupled settlement are in [20-CLEANVERSE](20-CLEANVERSE.md). This document
covers the two surfaces, which that one does not name.

## The three states and the one that matters

`cviStatus(worker)` is a `uint8` view on the gate. The contract enum is `Unknown = 0`,
`Unverified = 1`, `Verified = 2` and the API maps it to a string plus a reason:

| state | raw | what it means |
|---|---|---|
| `verified` | `2` | the validator returned a valid active CVI for this wallet |
| `unverified` | `1` | the validator answered and this wallet is not cleared to receive |
| `unknown` | `0` or an unreadable chain | nobody answered, so nothing is known |

**Unknown is never unverified.** A `1` is a compliance refusal about a wallet. An unreachable RPC, an
unreadable validator or an unregistered pool is operational and says nothing about the wallet. Folding
the two together would let our own outage publish as somebody's compliance failure, which is the exact
failure this whole project exists to point at.

Nothing reads `verified` unless the chain returned the `2` word. There is no default and no optimistic
pass. `interpretCviStatus` is pure, so every branch is reachable in a test with no network and a
thrown read is caught and returned as `unknown` with the transport error in `reason`.

## `GET /api/compliance/{address}`

```bash
curl -sS https://kanmani.xyz/api/compliance/0xaA514cD6573f95DdD0df78ec1Fdcb8dA05E70936
```

```json
{
  "address": "0xaa514cd6573f95ddd0df78ec1fdcb8da05e70936",
  "chains": [
    {
      "chainId": 143, "key": "monad", "displayName": "Monad mainnet",
      "gate": "0x4a21a5d8e24E683801ECC4CF19f178d7185e544A", "registered": false,
      "state": "unknown",
      "reason": "the gate is not yet registered as a compliance pool on this chain, so every wallet reads unknown and every settle fails closed",
      "raw": 0
    },
    {
      "chainId": 10143, "key": "monad-testnet", "displayName": "Monad testnet",
      "gate": "0xfc831E2F4FF21C4FB0B241684CB39203Bd137d2f", "registered": true,
      "state": "verified",
      "reason": "the validator returned a valid active CVI for this wallet",
      "raw": 2
    }
  ]
}
```

The envelope's `reproduce` names the exact call and both gates:
`cviStatus(0x…) via eth_call to each gate: 143 0x4a21…544A, 10143 0xfc83…7d2f`. Its `checkedAtBlock`
is `null`, because this is a live `eth_call` rather than an index read. `cache-control: no-store`.

Both chains are read in parallel, so **one failing chain never blocks the other**. The failure lands
as `unknown` on its own row with a reason, beside a real answer on the other row.

`registered` is carried per chain because it changes what a `0` means. The testnet gate is registered
as a compliance pool and the flow ran against it end to end. The mainnet gate is deployed but not yet
registered, so every mainnet wallet reads `unknown` and every mainnet settle fails closed. The reason
string says that rather than leaving a reader thinking the lookup is broken.

No auth is needed and none is checked. An address and its on-chain CVI status are already public, so
gating this would protect nothing while implying it protected something. The read needs no key and the
off-chain Cleanverse Verify-CVI API is never called from this path, so there is no SSRF surface and no
allowlist dependency.

The only error is `400 "Not an address"`.

## The addresses, never invented

All four are constants in `lib/cleanverse-onchain.ts`, so the page, the API and the test read one
source:

| what | address |
|---|---|
| Compliance Validator, same on both chains | `0xA64529732B52EFFD2B245320E88226D72c23b788` |
| Access USDC, the CVA (`name()` "Access USDC", `symbol()` "aUSDC", six decimals) | `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` |
| Mainnet gate on chain 143, deployed, not yet a registered pool | `0x4a21a5d8e24E683801ECC4CF19f178d7185e544A` |
| Testnet gate on chain 10143, registered, the flow ran against it | `0xfc831E2F4FF21C4FB0B241684CB39203Bd137d2f` |

## The `/compliance` page

Five panels, server-rendered, nothing hardcoded in the status rows.

1. **Live CVI status, read on load.** A server-side `eth_call` to each gate on every request, for the
   testnet worker holding a tier 20 CVI and for our own deployer, which holds none. Three rows, so a
   reader sees a `verified`, an `unverified` and an `unknown` side by side rather than one happy path.
2. **Check any wallet.** The same read for any address, pre-filled with the verified testnet worker so
   the happy path runs with one click.
3. **The flow.** `open()` escrows the hire through Aqueous with the gate as both buyer and agent, so
   only the gate can move the money. `settle()`, buyer only, reads `cviStatus` through the validator
   before anything leaves escrow. Then the three branches: release and pay in the CVA on `verified`,
   revert `CviNotVerified` on `unverified`, revert `CviUnknown` on `unknown`.
4. **The pass and the refuse as transactions.** Seven real Monad testnet transactions from the
   end-to-end run: register pool, set rule, issue CVI, then open plus settle on the pass and open plus
   settle on the refuse. The refuse row carries its revert, `CviNotVerified()` selector `0xbfeb29e5`,
   so the table states the failure rather than implying a success.
5. **The off-chain code map**, rendered as a static documentation table and never called live, so a
   reader can see how Cleanverse's four Verify-CVI codes map onto the same three states.

The money never moves on doubt. An unregistered pool or an unreadable validator reverts, which is why
a mainnet settle through this gate cannot pay anyone today. That is the posture, not a bug.

## Related

- [20-CLEANVERSE](20-CLEANVERSE.md) the gate contract, the off-chain client and the CVA simulation.
- [10-API](10-API.md) the rest of the HTTP surface.
