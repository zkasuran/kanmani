/**
 * Composing an ERC-8004 registration document and the two calls that put it on chain.
 *
 * This is the module behind `/studio`. It is pure over strings and bytes: it builds a document,
 * encodes it and returns the exact calldata an operator sends. **It never sends anything and it
 * never holds a key.** That separation is the whole design, for a reason that is not squeamishness:
 * this project publishes measurements about other people's registrations, so it must not be able to
 * manufacture one. A row we created is a row we cannot honestly measure.
 *
 * What we will do is make the operator's own registration correct, then get out of the way. The
 * calldata comes back to the caller, who signs it with a key derived from their own passkey or with
 * any wallet they already use. Nothing here is custodial.
 *
 * ## The two calls, from the spec
 *
 * The ERC-8004 Identity Registry is an ERC-721. The spec gives three registration overloads and one
 * update:
 *
 *   register(string agentURI) returns (uint256 agentId)
 *   register(string agentURI, MetadataEntry[] metadata) returns (uint256 agentId)
 *   register() returns (uint256 agentId)                  // URI added later
 *   setAgentURI(uint256 agentId, string newURI)           // owner only
 *
 * We generate the single-argument `register` and `setAgentURI`. The no-argument overload is
 * deliberately not offered: it mints an agent whose URI is empty, which is a registration that says
 * nothing about itself. Our own measurement found 80 of those already on Monad and they are the one
 * population no verifier can help.
 *
 * ## Why `data:` is the default here
 *
 * We probed all 2,012 distinct registration documents on Monad. **8,640 agents point at a document
 * whose host answered and said it is not there**, 8,093 of them sharing one expired preview
 * deployment across 7,962 wallets. Those registrations are still perfectly valid on chain, with a
 * valid owner and a valid URI and they will stay that way forever while describing nothing.
 *
 * A `data:` URI cannot 404, because there is no host to ask. It costs more gas once and then it
 * cannot rot. When we registered ourselves as agent 10252 we wrote our record into `tokenURI` as a
 * `data:` URI rather than hosting it, because publishing that measurement and then hosting our own
 * record would have been advice we do not take. The default here is the same advice.
 */

import { encodeFunctionData, type Hex } from "viem";
import { registriesFor } from "./chains.ts";

/**
 * Monad mainnet, chain 143. Kept as a named export because it is the default everywhere and every
 * number on this site is measured there.
 *
 * For any other chain use `identityRegistryFor(chainId)`, which reads the chain registry rather than
 * assuming this address. The mainnet deployments do share one address set and assuming that in code
 * would still be wrong: Monad testnet deployed elsewhere, so the assumption is false on a chain that
 * already exists.
 */
export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

/**
 * The identity registry for a chain or null when ERC-8004 is not deployed there.
 *
 * Null rather than a fallback on purpose. Handing back a plausible address for a chain with no
 * registry produces a transaction that goes somewhere real and does nothing, which is worse than a
 * refusal because it looks like it worked.
 */
export function identityRegistryFor(chainId: number): `0x${string}` | null {
  return registriesFor(chainId)?.identity ?? null;
}

/**
 * Only the two functions we generate calldata for.
 *
 * A narrow ABI on purpose. A wider one invites a future caller to encode something this module has
 * not thought about and every entry here is a transaction somebody signs with their own key.
 */
export const IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
] as const;

export type SkillDraft = {
  /** A stable identifier an agent consumer can match on. */
  id: string;
  /** Where the skill is actually callable. Empty means the skill is declared and not reachable. */
  endpoint: string;
  /** Whether that endpoint answers an x402 payment challenge. */
  x402: boolean;
  /**
   * The protocol the endpoint speaks, which ERC-8004 puts in the service `name`: "A2A" (the endpoint is
   * an agent card), "MCP", "web" or anything the author names. Defaults to "web".
   */
  protocol?: string;
  /** Protocol version, a SHOULD in the spec: "0.3.0" for A2A, "2025-06-18" for MCP. */
  version?: string;
};

