/**
 * The build kit's core: check a registration, check an evidence document.
 *
 * Every surface that helps someone build an agent (the HTTP API, the MCP server, the studio) answers
 * through these two functions, so a coding agent, a no-code flow and a person in the studio are told
 * the same thing about the same draft. A second, simpler copy "for machines" is how two surfaces end
 * up disagreeing.
 *
 * ## What neither function does
 *
 * Neither takes a key or signs anything. Registration returns the exact calldata; the builder signs it
 * with their own key. Evidence checking never fetches a URL: it takes the document itself (JSON or a
 * `data:` URI). A free endpoint that fetched arbitrary URLs would be a proxy for hitting other people's
 * servers from ours. Checking a hosted document already exists as the paid `/api/verify`.
 */
import {
  agentUri,
  byteLength,
  consequences,
  identityRegistryFor,
  problems,
  recordJson,
  registerCalldata,
  setAgentUriCalldata,
  type Consequence,
  type RegistrationDraft,
  type UriKind,
} from "./registration.ts";

/* ------------------------------------------------------------------ input parsing */

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const s = (v: unknown, max = 2000): string => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Accept a draft from a caller that is probably a language model.
 *
 * Lenient on shape where intent is unambiguous (a single skill object instead of a list, `x402` as the
 * string "true"), strict where a guess would change what gets registered (unknown `kind`, a non-integer
 * agent id). Every refusal says which field and why, because the caller will retry with the message.
 */
export function parseRegistrationInput(body: unknown): Parsed<{
  draft: RegistrationDraft;
  kind: UriKind;
  hostedAt: string;
  chainId: number;
  agentId: bigint | null;
  sender: `0x${string}` | null;
}> {
  const errors: string[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = body as Record<string, unknown>;
  const d = (b.draft ?? b) as Record<string, unknown>;

  const rawSkills = Array.isArray(d.skills) ? d.skills : d.skills && typeof d.skills === "object" ? [d.skills] : [];
  if (rawSkills.length > 32) errors.push("skills: at most 32");
  const skills = rawSkills.slice(0, 32).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      id: s(o.id, 200),
      endpoint: s(o.endpoint, 2000),
      x402: o.x402 === true || o.x402 === "true",
      ...(o.protocol ? { protocol: s(o.protocol, 40) } : {}),
      ...(o.version ? { version: s(o.version, 40) } : {}),
    };
  });
  const refuses = Array.isArray(d.refuses) ? d.refuses.slice(0, 32).map((x) => s(x, 500)).filter(Boolean) : [];
  const supportedTrust = Array.isArray(d.supportedTrust) ? d.supportedTrust.slice(0, 8).map((x) => s(x, 60)).filter(Boolean) : undefined;
  let registrations: { agentId: number; agentRegistry: string }[] | undefined;
  if (Array.isArray(d.registrations)) {
    registrations = [];
    for (const r of d.registrations.slice(0, 16) as Record<string, unknown>[]) {
      const id = Number(r?.agentId);
      const reg = String(r?.agentRegistry ?? "");
      if (!Number.isInteger(id) || id <= 0 || !/^eip155:\d+:0x[0-9a-fA-F]{40}$/.test(reg)) {
        errors.push('registrations: each entry is { agentId: <positive integer>, agentRegistry: "eip155:<chain>:<registry address>" }');
        break;
      }
      registrations.push({ agentId: id, agentRegistry: reg });
    }
  }
  const image = d.image === undefined ? undefined : s(d.image, 2000);
  if (image && !/^(https:\/\/|ipfs:\/\/|data:image\/)\S+$/.test(image)) errors.push("image: an https://, ipfs:// or data:image/ URL");

  const kind = (b.kind ?? "data") as string;
  if (kind !== "data" && kind !== "https") errors.push('kind: "data" (on chain, cannot go dead) or "https" (hosted by you)');

  const chainId = b.chainId === undefined ? 143 : Number(b.chainId);
  if (!Number.isInteger(chainId) || !identityRegistryFor(chainId)) errors.push(`chainId: ${String(b.chainId)} has no ERC-8004 identity registry here. Use 143 (Monad).`);

  let agentId: bigint | null = null;
  if (b.agentId !== undefined && b.agentId !== null && b.agentId !== "") {
    if (!/^\d+$/.test(String(b.agentId))) errors.push("agentId: a positive integer, only when repointing an agent you own");
    else agentId = BigInt(String(b.agentId));
  }

  let sender: `0x${string}` | null = null;
  if (b.sender !== undefined && b.sender !== null && b.sender !== "") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(b.sender))) errors.push("sender: a 20-byte hex address");
    else sender = String(b.sender).toLowerCase() as `0x${string}`;
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      draft: {
        name: s(d.name, 200),
        description: s(d.description, 4000),
        url: s(d.url, 2000),
        skills,
        refuses,
        ...(image ? { image } : {}),
        ...(registrations?.length ? { registrations } : {}),
        ...(supportedTrust?.length ? { supportedTrust } : {}),
        ...(typeof d.active === "boolean" ? { active: d.active } : {}),
      },
      kind: kind as UriKind,
      hostedAt: s(b.hostedAt, 2000),
      chainId,
      agentId,
      sender,
    },
  };
}

/* ------------------------------------------------------------------ registration */

