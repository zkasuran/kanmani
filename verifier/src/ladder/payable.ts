/**
 * The `payable` rung: could a buyer pay this agent right now?
 *
 * Every rung before this one reads a document. This one asks a server. The question is not whether
 * an agent SAYS it takes payment. It is whether the endpoint it published answers with a payment
 * requirement a buyer could act on.
 *
 * ## A status code is not a protocol
 *
 * **HTTP 402 on its own means nothing.** Classifying on the integer published 539 records as live
 * agents asking for payment when every one of them was a single suspended Vercel account answering
 * 402 with `content-type: text/plain` plus `x-vercel-error: DEPLOYMENT_DISABLED`. That is a dead
 * host wearing the number of a live one.
 *
 * So this file classifies on the payload, never the code:
 *
 * | signal | what it is |
 * |---|---|
 * | `www-authenticate: x402...` | the challenge header, per the transport binding |
 * | a JSON body with an `accepts` array | the challenge payload |
 * | an entry carrying `payTo` plus an amount | an offer a buyer could act on |
 * | a vendor error header, a `text/plain` body | a hosting failure, whatever the code says |
 *
 * A 402 with none of those is not payable. A **200** carrying `accepts` is, because a published
 * catalogue is the same offer delivered as a menu rather than as a till. Which of the two we saw is
 * recorded rather than flattened, so a reader can weigh them separately.
 *
 * ## Both protocol shapes exist in the wild
 *
 * Read off the specs, `specs/x402-specification-v1.md` and `-v2.md` in `coinbase/x402`:
 *
 * | | v1 entry | v2 entry |
 * |---|---|---|
 * | amount | `maxAmountRequired` | `amount` |
 * | network | a bare name, `base-sepolia` | CAIP-2, `eip155:84532` |
 * | resource | a string on the entry | an object at the top level |
 * | chosen method | n/a | `accepted`, in the client's payload |
 *
 * **The declared version and the observed shape disagree in the wild, so both are recorded.**
 * Measured 2026-09-23: `adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/adexto` answers 402 with
 * `x402Version: 2` over entries carrying `scheme`, a bare `network: "base"` and
 * `maxAmountRequired`, which is a v1 entry under a v2 label. `prooflines.org/.well-known/x402`
 * answers 200 with entries carrying `amount` AND `maxAmountRequired` together. Trusting the label
 * would misread the first and trusting one amount key would price the second at nothing.
 *
 * ## What this rung never does
 *
 * **A failure to look is not evidence that an agent cannot be paid.** A rate limit, a timeout, a
 * 5xx, a method we did not try: all `unknown`. That is the same rule `locate` holds about chain
 * reads and it is held here for the same reason, because an outage would otherwise manufacture
 * accusations at scale.
 *
 * **Probes are GET only.** A POST to a stranger's endpoint may do something rather than describe
 * something. We are measuring whether a buyer could pay rather than buying. An endpoint that
 * answers 405 to a GET is `unknown`, with the `allow` header recorded, because a challenge we did
 * not ask for correctly is a challenge we did not see.
 */
import { MAX_BYTES, MAX_REDIRECTS, TIMEOUT_MS, resolvePublic, screenUrl, type Resolver } from "../net/guard.ts";
import { resolveChain } from "../chains.ts";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

/* ------------------------------------------------------------------ what a document declares */

/** One address a buyer could try, pulled out of a registration document. */
export type ServiceEndpoint = {
  /** The absolute http(s) URL, present only when the declaration is actually fetchable. */
  url?: string;
  /** Where in the document this came from, so a reader can find it themselves. */
  declaredAt: string;
  /** The name or id the author gave it. Their words, not ours. */
  label?: string;
  /**
   * Whether the author labelled this one as the x402 endpoint. **This only decides probe order.**
   * A label is a claim and the whole point of the rung is that a claim is not a measurement, so it
   * never touches the classification.
   */
  labelledX402: boolean;
  /** Set when the declaration exists and cannot be fetched, with the reason it cannot. */
  notAddressable?: string;
};

