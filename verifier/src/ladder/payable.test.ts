/**
 * The `payable` rung, tested against the mistakes it exists to refuse.
 *
 * Three of these tests are the whole file. **`textPlain402IsNotPayable`**, because classifying a
 * 402 on its integer published 539 dead records as live agents asking for payment.
 * **`unknownNeverCollapses`**, because a rate limit is not evidence that somebody cannot be paid.
 * **`theGuardIsOnThePath`**, because this rung fetches URLs strangers put on a public chain.
 *
 * Every challenge body below is a real response measured on 2026-09-23, trimmed but not reshaped.
 * A fixture invented to match the parser proves nothing about the wild.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SKIP_HOSTS,
  classifyX402,
  declaredX402,
  exchange,
  fetchChallenge,
  looksLikeX402Header,
  payableCheck,
  serviceEndpoints,
  type ChallengeFetch,
  type EndpointResponse,
  type ProbeHeaders,
} from "./payable.ts";
import { connectionStringFrom } from "../store/store.ts";
import { resolveEvidence } from "./resolve.ts";

const enc = (s: string) => new TextEncoder().encode(s);

const response = (
  status: number,
  headers: ProbeHeaders = {},
  body = "",
): EndpointResponse => ({ status, headers, bytes: enc(body) });

/* ------------------------------------------------------------------ measured fixtures */

/**
 * `adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/adexto`, HTTP 402.
 *
 * A live challenge whose label says version 2 over entries written in the v1 shape: `scheme` and a
 * bare `network` at the top of the entry, the price under `maxAmountRequired`, `resource` as a
 * string. It settles on Base, not Monad.
 */
const ADEXTO_402 = JSON.stringify({
  x402Version: 2,
  error: "X-PAYMENT header is required",
  accepts: [
    {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "100000",
      resource: "https://adexto-x402-edge.cucuvirtual.workers.dev/v1/x402/buy/adexto",
      mimeType: "application/json",
      payTo: "0x24268Fffc119ec5550F68e80D94476fD64daE967",
      maxTimeoutSeconds: 300,
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      extra: { name: "USD Coin", version: "2", transferMethod: "eip3009" },
    },
  ],
});

const ADEXTO_HEADERS: ProbeHeaders = {
  "content-type": "application/json",
  "www-authenticate": 'x402 realm="adexto-buy-adexto"',
};

/**
 * `prooflines.org/.well-known/x402`, HTTP **200**.
 *
 * A catalogue rather than a till, with the offers nested under `resources[].accepts`. Its entries
 * carry `amount` and `maxAmountRequired` at once. Prices native MON on monad-testnet, which the
 * published chain list does not cover, so it must not read as a Monad mainnet option.
 */
const PROOFLINES_200 = JSON.stringify({
  x402Version: 2,
  name: "Prooflines Monad Network Intelligence",
  catalogues: ["https://prooflines.org/monad/x402/"],
  resources: [
    {
      resource: "https://prooflines.org/monad/x402/network-concentration-report",
      type: "http",
      method: "GET",
      accepts: [
        {
          scheme: "monad-native-exact",
          network: "monad-testnet",
          chainId: 10143,
          payTo: "0x7e3a2040F8D13a425E93C797630aB9828B59c806",
          amount: "10000000000000000",
          maxAmountRequired: "10000000000000000",
          maxTimeoutSeconds: 900,
          asset: "native",
          resource: "/monad/x402/network-concentration-report",
        },
      ],
    },
  ],
});

/** The v2 shape as the specification writes it: `amount`, CAIP-2 network, `resource` lifted out. */
const V2_SPEC_402 = JSON.stringify({
  x402Version: 2,
  error: "PAYMENT-SIGNATURE header is required",
  resource: { url: "https://api.example.com/premium-data", mimeType: "application/json" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:143",
      amount: "10000",
      asset: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60,
      extra: { name: "AUSD", version: "2" },
    },
  ],
  extensions: {},
});

/* ------------------------------------------------ THE TRAP: a status code is not a protocol */

test("textPlain402IsNotPayable: a suspended host answering 402 is not a live agent", () => {
  // The exact response that cost a published number. 539 records, 545 agents, one dead account.
  const r = classifyX402(
    response(
      402,
      { "content-type": "text/plain; charset=utf-8", "x-vercel-error": "DEPLOYMENT_DISABLED" },
      "The deployment could not be found",
    ),
  );
  assert.equal(r.challenge, false, "a vendor error 402 is a dead host, whatever the number says");
  assert.match(r.reason, /DEPLOYMENT_DISABLED/);
});

