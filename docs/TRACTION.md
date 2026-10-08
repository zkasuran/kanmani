# Traction and outreach

Every project Kanmani has contacted, what was offered and what came back. Thread status read from GitHub on 2026-10-08 by `node scripts/outreach-status.mjs`; anything settled links the transaction.

- **Contacted:** 11 projects.
- **Replied or acted:** 5.
- **Paid work settled on chain:** 2. 1 with an outside buyer paying our agents, 1 with an outside agent we hired. These are kept apart on purpose: only the first is demand that is not ours.

| date | project | what we offered | status | evidence |
|---|---|---|---|---|
| 2026-09-29 | Taifoon (Jev grader and job broker), [taifoon-io/jev#1](https://github.com/taifoon-io/jev/issues/1) | Sentinel and Assay hireable over x402 on Monad. | settled on chain (4 replies) | [Sentinel payment](https://monadvision.com/tx/0x7ea89118e0ea54c7a88833df61ff4b0b41dee063fcd98ffcbc160073bfc54eed), [Assay payment](https://monadvision.com/tx/0xa4cf2aa04fdff4f3cc7566f0512a60201b443382636e0d875bc500a4374960f2), [Taifoon's article](https://www.taifoon.io/blog/jev-grader-on-mainnet) |
| 2026-10-05 | Mida (encrypted agent context), direct | A paid job through Aqueous with Mida record ids as termsHash and deliverableHash. | settled on chain | [funded](https://monadvision.com/tx/0x10950f2e35f241ec01de5d6dbdef65756b0025f924605bad2ca68ddf6182f571), [delivered](https://monadvision.com/tx/0x24a69e44eb6eab7fac8f321f8e4121b515e42a8240b8caf98cb8456c0944f49c), [settled](https://monadvision.com/tx/0x89dc80d4d64c9f4334c486ffdc4429c530282b24eed6f1eeeaec5fc4abb01d8b), [Mida's write-up](https://github.com/damli40/mida-context/blob/main/docs/evidence/kanmani-job-2026-10-05.md) |
| 2026-09-23 | Envio (HyperIndex), [enviodev/hyperindex#1659](https://github.com/enviodev/hyperindex/issues/1659) | An ERC-8004 multichain indexer recipe for the HyperIndex templates. | replied; our PR is open, waiting on their review (2 replies) | [PR #1660, open](https://github.com/enviodev/hyperindex/pull/1660) |
| 2026-09-23 | Ultravioleta DAO (describe SDK), [UltravioletaDAO/uvd-describe-sdk-typescript#4](https://github.com/UltravioletaDAO/uvd-describe-sdk-typescript/issues/4) | A finding: hash integrity is not claim truth, 41 of 42 payment references on one agent do not resolve. | sent, no reply yet (0 replies) | none yet |
| 2026-09-23 | The Agora, [SakshiShah29/The-Agora#3](https://github.com/SakshiShah29/The-Agora/issues/3) | A finding: 8 metadata files behind 32 Monad agents are pinned to a mutable branch. | sent, no reply yet (0 replies) | none yet |
| 2026-10-06 | Assay (signed receipts for AI responses), [trudransh/Assay#4](https://github.com/trudransh/Assay/issues/4) | Pay their host per signed, anchored receipt through Aqueous. | replied, our turn done, waiting (3 replies) | [funded](https://monadvision.com/tx/0xa343ddb41fcde5e15118140de4203ceb57dd94cac539614d1f3237f96050c8e0), [terms](https://github.com/zkasuran/kanmani/blob/main/docs/jobs/assay-1.terms.txt) |
| 2026-10-06 | Prooflines Agent Trust, [ColinkaMir/monad-agent-trust#1](https://github.com/ColinkaMir/monad-agent-trust/issues/1) | Cross-link our claim-truth reading with their rating-provenance verdict or a paid job through Aqueous. | sent, no reply yet (0 replies) | none yet |
| 2026-10-06 | MonadGuard, [poteshniy/monadguard#1](https://github.com/poteshniy/monadguard/issues/1) | Pay them through Aqueous to scan Kanmani's MCP server. | sent, no reply yet (0 replies) | none yet |
| 2026-10-06 | Letterlock, [edycutjong/letterlock#2](https://github.com/edycutjong/letterlock/issues/2) | Seal an escrow delivery to the buyer's Letterlock address, one paid job. | sent, no reply yet (0 replies) | none yet |
| 2026-10-07 | Leash (spend limits for agents), [iamrobertmoore/leash#1](https://github.com/iamrobertmoore/leash/issues/1) | A finding (21 of their agents point at unreadable documents) and a paid Sentinel check inside a leash. | sent, no reply yet (0 replies) | none yet |
| 2026-10-07 | ADEXTO, [0xcuy/adexto#2](https://github.com/0xcuy/adexto/issues/2) | Our claim-truth reading on their agent pages or a paid Sentinel check before a buyer agent buys. | replied, our turn done, waiting (1 reply) | none yet |

## What came back

- **Taifoon (Jev grader and job broker).** Their broker paid Sentinel and Assay 0.01 USDC each on Monad mainnet on 2026-10-01. They named both agents in a published article. A follow-up on 2026-10-06 offered one graded job through the Aqueous escrow, so payment follows the grade.
- **Mida (encrypted agent context).** Mida's auditor agent re-checked the 10 claims our verifier found on no chain, for 0.50 USDC through Aqueous. Its findings showed 2 of them are real payments on Celo, so Celo was added to the search. We were the buyer.
- **Envio (HyperIndex).** Envio replied inviting a PR with a minimal ERC-8004 template and closed the issue as completed. The PR is open. Letterlock's author also commented, offering two event handlers once the template lands.
- **Assay (signed receipts for AI responses).** Assay accepted. Job 0xe658e2cb funded with 0.05 USDC on Aqueous for 5 responses from their host 10278. All 5 receipts verify on Monad against their ReceiptAnchor. Settlement follows their deliver() call. We are the buyer.
- **ADEXTO.** ADEXTO asked how the reading embeds, how uncovered chains count, our false-positive rate and Sentinel's coverage. They said they would start with our free reading on their agent pages if it is a simple API read. It is. We answered all four.
