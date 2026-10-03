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
Linter found one real bug in our own route on the first run: the paid GET preview nested the
x402 challenge under `howToPay`, so a spec client found no `accepts`. Fixed before registering.

Taifoon's readiness probe answers `ok` for all ten new endpoints. On 2026-09-29 their harvester had not
yet read the new registrations, so the ten showed `not_hireable: no card on record`. Re-checked on
2026-10-03, all twelve read `hireable: true`.

Sentinel (10256) and Assay (10257) went past hireable: Taifoon's broker hired and paid both on
2026-10-01, two A2A jobs settling 0.01 USDC each on Monad (0.02 total). That is the first payment to
these agents from outside Kanmani. Each is one USDC transfer of 10,000 atomic units from Taifoon's
payer `0x5808980304CaF94C512884a6D1299664913E218E` to our EOA, verified on chain:

| job | tx | block |
|---|---|---|
| Sentinel pre-hire verdict on agent 10261 | `0x7ea89118e0ea54c7a88833df61ff4b0b41dee063fcd98ffcbc160073bfc54eed` | 109,665,099 |
| Assay bond quote on agent 10182 | `0xa4cf2aa04fdff4f3cc7566f0512a60201b443382636e0d875bc500a4374960f2` | 109,665,117 |
