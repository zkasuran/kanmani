/**
 * Run the induction loop once, against the scripted fake, with no key and no network. It prints the
 * transcript and the induced mapping so the multi-step behaviour is visible in real output. This is
 * the offline convergence demo the article and the lane summary quote.
 *
 *   node --experimental-strip-types verifier/src/atlas/demo.ts
 *
 * For a real Qwen run, swap the ScriptedModel for `qwenFromEnv()` (needs DASHSCOPE_API_KEY).
 */

import { induceMapping } from "./induce.ts";
import type { ChatClient, ChatRequest, ChatResponse, MappingProposal } from "./model.ts";

class ScriptedModel implements ChatClient {
  readonly label = "scripted-fake";
  private calls = 0;
  private readonly script: MappingProposal[];
  constructor(script: MappingProposal[]) {
    this.script = script;
  }
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    const idx = Math.min(this.calls, this.script.length - 1);
    this.calls += 1;
    const proposal = this.script[idx]!;
    return {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: `call_${idx}`, type: "function", function: { name: "try_mapping", arguments: JSON.stringify(proposal) } },
        ],
      },
    };
  }
}

const HASH = `0x${"a".repeat(64)}`;
const doc = new TextEncoder().encode(
  JSON.stringify({
    schema: "x402-settlement/1",
    settlement: { chain: "monad", tx_hash: HASH, status: "final" },
    counterparty: { wallet: `0x${"b".repeat(40)}` },
  }),
);

const badThenGood: MappingProposal[] = [
  {
    name: "x402-settlement.bad",
    note: "guessed the hash lives under status",
    matchKeys: ["settlement.tx_hash"],
    claim: { networkPath: "settlement.chain", txHashPath: "settlement.status" },
    predicted: { network: "monad", txHash: HASH },
  },
  {
    name: "x402-settlement.v1",
    note: "hash under settlement.tx_hash, chain from the settlement object",
    matchKeys: ["settlement.tx_hash"],
    claim: { networkPath: "settlement.chain", txHashPath: "settlement.tx_hash", recipientPath: "counterparty.wallet" },
    predicted: { network: "monad", txHash: HASH },
  },
];

const r = await induceMapping({
  client: new ScriptedModel(badThenGood),
  document: doc,
  now: () => new Date("2026-09-23T10:00:00Z"),
});

for (const step of r.transcript) {
  if (step.kind === "propose") console.log(`turn ${step.at}  propose  ${step.proposal.name}`);
  if (step.kind === "tool") console.log(`turn ${step.at}  tool     parse -> ${step.outcome.kind}`);
  if (step.kind === "decision") console.log(`turn ${step.at}  decide   ${step.verdict}: ${step.reason}`);
}
console.log("");
console.log(`converged=${r.converged}  iterations=${r.iterations}  toolCalls=${r.toolCalls}`);
if (r.mapping) console.log(`induced   ${JSON.stringify(r.mapping, null, 2)}`);
else console.log(`reason    ${r.reason}`);
