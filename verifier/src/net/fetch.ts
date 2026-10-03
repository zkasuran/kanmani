/**
 * The guarded fetch.
 *
 * Built on `node:http`/`node:https` rather than global `fetch` for one reason that matters: the
 * request options accept a custom `lookup`, which is the only way to guarantee the socket connects
 * to the address the guard actually screened. Global fetch resolves DNS itself, out of reach, so a
 * guard in front of it is checking one resolution and connecting on another.
 *
 * Redirects are followed by hand so each hop is re-screened. The body is capped while it streams.
 */
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import {
  MAX_BYTES,
  MAX_REDIRECTS,
  TIMEOUT_MS,
  type FetchOutcome,
  type Resolver,
  resolvePublic,
  screenUrl,
} from "./guard.ts";

/** Hands the socket the exact address the guard approved, so DNS cannot change under us. */
function pinnedLookup(addresses: string[]): LookupFunction {
  return ((_hostname, options, callback) => {
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address?: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    const opts = typeof options === "function" ? {} : (options ?? {});
    const famOf = (a: string) => (a.includes(":") ? 6 : 4);
    if ((opts as { all?: boolean }).all) {
      cb(null, addresses.map((address) => ({ address, family: famOf(address) })));
    } else {
      cb(null, addresses[0]!, famOf(addresses[0]!));
    }
  }) as LookupFunction;
}

/**
 * Fetch a URL that a stranger controls, safely.
 *
 * Returns `ok: false` with a readable reason for anything refused. A refusal is never an accusation:
 * the reason describes what was observed, because these strings end up on a public verdict page.
 */
export async function guardedFetch(
  raw: string,
  opts: { resolver?: Resolver; maxBytes?: number; timeoutMs?: number } = {},
): Promise<FetchOutcome> {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const screened = screenUrl(current);
    if (!screened.ok) return screened;
    const url = screened.url;

    const host = url.hostname.replace(/^\[|\]$/g, "");
    const resolved = await resolvePublic(host, opts.resolver);
    if (!resolved.ok) return resolved;

    const res = await fetchOnce(url, resolved.addresses, maxBytes, timeoutMs);
    if (!res.ok) return res;

    if (res.redirectTo !== undefined) {
      if (hop === MAX_REDIRECTS) {
        return { ok: false, reason: `more than ${MAX_REDIRECTS} redirects` };
      }
      // Resolve relative Location values against the hop we are on, then loop so the next
      // iteration re-screens the whole thing. A redirect gets no shortcut past the guard.
      try {
        current = new URL(res.redirectTo, url).toString();
      } catch {
        return { ok: false, reason: "redirect target is not a parseable URL" };
      }
      continue;
    }

    return { ok: true, bytes: res.bytes!, finalUrl: url.toString(), status: res.status! };
  }
  return { ok: false, reason: `more than ${MAX_REDIRECTS} redirects` };
}

/**
 * One HTTP exchange against an already-screened set of addresses.
 *
 * Exported because the size cap, the timeout and the redirect handling are transport behaviour.
 * Testing them through `guardedFetch` would mean pointing it at loopback, which the screen correctly
 * refuses. Rather than weaken the screen for tests, the transport gets its own seam. Callers in
 * production go through `guardedFetch`; nothing else should call this directly.
 */
export type OnceResult =
  | { ok: true; status?: number; bytes?: Uint8Array; redirectTo?: string }
  | {
      ok: false;
      reason: string;
      status?: number;
      wwwAuthenticate?: string;
      contentType?: string;
      vendorError?: string;
    };

/** Node gives a header as string, string[] or undefined. Flatten it without inventing a value. */
function headerText(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(", ") : v;
}

export function fetchOnce(
  url: URL,
  addresses: string[],
  maxBytes: number,
  timeoutMs: number,
): Promise<OnceResult> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise<OnceResult>((resolve) => {
    let settled = false;
    const done = (r: OnceResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: pinnedLookup(addresses),
        // Never let the runtime follow a redirect for us.
        headers: { accept: "*/*", "user-agent": "kanmani-fovea/0.1 (+verification)" },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          done({ ok: true, redirectTo: res.headers.location });
          return;
        }
        if (status < 200 || status >= 300) {
          // Keep the headers that say WHAT this non-2xx is, before destroying the response.
          //
          // A status code is not a protocol. x402 answers 402 to mean "pay me" and Vercel answers
          // 402 to mean "this account is suspended". Classifying on the integer alone reported
          // 539 dead documents as live agents asking for payment. The discriminators are cheap.
          // They are all here: `www-authenticate: x402` on a real challenge, a JSON content type,
          // a vendor error header on a hosting failure.
          done({
            ok: false,
            reason: `HTTP ${status}`,
            status,
            wwwAuthenticate: headerText(res.headers["www-authenticate"]),
            contentType: headerText(res.headers["content-type"]),
            vendorError: headerText(res.headers["x-vercel-error"]),
          });
          res.destroy();
          return;
        }

        // Cap on arriving bytes. Content-Length is attacker-supplied and is not consulted.
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            done({ ok: false, reason: `document exceeds ${maxBytes} bytes` });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => done({ ok: true, status, bytes: new Uint8Array(Buffer.concat(chunks)) }));
        res.on("error", (e) => done({ ok: false, reason: `read failed: ${e.message}` }));
      },
    );

    req.on("timeout", () => {
      req.destroy();
      done({ ok: false, reason: `timed out after ${timeoutMs}ms` });
    });
    req.on("error", (e) => done({ ok: false, reason: `request failed: ${e.message}` }));
    req.end();
  });
}