test("a 402 with nothing to say for itself is not payable", () => {
  const r = classifyX402(response(402, {}, ""));
  assert.equal(r.challenge, false);
  assert.match(r.reason, /carrying no x402 challenge/);
});

test("a 402 whose body is prose rather than a challenge is not payable", () => {
  const r = classifyX402(response(402, { "content-type": "text/html" }, "<h1>Payment Required</h1>"));
  assert.equal(r.challenge, false);
});

test("a real challenge is payable and it is the payload that says so", () => {
  const r = classifyX402(response(402, ADEXTO_HEADERS, ADEXTO_402));
  assert.equal(r.challenge, true);
  if (r.challenge !== true) return;
  assert.equal(r.kind, "challenge");
  assert.equal(r.offers.length, 1);
  assert.equal(r.offers[0]!.payTo, "0x24268Fffc119ec5550F68e80D94476fD64daE967");
  assert.equal(r.offers[0]!.actionable, true);
});

test("an accepts array with no payTo and no amount is not an offer", () => {
  // A buyer needs somewhere to send money and a number. Without both there is nothing to act on,
  // so this is unknown rather than a payable agent conjured out of an empty object.
  const r = classifyX402(response(402, ADEXTO_HEADERS, JSON.stringify({ x402Version: 2, accepts: [{}] })));
  assert.equal(r.challenge, "unknown");
  assert.match(r.reason, /nothing a buyer could act on/);
});

test("the www-authenticate scheme is read as a token, not as a substring", () => {
  assert.equal(looksLikeX402Header('x402 realm="pay"'), true);
  assert.equal(looksLikeX402Header("X402"), true);
  assert.equal(looksLikeX402Header('Basic realm="x", x402'), true);
  // A bearer challenge that happens to mention x402 is a bearer challenge.
  assert.equal(looksLikeX402Header('Bearer realm="x402-gated"'), false);
  assert.equal(looksLikeX402Header("Bearer"), false);
  assert.equal(looksLikeX402Header(undefined), false);
});

/* ------------------------------------------------------------------ v1 and v2 */

test("the v1 shape is read from maxAmountRequired even when the label says version 2", () => {
  // ADEXTO, measured. Trusting `x402Version` would read this as v2 and find no price at all.
  const r = classifyX402(response(402, ADEXTO_HEADERS, ADEXTO_402));
  assert.equal(r.challenge, true);
  if (r.challenge !== true) return;
  assert.deepEqual(r.shapes, ["v1"], "the entry is v1 shaped");
  assert.equal(r.declaredVersion, 2, "and the label still says 2, so both are recorded");
  assert.equal(r.offers[0]!.amount, "100000");
  assert.equal(r.offers[0]!.network, "base");
  assert.equal(r.monadOption, false, "it settles on Base, so Monad is not an option here");
});

test("the v2 shape is read from amount, with a CAIP-2 network", () => {
  const r = classifyX402(response(402, ADEXTO_HEADERS, V2_SPEC_402));
  assert.equal(r.challenge, true);
  if (r.challenge !== true) return;
  assert.deepEqual(r.shapes, ["v2"]);
  assert.equal(r.offers[0]!.amount, "10000");
  assert.equal(r.offers[0]!.chainId, 143, "eip155:143 resolves through the published chain list");
  assert.equal(r.monadOption, true);
});

test("an entry carrying both amount keys is hybrid, not silently one of them", () => {
  const r = classifyX402(response(200, { "content-type": "application/json" }, PROOFLINES_200));
  assert.equal(r.challenge, true);
  if (r.challenge !== true) return;
  assert.deepEqual(r.shapes, ["hybrid"]);
  assert.equal(r.offers[0]!.amount, "10000000000000000");
  assert.equal(r.offers[0]!.asset, "native");
});

test("a 200 catalogue is payable AND is recorded as a catalogue rather than a challenge", () => {
  const r = classifyX402(response(200, { "content-type": "application/json" }, PROOFLINES_200));
  assert.equal(r.challenge, true);
  if (r.challenge !== true) return;
  assert.equal(r.kind, "catalogue", "nobody demanded payment, they published a price list");
});

