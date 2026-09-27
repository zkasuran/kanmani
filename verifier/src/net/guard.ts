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

/**
 * Response cap, set from measurement rather than instinct.
 *
 * This was 4 KB on the reasoning that a JSON receipt is small. Run against the real documents on
 * Monad it refused 10 of 14, because an ERC-8004 agent card is legitimately bigger than a receipt.
 * Measured over 30 distinct live documents: min 622, median 652, p90 4,398, max 7,268 bytes, with
 * nothing above 64 KB.
 *
 * 64 KB keeps roughly 9x headroom over the largest thing actually observed while still refusing an
 * unbounded stream, which is what the cap is for. The cap exists to stop a server streaming forever,
 * not to express an opinion about how long a document ought to be.
 */
export const MAX_BYTES = 65_536;
export const TIMEOUT_MS = 8000;
export const MAX_REDIRECTS = 3;

export type FetchOutcome =
  | { ok: true; bytes: Uint8Array; finalUrl: string; status: number }
  /**
   * `reason` is written for a stranger reading a verdict page, so it says what was observed and
   * never what anyone intended. "Blocked, resolves to a private address" is a fact about DNS.
   *
   * The header fields are carried on a refusal for one reason: a status code is not a protocol.
   * 402 means "pay me" to x402 and "this account is suspended" to a hosting provider, so whoever
   * classifies this outcome needs what the response actually said, not just its number.
   */
  | {
      ok: false;
      reason: string;
      status?: number;
      wwwAuthenticate?: string;
      contentType?: string;
      vendorError?: string;
    };

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

  // IPv6, screened on the bytes rather than on a notation. Node's dual-stack sockets connect an
  // IPv4-mapped address straight to the IPv4 host it carries, so any embedded IPv4 has to go through
  // the IPv4 rules. The trap the first cut fell into: the WHATWG URL parser rewrites
  // `[::ffff:127.0.0.1]` to the hex form `::ffff:7f00:1` before this guard ever runs, so a regex
  // written against the dotted notation never matches and loopback sails through as public. Parsing
  // to eight groups sees the address the socket will actually dial.
  const groups = parseIPv6ToGroups(ip);
  if (!groups) return "malformed IPv6";
  if (groups.every((g) => g === 0)) return "unspecified ::";
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "loopback ::1";
  const embedded = embeddedIPv4(groups);
  if (embedded) {
    const inner = isForbiddenAddress(embedded);
    return inner ? `IPv4-in-IPv6, ${inner}` : null;
  }
  const g0 = groups[0]!;
  if ((g0 & 0xfe00) === 0xfc00) return "unique local fc00::/7";
  if ((g0 & 0xffc0) === 0xfe80) return "link-local fe80::/10";
  if ((g0 & 0xff00) === 0xff00) return "multicast ff00::/8";
  return null;
}

/**
 * Expand anything `net.isIP` calls IPv6 into its eight 16-bit groups.
 *
 * Screening runs on these bytes, never on a string, because `::ffff:127.0.0.1`, `::ffff:7f00:1` and
 * `0:0:0:0:0:ffff:7f00:1` are one address and a URL parser is free to hand the guard any of them.
 * Returns null for anything it cannot expand to exactly eight groups, and the caller reads null as
 * forbidden, so an address this cannot parse fails closed.
 */
export function parseIPv6ToGroups(ip: string): number[] | null {
  if (net.isIP(ip) !== 6) return null;
  let str = ip;
  let tailV4: number[] = [];
  // A trailing dotted quad (the ::ffff:a.b.c.d form) becomes two 16-bit groups before expansion.
  const lastColon = str.lastIndexOf(":");
  const tail = str.slice(lastColon + 1);
  if (tail.includes(".")) {
    const p = tail.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    tailV4 = [((p[0]! << 8) | p[1]!) & 0xffff, ((p[2]! << 8) | p[3]!) & 0xffff];
    str = str.slice(0, lastColon);
  }
  const parts = str.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":").filter((x) => x !== "").map((h) => parseInt(h, 16)) : [];
  const rest =
    parts.length === 2 && parts[1] ? parts[1].split(":").filter((x) => x !== "").map((h) => parseInt(h, 16)) : [];
  let groups: number[];
  if (parts.length === 2) {
    const zeros = 8 - (head.length + rest.length + tailV4.length);
    if (zeros < 0) return null;
    groups = [...head, ...Array(zeros).fill(0), ...rest, ...tailV4];
  } else {
    groups = [...head, ...tailV4];
  }
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

/**
 * The dotted IPv4 an IPv6 address carries, or null if it carries none.
 *
 * Covers the mapped form `::ffff:a.b.c.d` that Node actually routes to IPv4, the deprecated
 * compatible form `::a.b.c.d`, and the well-known NAT64 prefix `64:ff9b::/96` that a translator maps
 * to the embedded IPv4. `::` and `::1` carry no routable IPv4 and are handled by the caller.
 */
function embeddedIPv4(g: number[]): string | null {
  const topFiveZero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  const asV4 = () => `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;
  if (topFiveZero && g[5] === 0xffff) return asV4();
  if (topFiveZero && g[5] === 0 && !(g[6] === 0 && (g[7] === 0 || g[7] === 1))) return asV4();
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return asV4();
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
