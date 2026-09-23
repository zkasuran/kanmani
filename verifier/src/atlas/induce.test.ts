import { test } from "node:test";
import assert from "node:assert/strict";
import { induceMapping } from "./induce.ts";
import { compileMapping, getPath } from "./compile.ts";
import type { ChatClient, ChatRequest, ChatResponse, MappingProposal } from "./model.ts";

/**
 * A scripted model. It returns its proposals in order, repeating the last one, recording every
 * request it was handed so a test can prove the model saw the tool result before it revised. No
 * network, no key: the seam is the whole boundary.
 */
class ScriptedModel implements ChatClient {
  readonly label = "scripted-fake";
  readonly calls: ChatRequest[] = [];
  private readonly script: MappingProposal[];
  constructor(script: MappingProposal[]) {
    this.script = script;
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req);
    const idx = Math.min(this.calls.length - 1, this.script.length - 1);
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
const WALLET = `0x${"b".repeat(40)}`;
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

/** A synthetic settlement receipt no shipped mapping reads. It is an example shape for the offline
 * harness, not a document pulled from chain. */
const UNMAPPED_DOC = enc({
  schema: "x402-settlement/1",
  settlement: { chain: "monad", tx_hash: HASH, status: "final" },
  counterparty: { wallet: WALLET },
});

const GOOD: MappingProposal = {
  name: "x402-settlement.v1",
  note: "hash under settlement.tx_hash, chain from the settlement object",
  matchKeys: ["settlement.tx_hash"],
  claim: { networkPath: "settlement.chain", txHashPath: "settlement.tx_hash", recipientPath: "counterparty.wallet" },
  predicted: { network: "monad", txHash: HASH },
};

// Matches the shape but reads the hash from the wrong key, so the parser extracts "final" instead
// of the predicted hash. The round-trip check is what must reject this.
const BAD_WRONG_HASH: MappingProposal = {
  ...GOOD,
  name: "x402-settlement.bad",
  note: "guessed the hash lives under status",
  claim: { networkPath: "settlement.chain", txHashPath: "settlement.status", recipientPath: "counterparty.wallet" },
};

const at2026 = () => new Date("2026-09-23T10:00:00Z");

test("the loop calls the parser as a tool, revises after a bad mapping then converges on the good one", async () => {
  const model = new ScriptedModel([BAD_WRONG_HASH, GOOD]);
  const r = await induceMapping({ client: model, document: UNMAPPED_DOC, now: at2026 });

  assert.equal(r.converged, true);
  assert.ok(r.mapping);
  assert.equal(r.mapping?.name, "x402-settlement.v1");
  assert.equal(r.mapping?.kind, "claim");
  assert.equal(r.mapping?.inducedBy, "scripted-fake");

  // The tool ran on every proposal. Two proposals, two real parser runs. This is what a "never
  // called the tool" break would drop to zero.
  assert.equal(r.iterations, 2);
  assert.equal(r.toolCalls, 2);

  // It revised before it accepted, so this was multi-step and not a single completion.
  const verdicts = r.transcript.filter((s) => s.kind === "decision").map((s) => (s as { verdict: string }).verdict);
  assert.deepEqual(verdicts, ["revise", "accept"]);
});

test("the induced mapping carries the date it was induced, like the shipped atlas entries", async () => {
  const model = new ScriptedModel([GOOD]);
  const r = await induceMapping({ client: model, document: UNMAPPED_DOC, now: at2026 });
  assert.equal(r.mapping?.induced, "2026-09-23");
});

test("the model sees the tool result before it proposes again", async () => {
  const model = new ScriptedModel([BAD_WRONG_HASH, GOOD]);
  await induceMapping({ client: model, document: UNMAPPED_DOC, now: at2026 });

  // The second request handed to the model must carry the first proposal's tool outcome, so the
  // revision is a response to real parser output rather than a blind retry.
  assert.equal(model.calls.length, 2);
  const secondTurn = model.calls[1]!.messages;
  const toolMsg = secondTurn.find((m) => m.role === "tool");
  assert.ok(toolMsg, "the second turn should include the tool result");
  assert.match(String(toolMsg?.content), /"final"/, "the tool result carries what the bad mapping actually extracted");
});

test("a mapping whose extraction does not match the plan is never accepted (round-trip guard)", async () => {
  // Only the bad proposal, one turn allowed. The extracted hash is "final", the plan predicted a
  // real hash, so it must not converge.
  const model = new ScriptedModel([BAD_WRONG_HASH]);
  const r = await induceMapping({ client: model, document: UNMAPPED_DOC, maxTurns: 1, now: at2026 });
  assert.equal(r.converged, false);
  assert.equal(r.mapping, undefined);
  assert.equal(r.toolCalls, 1);
});

test("running out of turns is a give-up, not a success (give-up guard)", async () => {
  const model = new ScriptedModel([BAD_WRONG_HASH]); // always bad
  const r = await induceMapping({ client: model, document: UNMAPPED_DOC, maxTurns: 3, now: at2026 });
  assert.equal(r.converged, false);
  assert.equal(r.mapping, undefined);
  assert.equal(r.iterations, 3);
  assert.equal(r.toolCalls, 3);
  assert.match(String(r.reason), /no mapping round-tripped in 3 turns/);
});

test("a shape that asserts no payment converges as noClaim", async () => {
  const doc = enc({ kind: "handshake", greeting: "hello", agent_alias: "scout-7" });
  const noClaim: MappingProposal = {
    name: "handshake.v1",
    note: "a greeting, asserts no payment",
    matchKeys: ["kind", "greeting"],
    claim: null,
    predicted: {},
  };
  const r = await induceMapping({ client: new ScriptedModel([noClaim]), document: doc, now: at2026 });
  assert.equal(r.converged, true);
  assert.equal(r.mapping?.kind, "noClaim");
});

test("a candidate that collides with a shipped mapping is refused rather than resolved by order", async () => {
  // This document already matches the shipped elo-record mapping. A candidate that also matches it
  // would make the verdict depend on declaration order, so the ambiguity guard must refuse it even
  // though the candidate extracts exactly what its plan predicted.
  const doc = enc({ elo: 1500, signal_type: "chess", settlement: { chain: "monad", tx_hash: HASH } });
  const collide: MappingProposal = {
    name: "collides.v1",
    note: "matches a document the elo mapping already claims",
    matchKeys: ["settlement.tx_hash"],
    claim: { networkPath: "settlement.chain", txHashPath: "settlement.tx_hash" },
    predicted: { network: "monad", txHash: HASH },
  };
  const r = await induceMapping({ client: new ScriptedModel([collide]), document: doc, maxTurns: 1, now: at2026 });
  assert.equal(r.converged, false);
});

/* --------------------------------------------------------------------------- compile unit tests */

test("getPath walks dotted paths and returns undefined at the first miss", () => {
  const d = { a: { b: { c: 7 } } };
  assert.equal(getPath(d, "a.b.c"), 7);
  assert.equal(getPath(d, "a.b.x"), undefined);
  assert.equal(getPath(d, "a.z.c"), undefined);
});

test("a compiled mapping matches only when every match key is present", () => {
  const m = compileMapping(GOOD, "2026-09-23");
  assert.equal(m.matches({ settlement: { tx_hash: HASH } }), true);
  assert.equal(m.matches({ settlement: { status: "final" } }), false);
  assert.equal(m.matches({}), false);
});

test("a compiled claim mapping extracts the paths, a null claim yields noClaim", () => {
  const m = compileMapping(GOOD, "2026-09-23");
  const out = m.extract({ settlement: { chain: "monad", tx_hash: HASH }, counterparty: { wallet: WALLET } });
  assert.equal(out.kind, "claim");
  if (out.kind === "claim") {
    assert.equal(out.claim.txHash, HASH);
    assert.equal(out.claim.network, "monad");
    assert.equal(out.claim.recipient, WALLET);
  }
  const noClaim = compileMapping({ ...GOOD, claim: null }, "2026-09-23").extract({});
  assert.equal(noClaim.kind, "noClaim");
});