/**
 * The agent's own x402 claim, read straight off the registration document.
 *
 * Recorded next to the probe so a page can put the claim and the measurement side by side. Both
 * shapes below are real on Monad: `x402Support: true` as a bare boolean plus an object carrying a
 * self-declared settlement (`claw.tormund.io`, measured 2026-09-23).
 */
export type X402Declaration = {
  claimed: boolean;
  /** A transaction the agent itself offers as proof it has been paid. Input to `settled`. */
  settlementTx?: string;
  network?: string;
  facilitator?: string;
  treasury?: string;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/**
 * Hosts we do not contact, with the reason attached.
 *
 * These four are one suspended account and they were re-probed on 2026-09-22, so asking again buys
 * nothing and costs somebody else's server. A skipped host reads as `unknown`, never as a
 * measurement: we chose not to look, which is a different thing from having looked.
 */
export const SKIP_HOSTS: Readonly<Record<string, string>> = {
  "api.monadmogs.xyz": "suspended account, re-probed 2026-09-22",
  "monadmogs.vercel.app": "suspended account, re-probed 2026-09-22",
  "monadmogs.xyz": "suspended account, re-probed 2026-09-22",
  "www.monadmogs.xyz": "suspended account, re-probed 2026-09-22",
};

/**
 * Every address a registration document offers, best candidate first.
 *
 * Four shapes, all measured on Monad 2026-09-23 rather than guessed at:
 *
 * | shape | example | count |
 * |---|---|---|
 * | `services: [{ name, endpoint }]` | the ERC-8004 registration-v1 documents | the bulk |
 * | `skills: [{ id, endpoint, payment }]` | `data:` inline agent cards | a handful |
 * | `endpoints: [{ name, method, price }]` | `clawd.party`, priced but with no URL | 1 |
 * | a top level `url` | A2A cards | common |
 *
 * **A declaration that is not a URL is kept rather than dropped.** `api.pr4gma.xyz` declares
 * `endpoint: "eip155:143:0xCb9E..."`, which is a wallet rather than a service. One document
 * declares services with a description and no address at all. Silently dropping those would report
 * the agent as declaring nothing, when it declared something unpayable. The two are different and
 * the second is the more interesting finding.
 */
export function serviceEndpoints(doc: unknown): ServiceEndpoint[] {
  if (!isObj(doc)) return [];
  const out: ServiceEndpoint[] = [];

  const push = (entry: Record<string, unknown>, declaredAt: string) => {
    const label = str(entry.name) ?? str(entry.id) ?? str(entry.type);
    // `payment: "x402"` is our own card's key, `name: "x402"` is prooflines', `type` is
    // grokandmon's. All three are the author naming their own rail, so all three are read.
    const labelledX402 = [entry.payment, entry.name, entry.type, entry.id, entry.scheme]
      .some((v) => typeof v === "string" && v.toLowerCase().includes("x402"));
    const raw = str(entry.endpoint) ?? str(entry.url);
    if (raw === undefined) {
      out.push({ declaredAt, label, labelledX402, notAddressable: "declares no endpoint or url" });
      return;
    }
    const screened = screenUrl(raw);
    if (!screened.ok) {
      // A CAIP-10 account, a bare github path, a relative path. Recorded verbatim, because the
      // author's words are the evidence for saying the declaration is not payable.
      out.push({
        declaredAt,
        label,
        labelledX402,
        notAddressable: `${screened.reason}: ${short(raw)}`,
      });
      return;
    }
    out.push({ url: screened.url.toString(), declaredAt, label, labelledX402 });
  };

  for (const key of ["skills", "services", "endpoints"] as const) {
    const arr = doc[key];
    if (!Array.isArray(arr)) continue;
    arr.forEach((entry, i) => {
      // `skills: ["profile", "render"]` is a list of words, which names capabilities rather than
      // addresses. Only object entries can carry an endpoint.
      if (isObj(entry)) push(entry, `${key}[${i}]`);
    });
  }

  // The card's own URL, last. For an agent whose only published address is this, probing it is the
  // only way to answer the question, so it is a candidate. It is ranked below every named service
  // because a card URL usually serves the card rather than the service.
  const top = str(doc.url);
  if (top !== undefined) {
    const screened = screenUrl(top);
    if (screened.ok) out.push({ url: screened.url.toString(), declaredAt: "url", labelledX402: false });
  }

  // Stable order: the author's own x402 label first, then declaration order. Sorting on the label
  // is the one place a claim influences anything here and it influences only what we try first.
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Number(b.e.labelledX402) - Number(a.e.labelledX402) || a.i - b.i)
    .map(({ e }) => e);
}

