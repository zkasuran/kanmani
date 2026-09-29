# Self-audit: every agent Kanmani operates, checked by Kanmani

Run 2026-09-29T16:20Z by `node scripts/self-audit.mjs`. Read-only: no payment, no transaction. The
same checks Kanmani applies to the registry, applied to ourselves first. Machine-readable:
[`/self-audit.json`](https://kanmani.xyz/self-audit.json).

| agent | id | document | spec | unique | indexed | card | doctor | linter | works | taifoon |
|---|---|---|---|---|---|---|---|---|---|---|
| kanmani | 10252 | pass | pass | pass | pass | pass | pass | pass | n/a | not_hireable |
| sentinel | 10256 | pass | pass | pass | pass | pass | pass | pass | pass | hireable |
| assay | 10257 | pass | pass | pass | pass | pass | pass | pass | pass | hireable |
| locator | 10263 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |
| notary | 10264 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |
| registrar | 10265 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |
| ledger | 10266 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |
| twin | 10267 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |
| pulse | 10268 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |
| doctor | 10269 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |
| linter | 10270 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |
| bondsman | 10271 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |
| scribe | 10272 | pass | pass | pass | pass | pass | pass | pass | pass | not_hireable |

What each column checks:

- **document**: the registry's agentURI is the registration-v1 document we intend, byte for byte.
- **spec**: every consequence our registration check reports is met (free tools take no payment by design).
- **unique**: no other agent shares the document. 8,093 Monad agents share one dead one.
- **indexed**: our index holds its name and endpoint and its x402 flag matches what it charges.
- **card**: its A2A card answers and names the ERC-8004 agent (for Kanmani: the well-known file lists all 13).
- **doctor**: our Doctor agent finds the endpoint hireable over A2A (for Kanmani: MCP).
- **linter**: our Linter agent finds a settleable x402 v2 challenge on paid endpoints.
- **works**: free agents answer their published example; paid ones answer an unpaid call with 402.

Findings, when a check fails:

- none