export type RegistrationDraft = {
  name: string;
  description: string;
  /** The operator's own site. Not where the record is hosted, which is a separate decision. */
  url: string;
  skills: SkillDraft[];
  /**
   * What this agent refuses to do.
   *
   * Unusual in a registration document and kept because it is the most useful field we found while
   * reading 2,012 of them: a capability list says what somebody hopes, a refusal list says what
   * they have thought about. Optional and empty is fine.
   */
  refuses: string[];
  /** ERC-721 compatible image URL. Optional; ERC-8004 lists it beside name and description. */
  image?: string;
  /**
   * Where this agent is registered, as `{ agentId, agentRegistry: "eip155:<chain>:<registry>" }`. Only
   * knowable after the first registration, so it is filled in on a repoint.
   */
  registrations?: { agentId: number; agentRegistry: string }[];
  /** "reputation", "crypto-economic", "tee-attestation"... Absent means discovery only, per the spec. */
  supportedTrust?: string[];
  /** Defaults to true. An agent that stopped serving says so rather than going silent. */
  active?: boolean;
};

export const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

export const EMPTY_DRAFT: RegistrationDraft = {
  name: "",
  description: "",
  url: "",
  skills: [{ id: "", endpoint: "", x402: false }],
  refuses: [],
};

/** How the record reaches a reader. The trade is gas once against rot forever. */
export type UriKind = "data" | "https";

/* ------------------------------------------------------------------ the document */

/**
 * The record, with a fixed key order.
 *
 * Fixed rather than whatever the object literal happened to be, because the bytes are hashed by
 * everything downstream and two orders are two different documents. Empty fields are dropped rather
 * than emitted as `""`, because a field present and empty is a claim that resolved to nothing and
 * this whole project is about not making those.
 */
export function buildRecord(d: RegistrationDraft): Record<string, unknown> {
  // ERC-8004 registration-v1, in the spec's own key order: type, name, description, image, services,
  // x402Support, active, registrations, supportedTrust. `refuses` is our extension and comes last.
  const rec: Record<string, unknown> = { type: REGISTRATION_TYPE };
  if (d.name.trim()) rec.name = d.name.trim();
  if (d.description.trim()) rec.description = d.description.trim();
  if (d.image?.trim()) rec.image = d.image.trim();

  const services: Record<string, unknown>[] = [];
  let x402 = false;
  for (const sk of d.skills) {
    if (!sk.id.trim()) continue;
    const out: Record<string, unknown> = { name: (sk.protocol ?? "").trim() || "web" };
    if (sk.endpoint.trim()) out.endpoint = sk.endpoint.trim();
    if (sk.version?.trim()) out.version = sk.version.trim();
    out.skills = [sk.id.trim()];
    if (sk.x402) {
      // `x402: true` on the service is what indexers in the wild (ours included) read; x402Support at
      // the top is the spec's own flag. Both are written so neither kind of reader misses it.
      out.x402 = true;
      x402 = true;
    }
    services.push(out);
  }
  const url = d.url.trim();
  if (url && !services.some((x) => x.endpoint === url)) services.push({ name: "web", endpoint: url });
  if (services.length) rec.services = services;
  rec.x402Support = x402;
  rec.active = d.active ?? true;

  const regs = (d.registrations ?? []).filter((r) => Number.isInteger(r.agentId) && r.agentId > 0 && /^eip155:\d+:0x[0-9a-fA-F]{40}$/.test(r.agentRegistry));
  if (regs.length) rec.registrations = regs.map((r) => ({ agentId: r.agentId, agentRegistry: r.agentRegistry }));
  const trust = (d.supportedTrust ?? []).map((t) => t.trim()).filter(Boolean);
  if (trust.length) rec.supportedTrust = trust;

  const refuses = d.refuses.map((r) => r.trim()).filter(Boolean);
  if (refuses.length) rec.refuses = refuses;

  return rec;
}

