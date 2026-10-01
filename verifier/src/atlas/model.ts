/**
 * The model seam for the atlas induction loop.
 *
 * The loop never talks to a network directly. It talks to a `ChatClient`, which is an
 * OpenAI-compatible chat-completions surface: messages in, one assistant message out, tools
 * offered on the way. The real one (`qwen.ts`) posts to Alibaba Cloud Model Studio. The test one
 * (`induce.test.ts`) is a scripted list of replies. Because the seam is the whole boundary, the
 * orchestration is tested with no key, no network and a deterministic model.
 *
 * The shapes below are the subset of the OpenAI chat schema the loop uses, named exactly as the
 * wire uses them so the real client is a pass-through rather than a translation layer.
 */

import type { ParseOutcome } from "../ladder/parse.ts";

export type Role = "system" | "user" | "assistant" | "tool";

/** One tool invocation the model asked for. `arguments` is a JSON string, as OpenAI sends it. */
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: Role;
  content: string | null;
  /** Present on an assistant turn that calls tools. */
  tool_calls?: ToolCall[];
  /** Present on a tool turn, echoing the call it answers. */
  tool_call_id?: string;
  /** The tool name, on a tool turn. */
  name?: string;
};

export type ToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    /** JSON schema for the arguments. */
    parameters: Record<string, unknown>;
  };
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } };
  temperature?: number;
};

export type ChatResponse = { message: ChatMessage };

export interface ChatClient {
  /** Names the model in the transcript, e.g. "qwen3.8-max" or "scripted-fake". */
  readonly label: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

/* --------------------------------------------------------------- the tool the model proposes */

/** Where a payment field lives inside a document, as a dotted path like "proof_of_payment.tx". */
export type ClaimPaths = {
  networkPath?: string;
  txHashPath?: string;
  recipientPath?: string;
  payerPath?: string;
  amountPath?: string;
  tokenPath?: string;
};

/**
 * A candidate mapping, exactly as the model hands it to the `try_mapping` tool. It is declarative
 * on purpose: paths, not code. The loop compiles it and runs it through the real parser, so the
 * model never emits anything executed as code and a wrong proposal costs a retry, never a wrong
 * verdict.
 */
export type MappingProposal = {
  name: string;
  note: string;
  /** Keys that must all be present for this mapping to claim the document. */
  matchKeys: string[];
  /** null means the model asserts this shape carries no payment (a noClaim shape). */
  claim: ClaimPaths | null;
  /** The model's own reading, checked against what the parser actually extracts. */
  predicted: { network?: unknown; txHash?: unknown };
};

/* ------------------------------------------------------------------- what the loop records */

/** An induced mapping, carrying its date the way the shipped atlas entries carry theirs. */
export type InducedMapping = {
  name: string;
  /** YYYY-MM-DD, the same field the shipped ATLAS mappings use. */
  induced: string;
  note: string;
  kind: "claim" | "noClaim";
  proposal: MappingProposal;
  /** Which model induced it, so the record says where it came from. */
  inducedBy: string;
};

export type TranscriptStep =
  | { at: number; kind: "propose"; by: string; proposal: MappingProposal }
  | { at: number; kind: "tool"; name: string; outcome: ParseOutcome }
  | { at: number; kind: "decision"; verdict: "accept" | "revise" | "give-up"; reason: string };

export type InductionResult = {
  converged: boolean;
  /** Set only when converged. */
  mapping?: InducedMapping;
  /** Model turns taken. */
  iterations: number;
  /** Times the parser ran as a tool. */
  toolCalls: number;
  transcript: TranscriptStep[];
  /** Set only when not converged. */
  reason?: string;
};
