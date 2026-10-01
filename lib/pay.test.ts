import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress, verifyTypedData } from "viem";
import { deriveKeys } from "./iris.ts";
import { openSession, type ScopedSession } from "./session.ts";
import {
  buildAuthorization,
  buildPaymentPayload,
  chainIdFromNetwork,
  type Eip3009Authorization,
  encodePaymentHeader,
  formatUsdc,
  MONAD_EXPLORER_TX,
  payForVerification,
  signAuthorization,
  usdcDomain,
  verificationPrice,
  verificationScope,
} from "./pay.ts";
import { NETWORK, paymentFrom, requirements, USDC_MONAD } from "./x402.ts";
import { TESTNET_USDC_FALLBACK } from "./pay-net.ts";

const PINNED_PRF = new Uint8Array(32).map((_, i) => i + 1);
const PINNED_ACCOUNT = "0x92c2a8984eb7b890FfB4c6B57560Ac4E4868454B";

/**
 * The domain USDC actually signs under on Monad, pinned here on its own rather than read from
 * `usdcDomain()`. That independence is the point: if the module's domain drifts, this constant does
 * not move with it, so the recovery check catches the drift.
 */
const EXPECTED_DOMAIN = {
  name: "USDC",
  version: "2",
  chainId: 143,
  verifyingContract: USDC_MONAD as `0x${string}`,
} as const;

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function messageOf(auth: Eip3009Authorization) {
  return {
    from: auth.from,
    to: auth.to,
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
  };
}

async function pinnedSession(now = () => 1_700_000_000_000): Promise<ScopedSession> {
  const keys = await deriveKeys(PINNED_PRF);
  return openSession({
    privateKey: keys.account.privateKey,
    scope: verificationScope(50_000n, "kanmani.xyz"),
    ttlMs: 60_000,
    seams: { now },
  });
}

function decodeHeader(header: string): {
  signature: `0x${string}`;
  authorization: Eip3009Authorization;
} {
  const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  return { signature: parsed.payload.signature, authorization: parsed.payload.authorization };
}

/* ---------------------------------------------- the authorization the client builds */

test("the authorization is built from the server's requirements, not from local numbers", async () => {
  const session = await pinnedSession();
  const auth = buildAuthorization({
    from: session.address,
    now: 1_700_000_000_000,
    nonce: `0x${"11".repeat(32)}`,
  });
  const req = requirements();
  assert.equal(auth.from, PINNED_ACCOUNT);
  assert.equal(auth.to, req.payTo);
  assert.equal(auth.value, req.amount);
  assert.equal(auth.value, "10000", "0.01 USDC at six decimals");
  assert.equal(auth.validAfter, "0");
  assert.equal(auth.validBefore, String(1_700_000_000 + req.maxTimeoutSeconds));
  assert.equal(auth.nonce, `0x${"11".repeat(32)}`);
});

/* ---------------------------------------------- the signature is real, checked by recovery */

test("the session-signed authorization recovers to the account address", async () => {
  const session = await pinnedSession();
  const auth = buildAuthorization({ from: session.address, now: 1_700_000_000_000, nonce: `0x${"22".repeat(32)}` });
  const signature = await signAuthorization(session, auth);

  const ok = await verifyTypedData({
    address: session.address,
    domain: EXPECTED_DOMAIN,
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: messageOf(auth),
    signature,
  });
  assert.equal(ok, true, "the facilitator will recover this signer under USDC's real domain");

  const recovered = await recoverTypedDataAddress({
    domain: EXPECTED_DOMAIN,
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: messageOf(auth),
    signature,
  });
  assert.equal(recovered.toLowerCase(), session.address.toLowerCase());
});

test("the module domain matches USDC's real EIP-712 domain on Monad", () => {
  const d = usdcDomain();
  assert.deepEqual(d, EXPECTED_DOMAIN);
  assert.equal(chainIdFromNetwork(NETWORK), 143);
});

/* ---------------------------------------------- the header the server route parses */

