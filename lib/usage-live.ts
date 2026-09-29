/**
 * Counts the access log cannot see, because they are inside request bodies: which MCP tool was
 * called, which MCP client announced itself, which agentURI a registration check produced.
 *
 * Buffered in memory and written every 30 seconds as additions, so a burst costs one query per key.
 * Losing a buffer on restart undercounts by at most 30 seconds, which is the honest direction to err.
 * Nothing about the caller is kept: a tool name, a client's self-declared product name, a URI hash.
 */
import { createHash } from "node:crypto";
import { q } from "./db.ts";

type Buf = { events: Map<string, number>; clients: Map<string, number>; uris: Map<string, number>; timer?: ReturnType<typeof setInterval> };
const g = globalThis as unknown as { __kanmaniUsage?: Buf };
const buf: Buf = (g.__kanmaniUsage ??= { events: new Map(), clients: new Map(), uris: new Map() });

const today = () => new Date().toISOString().slice(0, 10);
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export function countEvent(name: string) {
  bump(buf.events, `${today()}|${name.slice(0, 80)}`);
  arm();
}
export function countMcpClient(name: string) {
  bump(buf.clients, `${today()}|${name}`);
  arm();
}
/** sha256 of the agentURI, the same function SQL applies to Agent.tokenUri to match it later. */
export function uriSha256(uri: string): string {
  return createHash("sha256").update(uri, "utf8").digest("hex");
}
export function countBuiltUri(uri: string) {
  bump(buf.uris, `${today()}|${uriSha256(uri)}`);
  arm();
}

function arm() {
  if (buf.timer) return;
  buf.timer = setInterval(() => void flush(), 30_000);
  buf.timer.unref?.();
}

export async function flush(): Promise<void> {
  const take = (m: Map<string, number>) => {
    const e = [...m.entries()];
    m.clear();
    return e;
  };
  const events = take(buf.events), clients = take(buf.clients), uris = take(buf.uris);
  try {
    for (const [k, n] of events) {
      const [day, name] = k.split("|");
      await q("INSERT INTO fovea.usage_event (day, name, calls) VALUES ($1,$2,$3) ON CONFLICT (day, name) DO UPDATE SET calls = fovea.usage_event.calls + EXCLUDED.calls", [day, name, n]);
    }
    for (const [k, n] of clients) {
      const [day, name] = k.split("|");
      await q("INSERT INTO fovea.usage_integrator (day, kind, name, calls) VALUES ($1,'mcp-client',$2,$3) ON CONFLICT (day, kind, name) DO UPDATE SET calls = fovea.usage_integrator.calls + EXCLUDED.calls", [day, name, n]);
    }
    for (const [k, n] of uris) {
      const [day, h] = k.split("|");
      await q("INSERT INTO fovea.build_uri (uri_sha256, first_day, checks) VALUES ($1,$2,$3) ON CONFLICT (uri_sha256) DO UPDATE SET checks = fovea.build_uri.checks + EXCLUDED.checks", [h, day, n]);
    }
  } catch (e) {
    // A missing table or a down database must never break the request that was counted.
    console.error("[usage] flush failed:", (e as Error).message);
  }
}