/** The document as the bytes that go on chain. Two-space indent, stable, readable in a block explorer. */
export function recordJson(d: RegistrationDraft): string {
  return JSON.stringify(buildRecord(d), null, 2);
}

/** UTF-8 length, which is what storage is paid for, not `string.length`. */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * base64 without `Buffer`.
 *
 * `Buffer` is a Node global and this module is imported by a client component. A bundler that
 * polyfills it today is a dependency on a build setting rather than on the language and the failure
 * mode is the worst kind: green in Node, throws in the browser. The project already fixed this class
 * of bug once in `lib/iris.ts`; it is not being reintroduced here.
 */
function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The record as a `data:` URI, which is the form that cannot 404. */
export function dataUri(json: string): string {
  return `data:application/json;base64,${toBase64(json)}`;
}

/** The agentURI that would actually go on chain, for either hosting choice. */
export function agentUri(d: RegistrationDraft, kind: UriKind, hostedAt = ""): string {
  return kind === "data" ? dataUri(recordJson(d)) : hostedAt.trim();
}

/* ------------------------------------------------------------------ the calldata */

/** `register(string agentURI)`. The caller signs and sends this; we never do. */
export function registerCalldata(agentURI: string): Hex {
  return encodeFunctionData({ abi: IDENTITY_ABI, functionName: "register", args: [agentURI] });
}

/** `setAgentURI(uint256 agentId, string newURI)`. Owner only, enforced by the registry. */
export function setAgentUriCalldata(agentId: bigint, newURI: string): Hex {
  return encodeFunctionData({
    abi: IDENTITY_ABI,
    functionName: "setAgentURI",
    args: [agentId, newURI],
  });
}

/* ------------------------------------------------------------------ consequences */

/**
 * What this document would mean, field by field.
 *
 * The plan's rule for this form is that it is progressive and never a wall, with each field showing
 * its consequence live. So this returns the consequences rather than a score: an operator should be
 * able to see that adding an endpoint moves them a rung, without us ranking them.
 *
 * `met` is deliberately a boolean about the DOCUMENT, never about the operator. Nothing here is a
 * verdict: a verdict requires reading a chain and this document has not been on one yet.
 */
export type Consequence = { label: string; met: boolean; why: string };

export function consequences(d: RegistrationDraft, kind: UriKind, hostedAt = ""): Consequence[] {
  const rec = buildRecord(d);
  const skills = ((rec.services as { name?: string; endpoint?: string; x402?: boolean; skills?: string[] }[] | undefined) ?? []).filter((s) => s.skills);
  const reachable = skills.filter((s) => s.endpoint);
  const uri = agentUri(d, kind, hostedAt);

  return [
    {
      label: "describes itself",
      met: Boolean(rec.name && rec.description),
      why: "A name and a description. Without them the registration is a token with an owner and nothing a buyer can read.",
    },
    {
      label: "cannot return a deletion",
      met: kind === "data",
      why:
        kind === "data"
          ? "A data: URI has no host to ask, so it cannot 404. 8,640 agents on Monad point at a document whose host says it is not there."
          : "A hosted document can stop answering. It is a valid choice and it is the failure mode we measured most.",
    },
    {
      label: "has a callable endpoint",
      met: reachable.length > 0,
      why:
        reachable.length > 0
          ? "A skill with an endpoint can be probed, which is the difference between a declared capability and a reachable one."
          : "Every skill here is declared and not reachable. Fewer than one Monad agent in three hundred publishes an http endpoint at all: kanmani.xyz/agents shows the live count.",
    },
    {
      label: "follows ERC-8004 registration-v1",
      met: rec.type === REGISTRATION_TYPE && Boolean(rec.name && rec.description) && skills.length > 0,
      why: "type, name, description and services in the spec's shape, so any ERC-8004 reader finds the endpoints without guessing which key an author used.",
    },
    {
      label: "names its protocol",
      met: reachable.length > 0 && reachable.every((s) => s.name && s.name !== "web"),
      why: "A service named A2A or MCP tells a broker how to call it. A bare URL makes every caller guess, which is how most probes of Monad agents fail.",
    },
    {
      label: "points back to its registration",
      met: Array.isArray(rec.registrations) && (rec.registrations as unknown[]).length > 0,
      why: "registrations: [{ agentId, agentRegistry }] lets a reader who found the document confirm which on-chain agent it belongs to. Only knowable after the first registration.",
    },
    {
      label: "declares a trust model",
      met: Array.isArray(rec.supportedTrust) && (rec.supportedTrust as unknown[]).length > 0,
      why: "Without supportedTrust, the spec says the registration is for discovery only, not trust.",
    },
    {
      label: "can take a payment",
      met: skills.some((s) => s.x402 === true),
      why: "An endpoint that answers an x402 challenge can be paid by any agent with USDC, no account needed. Linter at kanmani.xyz/hire checks the challenge is settleable.",
    },
    {
      label: "asserts no payment it has not received",
      met: !/proof_of_payment|payment_tx|\banchored\b/i.test(recordJson(d)),
      why: "A registration document is not the place for a payment claim. 73 of the 85 payment claims on Monad cite a transaction that is not on the chain they name. Ours asserts none.",
    },
    {
      label: "fits on chain",
      met: uri.length > 0 && byteLength(uri) <= 65_536,
      why: "Our verifier caps a fetched document at 65,536 bytes, so a record above that cannot be read back by the thing that checks it.",
    },
  ];
}

