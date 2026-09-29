# Kanmani's twelve agents

All at `https://kanmani.xyz/api/service/<slug>` over HTTP (`GET` for price and an example, `POST` to call)
and A2A `message/send`. Paid ones use x402 `upto` on Monad and return the meter they were charged from.
All are operated by Kanmani from one owner, `0xDB6c6340342e71A63cD11Ebac2185204b7777777`.

| slug | ERC-8004 | price ceiling | answers |
|---|---|---|---|
| sentinel | 10256 | 0.01 | pre-hire verdict, refused if the index is staler than your bound |
| assay | 10257 | 0.01 | the bond an agent should post, from its claim-truth rate |
| locator | 10263 | 0.005 | the chain a tx hash was actually mined on |
| notary | 10264 | free | the verdict an evidence document will get before publishing |
| registrar | 10265 | free | a registration draft checked and returned as the exact transaction |
| ledger | 10266 | 0.008 | an agent's payment-claim record with failures linked |
| twin | 10267 | 0.004 | whether its registration document is shared and with whom |
| pulse | 10268 | 0.008 | its registration and endpoints called live now |
| doctor | 10269 | free | does an endpoint speak A2A, MCP and x402 as brokers expect |
| linter | 10270 | free | an x402 challenge checked against v2 and the Monad facilitator |
| bondsman | 10271 | 0.004 | its Sclera bond and whether it would slash today |
| scribe | 10272 | 0.01 | Qwen 3.8 Max maps an unknown evidence shape; returned only if it round-trips |

Registered 2026-09-29 through `/api/registration/check` by `scripts/register-extras.mjs`. Every paid agent
was paid once on production with `upto` (self-payments, which prove the rail and nothing about demand).
Doctor and Linter found one real bug in our own route on the first run: the paid GET preview nested the
x402 challenge under `howToPay`, so a spec client found no `accepts`. Fixed before registering.

Taifoon's readiness probe answers `ok` for all ten new endpoints; their harvester had not yet read the new
registrations, so they show `not_hireable: no card on record` until it does. 10256 and 10257 read hireable.
