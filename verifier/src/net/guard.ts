/**
 * The SSRF guard.
 *
 * Fovea fetches URLs that strangers put on a public blockchain. Anyone can register an agent whose
 * evidence document points at `http://169.254.169.254/latest/meta-data/` or at a host on our own
 * network and we will fetch it because fetching it is the product. So this file is the part of the
 * build most likely to be attacked and it is written to be read rather than trusted.
 *
 * Three properties, each one a thing a checkbox implementation gets wrong:
 *
 *  1. **The resolved address is what gets checked and the same address is what gets connected to.**
 *     Checking a hostname against a blocklist and then handing the hostname to `fetch` is a
 *     time-of-check to time-of-use hole: a DNS record with a one second TTL can answer public on the
 *     check and private on the connect. This resolves once, screens every answer, then pins the
 *     survivor into the socket. See `pinnedLookup`.
 *
 *  2. **Redirects are re-screened, every hop.** A public URL that 302s to `http://127.0.0.1:8081` is
 *     the same attack with one more step, so redirects are followed by hand rather than by the
 *     runtime and each hop goes through the whole guard again.
 *
 *  3. **The size cap is enforced on the bytes as they arrive**, never on `Content-Length`. That
 *     header is supplied by the attacker and a server is free to send a gigabyte after declaring
 *     twelve bytes.
 */
import { lookup as dnsLookup } from "node:dns";
import net from "node:net";

/** Evidence documents are small. 4 KB is generous for a JSON receipt and cheap to refuse beyond. */
export const MAX_BYTES = 4096;
export const TIMEOUT_MS = 8000;
export const MAX_REDIRECTS = 3;

export type FetchOutcome =
  | { ok: true; bytes: Uint8Array; finalUrl: string; status: number }
  /**
   * `reason` is written for a stranger reading a verdict page, so it says what was observed and
   * never what anyone intended. "Blocked, resolves to a private address" is a fact about DNS.
   */
  | { ok: false; reason: string };

/* ------------------------------------------------------------------ address screening */

/**
 * Reject anything that is not a normal public unicast address.
 *
 * Deny-listing by range rather than allow-listing is deliberate here: the public internet is the
 * set we want and it is defined by exclusion. Each range below is a real place a fetch could reach
 * something it should not.
 */
export function isForbiddenAddress(ip: string): string | null {
  const v = net.isIP(ip);
  if (v === 0) return "not an IP address";

  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return "malformed IPv4";
    }
    const [a, b] = p as [number, number, number, number];
    if (a === 0) return "unspecified range 0.0.0.0/8";
    if (a === 10) return "private range 10.0.0.0/8";
    if (a === 127) return "loopback 127.0.0.0/8";
    // 169.254.169.254 is the cloud metadata endpoint on AWS, GCP and Azure alike. The whole
    // link-local range goes, because the interesting address is not the only one there.
    if (a === 169 && b === 254) return "link-local 169.254.0.0/16, includes cloud metadata";
    if (a === 172 && b >= 16 && b <= 31) return "private range 172.16.0.0/12";
    if (a === 192 && b === 168) return "private range 192.168.0.0/16";
    if (a === 192 && b === 0) return "IETF special-use 192.0.0.0/24";
    if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT 100.64.0.0/10";
    if (a >= 224) return "multicast or reserved, 224.0.0.0/4 and above";
    return null;
  }

  // IPv6. Normalised lowercase and the v4-mapped form is re-screened as v4 rather than waved
  // through, because ::ffff:127.0.0.1 is loopback wearing a different notation.
  const s = ip.toLowerCase();
  if (s === "::" || s === "::0") return "unspecified ::";
  if (s === "::1") return "loopback ::1";
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const inner = isForbiddenAddress(mapped[1]!);
    return inner ? `IPv4-mapped, ${inner}` : null;
  }
  const head = parseInt(s.split(":")[0] || "0", 16);
  if ((head & 0xfe00) === 0xfc00) return "unique local fc00::/7";
  if ((head & 0xffc0) === 0xfe80) return "link-local fe80::/10";
  if ((head & 0xff00) === 0xff00) return "multicast ff00::/8";
  return null;
}

/* ------------------------------------------------------------------ scheme and shape */

export function screenUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a parseable URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `scheme ${url.protocol} is not fetchable here` };
  }
  // Credentials in the URL are a redirect-laundering trick and nothing legitimate needs them.
  if (url.username || url.password) {
    return { ok: false, reason: "URL carries credentials" };
  }
  // A bare literal skips DNS, so screen it here as well as in the lookup.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    const bad = isForbiddenAddress(host);
    if (bad) return { ok: false, reason: `blocked, ${bad}` };
  }
  return { ok: true, url };
}

/* ------------------------------------------------------------------ pinned resolution */

export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = (host) =>
  new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => {
      if (err) reject(err);
      else resolve(addrs.map((a) => a.address));
    });
  });

/**
 * Resolve, screen every answer and return the survivors.
 *
 * **Every** answer is screened rather than the first, because a hostname resolving to one public
 * address and one private one is the cheapest way to smuggle a private target past a guard that
 * stops at the first record it reads.
 */
export async function resolvePublic(
  host: string,
  resolver: Resolver = systemResolver,
): Promise<{ ok: true; addresses: string[] } | { ok: false; reason: string }> {
  if (net.isIP(host)) {
    const bad = isForbiddenAddress(host);
    return bad ? { ok: false, reason: `blocked, ${bad}` } : { ok: true, addresses: [host] };
  }
  let addrs: string[];
  try {
    addrs = await resolver(host);
  } catch (e) {
    return { ok: false, reason: `DNS lookup failed: ${String((e as Error).message ?? e)}` };
  }
  if (addrs.length === 0) return { ok: false, reason: "DNS returned no addresses" };
  for (const a of addrs) {
    const bad = isForbiddenAddress(a);
    if (bad) return { ok: false, reason: `blocked, ${host} resolves to ${a}, ${bad}` };
  }
  return { ok: true, addresses: addrs };
}