/** A blocking problem, as opposed to a consequence. Returns an empty array when the draft can ship. */
export function problems(d: RegistrationDraft, kind: UriKind, hostedAt = ""): string[] {
  const out: string[] = [];
  const rec = buildRecord(d);
  if (!rec.name) out.push("A name is required. A record with no name describes nothing.");
  if (kind === "https") {
    const at = hostedAt.trim();
    if (!at) out.push("Choose a URL for the hosted document. Or switch to data: and put it on chain.");
    else if (!/^https:\/\/\S+$/.test(at)) out.push("The hosted URL must be absolute and https.");
  }
  const uri = agentUri(d, kind, hostedAt);
  if (uri && byteLength(uri) > 65_536) {
    out.push(`The URI is ${byteLength(uri).toLocaleString()} bytes, over the 65,536 byte cap a reader will apply.`);
  }
  return out;
}

/* ------------------------------------------------------------------ adopting what exists */

/**
 * Turn a document that is already on chain into an editable draft.
 *
 * This is the load-bearing half of "Door A" from the plan: an operator should land on **their own data,
 * already measured**, not on an empty form. Retyping a record you already published is the friction that
 * makes a one-field fix feel like a project.
 *
 * Deliberately lossy in one direction and honest about it. Fields this editor does not model,
 * anything an operator invented and any malformed registrations list, are preserved in
 * `carried` and written back out unchanged by `buildRecordPreserving`. Dropping somebody's fields
 * because our form has no input for them would be a worse edit than the one they came to make.
 */
export type Adopted = {
  draft: RegistrationDraft;
  /** Fields we parsed but do not edit, written back unchanged. */
  carried: Record<string, unknown>;
  /** True when the source was a `data:` URI, so it had no host to ask. */
  wasOnChain: boolean;
};

const EDITED_KEYS = new Set(["type", "name", "description", "image", "url", "skills", "services", "x402Support", "active", "registrations", "supportedTrust", "refuses"]);

/**
 * Decode a `data:` URI, base64 or percent-encoded.
 *
 * Both appear in the live corpus: most are base64 and a few are plain percent-encoded JSON, so a reader
 * that only handles one silently fails on real records.
 */