test("monad-testnet is not Monad mainnet and must not read as one", () => {
  // Chain 10143 is not in the published list, so it resolves to nothing and the author's own
  // string survives. Rounding it to Monad would claim a mainnet rail this build never saw.
  const r = classifyX402(response(200, {}, PROOFLINES_200));
  assert.equal(r.challenge, true);
  if (r.challenge !== true) return;
  assert.equal(r.offers[0]!.network, "monad-testnet");
  assert.equal(r.offers[0]!.chainId, undefined);
  assert.equal(r.monadOption, false);
});

/* ------------------------------------------- unknown is a first class answer, never a false */

test("unknownNeverCollapses: a rate limit, a 5xx and a wrong method are all unknown", () => {
  for (const [status, needle] of [
    [429, /rate limiting/],
    [500, /server error/],
    [502, /server error/],
    [503, /server error/],
  ] as const) {
    const r = classifyX402(response(status, {}, ""));
    assert.equal(r.challenge, "unknown", `HTTP ${status} must not read as unpayable`);
    assert.match(r.reason, needle);
  }
});

test("a 405 to a GET is unknown and names the methods it does allow", () => {
  // Measured: agent-arcade-steel.vercel.app/api/x402/action answers 405 to a GET while declaring
  // x402Support. A challenge we did not ask for correctly is a challenge we did not see.
  const r = classifyX402(response(405, { allow: "POST, OPTIONS" }, ""));
  assert.equal(r.challenge, "unknown");
  assert.match(r.reason, /allows POST, OPTIONS/);
});

test("a header with no requirements is unknown, because there is nowhere to send money", () => {
  const r = classifyX402(response(402, { "www-authenticate": "x402" }, ""));
  assert.equal(r.challenge, "unknown");
  assert.match(r.reason, /no readable accepts array/);
});

test("a definitive read with no challenge is false, which is a different answer", () => {
  for (const [status, needle] of [
    [200, /asks for no payment|answers for free/],
    [404, /not there/],
    [410, /not there/],
    [401, /credentials rather than by payment/],
    [403, /credentials rather than by payment/],
  ] as const) {
    const r = classifyX402(response(status, { "content-type": "application/json" }, "{}"));
    assert.equal(r.challenge, false, `HTTP ${status} was read successfully`);
    assert.match(r.reason, needle);
  }
});

test("a body that is not UTF-8 does not throw and is not a challenge", () => {
  const r = classifyX402({ status: 402, headers: {}, bytes: new Uint8Array([0xff, 0xfe, 0x00]) });
  assert.equal(r.challenge, false);
});

/* ------------------------------------------------------------------ reading a document */

/** `claw.tormund.io`, measured. Services with a description and no address at all. */
const CLAW = {
  name: "Claw",
  services: [
    { name: "email-triage", description: "Email sorting and draft composition" },
    { name: "x402", description: "HTTP 402 payment protocol" },
  ],
  x402Support: {
    verified: true,
    verifiedAt: "2026-02-10T13:57:08.236Z",
    donationTx: "0x01377ebc382882e614b6fd80f079f93b9a3570b297230735ff7d934ed6949e56",
    donationAmount: "$1.00",
    facilitator: "https://x402-facilitator.molandak.org",
    network: "eip155:143",
    treasury: "0xBC0e32c8fd8c57E50De41C388C759cEf53719BA4",
  },
};

/** `prooflines.org`, measured. Four services, the x402 one declared last. */
const PROOFLINES_DOC = {
  name: "Prooflines",
  services: [
    { name: "web", endpoint: "https://prooflines.org/monad/" },
    { name: "A2A", endpoint: "https://prooflines.org/.well-known/agent-card.json", version: "0.3.0" },
    { name: "MCP", endpoint: "https://prooflines.org/mcp", version: "2025-06-18" },
    { name: "x402", endpoint: "https://prooflines.org/.well-known/x402" },
  ],
  x402Support: true,
};

/** `api.pr4gma.xyz`, measured. One of the three services is a wallet, not a URL. */
const PR4GMA = {
  name: "pr4gma",
  services: [
    { name: "MCP", endpoint: "https://api.pr4gma.xyz", version: "0.8.57" },
    { name: "web", endpoint: "https://pr4gma.xyz" },
    { name: "agentWallet", endpoint: "eip155:143:0xCb9EA18579EB357E78EBB3EFaE6E9a594225c4f8" },
  ],
};