/** The agent's own x402 claim. Read, recorded, never believed. */
export function declaredX402(doc: unknown): X402Declaration {
  if (!isObj(doc)) return { claimed: false };
  const v = doc.x402Support;
  if (typeof v === "boolean") return { claimed: v };
  if (!isObj(v)) return { claimed: false };
  // The object form carries its own verification claim. Absent `verified` we read the presence of
  // the object as the claim, which is what the author meant by writing it.
  return {
    claimed: typeof v.verified === "boolean" ? v.verified : true,
    settlementTx: str(v.donationTx) ?? str(v.settlementTx) ?? str(v.txHash),
    network: str(v.network),
    facilitator: str(v.facilitator),
    treasury: str(v.treasury) ?? str(v.payTo),
  };
}

/* ------------------------------------------------------------------ reading a challenge */

/** Which protocol shape an `accepts` entry is written in, decided by its keys. */
export type AcceptsShape =
  /** `maxAmountRequired`, a bare network name, `resource` as a string. */
  | "v1"
  /** `amount`, CAIP-2 network, `resource` lifted to a top level object. */
  | "v2"
  /** Both amount keys on one entry. Real: prooflines.org, measured 2026-09-23. */
  | "hybrid"
  /** Neither amount key, so there is no price to read. */
  | "unpriced";

/** One payment requirement, normalised across both shapes. */
export type Offer = {
  shape: AcceptsShape;
  scheme?: string;
  /** Verbatim, as the server wrote it. Never normalised away, because it is their claim. */
  network?: string;
  /** Resolved through the published chain list. Undefined when that list does not cover it. */
  chainId?: number;
  /** Atomic units, as a string, from whichever amount key the entry used. */
  amount?: string;
  asset?: string;
  payTo?: string;
  /** A buyer needs a recipient and a price. Without both there is nothing to act on. */
  actionable: boolean;
};

export type ProbeHeaders = Readonly<Record<string, string>>;

export type EndpointResponse = { status: number; headers: ProbeHeaders; bytes: Uint8Array };

export type X402Reading =
  | {
      challenge: true;
      /** A 402 demanding payment is a challenge. A 200 publishing the same offer is a catalogue. */
      kind: "challenge" | "catalogue";
      /** The `x402Version` the server printed. A label, not a measurement. */
      declaredVersion?: number;
      /** What the entries are actually shaped like, which is the part that can be trusted. */
      shapes: AcceptsShape[];
      offers: Offer[];
      /** True when at least one offer settles on Monad mainnet, chain 143. */
      monadOption: boolean;
      wwwAuthenticate?: string;
      reason: string;
    }
  /** We read the response and it is not an x402 offer. */
  | { challenge: false; reason: string }
  /** We could not tell. Never an accusation and never folded into false. */
  | { challenge: "unknown"; reason: string };

/** Pull the amount out of whichever key the entry used and say which key that was. */
function shapeOf(entry: Record<string, unknown>): { shape: AcceptsShape; amount?: string } {
  const v2 = entry.amount;
  const v1 = entry.maxAmountRequired;
  const has = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
  // Both keys present is its own answer rather than a tie broken by preference. Preferring one
  // silently would hide that the server is writing for two protocol versions at once.
  if (has(v2) && has(v1)) return { shape: "hybrid", amount: String(v2).trim() };
  if (has(v2)) return { shape: "v2", amount: String(v2).trim() };
  if (has(v1)) return { shape: "v1", amount: String(v1).trim() };
  return { shape: "unpriced" };
}