export function decodeDataUri(uri: string): string | null {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma === -1) return null;
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      const bin = atob(payload);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/** Parse a registration document into a draft plus the fields we do not edit. */
export function adopt(json: string, wasOnChain: boolean): Adopted | null {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;

  // Skills appear under several names in the wild. `services` is what Monad's own Agent Hub writes and
  // `endpoints` is what the ERC-8004 examples use, so a reader that only knows `skills` adopts nothing
  // from most real records.
  const isV1 = o.type === REGISTRATION_TYPE;
  const siteService = isV1 && Array.isArray(o.services)
    ? (o.services as Record<string, unknown>[]).find((x) => x && x.name === "web" && !Array.isArray(x.skills) && !x.id)
    : undefined;
  const regsValid =
    Array.isArray(o.registrations) &&
    (o.registrations as unknown[]).every((r) => {
      const x = r as { agentId?: unknown; agentRegistry?: unknown };
      return Number.isInteger(x?.agentId) && typeof x?.agentRegistry === "string" && /^eip155:\d+:0x[0-9a-fA-F]{40}$/.test(x.agentRegistry);
    });
  const rawSkills =
    (Array.isArray(o.skills) && o.skills) ||
    (Array.isArray(o.services) && o.services) ||
    (Array.isArray(o.endpoints) && o.endpoints) ||
    [];

  const skills: SkillDraft[] = (rawSkills as Record<string, unknown>[])
    .filter((x) => x && typeof x === "object")
    // In a registration-v1 document our builder writes the operator site as a plain `web` service with
    // no skills. That is the draft's url, not a skill or a round trip would turn it into one.
    .filter((x) => !(isV1 && x.name === "web" && !Array.isArray(x.skills) && !x.id))
    .map((x) => ({
      // A registration-v1 service carries its skill ids in `skills` and its protocol in `name`.
      id: String((Array.isArray(x.skills) ? x.skills[0] : undefined) ?? x.id ?? x.name ?? "").trim(),
      endpoint: String(x.endpoint ?? x.url ?? "").trim(),
      protocol: Array.isArray(x.skills) && typeof x.name === "string" ? x.name : undefined,
      version: typeof x.version === "string" ? x.version : undefined,
      // x402 is declared several ways. Any of them counts as declared; none of them is a measurement.
      x402:
        x.payment === "x402" ||
        x.x402 === true ||
        x.x402Support === true ||
        x.x402support === true ||
        o.x402Support === true ||
        o.x402support === true,
    }))
    .filter((x) => x.id || x.endpoint);

  const carried: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    // A malformed registrations list is carried verbatim: rewriting someone's entry into a shape it
    // did not have would be an edit they did not make.
    if (k === "registrations" && !regsValid) carried[k] = v;
    else if (!EDITED_KEYS.has(k) && k !== "services" && k !== "endpoints") carried[k] = v;
  }

  return {
    draft: {
      name: String(o.name ?? "").trim(),
      description: String(o.description ?? "").trim(),
      url: String(o.url ?? siteService?.endpoint ?? "").trim(),
      skills: skills.length ? skills : [{ id: "", endpoint: "", x402: false }],
      refuses: Array.isArray(o.refuses) ? o.refuses.map(String) : [],
      image: typeof o.image === "string" ? o.image : undefined,
      registrations: regsValid ? (o.registrations as { agentId: number; agentRegistry: string }[]) : undefined,
      supportedTrust: Array.isArray(o.supportedTrust) ? o.supportedTrust.map(String) : undefined,
      active: typeof o.active === "boolean" ? o.active : undefined,
    },
    carried,
    wasOnChain,
  };
}

/**
 * Build the record for an adopted document, keeping the fields we never modelled.
 *
 * Key order puts our edited fields first and the carried ones after, so a diff between the old and new
 * document is readable rather than a reshuffle.
 */
export function buildRecordPreserving(d: RegistrationDraft, carried: Record<string, unknown>): Record<string, unknown> {
  return { ...buildRecord(d), ...carried };
}

export function recordJsonPreserving(d: RegistrationDraft, carried: Record<string, unknown>): string {
  return JSON.stringify(buildRecordPreserving(d, carried), null, 2);
}