test("the author's own x402 label decides probe order and nothing else", () => {
  const got = serviceEndpoints(PROOFLINES_DOC);
  assert.equal(got.length, 4);
  assert.equal(got[0]!.label, "x402", "declared fourth, tried first");
  assert.equal(got[0]!.url, "https://prooflines.org/.well-known/x402");
  assert.equal(got[1]!.label, "web", "then declaration order");
});

test("a CAIP-10 account is kept as a declaration that cannot be paid, not dropped", () => {
  const got = serviceEndpoints(PR4GMA);
  assert.equal(got.length, 3);
  const wallet = got.find((e) => e.label === "agentWallet")!;
  assert.equal(wallet.url, undefined);
  assert.match(wallet.notAddressable!, /not fetchable here/);
  assert.match(wallet.notAddressable!, /eip155:143/, "the author's own string is the evidence");
});

test("a service with a description and no endpoint reads as declared but unpayable", () => {
  const got = serviceEndpoints(CLAW);
  assert.equal(got.length, 2);
  assert.ok(got.every((e) => e.url === undefined));
  assert.match(got[0]!.notAddressable!, /declares no endpoint or url/);
});

test("the two skill shapes on Monad both yield endpoints", () => {
  // Our own card writes objects under `skills`. Most documents write them under `services`.
  const kanmani = serviceEndpoints({
    name: "Kanmani",
    url: "https://kanmani.xyz",
    skills: [
      { id: "verify-payment-claim", endpoint: "https://kanmani.xyz/api/verify", payment: "x402" },
      { id: "validate-on-request", endpoint: "https://kanmani.xyz/validate" },
    ],
  });
  assert.equal(kanmani[0]!.label, "verify-payment-claim");
  assert.equal(kanmani[0]!.labelledX402, true, "payment: x402 is the author naming their rail");
  assert.equal(kanmani.length, 3, "the card's own url is a last-resort candidate");
  assert.equal(kanmani[2]!.declaredAt, "url");
});

test("a skills array of plain words carries no endpoint and is not mistaken for one", () => {
  // `clawd.party`, measured: eight skills as strings plus priced endpoints with no URL.
  const got = serviceEndpoints({
    skills: ["Go-to-market strategy", "Product analysis"],
    endpoints: [{ name: "strategy_consultation", method: "POST", price: 0.05 }],
  });
  assert.equal(got.filter((e) => e.url !== undefined).length, 0);
  assert.equal(got.length, 1, "only the priced endpoint object is a declaration");
});

test("an empty services array declares nothing", () => {
  // 483 records on Monad, measured. One dashboard publishing empty registrations.
  assert.deepEqual(serviceEndpoints({ name: "x", services: [] }), []);
  assert.deepEqual(serviceEndpoints(null), []);
  assert.deepEqual(serviceEndpoints("a string"), []);
});

test("declaredX402 reads both real shapes and never invents a claim", () => {
  assert.deepEqual(declaredX402({ x402Support: true }), { claimed: true });
  assert.deepEqual(declaredX402({ x402Support: false }), { claimed: false });
  assert.deepEqual(declaredX402({}), { claimed: false });
  assert.deepEqual(declaredX402({ x402Support: "yes" }), { claimed: false }, "a string is not the object form");

  const d = declaredX402(CLAW);
  assert.equal(d.claimed, true);
  assert.equal(d.settlementTx, CLAW.x402Support.donationTx);
  assert.equal(d.network, "eip155:143");
  assert.equal(d.treasury, CLAW.x402Support.treasury);
});

/* ------------------------------------------------------------------ the guard is on the path */

test("theGuardIsOnThePath: a literal private address is refused before any request", async () => {
  for (const url of [
    "http://127.0.0.1:9/x402",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]:8081/v1/graphql",
    "http://10.0.0.5/pay",
  ]) {
    const r = await fetchChallenge(url);
    assert.equal(r.ok, false, `${url} must be refused`);
    if (r.ok === false) assert.equal(r.blocked, true, "blocked is a fact about the address");
  }
});