function readOffer(entry: Record<string, unknown>): Offer {
  const { shape, amount } = shapeOf(entry);
  const network = str(entry.network);
  // Resolved through `chains.ts` so coverage is the published list rather than a local opinion.
  // A network we do not cover leaves `chainId` undefined and keeps the author's own string, which
  // is how `monad-testnet` stays visible as itself instead of being rounded to Monad.
  const lookup = resolveChain(network ?? entry.chainId);
  const payTo = str(entry.payTo);
  return {
    shape,
    scheme: str(entry.scheme),
    network,
    chainId: lookup.known ? lookup.chain.id : undefined,
    amount,
    asset: str(entry.asset),
    payTo,
    // A recipient and a price. An entry with neither is a shape rather than an offer. Calling it
    // payable would let an empty `accepts: [{}]` pass as a live till.
    actionable: payTo !== undefined && amount !== undefined,
  };
}

/** Every `accepts` array in a body, top level or nested under `resources[]` as a catalogue. */
function acceptsArrays(doc: Record<string, unknown>): Record<string, unknown>[][] {
  const found: Record<string, unknown>[][] = [];
  const take = (v: unknown) => {
    if (Array.isArray(v)) found.push(v.filter(isObj));
  };
  take(doc.accepts);
  if (Array.isArray(doc.resources)) {
    for (const r of doc.resources) if (isObj(r)) take(r.accepts);
  }
  return found.filter((a) => a.length > 0);
}

/**
 * Decide what a response actually is.
 *
 * Pure, so every branch below is testable with no network. The order of the checks is the whole
 * argument of this file: the payload decides, then the header. The status code is read last
 * and only to separate a till from a catalogue.
 */
export function classifyX402(res: EndpointResponse): X402Reading {
  const { status, headers } = res;
  const auth = headers["www-authenticate"];
  const contentType = headers["content-type"] ?? "";
  const vendor = headers["x-vercel-error"] ?? headers["x-now-error"];

  // Ours to fix, not theirs to answer for. A rate limit, a gateway error, a method we did not try.
  if (status === 429) return { challenge: "unknown", reason: "HTTP 429, the host is rate limiting us" };
  if (status >= 500) return { challenge: "unknown", reason: `HTTP ${status}, a server error on their side` };
  if (status === 405 || status === 501) {
    const allow = headers["allow"];
    return {
      challenge: "unknown",
      reason:
        `HTTP ${status} to a GET${allow ? `, allows ${allow}` : ""}, so a challenge was ` +
        "never asked for correctly",
    };
  }

  // A hosting failure announces itself, whatever code it picked. Checked before the body, because
  // the body in this case is the provider's error page rather than anything the agent wrote.
  if (vendor !== undefined) {
    return { challenge: false, reason: `HTTP ${status} from the host itself, ${vendor}` };
  }

  const bodyText = decode(res.bytes);
  let doc: unknown;
  try {
    doc = bodyText === "" ? undefined : JSON.parse(bodyText);
  } catch {
    doc = undefined;
  }

  const arrays = isObj(doc) ? acceptsArrays(doc) : [];
  const entries = arrays.flat();

  if (entries.length === 0) {
    // The header alone is not enough to call something payable. A server can send the header and
    // no requirements, which leaves a buyer with nowhere to send money.
    if (looksLikeX402Header(auth)) {
      return {
        challenge: "unknown",
        reason:
          `HTTP ${status} with www-authenticate: x402 and no readable accepts array, ` +
          "so there is no offer to check",
      };
    }
    if (status === 402) {
      // The 539 case. A 402 that says nothing is a dead deployment answering with the wrong number.
      return {
        challenge: false,
        reason: `HTTP 402 carrying no x402 challenge, content-type ${contentType || "unstated"}`,
      };
    }
    if (status === 404 || status === 410) {
      return { challenge: false, reason: `HTTP ${status}, the declared endpoint is not there` };
    }
    if (status === 401 || status === 403) {
      // Gated by something that is not payment. A buyer cannot pay their way in.
      return { challenge: false, reason: `HTTP ${status}, gated by credentials rather than by payment` };
    }
    if (status >= 200 && status < 300) {
      return {
        challenge: false,
        reason: `HTTP ${status} and no payment requirement, so the endpoint answers for free`,
      };
    }
    return { challenge: false, reason: `HTTP ${status} with no x402 challenge` };
  }

  const offers = entries.map(readOffer);
  const actionable = offers.filter((o) => o.actionable);
  const declaredVersion =
    isObj(doc) && typeof doc.x402Version === "number" ? doc.x402Version : undefined;
  const shapes = [...new Set(offers.map((o) => o.shape))];

  if (actionable.length === 0) {
    return {
      challenge: "unknown",
      reason:
        `${entries.length} accepts ${entries.length === 1 ? "entry" : "entries"} carrying ` +
        "no payTo and no amount, so there is nothing a buyer could act on",
    };
  }

  // A till asks. A catalogue publishes. Both are live offers from a running server so both clear
  // this rung. Which one it was stays on the record instead of being flattened.
  const kind = status === 402 ? "challenge" : "catalogue";
  const monadOption = actionable.some((o) => o.chainId === 143);
  const networks = [...new Set(actionable.map((o) => o.network ?? "unstated"))].join(", ");

  return {
    challenge: true,
    kind,
    declaredVersion,
    shapes,
    offers,
    monadOption,
    wwwAuthenticate: auth,
    reason:
      `HTTP ${status} ${kind === "challenge" ? "x402 challenge" : "x402 catalogue"} with ` +
      `${actionable.length} payable ${actionable.length === 1 ? "option" : "options"} on ${networks}, ` +
      `${shapes.join(" and ")} ${shapes.length === 1 ? "shape" : "shapes"}` +
      (declaredVersion === undefined ? "" : `, labelled x402Version ${declaredVersion}`),
  };
}

