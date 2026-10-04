# Atlas induction: what Qwen actually did

**The honest position before this run.** The five shipped mappings are hand-written, plus a rule for
plain-text comments. Each carried `induced: "2026-09-19"` as a typed string, which is only the date a
human added it. The Qwen client and the induction loop existed with tests and **had never been run**,
so no artefact showed a model had produced anything. Calling the hand atlas "induced" invited a reading
the repo could not support.

This document is the artefact that was missing.

## Run it yourself

```bash
# the offline convergence demo (no key, no network): watches the loop propose, run the parser, revise
npx tsx verifier/src/atlas/demo.ts

# a real Qwen run: swap ScriptedModel for qwenFromEnv() in demo.ts, then set a key and host
export GMI_API_KEY=...            # or DASHSCOPE_API_KEY
export QWEN_BASE_URL=https://api.gmi-serving.com/v1
export QWEN_MODEL=Qwen/Qwen3.8-Max
```

The record of the run below is `verifier/src/atlas/inductions/gebo-uptime-report.v1.json`, including the
full transcript.

## Where the gap is on Monad

`noMappingReadTheShape` was **0** for Monad through 2026-09-28: every document was read by a
hand-written mapping, which is why the integration had no pressure behind it at first. That changed on
2026-09-30, when agent 10255 wrote three `tab-settlement-feedback` documents the hand atlas could not
read, so the Monad gap is live, shown on `/method#review-queue`. Those three are the first Monad shape
the induction loop has a real reason to run against. The candidate it proposes sits in the review queue
on `/method`. The current count is read from the database on each render, so this prose does not drift
again: see `/method#review-queue` and `/blog/qwen`.

The larger gap is on the other chain. As of the 2026-09-28 sampling run, BSC held **25,643 evidence
documents** against Monad's 1,287 and none had ever been through the atlas. Sampling 320 of them:

| | |
|---|---|
| documents sampled | 320 |
| read by the current atlas | **0** |
| dominant unread shape | `agentId, agentRegistry, clientAddress, createdAt, endpoint, method, reasoning, tag1, tag2, value, valueDecimals` |

The atlas was induced entirely from Monad and reads none of BSC. That is a real coverage gap rather than
a manufactured one.

## What the model found and why it matters

Converged in one turn with a single tool call. It proposed `gebo-uptime-report.v1` with **`claim:
null`** and this reasoning, quoted from the artefact:

<!-- voice-gate:off  quoted verbatim from the induction artefact -->

> GEBO uptime probe report. value/valueDecimals are a percentage (10000 @ 2 decimals = 100.00%
> uptime), not a settlement amount. No tx hash, payer, recipient, token, or payment network exists in
> the document, so the shape asserts no payment: claim is null.

<!-- voice-gate:on -->

**That is a false positive avoided, not a gap closed.** A parser written in a hurry sees `value: "10000"`
in an evidence document and reads a payment of 10,000 atomic units. There are 41 documents of this shape
in the sample alone and treating them as payment claims would have invented payment claims out of
uptime reports, then marked them `false` when no transaction could be found. On a project whose headline
is about claims that do not resolve, inventing 41 of them would have been the worst possible error.

## Checked by hand rather than taken on trust

The model's reading was verified against the corpus before being accepted:

* Every document of that shape carries `value: 10000`, `valueDecimals: 2` and `tag1: "uptime"`, which
  reads as 100.00%.
* A key scan across the whole sample for `tx`, `hash`, `pay`, `token`, `amount`, `chain` and `settle`
  returns **nothing**.

So `noClaim` is correct. The model was right and the verification is recorded rather than implied.

## A provider constraint this found

The loop sends `tool_choice: "required"` to force the model through the parser. Qwen3.8-Max refuses:

```
InternalError.Algo.InvalidParameter: The tool_choice parameter does not
support being set to required or object in thinking mode
```

The client now downgrades `required` to `auto` for that case. Turning thinking off would have been the
other option and it is the wrong one, because the reasoning is exactly what let it notice that a field
named `value` was not money. The loop already tolerates a turn with no tool call, so `auto` costs a retry
at worst and it still refuses to accept a mapping it has not put through the parser.

## What this does not claim

One shape, on one chain, from one run. The other unread shapes in the sample are not yet mapped and
nothing has been added to the shipped atlas on the strength of a single induction. The mapping is
published here as a record of what the model proposed and what was verified, which is the standard the
five hand-written mappings did not meet until now.

## Update, 2026-10-04: the first model-proposed mapping shipped

The three tab-settlement claims on Monad stayed `unknown` at the `intact` rung, because no mapping read
their shape. A real keyed run against `Qwen/Qwen3.8-Max` (served by GMI Cloud) gave up after six turns.
The transcript showed the first proposal was already right. Qwen sent `claim` as a JSON-encoded string,
and the loop cast the arguments without checking them, so every proposal compiled to an empty mapping.
`readProposal` in `verifier/src/atlas/induce.ts` now validates the arguments field by field and decodes a
string `claim` once. `verifier/src/atlas/read-proposal.test.ts` pins that with the exact shape the run
produced.

A second real run converged in one turn and one parser call, in 16 seconds. Review changed one field.
Qwen read the recipient as `settlement.serviceId`, which is the bytes32 label `tab.demo`. The settlement
transaction `0x863e9ae5…f817497` transfers 200,000 USDC units to `settlement.collection`, so the shipped
`tabSettlementFeedback` mapping in `verifier/src/ladder/parse.ts` uses that. Judged with live readers,
the claim is `true`: the value reached `0x49472ef9…783a` at block 109,379,821.

The run, the review note and the transcript are in
`verifier/src/atlas/inductions/tab-settlement-feedback.v1.2026-10-04.json`. The atlas is now six mappings:
five written by hand and one a model proposed and a person checked.