test("theGuardIsOnThePath: every DNS answer is screened, not just the first", async () => {
  const r = await fetchChallenge("http://mixed.invalid/x402", {
    resolver: async () => ["93.184.216.34", "127.0.0.1"],
  });
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.match(r.reason, /127\.0\.0\.1/);
    assert.equal(r.blocked, true);
  }
});

test("theGuardIsOnThePath: a real server behind a rebound hostname is still refused", async () => {
  const s = await listen((_req, res) => {
    res.writeHead(402, { "www-authenticate": "x402", "content-type": "application/json" });
    res.end(ADEXTO_402);
  });
  try {
    const r = await fetchChallenge(`http://sneaky.invalid:${s.port}/x402`, {
      resolver: async () => ["127.0.0.1"],
      timeoutMs: 2500,
    });
    assert.equal(r.ok, false, "the screen wins even though a real challenge is really there");
  } finally {
    s.close();
  }
});

test("a DNS failure is unknown, not a blocked address, because the two mean different things", async () => {
  const r = await fetchChallenge("http://nope.invalid/x402", {
    resolver: async () => {
      throw new Error("NXDOMAIN");
    },
  });
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.match(r.reason, /DNS lookup failed/);
    assert.equal(r.blocked, false, "we failed to look, which is not a fact about the address");
  }
});

test("a do-not-probe host is refused with its reason and never contacted", async () => {
  let resolved = false;
  for (const host of Object.keys(SKIP_HOSTS)) {
    const r = await fetchChallenge(`https://${host}/api/x402`, {
      resolver: async () => {
        resolved = true;
        return ["93.184.216.34"];
      },
    });
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.match(r.reason, /not probed/);
      assert.equal(r.blocked, false, "we chose not to look, so it must read as unknown");
    }
  }
  assert.equal(resolved, false, "DNS was never even asked");
});

/* --------------------------------------------- transport: the body survives a non-2xx */

function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => {
      resolve({ port: (s.address() as { port: number }).port, close: () => s.close() });
    });
  });
}

test("THE BODY OF A 402 IS KEPT, which the shared guarded fetch throws away", async () => {
  // The reason this rung has its own exchange. `guardedFetch` destroys the response on any non-2xx
  // and the 402 body is exactly what the classification reads.
  const s = await listen((_req, res) => {
    res.writeHead(402, { "www-authenticate": 'x402 realm="pay"', "content-type": "application/json" });
    res.end(ADEXTO_402);
  });
  try {
    const r = await exchange(new URL(`http://x:${s.port}/x402`), ["127.0.0.1"], 65_536, 2500);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.status, 402);
    assert.equal(Buffer.from(r.bytes).toString("utf8"), ADEXTO_402);
    const reading = classifyX402({ status: r.status, headers: r.headers, bytes: r.bytes });
    assert.equal(reading.challenge, true);
  } finally {
    s.close();
  }
});

test("headers arrive lowercased and flattened, so a repeated header is not lost", async () => {
  const s = await listen((_req, res) => {
    res.writeHead(402, { "WWW-Authenticate": "x402", "X-Vercel-Error": "DEPLOYMENT_DISABLED" });
    res.end("no");
  });
  try {
    const r = await exchange(new URL(`http://x:${s.port}/`), ["127.0.0.1"], 4096, 2500);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.headers["www-authenticate"], "x402");
    assert.equal(r.headers["x-vercel-error"], "DEPLOYMENT_DISABLED");
  } finally {
    s.close();
  }
});

test("an endless challenge body is cut off at the cap", async () => {
  let stopped = false;
  const s = await listen((_req, res) => {
    res.writeHead(402, { "content-type": "application/json" });
    const pump = () => {
      if (stopped || res.writableEnded) return;
      if (!res.write("A".repeat(4096))) {
        res.once("drain", pump);
        return;
      }
      setImmediate(pump);
    };
    res.on("close", () => {
      stopped = true;
    });
    pump();
  });
  try {
    const r = await exchange(new URL(`http://x:${s.port}/`), ["127.0.0.1"], 4096, 2500);
    assert.equal(r.ok, false);
    if (r.ok === false) assert.match(r.reason, /exceeds 4096 bytes/);
  } finally {
    stopped = true;
    s.close();
  }
});

