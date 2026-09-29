/**
 * Doctor and Linter: what an endpoint's answers mean for a broker, a client and a facilitator. Pure.
 *
 * Every finding names what was expected, what came back and the fix. Nothing is scored: an endpoint
 * either speaks a protocol or it does not. "Sort of" is how our own agents stayed unhireable.
 */
import type { ProbeResult } from "../verifier/src/net/probe.ts";

export type Finding = { check: string; ok: boolean | null; saw: string; fix: string | null };

const json = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    // An SSE answer from a streamable-HTTP MCP server: take the first data line.
    const m = s.match(/^data:\s*(\{.*\})\s*$/m);
    if (m) {
      try {
        return JSON.parse(m[1]!);
      } catch {}
    }
    return null;
  }
};
const reached = (r: ProbeResult) => (r.ok ? `HTTP ${r.status} in ${r.ms}ms` : `no answer: ${r.reason}`);

export function diagnose(p: { a2a: ProbeResult; mcp: ProbeResult; get: ProbeResult }) {
  const out: Finding[] = [];

  // A2A message/send
  {
    const r = p.a2a;
    const j = r.ok ? (json(r.body) as Record<string, unknown> | null) : null;
    const res = j?.result as { kind?: string; status?: { state?: string; message?: { metadata?: Record<string, unknown> } } } | undefined;
    const rpcErr = j?.error as { code?: number; message?: string } | undefined;
    if (!r.ok) out.push({ check: "A2A message/send", ok: false, saw: reached(r), fix: "Make the endpoint reachable over HTTPS from the public internet." });
    else if (j?.jsonrpc === "2.0" && res && (res.kind === "task" || res.kind === "message"))
      out.push({ check: "A2A message/send", ok: true, saw: `a ${res.kind}${res.status?.state ? ` in ${res.status.state}` : ""}`, fix: null });
    else if (j?.jsonrpc === "2.0" && rpcErr)
      out.push({ check: "A2A message/send", ok: false, saw: `JSON-RPC error ${rpcErr.code}: ${String(rpcErr.message).slice(0, 80)}`, fix: "Answer message/send with a Task or Message result. A broker that gets an error marks the agent not hireable." });
    else
      out.push({ check: "A2A message/send", ok: false, saw: `${reached(r)} but not a JSON-RPC 2.0 reply`, fix: "Accept POST {jsonrpc:'2.0', method:'message/send'} and reply {jsonrpc:'2.0', id, result:{kind:'task', ...}}. Taifoon's readiness probe rejects anything else." });

    const meta = res?.status?.message?.metadata;
    if (meta && meta["x402.payment.status"] === "payment-required") {
      const req = meta["x402.payment.required"] as { accepts?: unknown[] } | undefined;
      out.push({
        check: "A2A x402 extension",
        ok: Array.isArray(req?.accepts) && req!.accepts.length > 0,
        saw: `payment-required with ${Array.isArray(req?.accepts) ? req!.accepts.length : 0} accepted option(s)${r.ok && r.headers.a2aExtensions ? ", extension header echoed" : ""}`,
        fix: Array.isArray(req?.accepts) && req!.accepts.length ? null : "Put the accepted PaymentRequirements in x402.payment.required.accepts.",
      });
    }
  }

  // MCP initialize
  {
    const r = p.mcp;
    const j = r.ok ? (json(r.body) as Record<string, unknown> | null) : null;
    const res = j?.result as { protocolVersion?: string; serverInfo?: { name?: string }; capabilities?: Record<string, unknown> } | undefined;
    if (r.ok && res?.protocolVersion)
      out.push({ check: "MCP initialize", ok: true, saw: `protocol ${res.protocolVersion}, server ${res.serverInfo?.name ?? "unnamed"}, capabilities ${Object.keys(res.capabilities ?? {}).join(", ") || "none"}`, fix: null });
    else
      out.push({ check: "MCP initialize", ok: null, saw: r.ok ? `${reached(r)}, not an MCP initialize result` : reached(r), fix: "Optional. Serve MCP over streamable HTTP if coding agents and frameworks should call you as tools." });
  }

  // Plain GET: a human or a probe opening the URL
  {
    const r = p.get;
    if (!r.ok) out.push({ check: "GET", ok: false, saw: reached(r), fix: "Answer GET with a description or a 402 challenge, so a browser or crawler learns what this is." });
    else if (r.status === 402) out.push({ check: "GET", ok: true, saw: `402 payment required${r.headers.wwwAuthenticate ? `, www-authenticate: ${r.headers.wwwAuthenticate.slice(0, 40)}` : ""}`, fix: null });
    else if (r.status >= 200 && r.status < 300) out.push({ check: "GET", ok: true, saw: `HTTP ${r.status}, ${r.headers.contentType ?? "no content type"}`, fix: null });
    else if (r.status === 405) out.push({ check: "GET", ok: null, saw: "405 method not allowed", fix: "Consider answering GET with what the endpoint does and costs. Probes and people open URLs." });
    else out.push({ check: "GET", ok: false, saw: `HTTP ${r.status}`, fix: "A non-2xx, non-402 GET reads as broken to directories." });
    if (r.ok && r.ms > 3000) out.push({ check: "latency", ok: false, saw: `${r.ms}ms to answer`, fix: "Brokers time probes out at a few seconds; answer the handshake before doing slow work." });
  }

  const a2aOk = out.find((f) => f.check === "A2A message/send")?.ok === true;
  const mcpOk = out.find((f) => f.check === "MCP initialize")?.ok === true;
  return {
    hireable: a2aOk || mcpOk,
    speaks: [a2aOk ? "a2a" : null, mcpOk ? "mcp" : null].filter(Boolean),
    findings: out,
  };
}

