import { envelope, json, problem } from "@/lib/api.ts";
import { payNet } from "@/lib/pay-net.ts";
import {
  createRateLimiter,
  decideMint,
  enqueueSend,
  FUND_FLOOR,
  isWellFormedAddress,
} from "@/lib/testnet-mint.ts";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const dynamic = "force-dynamic";

/**
 * The sponsored testnet mint, so a brand-new passkey reaches a confirmed testnet transaction with
 * zero funding steps.
 *
 * This is the first server-held signing key in the app, so it is scoped hard. It is a dedicated
 * testnet-only minter, NEVER the house mainnet key, and it only ever calls TestUSDC.mint on chain
 * 10143. The constructor of TestUSDC already refuses mainnet, and this route refuses any chain that
 * is not 10143 as well, so it can never mint real-looking tokens anywhere else.
 *
 * Fail closed: with no TESTNET_MINTER_KEY the route is inert and answers 503, so a build that ships
 * only mainnet is safe.
 *
 * POST { address }. Idempotent per address (fund once), rate-limited per IP, capped per day.
 */

const RPC = process.env.TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const MAX_BODY_BYTES = 1_024;

const TEST_USDC_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const limiter = createRateLimiter();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(req: Request) {
  const key = process.env.TESTNET_MINTER_KEY;
  if (!key) {
    return problem(503, "Testnet mint not configured", "This deployment has no testnet minter key, so the sponsored mint is off. The mainnet path is unaffected.");
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return problem(413, "Body too large", `Send under ${MAX_BODY_BYTES} bytes: {"address":"0x…"}.`);
  }
  let body: { address?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return problem(400, "Body is not JSON", 'Send {"address":"0x…"}.');
  }
  if (!isWellFormedAddress(body.address)) {
    return problem(400, "Bad address", "address must be a 20-byte hex address.");
  }
  const address = body.address;

  const rate = limiter.check(clientIp(req), address);
  if (!rate.allowed) {
    return problem(429, "Rate limited", rate.reason);
  }

  const token = payNet("testnet").asset;
  const pub = createPublicClient({ chain: monadTestnet, transport: http(RPC) });

  // Hard chain guard: this must never run against anything but Monad testnet.
  let chainId: number;
  try {
    chainId = await pub.getChainId();
  } catch (e) {
    return problem(502, "Testnet RPC unreachable", (e as Error).message);
  }
  if (chainId !== 10143) {
    return problem(500, "Wrong chain", `the configured RPC is chain ${chainId}, not Monad testnet 10143. Refusing to mint.`);
  }

  let balance: bigint;
  try {
    balance = (await pub.readContract({ address: token, abi: TEST_USDC_ABI, functionName: "balanceOf", args: [address] })) as bigint;
  } catch (e) {
    return problem(502, "Could not read the testnet balance", (e as Error).message);
  }

  const decision = decideMint({ balance });
  if (decision.action === "skip") {
    return json(
      envelope(
        { alreadyFunded: true, address, balance: balance.toString(), floor: FUND_FLOOR.toString(), minted: false, note: "This account already holds enough tUSDC to pay, so nothing was minted." },
        `cast call ${token} 'balanceOf(address)(uint256)' ${address} --rpc-url ${RPC}`,
      ),
    );
  }

  try {
    const minter = privateKeyToAccount(key.startsWith("0x") ? (key as `0x${string}`) : `0x${key}`);
    const wallet = createWalletClient({ account: minter, chain: monadTestnet, transport: http(RPC) });
    // Serialized so two concurrent mints from the one minter never reuse a nonce.
    const txHash = await enqueueSend(() =>
      wallet.writeContract({ address: token, abi: TEST_USDC_ABI, functionName: "mint", args: [address, decision.amount] }),
    );
    await pub.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 }).catch(() => undefined);
    const after = (await pub.readContract({ address: token, abi: TEST_USDC_ABI, functionName: "balanceOf", args: [address] })) as bigint;
    return json(
      envelope(
        { minted: true, txHash, amount: decision.amount.toString(), balance: after.toString(), explorerTx: `${payNet("testnet").explorerTx}${txHash}` },
        `cast call ${token} 'balanceOf(address)(uint256)' ${address} --rpc-url ${RPC}`,
      ),
    );
  } catch (e) {
    // The minter key is never in the error. A stranger gets the reason, not our internals.
    console.error("[/api/testnet/mint] mint failed:", (e as Error).message);
    return problem(502, "The mint did not land", "The testnet mint transaction did not confirm. Nothing was charged to you.", { retryable: true });
  }
}