test("a hanging endpoint is a timeout rather than a stuck probe", async () => {
  const s = await listen(() => {
    /* never responds */
  });
  try {
    const r = await exchange(new URL(`http://x:${s.port}/`), ["127.0.0.1"], 4096, 700);
    assert.equal(r.ok, false);
    if (r.ok === false) assert.match(r.reason, /timed out/);
  } finally {
    s.close();
  }
});

test("a redirect is reported as a redirect rather than followed by the runtime", async () => {
  const s = await listen((_req, res) => {
    res.writeHead(302, { location: "http://127.0.0.1:9/internal" });
    res.end();
  });
  try {
    const r = await exchange(new URL(`http://x:${s.port}/`), ["127.0.0.1"], 4096, 2500);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.redirectTo, "http://127.0.0.1:9/internal");
    // That Location is what the hop loop re-screens. It has to lose.
    const again = await fetchChallenge(r.redirectTo!);
    assert.equal(again.ok, false, "the redirect target is loopback and has to be blocked");
  } finally {
    s.close();
  }
});

/* ------------------------------------------------------------------ the rung */

const at = () => new Date("2026-09-23T00:00:00.000Z");

/** A probe seam returning canned answers in order, so the ordering rules are tested directly. */
function canned(...answers: ChallengeFetch[]): {
  probe: (url: string) => Promise<ChallengeFetch>;
  urls: string[];
} {
  const urls: string[] = [];
  let i = 0;
  return {
    urls,
    probe: async (url: string) => {
      urls.push(url);
      return answers[Math.min(i++, answers.length - 1)]!;
    },
  };
}

const answered = (status: number, headers: ProbeHeaders, body: string): ChallengeFetch => ({
  ok: true,
  finalUrl: "https://probed.example/x",
  res: response(status, headers, body),
});

test("a document with no fetchable endpoint is noOffer, which is not a false", async () => {
  const r = await payableCheck(CLAW, { now: at, probe: async () => ({ ok: false, reason: "never", blocked: false }) });
  assert.equal(r.payable, "noOffer", "nothing was asked, so nothing was refused");
  assert.equal(r.probes.length, 0);
  assert.equal(r.endpoints.length, 2, "the declarations are still on the record");
  assert.equal(r.declared.claimed, true, "the agent's own claim sits beside the noOffer");
  assert.equal(r.checkedAt, "2026-09-23T00:00:00.000Z");
});

test("an empty services array is noOffer and says so plainly", async () => {
  const r = await payableCheck({ name: "dashboard", services: [] }, { now: at });
  assert.equal(r.payable, "noOffer");
  assert.match(r.reason, /declares no service endpoint at all/);
});

test("the walk stops at the first payable endpoint", async () => {
  const c = canned(answered(402, ADEXTO_HEADERS, ADEXTO_402));
  const r = await payableCheck(PROOFLINES_DOC, { now: at, gapMs: 0, probe: c.probe });
  assert.equal(r.payable, true);
  assert.equal(c.urls.length, 1, "one live till answers the question for the agent");
  assert.equal(c.urls[0], "https://prooflines.org/.well-known/x402", "the x402 endpoint went first");
  assert.deepEqual(r.shapes, ["v1"]);
  assert.equal(r.monadOption, false);
});

test("UNKNOWN OUTRANKS FALSE across endpoints, so an outage never reads as unpayable", async () => {
  // Endpoint one answered and asked for nothing. Endpoint two timed out. A buyer could have paid
  // through the second, so the agent-level answer cannot be false.
  const c = canned(
    answered(200, { "content-type": "application/json" }, "{}"),
    { ok: false, reason: "timed out after 8000ms", blocked: false },
  );
  const r = await payableCheck(PROOFLINES_DOC, { now: at, gapMs: 0, probe: c.probe });
  assert.equal(c.urls.length, 2);
  assert.equal(r.payable, "unknown");
  assert.match(r.reason, /timed out/);
});

test("false is reached only when every probe was a definitive read", async () => {
  const c = canned(answered(404, {}, ""), answered(200, { "content-type": "text/html" }, "<html>"));
  const r = await payableCheck(PROOFLINES_DOC, { now: at, gapMs: 0, probe: c.probe });
  assert.equal(r.payable, false);
  assert.match(r.reason, /none asked for payment/);
});

