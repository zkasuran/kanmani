# 38. Time to first transaction

`/api/pay-runs` records and serves how long it takes to get from the landing page to a confirmed Monad
transaction, as runs each tied to a real settlement. The concept is in
[21-MERA-UX](21-MERA-UX.md); this is the endpoint that holds the number.

The code is `app/api/pay-runs/route.ts` for the surface and `lib/pay-run.ts` for the one definition of
the per-run string and the aggregate math, shared by the `/pay` widget, the route and a test.

## Two honesty rules, both in the module

**A passkey confirmation is counted apart from in-app taps.** The OS prompt is a user-agent surface
the page cannot see. Folding it into "taps" would quietly undercount the real effort, so `appTaps`
counts primary pointerdowns inside the app and `passkeyPrompts` counts ceremonies the flow invoked.
The on-screen line states both: `2 taps plus 1 passkey confirmation, 8.4 s`.

**An empty set is `count: 0` with null statistics, never a zero.** A median of `0` reads as
instantaneous. `null` reads as what it is.

## `GET /api/pay-runs`

Two blocks, kept apart so the published median is never mixed:

```json
{
  "real": { "count": 0, "medianMs": null, "worstMs": null, "bestMs": null, "medianTaps": null },
  "ci":   { "count": 0, "medianMs": null, "worstMs": null, "bestMs": null, "medianTaps": null }
}
```

`real` is mainnet settles by a person. `ci` is rehearsals from the e2e harness. A rehearsal is a
useful regression signal and a dishonest headline, so it is served beside the real block rather than
inside it.

The envelope's `reproduce` is the SQL that produced the body:

```sql
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY elapsed_ms),
       max(elapsed_ms), min(elapsed_ms)
  FROM fovea.pay_run WHERE source='real' AND net='mainnet'
```

`percentileCont` in `lib/pay-run.ts` reimplements Postgres `percentile_cont(0.5)` exactly, so the
browser widget and the route cannot report different medians for the same rows.

## `POST /api/pay-runs`

```json
{ "source": "real", "net": "mainnet", "appTaps": 2, "passkeyPrompts": 1,
  "elapsedMs": 8400, "txHash": "0x…", "payer": "0x…" }
```

| field | accepted |
|---|---|
| `source` | `real` or `ci` |
| `net` | `mainnet` or `testnet` |
| `appTaps` | integer 0 to 1000 |
| `passkeyPrompts` | integer 0 to 100 |
| `elapsedMs` | integer 0 to 3,600,000 |
| `txHash` | `0x` plus 64 hex. **Required for a `real` mainnet run** |
| `payer` | optional string |

`201` on a first insert, `200` on a replay, both returning the current aggregate so the page updates
without a second request. Body capped at 2,048 bytes.

## Why an unauthenticated write does not poison the median

Anyone can finish a payment, so requiring a login to record one would gate the measurement on
something unrelated to it. What protects the number is not a login. It is two things:

**A `real` mainnet run must cite a settlement that can be read on chain.** Before the insert, the
route fetches the receipt on chain 143 and refuses unless the transaction succeeded **and** the logs
carry a USDC `Transfer` whose `to` topic is the payee. A run with no settlement behind it is
`400 "Unverifiable settlement"` with the reason and a `real` mainnet run with no `txHash` at all is
`400 "A real run needs its tx"`.

**`tx_hash` is UNIQUE, so a replay returns the first row rather than inserting a second.** The
`ON CONFLICT` clause updates the row to itself and the reply reports `firstTime: false`. The dedup is
the database's own constraint rather than a flag somebody remembers to check.

One note on the payer check. An x402 settle is sent by the relayer, not by the payer, so
`receipt.from` is the facilitator. The payer is the EIP-3009 `from` inside a `Transfer` log, which the
credited-the-payee check already ties to the asset. A mismatch on `receipt.from` is therefore expected
and is not a rejection on its own. The route says so in a comment rather than silently ignoring the
field.

## Related

- [21-MERA-UX](21-MERA-UX.md) the flow being measured: one passkey, a scoped session, no MON.
- [37-TESTNET](37-TESTNET.md) the testnet rail, which records `net: "testnet"` runs.
- [10-API](10-API.md) the rest of the HTTP surface.