/**
 * Whether a `www-authenticate` value names the x402 scheme.
 *
 * Matched on the scheme token rather than with a substring test. `Bearer realm="x402-gated"` is a
 * bearer challenge that mentions x402 and reading it as an x402 challenge would be the same class
 * of error as reading the status code.
 */
export function looksLikeX402Header(v: string | undefined): boolean {
  if (v === undefined) return false;
  return v
    .split(",")
    .some((part) => /^\s*x402(\s|$)/i.test(part));
}

/* ------------------------------------------------------------------ the guarded probe */

export type ProbeOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  resolver?: Resolver;
  /** Milliseconds between two probes of the same agent. Politeness, not rate limiting. */
  gapMs?: number;
  /** How many of an agent's declared endpoints to try before stopping. */
  maxEndpoints?: number;
  now?: () => Date;
  /**
   * The one network call this rung makes, as a seam.
   *
   * `locate` is written against the two chain reads it needs rather than against a client library,
   * so its decision logic is testable with no network. Same idea here: the ordering rules below
   * decide whether somebody is published as unpayable, so they are worth testing directly rather
   * than through a socket. Production callers leave this alone and get `fetchChallenge`.
   */
  probe?: (url: string, opts: ProbeOptions) => Promise<ChallengeFetch>;
};

/**
 * Hands the socket the exact address the guard approved, so DNS cannot change under us.
 *
 * The same trick `net/fetch.ts` uses, written again here for one reason: `guardedFetch` destroys
 * the response body on any non-2xx. A 402 body is precisely the payload this rung classifies
 * on. Rather than loosen the shared fetch for one caller, this file keeps its own single exchange
 * and goes through the guard's own `screenUrl` plus `resolvePublic` for every hop. The screening is
 * shared. Only the body handling differs.
 */