test("an endpoint no buyer could reach is a false about the address, not an unknown", async () => {
  const r = await payableCheck(
    { services: [{ name: "web", endpoint: "http://localhost:5173/" }] },
    { now: at, gapMs: 0 },
  );
  // Measured: two records on Monad declare a localhost URL. Nobody but the operator can pay it.
  assert.equal(r.payable, false);
  assert.match(r.reason, /blocked/);
});

test("probes of one agent are serial with a gap, never a parallel hammer", async () => {
  const stamps: number[] = [];
  const probe = async (): Promise<ChallengeFetch> => {
    stamps.push(Date.now());
    return answered(404, {}, "");
  };
  await payableCheck(PROOFLINES_DOC, { now: at, gapMs: 120, probe });
  assert.equal(stamps.length, 2, "capped at maxEndpoints, which defaults to 2");
  assert.ok(stamps[1]! - stamps[0]! >= 110, `gap was ${stamps[1]! - stamps[0]!}ms, expected 120`);
});

test("maxEndpoints caps how much of somebody's deployment we touch", async () => {
  const c = canned(answered(404, {}, ""));
  await payableCheck(PROOFLINES_DOC, { now: at, gapMs: 0, maxEndpoints: 1, probe: c.probe });
  assert.equal(c.urls.length, 1);
});

test("no reason string states intent, because somebody's reputation is attached", async () => {
  const banned = /\b(lying|lied|fraud|fake|scam|dishonest|malicious|abandoned)\b/i;
  const cases: string[] = [];
  for (const res of [
    response(402, { "content-type": "text/plain", "x-vercel-error": "DEPLOYMENT_DISABLED" }, "x"),
    response(402, {}, ""),
    response(429, {}, ""),
    response(405, { allow: "POST" }, ""),
    response(200, {}, "{}"),
    response(402, ADEXTO_HEADERS, ADEXTO_402),
    response(200, {}, PROOFLINES_200),
  ]) {
    cases.push(classifyX402(res).reason);
  }
  const outcomes = await Promise.all([
    payableCheck(CLAW, { now: at }),
    payableCheck({ services: [] }, { now: at }),
    payableCheck(PROOFLINES_DOC, { now: at, gapMs: 0, probe: async () => answered(404, {}, "") }),
  ]);
  for (const s of [...cases, ...outcomes.map((o) => o.reason)]) {
    assert.doesNotMatch(s, banned, `reason states intent: ${s}`);
  }
});

/* ------------------------------------------------------------------ against the real database */

/**
 * The integration test, gated on a real Postgres.
 *
 * Two halves. The extractors are run over **every registration document the indexer holds that is
 * readable without a network**, which is the only way to know the shapes above are the real ones
 * rather than the ones we happened to write fixtures for. Then the view is exercised in a throwaway
 * database, because `payable_state` is where the 402 trap is finally decided for a page.
 *
 * Skipped with a loud reason when no database is configured, rather than passing quietly.
 */
const TEST_DB = "fovea_payable_test";

let adminConn: string | null = null;
try {
  adminConn = connectionStringFrom();
} catch {
  adminConn = null;
}
const skip = adminConn ? false : "no database configured: set ENVIO_PG_PASSWORD or FOVEA_DATABASE_URL";

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** Refuses to write anywhere but the scratch database, same guard the store tests carry. */
function assertScratch(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name !== TEST_DB) throw new Error(`refusing to write to "${name}", only ${TEST_DB}`);
}

let indexer: pg.Client | null = null;
let scratch: pg.Client | null = null;