const USDC6 = new Set(["0x754704bc059f8c67012fed69bc8a327a5aafb603", "0x534b2f3a21130d7a60830c2df862319e593943a3"]);

export function lintChallenge(p: { get: ProbeResult; post: ProbeResult; supported: { kinds?: { scheme?: string; network?: string }[] } | null }) {
  const out: Finding[] = [];
  const pick = [p.post, p.get].find((r) => r.ok && r.status === 402);
  if (!pick || !pick.ok) {
    const saw = [p.get, p.post].map((r, i) => `${i ? "POST" : "GET"} ${r.ok ? `HTTP ${r.status}` : r.reason}`).join(", ");
    return { challenge: null, findings: [{ check: "402 challenge", ok: false, saw, fix: "A paid endpoint answers an unpaid request with HTTP 402 and a v2 challenge body." }] };
  }
  let body = json(pick.body) as Record<string, unknown> | null;
  if (!body && pick.headers.paymentRequired) {
    try {
      body = JSON.parse(Buffer.from(pick.headers.paymentRequired, "base64").toString("utf8"));
    } catch {}
  }
  if (!body) return { challenge: null, findings: [{ check: "402 challenge", ok: false, saw: "402 without a JSON body or PAYMENT-REQUIRED header", fix: "Send the challenge as JSON (x402 v2 §5.1) or base64 in the PAYMENT-REQUIRED header." }] };

  const v = body.x402Version;
  out.push({ check: "x402Version", ok: v === 2 ? true : v === 1 ? null : false, saw: String(v), fix: v === 2 ? null : v === 1 ? "v1 still works with some clients; the Monad facilitator only speaks v2." : "Set x402Version to 2." });
  const accepts = Array.isArray(body.accepts) ? (body.accepts as Record<string, unknown>[]) : [];
  out.push({ check: "accepts", ok: accepts.length > 0, saw: `${accepts.length} option(s)`, fix: accepts.length ? null : "List at least one PaymentRequirements object in accepts." });
  if (v === 2 && !body.resource) out.push({ check: "resource", ok: false, saw: "missing", fix: "v2 carries resource {url, description, mimeType} beside accepts, not inside each option." });

  accepts.forEach((a, n) => {
    const tag = `accepts[${n}]`;
    const scheme = String(a.scheme ?? "");
    const network = String(a.network ?? "");
    const asset = String(a.asset ?? "").toLowerCase();
    const amount = String(a.amount ?? a.maxAmountRequired ?? "");
    out.push({ check: `${tag}.scheme`, ok: scheme === "exact" || scheme === "upto", saw: scheme || "missing", fix: scheme === "exact" || scheme === "upto" ? null : "Use exact or upto." });
    out.push({ check: `${tag}.network`, ok: /^eip155:\d+$/.test(network), saw: network || "missing", fix: /^eip155:\d+$/.test(network) ? null : 'v2 networks are CAIP-2, e.g. "eip155:143" for Monad, not "monad".' });
    out.push({ check: `${tag}.amount`, ok: /^[1-9]\d*$/.test(amount), saw: amount || "missing", fix: /^[1-9]\d*$/.test(amount) ? null : "amount is a positive integer string in the token's atomic units." });
    if (USDC6.has(asset) && /^\d+$/.test(amount) && amount.length > 12)
      out.push({ check: `${tag}.decimals`, ok: false, saw: `${amount} atomic units of a 6-decimal USDC is ${BigInt(amount) / 1_000_000n} USDC`, fix: "USDC on Monad has 6 decimals. An amount written for 18 decimals asks for a million times the price." });
    else if (USDC6.has(asset)) out.push({ check: `${tag}.asset`, ok: true, saw: `USDC (6 decimals), ${/^\d+$/.test(amount) ? `${Number(amount) / 1e6} USDC` : "?"}`, fix: null });
    else out.push({ check: `${tag}.asset`, ok: null, saw: asset || "missing", fix: "Not a USDC address we know. Check its decimals and EIP-712 domain name by reading the token." });
    const extra = (a.extra ?? {}) as { name?: string; version?: string; facilitatorAddress?: string };
    if (USDC6.has(asset) && scheme === "exact") out.push({ check: `${tag}.extra.name`, ok: extra.name === "USDC", saw: String(extra.name), fix: extra.name === "USDC" ? null : 'Monad USDC signs under the EIP-712 name "USDC", not "USD Coin". A wrong name can never settle.' });
    if (scheme === "upto") out.push({ check: `${tag}.extra.facilitatorAddress`, ok: /^0x[0-9a-fA-F]{40}$/.test(String(extra.facilitatorAddress)), saw: String(extra.facilitatorAddress ?? "missing"), fix: /^0x[0-9a-fA-F]{40}$/.test(String(extra.facilitatorAddress)) ? null : "upto needs extra.facilitatorAddress from the facilitator's /supported, for the Permit2 witness." });
    out.push({ check: `${tag}.payTo`, ok: /^0x[0-9a-fA-F]{40}$/.test(String(a.payTo ?? "")), saw: String(a.payTo ?? "missing"), fix: /^0x[0-9a-fA-F]{40}$/.test(String(a.payTo ?? "")) ? null : "payTo is the recipient's 20-byte address." });
    if (p.supported?.kinds) {
      const k = p.supported.kinds.some((x) => x.scheme === scheme && x.network === network);
      out.push({ check: `${tag}.facilitator`, ok: k, saw: k ? `Monad facilitator settles ${scheme} on ${network}` : `Monad facilitator does not list ${scheme} on ${network}`, fix: k ? null : "Settle through a facilitator that supports this pair. Otherwise pick one the Monad facilitator lists." });
    }
  });
  return { challenge: { status: pick.status, x402Version: v ?? null, options: accepts.length }, findings: out, ok: out.every((f) => f.ok !== false) };
}

/** Every endpoint a registration document declares, under whichever key its author used. */
export function endpointsIn(bytes: Uint8Array): string[] {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const list of [d.skills, d.services, d.endpoints]) {
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      if (typeof x === "string") out.push(x);
      else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        for (const k of ["endpoint", "url", "uri"]) if (typeof o[k] === "string") out.push(o[k] as string);
      }
    }
  }
  return out;
}

