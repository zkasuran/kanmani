/**
 * Answer validation requests addressed to us.
 *
 *   set -a && . ../.env.local && . ~/Downloads/hackathon-hq/.env && set +a
 *   node --experimental-strip-types src/cli/optic.ts --dry
 *   node --experimental-strip-types src/cli/optic.ts
 *
 * ## This used to try to write unsolicited verdicts. It could not and that is the finding
 *
 * The first version of this walked our verdicts and wrote one row per checked claim. Every call
 * reverted with `Not authorized`. Simulating `validationRequest` from three addresses settled it:
 *
 * | caller | result |
 * |---|---|
 * | us, an arbitrary validator | revert `Not authorized` |
 * | the agent's own declared wallet | revert `Not authorized` |
 * | the NFT owner | passes |
 *
 * **Only the agent's owner can open a validation and they name the validator when they do.** A
 * validator cannot publish an opinion about somebody else's agent, however true that opinion is.
 *
 * That explains something we had measured and not explained: Monad's Validation Registry held
 * zero rows while the Reputation Registry held 9,188 feedbacks. Anyone can leave feedback about
 * anyone. Only an owner can invite a check. The half of ERC-8004 that is permissionless is in
 * heavy use and the half that requires consent is empty.
 *
 * Monad's own ERC-8004 guide calls this registry "coming soon" while it has been live and
 * answering calls the whole time.
 *
 * So this worker is a responder rather than a publisher: it finds requests naming us and answers
 * them with a real verdict. An operator who wants a check asks for one, which is the shape the
 * contract was built for.
 */
import pg from "pg";
import { createPublicClient, createWalletClient, http, keccak256, parseAbiItem, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { connectionStringFrom } from "../store/store.ts";
import { ABI, isWritable, responseFor, TAG, VALIDATION_REGISTRY } from "../optic.ts";

const REQUEST_EVENT = parseAbiItem(
  "event ValidationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
);

/** Monad's free RPC caps eth_getLogs at a 100-block span, so the scan is chunked to match. */
const SPAN = 100n;

type Args = { dry: boolean; blocks: bigint; site: string };

function parseArgs(argv: string[]): Args {
  const get = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dry: argv.includes("--dry"),
    blocks: BigInt(get("blocks") ?? 2000),
    site: get("site") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz",
  };
}

/**
 * The verdict we hold about an agent, if any.
 *
 * An agent with several claims gets the worst one that was actually decided, because a summary
 * that reported the best would be the single most misleading thing this project could publish. An
 * agent with no decided claim gets nothing and the worker says so rather than inventing a score.
 */
async function verdictFor(pool: pg.Pool, agentId: bigint) {
  const { rows } = await pool.query(
    `SELECT v.outcome, v.feedback_id, v.checked_at, v.checked_at_block, v.mapping
       FROM fovea.verdict_latest v
       JOIN "Feedback" f ON f.id = v.feedback_id
       JOIN "Agent"    a ON a.id = f.agent_id
      WHERE a."agentId" = $1 AND v.outcome IN ('true','false')
      ORDER BY (v.outcome = 'false') DESC, v.checked_at DESC
      LIMIT 1`,
    [agentId.toString()],
  );
  return rows[0] ?? null;
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const a = parseArgs(argv);
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
  const pool = new pg.Pool({ connectionString: connectionStringFrom(), max: 2 });

  const head = await publicClient.getBlockNumber();
  const from = head > a.blocks ? head - a.blocks : 0n;
  console.log(`validator ${account.address}`);
  console.log(`scanning ${from} to ${head} for requests naming us\n`);

  const requests: { agentId: bigint; requestHash: Hex; block: bigint }[] = [];
  for (let start = from; start <= head; start += SPAN) {
    const end = start + SPAN - 1n > head ? head : start + SPAN - 1n;
    const logs = await publicClient.getLogs({
      address: VALIDATION_REGISTRY as Address,
      event: REQUEST_EVENT,
      args: { validatorAddress: account.address },
      fromBlock: start,
      toBlock: end,
    });
    for (const l of logs) {
      requests.push({
        agentId: l.args.agentId!,
        requestHash: l.args.requestHash!,
        block: l.blockNumber!,
      });
    }
  }

  console.log(`${requests.length} request${requests.length === 1 ? "" : "s"} found\n`);

  for (const r of requests) {
    // Already answered? `response` is non-zero only once we have written one and a revert here
    // means the request is unknown, which cannot happen for a hash we just read from its own
    // event. Either way, not answering twice is the point.
    let answered = false;
    try {
      const status = await publicClient.readContract({
        address: VALIDATION_REGISTRY as Address,
        abi: ABI,
        functionName: "getValidationStatus",
        args: [r.requestHash],
      });
      answered = status[4] !== "";
    } catch {
      answered = false;
    }
    if (answered) {
      console.log(`  skip    agent ${r.agentId}, already answered`);
      continue;
    }

    const v = await verdictFor(pool, r.agentId);
    if (!v || !isWritable(v.outcome)) {
      // Refusing to answer is the honest outcome here and it is not a failure. Writing a number
      // for an agent whose claims we could not check would be the exact thing this project
      // exists to argue against and on chain it would be permanent.
      console.log(
        `  refuse  agent ${r.agentId}, we hold no decided verdict about it. Nothing written, on purpose`,
      );
      continue;
    }

    const uri = `${a.site}/claim/${encodeURIComponent(v.feedback_id)}`;
    const receiptHash = keccak256(
      toHex(
        [
          "kanmani.receipt.v1",
          v.feedback_id,
          v.outcome,
          v.checked_at_block ?? "",
          new Date(v.checked_at).toISOString(),
          v.mapping ?? "",
        ].join("\n"),
      ),
    );

    if (a.dry) {
      console.log(`  would answer agent ${r.agentId} with ${responseFor(v.outcome)} (${v.outcome}) from ${v.feedback_id}`);
      continue;
    }

    try {
      const tx = await walletClient.writeContract({
        address: VALIDATION_REGISTRY as Address,
        abi: ABI,
        functionName: "validationResponse",
        args: [r.requestHash, responseFor(v.outcome), uri, receiptHash, TAG],
      });
      console.log(`  answer  agent ${r.agentId} response ${responseFor(v.outcome)} tx ${tx}`);
      await publicClient.waitForTransactionReceipt({ hash: tx });
    } catch (e) {
      console.log(`  FAILED  agent ${r.agentId}: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
