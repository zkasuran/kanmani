/**
 * One HTTP request to a URL a stranger supplied, through the same screen as every other fetch here.
 *
 * `guardedFetch` is GET-only and follows redirects, which is right for reading documents. Probing an
 * agent's endpoint needs a POST with a JSON body and the raw answer, so this is the same guard with a
 * method and a body: the URL is screened, the host resolved to public addresses only and the socket
 * pinned to those addresses, so DNS cannot be flipped between the check and the connect. Redirects are
 * reported, never followed: a probe of one endpoint must not become a request to another.
 */
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { resolvePublic, screenUrl } from "./guard.ts";

export type ProbeResult =
  | {
      ok: true;
      status: number;
      ms: number;
      headers: { contentType?: string; wwwAuthenticate?: string; location?: string; paymentRequired?: string; a2aExtensions?: string };
      body: string;
      truncated: boolean;
    }
  | { ok: false; reason: string; ms: number };

function pinned(addresses: string[]): LookupFunction {
  return ((_h, options, callback) => {
    const cb = (typeof options === "function" ? options : callback) as (e: NodeJS.ErrnoException | null, a?: string | { address: string; family: number }[], f?: number) => void;
    const o = typeof options === "function" ? {} : (options ?? {});
    const fam = (a: string) => (a.includes(":") ? 6 : 4);
    if ((o as { all?: boolean }).all) cb(null, addresses.map((address) => ({ address, family: fam(address) })));
    else cb(null, addresses[0]!, fam(addresses[0]!));
  }) as LookupFunction;
}

const h = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v.join(", ") : v);

export async function guardedRequest(
  raw: string,
  opts: { method?: "GET" | "POST"; body?: string; headers?: Record<string, string>; maxBytes?: number; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const t0 = Date.now();
  const screened = screenUrl(raw);
  if (!screened.ok) return { ok: false, reason: screened.reason, ms: 0 };
  const url = screened.url;
  const resolved = await resolvePublic(url.hostname.replace(/^\[|\]$/g, ""));
  if (!resolved.ok) return { ok: false, reason: resolved.reason, ms: Date.now() - t0 };
  const maxBytes = opts.maxBytes ?? 256 * 1024;
  const mod = url.protocol === "https:" ? https : http;
  return new Promise<ProbeResult>((resolve) => {
    let done = false;
    const finish = (r: ProbeResult) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    const req = mod.request(
      url,
      {
        method: opts.method ?? "GET",
        lookup: pinned(resolved.addresses),
        timeout: opts.timeoutMs ?? 8000,
        headers: {
          "user-agent": "kanmani-doctor/1 (+https://kanmani.xyz/hire)",
          accept: "application/json, text/event-stream, */*",
          ...(opts.body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(opts.body)) } : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let n = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          if (n >= maxBytes) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(c.subarray(0, maxBytes - n));
          n += c.length;
        });
        const end = () =>
          finish({
            ok: true,
            status: res.statusCode ?? 0,
            ms: Date.now() - t0,
            headers: {
              contentType: h(res.headers["content-type"]),
              wwwAuthenticate: h(res.headers["www-authenticate"]),
              location: h(res.headers.location),
              paymentRequired: h(res.headers["payment-required"]),
              a2aExtensions: h(res.headers["x-a2a-extensions"]),
            },
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
          });
        res.on("end", end);
        res.on("close", end);
        res.on("error", () => end());
      },
    );
    req.on("timeout", () => {
      req.destroy();
      finish({ ok: false, reason: `no answer within ${opts.timeoutMs ?? 8000}ms`, ms: Date.now() - t0 });
    });
    req.on("error", (e) => finish({ ok: false, reason: e.message.slice(0, 160), ms: Date.now() - t0 }));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