function pinnedLookup(addresses: string[]): LookupFunction {
  return ((hostname, options, callback) => {
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

export type ChallengeFetch =
  | { ok: true; res: EndpointResponse; finalUrl: string }
  /** `blocked` separates an address no buyer could reach from a look that simply failed. */
  | { ok: false; reason: string; blocked: boolean };

/**
 * One exchange, body kept whatever the status, capped while it streams.
 *
 * Exported for the same reason `net/fetch.ts` exports `fetchOnce`: the cap, the timeout and the
 * header handling are transport behaviour. Testing them through `fetchChallenge` would mean
 * pointing it at loopback, which the screen correctly refuses. Rather than weaken the screen for
 * tests, the transport gets its own seam. Callers in production go through `fetchChallenge`.
 */
export function exchange(
  url: URL,
  addresses: string[],
  maxBytes: number,
  timeoutMs: number,
): Promise<
  | { ok: true; status: number; headers: ProbeHeaders; bytes: Uint8Array; redirectTo?: string }
  | { ok: false; reason: string }
> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: Awaited<ReturnType<typeof exchange>>) => {
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
        headers: {
          accept: "application/json, */*",
          "user-agent": "kanmani-fovea/0.1 (+verification)",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
        }

        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          done({ ok: true, status, headers, bytes: new Uint8Array(), redirectTo: res.headers.location });
          return;
        }

        // Cap on arriving bytes. Content-Length is the server's claim and is not consulted.
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            done({ ok: false, reason: `response exceeds ${maxBytes} bytes` });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          done({ ok: true, status, headers, bytes: new Uint8Array(Buffer.concat(chunks)) }),
        );
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

/** Fetch an endpoint a stranger published, through the guard, keeping the body on any status. */
export async function fetchChallenge(raw: string, opts: ProbeOptions = {}): Promise<ChallengeFetch> {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const screened = screenUrl(current);
    if (!screened.ok) return { ok: false, reason: screened.reason, blocked: true };
    const url = screened.url;

    const host = url.hostname.replace(/^\[|\]$/g, "");
    const skip = SKIP_HOSTS[host.toLowerCase()];
    if (skip !== undefined) {
      return { ok: false, reason: `not probed, ${host} is ${skip}`, blocked: false };
    }

    const resolved = await resolvePublic(host, opts.resolver);
    if (!resolved.ok) {
      // `blocked,` is a fact about the address: no buyer on the public internet could reach it.
      // A DNS failure is a fact about our look, so it must not read as the same thing.
      return { ok: false, reason: resolved.reason, blocked: resolved.reason.startsWith("blocked,") };
    }

    const r = await exchange(url, resolved.addresses, maxBytes, timeoutMs);
    if (!r.ok) return { ok: false, reason: r.reason, blocked: false };

    if (r.redirectTo !== undefined) {
      if (hop === MAX_REDIRECTS) {
        return { ok: false, reason: `more than ${MAX_REDIRECTS} redirects`, blocked: false };
      }
      // Loop rather than recurse, so the next iteration re-screens the whole thing. A redirect to
      // loopback is the same attack with one more step and it gets no shortcut past the guard.
      try {
        current = new URL(r.redirectTo, url).toString();
      } catch {
        return { ok: false, reason: "redirect target is not a parseable URL", blocked: true };
      }
      continue;
    }

    return {
      ok: true,
      finalUrl: url.toString(),
      res: { status: r.status, headers: r.headers, bytes: r.bytes },
    };
  }
  return { ok: false, reason: `more than ${MAX_REDIRECTS} redirects`, blocked: false };
}

/* ------------------------------------------------------------------ the rung */

/** What one endpoint answered. */
export type EndpointResult = {
  endpoint: ServiceEndpoint;
  probedUrl?: string;
  reading: X402Reading;
};

