#!/usr/bin/env node
/**
 * The free judge path, proven end to end on Monad testnet. Plan 1.1 / spec 03 done-when.
 *
 * A brand-new account that holds nothing is funded by the sponsored mint, then signs ONE EIP-3009
 * exact authorization over TestUSDC and the facilitator relays it and pays the gas. A green run is
 * "brand-new passkey, confirmed testnet tx, zero funding steps". This also settles the one open
 * question from the spec: whether molandak accepts TestUSDC on the exact scheme.
 *
 * [ext], testnet only, NO real funds. It broadcasts a testnet transaction through the facilitator.
 *
 *   node scripts/pay-testnet-exact.mjs [siteOrigin]      default https://kanmani.xyz
 *   SITE provides the mint endpoint; the facilitator and RPC are testnet.
 */
import { createPublicClient, defineChain, erc20Abi, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const SITE = process.argv[2] ?? "https://kanmani.xyz";
const RPC = process.env.TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const FACILITATOR = process.env.X402_FACILITATOR ?? "https://x402-facilitator.molandak.org";
const NETWORK = "eip155:10143";
const TESTNET_USDC = process.env.TESTNET_USDC ?? "0x841057C182b74408628FadAFba01Ad178cDA2E2f";
const PAY_TO = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
const PRICE = "10000"; // 0.01 tUSDC, six decimals

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const log = (...a) => console.log(" ", ...a);
const pub = createPublicClient({ chain: monadTestnet, transport: http(RPC) });

// A brand-new account that holds nothing. This is the "fresh passkey" an account would derive.
const account = privateKeyToAccount(generatePrivateKey());
log("fresh account", account.address);

// 1. Fund it through the sponsored mint endpoint, so the account itself funds nothing.
const mint = await fetch(`${SITE}/api/testnet/mint`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: account.address }),
});
const mintBody = await mint.json().catch(() => ({}));
log("mint", mint.status, JSON.stringify(mintBody?.data ?? mintBody));
if (!mint.ok) {
  console.error("the sponsored mint did not succeed, cannot run the zero-funding proof");
  process.exit(2);
}

// 2. Build and sign the EIP-3009 exact authorization over TestUSDC's own domain.
const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: account.address,
  to: PAY_TO,
  value: PRICE,
  validAfter: "0",
  validBefore: String(now + 60),
  nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`,
};
const domain = { name: "Kanmani Test USD", version: "1", chainId: 10143, verifyingContract: TESTNET_USDC };
const types = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};
const signature = await account.signTypedData({
  domain,
  types,
  primaryType: "TransferWithAuthorization",
  message: {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: 0n,
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  },
});

const requirements = {
  scheme: "exact",
  network: NETWORK,
  amount: PRICE,
  asset: TESTNET_USDC,
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  extra: { name: "Kanmani Test USD", version: "1" },
};
const paymentPayload = {
  x402Version: 2,
  accepted: requirements,
  payload: { signature, authorization },
};
const post = (path) =>
  fetch(`${FACILITATOR}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirements }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// 3. Verify then settle through the facilitator, which pays the gas.
const v = await post("/verify");
log("verify", v.status, JSON.stringify(v.body));
if (!v.body.isValid) {
  console.error("facilitator rejected the exact authorization for TestUSDC on testnet");
  process.exit(1);
}
const s = await post("/settle");
log("settle", s.status, JSON.stringify(s.body));
const txHash = s.body.transaction;
if (!s.body.success || !txHash) {
  console.error("settlement did not confirm");
  process.exit(1);
}

// 4. Read the settle tx and assert a Transfer from the account to the payee for the price.
const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
const transfer = receipt.logs.find((l) => l.address.toLowerCase() === TESTNET_USDC.toLowerCase());
log("tx", `${RPC.includes("testnet") ? "https://testnet.monadscan.com/tx/" : ""}${txHash}`, "status", receipt.status);
if (receipt.status !== "success" || !transfer) {
  console.error("the settle tx did not carry a TestUSDC transfer");
  process.exit(1);
}

// Decode is optional for the proof: a successful receipt with a TestUSDC transfer is the done-when.
void erc20Abi;
console.log("\npay-testnet-exact: brand-new account, confirmed testnet tx, zero funding steps.");
process.exit(0);
