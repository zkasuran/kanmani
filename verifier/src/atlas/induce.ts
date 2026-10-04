/**
 * The atlas induction loop: a real Qwen agent turn, planning, tool use and multi-step revision.
 *
 * The job is to read a document shape nobody mapped yet and produce a mapping that reads it. The
 * loop does not trust the model. It runs every proposal through the real parser (`parse.ts`) as a
 * tool. It accepts a mapping only when what the parser extracts matches what the model said it
 * would. A proposal that cannot be confirmed costs a retry and can never produce a wrong verdict,
 * which is the same discipline the shipped atlas already states: the model proposes a shape, the
 * deterministic parser decides.
 *
 * The three properties this loop must have, each guarded by one place in the code and each proven
 * to fail when that place is broken (see induce.test.ts):
 *
 *   1. It accepts a mapping only when it ROUND-TRIPS. Guard: `roundTrips(...)`.
 *   2. It always runs the parser as a tool. Guard: the `parseDocument(...)` call, counted.
 *   3. Running out of turns is a give-up, never a success. Guard: the final return.
 */

import { parseDocument, type Mapping, type ParseOutcome, ATLAS } from "../ladder/parse.ts";
import { compileMapping } from "./compile.ts";
import type {
  ChatClient,
  ChatMessage,
  InducedMapping,
  InductionResult,
  MappingProposal,
  ToolSpec,
  TranscriptStep,
} from "./model.ts";

const TOOL_NAME = "try_mapping";

const TRY_MAPPING_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: TOOL_NAME,
    description:
      "Run a candidate mapping through the real evidence parser and return exactly what it " +
      "extracts. Propose the keys that identify the shape and the paths to each payment field, " +
      "then read the result and revise. Set claim to null if the shape asserts no payment.",
    parameters: {
      type: "object",
      required: ["name", "note", "matchKeys", "claim", "predicted"],
      properties: {
        name: { type: "string", description: "a stable name, e.g. settlement-receipt.v1" },
        note: { type: "string" },
        matchKeys: {
          type: "array",
          items: { type: "string" },
          description: "dotted paths that must all be present, e.g. settlement.tx_hash",
        },
        claim: {
          description: "null for a no-payment shape, else the dotted path to each field",
          type: ["object", "null"],
          properties: {
            networkPath: { type: "string" },
            txHashPath: { type: "string" },
            recipientPath: { type: "string" },
            payerPath: { type: "string" },
            amountPath: { type: "string" },
            tokenPath: { type: "string" },
          },
        },
        predicted: {
          type: "object",
          description: "what you expect the parser to extract, checked against what it does",
          properties: { network: {}, txHash: {} },
        },
      },
    },
  },
};

const norm = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

function decode(raw: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(raw);
  } catch {
    return "<not valid UTF-8>";
  }
}

/**
 * The round-trip check. This is guard #1. A mapping round-trips only when the parser extracts what
 * the model predicted (for a claim shape) or agrees the shape carries no payment (for a noClaim
 * shape), AND the mapping is not ambiguous once dropped in beside the shipped atlas.
 */
function roundTrips(
  outcome: ParseOutcome,
  proposal: MappingProposal,
  compiled: Mapping,
  document: Uint8Array,
  atlas: readonly Mapping[],
  mediaType: string | undefined,
): boolean {
  if (outcome.kind === "claim") {
    if (proposal.claim === null) return false; // model said noClaim but extracted a claim
    const confirmed =
      norm(outcome.claim.txHash) === norm(proposal.predicted.txHash) &&
      norm(outcome.claim.network) === norm(proposal.predicted.network);
    return confirmed && isUnambiguous(compiled, document, atlas, mediaType);
  }
  if (outcome.kind === "noClaim") return proposal.claim === null;
  return false; // unparsed never round-trips
}

/** Adding the candidate to the atlas must resolve this document to exactly the candidate. */
function isUnambiguous(
  compiled: Mapping,
  document: Uint8Array,
  atlas: readonly Mapping[],
  mediaType: string | undefined,
): boolean {
  const withCandidate = parseDocument(document, [...atlas, compiled], mediaType);
  if (withCandidate.kind === "unparsed") return false; // ambiguous or still unmatched
  return withCandidate.mapping === compiled.name;
}

const PATH_KEYS = ["networkPath", "txHashPath", "recipientPath", "payerPath", "amountPath", "tokenPath"] as const;

/**
 * Tool arguments, checked field by field rather than cast.
 *
 * The first real run against Qwen 3.8 Max failed for six straight turns on a correct mapping. The
 * model sent `claim` as a JSON-encoded string, `"{\"networkPath\": \"chainId\"}"`, which some
 * OpenAI-compatible servers produce for a nested object in tool arguments. The old code cast the
 * parsed arguments straight to `MappingProposal`, so `claim.networkPath` was read off a string, came
 * back undefined, and every proposal compiled to an empty claim. The parser then told the model it was
 * wrong, and it went on rewriting a right answer.
 *
 * A string `claim` is decoded once. Anything that is still not the declared shape is refused here
 * rather than compiled, and every path must be a non-empty string.
 */
