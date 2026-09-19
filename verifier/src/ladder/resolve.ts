/**
 * `resolve`: turn whatever a feedback points at into bytes.
 *
 * Three schemes appear in the real corpus and they have nothing in common but the name "URI".
 *
 * | scheme | count on Monad | how it resolves |
 * |---|---|---|
 * | `data:` | 1,095 | decoded in process, no network at all |
 * | `http(s):` | 95 | fetched through the SSRF guard |
 * | `ipfs://` | 2 | through a gateway, so still a guarded fetch |
 *
 * **The `data:` path touches no network, which means the SSRF guard is irrelevant to 92% of this
 * corpus.** That is worth stating plainly, because the guard is the most security-critical file in
 * the build and it is also the one that almost never runs. The risk on the `data:` path is
 * different in kind: a caller controls the bytes directly, so the cap is about memory rather than
 * about where a request goes.
 */
import { MAX_BYTES } from "../net/guard.ts";
import { guardedFetch } from "../net/fetch.ts";
import type { FetchOutcome } from "../net/guard.ts";

export type ResolveOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  /** Gateway for ipfs://. Named so a reader can see which third party we depended on. */
  ipfsGateway?: string;
};

/** How the bytes arrived, recorded because it changes what the verdict can claim. */
export type Source = "data" | "http" | "ipfs";

/**
 * `mediaType` is carried through because it is the author's own statement about what they wrote.
 * A `data:text/plain` document is prose somebody chose to write, so failing to find JSON in it is
 * not a gap in our parser. Without this the 66 plain-text comments on Monad read as unparsed, which
 * would inflate our published coverage gap with documents that are perfectly well formed.
 */
export type ResolveOutcome = FetchOutcome & { source?: Source; mediaType?: string };

export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

export async function resolveEvidence(uri: string, opts: ResolveOptions = {}): Promise<ResolveOutcome> {
  const raw = (uri ?? "").trim();
  if (raw === "") return { ok: false, reason: "feedback carries no URI" };

  if (raw.startsWith("data:")) {
    const decoded = decodeDataUri(raw, opts.maxBytes ?? MAX_BYTES);
    return { ...decoded, source: "data", mediaType: dataUriMediaType(raw) };
  }

  if (raw.startsWith("ipfs://")) {
    const cid = raw.slice("ipfs://".length).replace(/^ipfs\//, "");
    // A CID is base58btc or base32 and contains no dots. The first version of this allowed `.`
    // because CIDs live next to filenames in people's heads and `ipfs://../../etc/passwd` sailed
    // straight through it into a gateway URL. Segments are validated individually and `.` and
    // `..` are refused by name rather than by hoping a character class excludes them.
    const [head, ...rest] = cid.split("/");
    const cidOk = /^[A-Za-z0-9]{10,}$/.test(head ?? "");
    const pathOk = rest.every((seg) => seg !== "" && seg !== "." && seg !== ".." && /^[A-Za-z0-9._-]+$/.test(seg));
    if (!cidOk || !pathOk) {
      return { ok: false, reason: "ipfs path is not a CID optionally followed by plain segments" };
    }
    const gateway = opts.ipfsGateway ?? DEFAULT_IPFS_GATEWAY;
    const r = await guardedFetch(gateway + cid, opts);
    return { ...r, source: "ipfs" };
  }

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return { ...(await guardedFetch(raw, opts)), source: "http" };
  }

  // Inline JSON with no scheme shows up in other registries. Not on Monad as of 2026-09-19, so it
  // is refused rather than guessed at: treating a bare string as a document would let a URI that
  // simply failed to parse look like evidence.
  return { ok: false, reason: `unsupported URI scheme: ${raw.slice(0, 24)}` };
}

/**
 * Decode a `data:` URI.
 *
 * RFC 2397 shape: `data:[<mediatype>][;base64],<data>`. Both encodings appear in the corpus, 397
 * base64 and 3 percent-encoded in a 400 document sample.
 */
export function decodeDataUri(uri: string, maxBytes = MAX_BYTES): FetchOutcome {
  const comma = uri.indexOf(",");
  if (comma === -1) return { ok: false, reason: "data URI has no comma separating the payload" };

  const header = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const isBase64 = /;base64$/i.test(header) || /;base64;/i.test(`${header};`);

  // Check the encoded length before decoding. base64 inflates by 4/3, so a payload that decodes
  // under the cap is always under this bound too and this refuses a hostile input without first
  // allocating it.
  if (payload.length > maxBytes * 2) {
    return { ok: false, reason: `data URI payload exceeds ${maxBytes * 2} encoded characters` };
  }

  let bytes: Uint8Array;
  try {
    if (isBase64) {
      const buf = Buffer.from(payload, "base64");
      // Buffer.from is lenient and silently drops invalid characters rather than throwing, so a
      // corrupt payload would decode to something shorter and look like a real document. Round
      // trip it and compare, which is the only way to notice.
      const normalised = payload.replace(/\s/g, "");
      if (buf.toString("base64").replace(/=+$/, "") !== normalised.replace(/=+$/, "")) {
        return { ok: false, reason: "data URI is not valid base64" };
      }
      bytes = new Uint8Array(buf);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
  } catch (e) {
    return { ok: false, reason: `data URI could not be decoded: ${(e as Error).message}` };
  }

  if (bytes.length === 0) return { ok: false, reason: "data URI decoded to zero bytes" };
  if (bytes.length > maxBytes) {
    return { ok: false, reason: `document exceeds ${maxBytes} bytes` };
  }

  return { ok: true, bytes, finalUrl: `data:${header},`, status: 200 };
}

/** The declared media type of a data URI, lowercased, defaulting as RFC 2397 says. */
export function dataUriMediaType(uri: string): string {
  const comma = uri.indexOf(",");
  if (comma === -1) return "";
  const header = uri.slice(5, comma);
  const type = header.split(";")[0]!.trim().toLowerCase();
  // RFC 2397: an omitted media type means text/plain. That default matters here, because a bare
  // `data:,Excellent service` is prose by specification rather than by our guess.
  return type === "" ? "text/plain" : type;
}