before(async () => {
  if (!adminConn) return;
  // Read only, against the indexer's own database. Nothing here writes to it.
  indexer = new pg.Client({ connectionString: adminConn });
  await indexer.connect();

  const admin = new pg.Client({ connectionString: withDatabase(adminConn, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const conn = withDatabase(adminConn, TEST_DB);
  assertScratch(conn);
  scratch = new pg.Client({ connectionString: conn });
  await scratch.connect();
  const here = dirname(fileURLToPath(import.meta.url));
  await scratch.query(readFileSync(join(here, "../store/schema.sql"), "utf8"));
});

after(async () => {
  await indexer?.end();
  await scratch?.end();
  if (!adminConn) return;
  const admin = new pg.Client({ connectionString: withDatabase(adminConn, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

test("the extractors survive every offline registration document in the corpus", { skip }, async () => {
  const rows = await indexer!.query<{ id: string; uri: string }>(
    `SELECT id, uri FROM "AgentRecord"
      WHERE "chainId" = 143 AND (uri LIKE 'data:%' OR uri LIKE '{%')`,
  );
  assert.ok(rows.rowCount! > 0, "there are offline documents to read");

  let withEndpoint = 0;
  let declaring = 0;
  let notAddressable = 0;

  for (const row of rows.rows) {
    // An inline document is the tokenURI itself. A data: URI decodes in process. Neither touches a
    // network, which is why the query above asks only for those two: an integration test must not
    // fetch 2,000 strangers' servers to prove a parser works.
    const bytes = row.uri.startsWith("{")
      ? enc(row.uri)
      : await (async () => {
          const r = await resolveEvidence(row.uri);
          return r.ok ? r.bytes : undefined;
        })();
    if (bytes === undefined) continue;

    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      continue; // prose and broken JSON are not registration documents
    }

    // The assertion is that this never throws on a real document, whatever shape it is.
    const endpoints = serviceEndpoints(doc);
    declaredX402(doc);
    if (endpoints.length > 0) declaring++;
    if (endpoints.some((e) => e.url !== undefined)) withEndpoint++;
    if (endpoints.some((e) => e.notAddressable !== undefined)) notAddressable++;
  }

  assert.ok(declaring > 0, `some real documents declare services, got ${declaring}`);
  assert.ok(withEndpoint > 0, `some real declarations are fetchable, got ${withEndpoint}`);
  console.log(
    `  real corpus: ${rows.rowCount} offline documents, ${declaring} declaring, ` +
      `${withEndpoint} with a fetchable endpoint, ${notAddressable} declaring something unpayable`,
  );
});

test("payable_state decides the 402 trap for a page, not http_status", { skip }, async () => {
  // The same bug as `record_state`, one rung further along: both rows below would be a 402 on the
  // wire. Only the one carrying a real challenge is payable. The suspended host is `free`
  // rather than a live agent asking to be paid.
  const rows = [
    { h: "live-monad", payable: "true", monad: true, claims: true, status: 402, vendor: null, shape: "v2" },
    { h: "live-base", payable: "true", monad: false, claims: true, status: 402, vendor: null, shape: "v1" },
    { h: "dead-402", payable: "false", monad: null, claims: true, status: 402,
      vendor: "DEPLOYMENT_DISABLED", shape: null },
    { h: "quiet", payable: "false", monad: null, claims: false, status: 200, vendor: null, shape: null },
    { h: "ratelimited", payable: "unknown", monad: null, claims: true, status: 429, vendor: null, shape: null },
    { h: "nothing", payable: "noOffer", monad: null, claims: false, status: null, vendor: null, shape: null },
  ];
  for (const r of rows) {
    await scratch!.query(
      `INSERT INTO fovea.payable_probe
         (uri_hash, uri, probed_url, payable, reason, http_status, vendor_error,
          monad_option, claims_x402, accepts_shape, checked_at)
       VALUES ($1,$2,$3,$4,'measured',$5,$6,$7,$8,$9,now())`,
      [r.h, `https://${r.h}/doc.json`, `https://${r.h}/x402`, r.payable, r.status, r.vendor,
       r.monad, r.claims, r.shape],
    );
  }

  const state = async (h: string): Promise<string> => {
    const q = await scratch!.query<{ state: string }>(
      "SELECT state FROM fovea.payable_state WHERE uri_hash = $1",
      [h],
    );
    return q.rows[0]!.state;
  };

  assert.equal(await state("live-monad"), "payable-monad");
  assert.equal(await state("live-base"), "payable-elsewhere", "payable off Monad is a finding, not a failure");
  assert.equal(await state("dead-402"), "claimed-unconfirmed", "a 402 from a dead host is not a paywall");
  assert.equal(await state("quiet"), "free");
  assert.equal(await state("ratelimited"), "unknown", "OUR failure must never read as theirs");
  assert.equal(await state("nothing"), "noendpoint");
});

test("the payable column refuses an outcome the rung cannot produce", { skip }, async () => {
  await assert.rejects(
    () =>
      scratch!.query(
        `INSERT INTO fovea.payable_probe (uri_hash, uri, payable, reason, checked_at)
         VALUES ('bad','https://x/','probably','measured',now())`,
      ),
    /violates check constraint/,
  );
});