test("the payment header round-trips through the server's own paymentFrom", async () => {
  const session = await pinnedSession();
  const auth = buildAuthorization({ from: session.address, now: 1_700_000_000_000, nonce: `0x${"33".repeat(32)}` });
  const signature = await signAuthorization(session, auth);
  const payload = buildPaymentPayload({ resourceUrl: "https://kanmani.xyz/api/verify", authorization: auth, signature });
  const header = encodePaymentHeader(payload);

  const parsed = paymentFrom(new Headers({ "x-payment": header }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.header, "X-PAYMENT");
    assert.equal(parsed.payload.accepted.scheme, "exact");
    assert.equal(parsed.payload.accepted.network, NETWORK);
    assert.equal((parsed.payload.payload as { authorization: Record<string, string> }).authorization.from, session.address);
  }

  // The header the server sees carries a signature that recovers to `from`, so it is signed.
  const decoded = decodeHeader(header);
  const ok = await verifyTypedData({
    address: session.address,
    domain: EXPECTED_DOMAIN,
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: messageOf(decoded.authorization),
    signature: decoded.signature,
  });
  assert.equal(ok, true);
});

/* ---------------------------------------------- the driver, with an injected fetch */

test("payForVerification signs, attaches X-PAYMENT and reports the settlement", async () => {
  const session = await pinnedSession();
  let seenHeader: string | null = null;
  let seenBody: string | null = null;

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    seenHeader = headers["X-PAYMENT"] ?? null;
    seenBody = init.body as string;
    // Prove the header the driver sent is a real signature over the authorization.
    const decoded = decodeHeader(seenHeader!);
    const ok = await verifyTypedData({
      address: session.address,
      domain: EXPECTED_DOMAIN,
      types: TYPES,
      primaryType: "TransferWithAuthorization",
      message: messageOf(decoded.authorization),
      signature: decoded.signature,
    });
    assert.equal(ok, true, "the driver sent a genuinely signed authorization");
    const envelope = {
      data: { paid: true, payment: { settled: true, transaction: "0xabc123", payer: session.address }, verdict: { outcome: "true" } },
    };
    return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const result = await payForVerification({
    session,
    target: { id: "143_10182_7" },
    fetchImpl,
    now: 1_700_000_000_000,
    nonce: `0x${"44".repeat(32)}`,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.settlement.settled, true);
    assert.equal(result.settlement.transaction, "0xabc123");
    assert.equal(result.settlement.txUrl, `${MONAD_EXPLORER_TX}0xabc123`);
    assert.equal(result.settlement.paid, true);
  }
  assert.ok(seenHeader, "the driver attached the X-PAYMENT header");
  assert.equal(JSON.parse(seenBody!).id, "143_10182_7");
});

test("payForVerification surfaces a facilitator refusal as a not-ok result", async () => {
  const session = await pinnedSession();
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ title: "payment", detail: "insufficient_funds" }), {
      status: 402,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  const result = await payForVerification({ session, target: { id: "x" }, fetchImpl, now: 1_700_000_000_000 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 402);
    assert.match(result.reason, /insufficient_funds/);
  }
});

/* ---------------------------------------------- the session gates reach the driver */

