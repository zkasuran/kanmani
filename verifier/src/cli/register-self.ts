/**
 * Register Kanmani's own agent, then validate it, making the first row in Monad's Validation
 * Registry.
 *
 *   set -a && . ../.env.local && . ~/Downloads/hackathon-hq/.env && set +a
 *   node --experimental-strip-types src/cli/register-self.ts --dry
 *   node --experimental-strip-types src/cli/register-self.ts
 *
 * ## Why the record goes on chain rather than at a URL
 *
 * Our own measurement over all 2,012 distinct registration documents on Monad: 8,095 agents point
 * at a document that returns a deletion and 137 point at documents written straight into
 * `tokenURI`, which cannot 404 because there is no host to ask. Registering ourselves at a URL
 * after publishing that number would be advice we do not take.
 *
 * It costs more gas. That is the trade and it is worth it once.
 *
 * ## Why this is the first validation on the chain, legitimately
 *
 * `validationRequest` reverts with `Not authorized` for anyone who is not the agent's NFT owner.
 * Verified by simulating it from three addresses: ours (revert), the agent's own wallet (revert),
 * and the owner (passes). So a validator cannot write an unsolicited verdict about somebody
 * else's agent, which is a large part of why the registry is empty on Monad.
 *
 * We can validate our own agent because we own it. Everyone else has to ask and `/validate`
 * publishes exactly how.
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex } from "viem";
import { TAG, VALIDATION_REGISTRY, ABI as VALIDATION_ABI } from "../optic.ts";

const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

const IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * Our record, kept small because every byte is storage somebody paid for.
 *
 * What is deliberately NOT in it: any payment claim. We have not been paid through this record,
 * so it asserts nothing about one. A document that claims nothing cannot be wrong about it, which
 * is the same standard we hold everybody else's to.
 */
function record(site: string) {
  return {
    name: "Kanmani",
    description:
      "Checks whether the payment an ERC-8004 evidence document describes actually happened, by reading the cited transaction on the chain the document names.",
    url: site,
    skills: [
      { id: "verify-payment-claim", endpoint: `${site}/api/verify`, payment: "x402" },
      { id: "validate-on-request", endpoint: `${site}/validate`, note: "request a validation on chain and we answer" },
    ],
    refuses: [
      "returning false for a document we failed to fetch",
      "ranking agents by a score that is not published",
    ],
  };
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const dry = argv.includes("--dry");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz";
  const rpcUrl = process.env.RPC_MONAD ?? "https://rpc.monad.xyz";
  const rawKey = process.env.HOUSE_WALLET_PRIVATE_KEY;
  if (!rawKey) throw new Error("HOUSE_WALLET_PRIVATE_KEY is required");
  const account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex);

  const chain = {
    id: 143,
    name: "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const doc = JSON.stringify(record(site));
  const agentURI = `data:application/json,${encodeURIComponent(doc)}`;

  console.log(`validator   ${account.address}`);
  console.log(`record      ${doc.length} bytes, inline, no host to ask`);
  console.log(`uri         ${agentURI.slice(0, 90)}…\n`);

  if (dry) {
    const gas = await publicClient.estimateContractGas({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: "register",
      args: [agentURI],
      account,
    });
    const price = await publicClient.getGasPrice();
    console.log(`register would cost about ${gas} gas at ${price} wei = ${Number(gas * price) / 1e18} MON`);
    console.log("--dry, nothing sent");
    return;
  }

  /* -------------------------------------------------- register */

  const registerTx = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_ABI,
    functionName: "register",
    args: [agentURI],
  });
  console.log(`register    ${registerTx}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerTx });
  console.log(`            block ${receipt.blockNumber}, status ${receipt.status}`);

  // The id comes off the Transfer log rather than from the return value, because a write does not
  // hand one back. Topic 3 of ERC-721 Transfer is the token id.
  const transfer = receipt.logs.find(
    (l) => l.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  );
  if (!transfer?.topics[3]) throw new Error("no Transfer log, so no agent id to read");
  const agentId = BigInt(transfer.topics[3]);
  console.log(`agentId     ${agentId}\n`);

  /* -------------------------------------------------- validate it */

  // Our own agent, our own check and the page says so. The point is not that we vouch for
  // ourselves, it is that the row exists at all on a registry nobody has ever written to.
  const claimId = `self:${agentId}`;
  const requestHash = keccak256(toHex(`${TAG}\n${claimId}`));
  const uri = `${site}/validate`;

  const reqTx = await walletClient.writeContract({
    address: VALIDATION_REGISTRY,
    abi: VALIDATION_ABI,
    functionName: "validationRequest",
    args: [account.address, agentId, uri, requestHash],
  });
  console.log(`request     ${reqTx}`);
  await publicClient.waitForTransactionReceipt({ hash: reqTx });

  const resTx = await walletClient.writeContract({
    address: VALIDATION_REGISTRY,
    abi: VALIDATION_ABI,
    functionName: "validationResponse",
    args: [requestHash, 100, uri, keccak256(toHex(doc)), TAG],
  });
  console.log(`response    ${resTx}`);
  const resReceipt = await publicClient.waitForTransactionReceipt({ hash: resTx });
  console.log(`            block ${resReceipt.blockNumber}, status ${resReceipt.status}`);

  const status = await publicClient.readContract({
    address: VALIDATION_REGISTRY,
    abi: VALIDATION_ABI,
    functionName: "getValidationStatus",
    args: [requestHash],
  });
  console.log(`\nread back   validator ${status[0]} agent ${status[1]} response ${status[2]} tag ${status[4]}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