export type PayableOutcome = {
  /**
   * Four answers. They are not a scale.
   *
   *  - `true`    a live server published an offer a buyer could act on
   *  - `false`   we read its endpoints and none of them asks for payment
   *  - `noOffer` the document declares no fetchable endpoint, so there is nothing to probe
   *  - `unknown` we could not look. A rate limit, a timeout, a method we did not try
   */
  payable: true | false | "noOffer" | "unknown";
  reason: string;
  /** The author's own claim, recorded beside the measurement rather than instead of it. */
  declared: X402Declaration;
  /** Every endpoint the document offered, including the ones that are not addressable. */
  endpoints: ServiceEndpoint[];
  /** Only the ones actually contacted. Kept short on purpose, see `maxEndpoints`. */
  probes: EndpointResult[];
  /** Set when an offer settles on Monad mainnet, which is the rail this build measures. */
  monadOption?: boolean;
  /** The shapes seen, so the v1 and v2 split is a published number rather than a footnote. */
  shapes?: AcceptsShape[];
  checkedAt: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Probe an agent's own service endpoints and decide whether a buyer could pay it.
 *
 * @param doc the agent's registration document, already parsed
 *
 * **This is not the document URL.** `record_probe` measures whether a registration still resolves.
 * This measures the SERVICE the registration declares, which is a different host as often as not.
 * Confusing the two would report an agent as payable because its business card loaded.
 *
 * Endpoints are tried **in order, serially, with a gap**. The walk stops at the first payable
 * one. A registration commonly declares four services on one host, so a parallel pass would put
 * four simultaneous requests on one small deployment to learn something the first answer usually
 * settles. We publish findings about these operators, so knocking one over while measuring whether
 * it is up would be its own answer.
 */
export async function payableCheck(doc: unknown, opts: ProbeOptions = {}): Promise<PayableOutcome> {
  const checkedAt = (opts.now?.() ?? new Date()).toISOString();
  const declared = declaredX402(doc);
  const endpoints = serviceEndpoints(doc);
  const base = { declared, endpoints, checkedAt };

  const addressable = endpoints.filter((e) => e.url !== undefined);
  if (addressable.length === 0) {
    // Distinct from `false` on purpose. Nothing was asked, so nothing was refused. This is the
    // 483 `services: []` documents and the ones declaring a wallet where a URL should be.
    const why =
      endpoints.length === 0
        ? "the document declares no service endpoint at all"
        : `${endpoints.length} declared ` +
          `${endpoints.length === 1 ? "service carries" : "services carry"} no fetchable URL: ` +
          `${endpoints[0]!.notAddressable}`;
    return { ...base, payable: "noOffer", probes: [], reason: why };
  }

  const limit = Math.max(1, opts.maxEndpoints ?? 2);
  const gapMs = opts.gapMs ?? 350;
  const probe = opts.probe ?? fetchChallenge;
  const probes: EndpointResult[] = [];

  for (const endpoint of addressable.slice(0, limit)) {
    if (probes.length > 0 && gapMs > 0) await sleep(gapMs);

    const got = await probe(endpoint.url!, opts);
    if (!got.ok) {
      probes.push({
        endpoint,
        probedUrl: endpoint.url,
        reading: got.blocked
          ? // An address no buyer could reach is a fact about the address, so it is a real `false`.
            { challenge: false, reason: got.reason }
          : { challenge: "unknown", reason: got.reason },
      });
      continue;
    }

    const reading = classifyX402(got.res);
    probes.push({ endpoint, probedUrl: got.finalUrl, reading });
    // Stop at the first payable endpoint. One live till answers the question for the agent.
    if (reading.challenge === true) break;
  }

  const hit = probes.find((p) => p.reading.challenge === true);
  if (hit && hit.reading.challenge === true) {
    return {
      ...base,
      payable: true,
      probes,
      monadOption: hit.reading.monadOption,
      shapes: hit.reading.shapes,
      reason: `${hit.probedUrl} answered with ${hit.reading.reason}`,
    };
  }

  // **`unknown` outranks `false` here and the order is the point.** An endpoint we failed to read
  // could have been the one a buyer pays, so a timeout on it cannot be reported as an agent that
  // does not take payment. Collapsing the two would turn our own outage into a published finding
  // about somebody else.
  const cloudy = probes.find((p) => p.reading.challenge === "unknown");
  if (cloudy) {
    return {
      ...base,
      payable: "unknown",
      probes,
      reason: `${cloudy.probedUrl} could not be read: ${cloudy.reading.reason}`,
    };
  }

  const first = probes[0]!;
  return {
    ...base,
    payable: false,
    probes,
    reason:
      probes.length === 1
        ? `${first.probedUrl} answered and asked for no payment: ${first.reading.reason}`
        : `${probes.length} endpoints answered and none asked for payment, first: ${first.reading.reason}`,
  };
}

/* ------------------------------------------------------------------ helpers */

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Not text. An x402 challenge is JSON by specification, so this is not one.
    return "";
  }
}

function short(v: unknown): string {
  const s = String(v ?? "");
  return s.length <= 48 ? s : `${s.slice(0, 45)}...`;
}