test("an expired session makes payForVerification re-prompt rather than fetch", async () => {
  const clock = { t: 1_700_000_000_000 };
  const session = await deriveKeys(PINNED_PRF).then((keys) =>
    openSession({
      privateKey: keys.account.privateKey,
      scope: verificationScope(50_000n, "kanmani.xyz"),
      ttlMs: 10_000,
      seams: { now: () => clock.t },
    }),
  );
  clock.t += 10_001;

  let fetched = false;
  const fetchImpl = (async () => {
    fetched = true;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => payForVerification({ session, target: { id: "x" }, fetchImpl }),
    (e: unknown) => (e as { code?: string }).code === "SESSION_EXPIRED",
  );
  assert.equal(fetched, false, "an expired session never reaches the network");
});

test("an authorization from another address is refused before signing", async () => {
  const session = await pinnedSession();
  const auth = buildAuthorization({ from: "0x000000000000000000000000000000000000dEaD", now: 1_700_000_000_000 });
  await assert.rejects(
    () => signAuthorization(session, auth),
    (e: unknown) => (e as { code?: string }).code === "WRONG_SIGNER",
  );
});

/* ---------------------------------------------- money helpers, easy to get wrong */

test("chainIdFromNetwork parses eip155 and refuses anything else", () => {
  assert.equal(chainIdFromNetwork("eip155:143"), 143);
  assert.throws(() => chainIdFromNetwork("solana:mainnet"));
  assert.throws(() => chainIdFromNetwork("eip155:notanumber"));
});

test("USDC amounts format at six decimals", () => {
  assert.equal(formatUsdc(10_000n), "0.01");
  assert.equal(formatUsdc(50_000n), "0.05");
  assert.equal(formatUsdc(1_000_000n), "1");
  assert.equal(verificationPrice().usdc, "0.01");
  assert.equal(verificationPrice().atomic, 10_000n);
});

test("a verification scope names its ceiling in USDC", () => {
  const s = verificationScope(50_000n, "kanmani.xyz");
  assert.match(s.label, /0\.05 USDC/);
  assert.match(s.label, /kanmani\.xyz/);
  assert.equal(s.maxAmountAtomic, 50_000n);
});

/* ---------------------------------------------- the testnet path, beside mainnet, not replacing it */

const TESTNET_DOMAIN = {
  name: "Kanmani Test USD",
  version: "1",
  chainId: 10143,
  verifyingContract: (process.env.TESTNET_USDC ?? TESTNET_USDC_FALLBACK) as `0x${string}`,
} as const;

test("a testnet authorization signs under TestUSDC's own domain and recovers to the account", async () => {
  const session = await pinnedSession();
  const auth = buildAuthorization({ from: session.address, now: 1_700_000_000_000, nonce: `0x${"55".repeat(32)}`, net: "testnet" });
  // Built from the testnet requirements, so the recipient and amount are the testnet config's.
  assert.equal(auth.to, "0xDB6c6340342e71A63cD11Ebac2185204b7777777");
  assert.equal(auth.value, "10000");

  const signature = await signAuthorization(session, auth, "testnet");
  const recovered = await recoverTypedDataAddress({
    domain: TESTNET_DOMAIN,
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: messageOf(auth),
    signature,
  });
  assert.equal(recovered.toLowerCase(), session.address.toLowerCase(), "the facilitator recovers the account under TestUSDC's domain");

  // The mainnet domain must NOT verify the testnet signature: the two chains are genuinely separate.
  const crossOk = await verifyTypedData({
    address: session.address,
    domain: EXPECTED_DOMAIN,
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: messageOf(auth),
    signature,
  });
  assert.equal(crossOk, false, "a testnet signature does not verify under the mainnet domain");
});

test("a testnet payment header reads back through the testnet-aware paymentFrom", async () => {
  const session = await pinnedSession();
  const auth = buildAuthorization({ from: session.address, now: 1_700_000_000_000, nonce: `0x${"66".repeat(32)}`, net: "testnet" });
  const signature = await signAuthorization(session, auth, "testnet");
  const payload = buildPaymentPayload({ resourceUrl: "https://kanmani.xyz/api/testnet/verify", authorization: auth, signature, net: "testnet" });
  const header = encodePaymentHeader(payload);

  // The testnet route passes eip155:10143, so the testnet network is accepted here.
  const parsed = paymentFrom(new Headers({ "payment-signature": header }), ["exact"], "eip155:10143");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.payload.accepted.network, "eip155:10143");
    assert.equal((parsed.payload.payload as { authorization: Record<string, string> }).authorization.from, session.address);
  }

  // The mainnet endpoint rejects a testnet payment, so a testnet header cannot settle on mainnet.
  const wrong = paymentFrom(new Headers({ "payment-signature": header }));
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.match(wrong.reason, /eip155:143/);
});