export function readProposal(raw: unknown): MappingProposal | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.length === 0 || r.name.length > 120) return null;
  const matchKeys = r.matchKeys;
  if (!Array.isArray(matchKeys) || !matchKeys.every((k) => typeof k === "string" && k.length > 0)) return null;
  let claim: unknown = r.claim;
  if (typeof claim === "string") {
    try {
      claim = JSON.parse(claim);
    } catch {
      return null;
    }
  }
  let paths: MappingProposal["claim"] = null;
  if (claim !== null) {
    if (typeof claim !== "object" || Array.isArray(claim)) return null;
    const c = claim as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of PATH_KEYS) {
      if (c[k] === undefined) continue;
      if (typeof c[k] !== "string" || (c[k] as string).length === 0) return null;
      out[k] = c[k] as string;
    }
    paths = out as NonNullable<MappingProposal["claim"]>;
  }
  const predicted = typeof r.predicted === "object" && r.predicted !== null ? (r.predicted as MappingProposal["predicted"]) : {};
  return { name: r.name, note: typeof r.note === "string" ? r.note : "", matchKeys: matchKeys as string[], claim: paths, predicted };
}

function firstToolCall(message: ChatMessage): { id: string; proposal: MappingProposal } | null {
  const call = message.tool_calls?.find((c) => c.function.name === TOOL_NAME);
  if (!call) return null;
  try {
    const proposal = readProposal(JSON.parse(call.function.arguments));
    return proposal ? { id: call.id, proposal } : null;
  } catch {
    return null;
  }
}

export type InduceOptions = {
  client: ChatClient;
  document: Uint8Array;
  mediaType?: string;
  atlas?: readonly Mapping[];
  model?: string;
  maxTurns?: number;
  now?: () => Date;
};

export async function induceMapping(opts: InduceOptions): Promise<InductionResult> {
  const atlas = opts.atlas ?? ATLAS;
  const maxTurns = opts.maxTurns ?? 6;
  const model = opts.model ?? opts.client.label;
  const now = opts.now ?? (() => new Date());
  const transcript: TranscriptStep[] = [];
  let toolCalls = 0;
  let iterations = 0;

  // The document as the current atlas already sees it: an unmapped shape comes back unparsed with
  // its keys, which is the honest starting context handed to the model.
  const seen = parseDocument(opts.document, atlas, opts.mediaType);
  const keys = seen.kind === "unparsed" ? (seen.keys ?? []) : [];

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You extend a published atlas that reads ERC-8004 evidence documents. Each mapping names " +
        "the keys that identify a document shape and the paths to its payment fields. Call " +
        `${TOOL_NAME} with a candidate, read what the parser extracts, then revise until the ` +
        "extracted fields match what you predicted. If the shape asserts no payment, set claim to " +
        "null. Do not guess a transaction hash: point at where it lives in the document.",
    },
    {
      role: "user",
      content:
        `This document is unmapped. The atlas returned: ${seen.kind}` +
        (keys.length ? ` with keys ${JSON.stringify(keys)}` : "") +
        `.\n\nDocument:\n${decode(opts.document)}`,
    },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await opts.client.chat({
      model,
      messages,
      tools: [TRY_MAPPING_TOOL],
      tool_choice: "required",
      temperature: 0,
    });
    iterations += 1;
    messages.push(res.message);

    const parsed = firstToolCall(res.message);
    if (!parsed) {
      transcript.push({ at: turn, kind: "decision", verdict: "revise", reason: "no tool call" });
      messages.push({ role: "user", content: `Call ${TOOL_NAME} with a candidate mapping.` });
      continue;
    }

    const { id, proposal } = parsed;
    transcript.push({ at: turn, kind: "propose", by: opts.client.label, proposal });

    const induced = fmtDate(now());
    const compiled = compileMapping(proposal, induced);

    // Guard #2: the parser runs as a tool on every proposal. Nothing downstream is trusted until
    // this has executed and the outcome is fed back to the model.
    const outcome: ParseOutcome = parseDocument(opts.document, [compiled], opts.mediaType);
    toolCalls += 1;

    transcript.push({ at: turn, kind: "tool", name: TOOL_NAME, outcome });
    messages.push({
      role: "tool",
      tool_call_id: id,
      name: TOOL_NAME,
      content: JSON.stringify(outcome),
    });

    // Guard #1: accept only on a confirmed round-trip.
    if (roundTrips(outcome, proposal, compiled, opts.document, atlas, opts.mediaType)) {
      const mapping: InducedMapping = {
        name: proposal.name,
        induced,
        note: proposal.note,
        kind: proposal.claim === null ? "noClaim" : "claim",
        proposal,
        inducedBy: opts.client.label,
      };
      transcript.push({
        at: turn,
        kind: "decision",
        verdict: "accept",
        reason: `parser extracted what the plan predicted (${outcome.kind})`,
      });
      return { converged: true, mapping, iterations, toolCalls, transcript };
    }

    transcript.push({
      at: turn,
      kind: "decision",
      verdict: "revise",
      reason: revisionReason(outcome, proposal),
    });
    messages.push({
      role: "user",
      content: revisionReason(outcome, proposal) + " Propose a corrected mapping.",
    });
  }

  // Guard #3: turns ran out. That is a give-up, never a success.
  return {
    converged: false,
    iterations,
    toolCalls,
    transcript,
    reason: `no mapping round-tripped in ${maxTurns} turns`,
  };
}

function revisionReason(outcome: ParseOutcome, proposal: MappingProposal): string {
  if (outcome.kind === "unparsed") return `The parser could not place it: ${outcome.reason}.`;
  if (outcome.kind === "noClaim") {
    return proposal.claim === null
      ? "The parser agrees there is no payment."
      : "You predicted a payment but the shape read as noClaim.";
  }
  if (proposal.claim === null) return "You set claim to null but the parser extracted a payment.";
  return (
    `The parser extracted network ${JSON.stringify(outcome.claim.network)} and hash ` +
    `${JSON.stringify(outcome.claim.txHash)}, not the ${JSON.stringify(proposal.predicted.network)} ` +
    `and ${JSON.stringify(proposal.predicted.txHash)} you predicted.`
  );
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
