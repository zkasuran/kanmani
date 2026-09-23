import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyCvi,
  interpret,
  CleanverseConfigError,
  type FetchLike,
  type CleanverseConfig,
} from "./cleanverse.ts";

/**
 * These prove the two things that matter about a compliance read: it never returns "verified" unless
 * the API said so and an operational failure is "unknown" rather than "unverified". Everything runs
 * against an injected fetch, so no network is touched and every branch is reachable.
 */

const CVA = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D"; // Access USDC on Monad, read on chain
const WALLET = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";

/** A fetch that returns one canned envelope and records how it was called. */
function stubFetch(status: number, body: unknown, calls: { url?: string; init?: Parameters<FetchLike>[1] }[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

function cfg(over: Partial<CleanverseConfig> = {}): CleanverseConfig {
  return { apiId: "APP-TEST", cvaToken: CVA, chain: "monad", requestId: () => "fixed-id", ...over };
}

function ok(dataCode: number, message = "") {
  return { code: "0000", message: "ok", data: { code: dataCode, message } };
}

/* -------------------------------------------------------------------- states */

test("data.code 4 is verified", async () => {
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: stubFetch(200, ok(4, "apass verify success")) }));
  assert.equal(r.state, "verified");
  assert.equal(r.code, 4);
});

test("data.code 2 (no CVI) is unverified", async () => {
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: stubFetch(200, ok(2)) }));
  assert.equal(r.state, "unverified");
  assert.equal(r.code, 2);
});

test("data.code 3 (expired or frozen) is unverified", async () => {
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: stubFetch(200, ok(3)) }));
  assert.equal(r.state, "unverified");
});

test("data.code 1 (CVA not found) is unknown, because it is about the asset not the wallet", async () => {
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: stubFetch(200, ok(1)) }));
  assert.equal(r.state, "unknown");
});

/* ------------------------------------------------- unknown is never false */

test("a thrown fetch (network, timeout, refused redirect) is unknown, not unverified", async () => {
  const boom: FetchLike = async () => {
    throw new Error("ECONNREFUSED");
  };
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: boom }));
  assert.equal(r.state, "unknown");
  assert.notEqual(r.state, "unverified");
});

test("an aborted request reports timeout as unknown", async () => {
  const hang: FetchLike = async (_u, init) =>
    new Promise((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: hang, timeoutMs: 10 }));
  assert.equal(r.state, "unknown");
  assert.match(r.reason, /timeout/);
});

test("a non-2xx HTTP status is unknown", async () => {
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: stubFetch(500, "") }));
  assert.equal(r.state, "unknown");
  assert.match(r.reason, /http 500/);
});

test("a non-0000 envelope is unknown, never a verdict", async () => {
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: stubFetch(200, { code: "0002", message: "bad address", data: "" }) }));
  assert.equal(r.state, "unknown");
});

test("a body that is not json is unknown", async () => {
  const bad: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("not json");
    },
  });
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: bad }));
  assert.equal(r.state, "unknown");
});

test("an unrecognised data.code is unknown, never a pass", async () => {
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: stubFetch(200, ok(99)) }));
  assert.equal(r.state, "unknown");
});

test("a missing data object is unknown", async () => {
  const r = await verifyCvi(WALLET, cfg({ fetchImpl: stubFetch(200, { code: "0000", message: "ok" }) }));
  assert.equal(r.state, "unknown");
});

/* ------------------------------------------------------ request construction */

test("the request goes to the pinned host and path, with the values in the body not the url", async () => {
  const calls: { url?: string; init?: Parameters<FetchLike>[1] }[] = [];
  await verifyCvi(WALLET, cfg({ fetchImpl: stubFetch(200, ok(4), calls) }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://uatapi.cleanverse.com/api/cooperate/verify_apass");
  const init = calls[0].init!;
  assert.equal(init.redirect, "error");
  assert.equal(init.headers["api-id"], "APP-TEST");
  assert.equal(init.headers["x-request-id"], "fixed-id");
  const sent = JSON.parse(init.body);
  assert.deepEqual(sent, { atoken: CVA, chain: "monad", address: WALLET });
});

/* -------------------------------------------------------- config guards (SSRF) */

test("a non-0x wallet is a config error, never a silent unknown", async () => {
  await assert.rejects(() => verifyCvi("not-an-address", cfg({ fetchImpl: stubFetch(200, ok(4)) })), CleanverseConfigError);
});

test("a non-0x cvaToken is rejected", async () => {
  await assert.rejects(
    () => verifyCvi(WALLET, cfg({ cvaToken: "nope", fetchImpl: stubFetch(200, ok(4)) })),
    CleanverseConfigError,
  );
});

test("a non-https base url is rejected", async () => {
  await assert.rejects(
    () => verifyCvi(WALLET, cfg({ baseUrl: "http://uatapi.cleanverse.com", fetchImpl: stubFetch(200, ok(4)) })),
    CleanverseConfigError,
  );
});

test("a host that is not allowlisted is rejected, so a redirect target cannot be forged in config", async () => {
  await assert.rejects(
    () => verifyCvi(WALLET, cfg({ baseUrl: "https://evil.example.com", fetchImpl: stubFetch(200, ok(4)) })),
    CleanverseConfigError,
  );
});

test("an unsupported chain is rejected", async () => {
  await assert.rejects(
    () => verifyCvi(WALLET, cfg({ chain: "dogecoin", fetchImpl: stubFetch(200, ok(4)) })),
    CleanverseConfigError,
  );
});

test("a missing apiId is rejected", async () => {
  await assert.rejects(
    () => verifyCvi(WALLET, cfg({ apiId: "", fetchImpl: stubFetch(200, ok(4)) })),
    CleanverseConfigError,
  );
});

/* -------------------------------------------------------------- interpret() */

test("interpret maps the four documented codes directly", () => {
  assert.equal(interpret(ok(4)).state, "verified");
  assert.equal(interpret(ok(3)).state, "unverified");
  assert.equal(interpret(ok(2)).state, "unverified");
  assert.equal(interpret(ok(1)).state, "unknown");
  assert.equal(interpret({ code: "9999" }).state, "unknown");
});