export type RegistrationReport = {
  ready: boolean;
  problems: string[];
  consequences: Consequence[];
  /** The registration document exactly as it will be committed. */
  document: Record<string, unknown>;
  agentURI: string;
  uriBytes: number;
  transaction: {
    chainId: number;
    to: `0x${string}`;
    function: "register(string)" | "setAgentURI(uint256,string)";
    data: `0x${string}`;
    value: "0";
  } | null;
  /** How to send it, for the tools people actually use. Never involves us holding a key. */
  send: { cast: string; viem: string } | null;
  next: string[];
};

export function checkRegistration(input: {
  draft: RegistrationDraft;
  kind: UriKind;
  hostedAt: string;
  chainId: number;
  agentId: bigint | null;
}): RegistrationReport {
  const probs = problems(input.draft, input.kind, input.hostedAt);
  const cons = consequences(input.draft, input.kind, input.hostedAt);
  const uri = agentUri(input.draft, input.kind, input.hostedAt);
  const to = identityRegistryFor(input.chainId)!;
  const ready = probs.length === 0 && uri !== "";

  let transaction: RegistrationReport["transaction"] = null;
  if (ready) {
    transaction =
      input.agentId === null
        ? { chainId: input.chainId, to, function: "register(string)", data: registerCalldata(uri), value: "0" }
        : { chainId: input.chainId, to, function: "setAgentURI(uint256,string)", data: setAgentUriCalldata(input.agentId, uri), value: "0" };
  }
  const rpc = input.chainId === 143 ? "https://rpc.monad.xyz" : "<rpc url>";

  return {
    ready,
    problems: probs,
    consequences: cons,
    document: JSON.parse(recordJson(input.draft)) as Record<string, unknown>,
    agentURI: uri,
    uriBytes: byteLength(uri),
    transaction,
    send: transaction
      ? {
          // The raw calldata, so the command sends exactly the bytes this report was built over.
          cast: `cast send ${to} ${transaction.data} --rpc-url ${rpc} --private-key "$AGENT_PRIVATE_KEY"`,
          viem: `await walletClient.sendTransaction({ to: "${to}", data: "${transaction.data.slice(0, 18)}…", chain: monad })`,
        }
      : null,
    next: ready
      ? [
          "Sign and send `transaction` from the agent's own key. Whoever sends it becomes the owner, so it cannot be relayed or sent by us.",
          "Read the new agent id from the Transfer log of the receipt (topic 3). https://kanmani.xyz/api/account/<sender> lists it too.",
          "Once indexed (usually under a minute), https://kanmani.xyz/api/agent/<id> shows what we measure about it.",
        ]
      : ["Fix every item in `problems`, then check again."],
  };
}

/* ------------------------------------------------------------------ evidence */

export type EvidenceInput = { dataUri: string } | { error: string };

/**
 * Turn whatever the caller sent into a `data:` URI the judge can read with no network.
 *
 * Accepts the document as an object, as a JSON string or as a `data:` URI. Refuses a URL by name and
 * points to the paid check, so a caller never believes a hosted document was fetched when it was not.
 */
export function evidenceInput(body: unknown): EvidenceInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "body must be a JSON object with `document`" };
  const doc = (body as Record<string, unknown>).document;
  if (doc === undefined || doc === null) return { error: "`document` is required: the evidence document itself, as JSON or a data: URI" };
  if (typeof doc === "string") {
    const t = doc.trim();
    if (/^(https?|ipfs):\/\//i.test(t)) {
      return { error: "This free check does not fetch URLs. Send the document itself. To check a hosted one, pay POST /api/verify with {\"uri\": ...} to check a hosted one." };
    }
    if (t.startsWith("data:")) return t.length > 200_000 ? { error: "document is over 200,000 characters" } : { dataUri: t };
    try {
      JSON.parse(t);
    } catch {
      return { error: "`document` is a string that is neither JSON nor a data: URI" };
    }
    return toDataUri(t);
  }
  if (typeof doc === "object") return toDataUri(JSON.stringify(doc));
  return { error: "`document` must be an object, a JSON string or a data: URI" };
}

function toDataUri(json: string): EvidenceInput {
  if (json.length > 200_000) return { error: "document is over 200,000 characters" };
  return { dataUri: `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}` };
}

/** What to do about a verdict, for the author of the document rather than for a buyer. */
export function adviceFor(v: { outcome: string | null; rung: string; reason: string; declaredNetwork?: string; foundOnChain?: unknown }, elsewhere: string | null): string[] {
  switch (v.outcome) {
    case "true":
      return ["This document would check out: the cited payment is on the chain it names and reached the recipient it names."];
    case "noClaim":
      return [
        "This document asserts no payment, so there is nothing to check and nothing to fail.",
        "If it describes paid work, add the payment: the network it settled on, the transaction hash and the recipient.",
      ];
    case "false":
      return elsewhere
        ? [elsewhere, `Change the network field from "${v.declaredNetwork ?? "?"}" to the chain named above. That one edit turns this into a checkable claim.`]
        : [
            "The cited transaction is not on the chain this document names.",
            "Check the network field matches where the payment actually settled. The hash must be the settlement transaction, not an approval or a bridge leg.",
          ];
    default:
      return [`Undecided: ${v.reason}`, "unknown means we could not decide, which is not the same as false."];
  }
}
