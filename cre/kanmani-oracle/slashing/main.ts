/**
 * Kanmani slashing oracle: a CRE workflow that decides whether a bonded agent kept its promise.
 *
 * It combines the two things the bounty asks to be integrated, a blockchain and an external API:
 *
 *   1. Monad mainnet (chain 143), read with `callContract`: the bond an agent posted in Sclera,
 *      carrying the floor it committed to, the window it runs over, the minimum sample below which
 *      nothing counts and the last nonce it accepted. The terms are read from the chain rather than
 *      from config, because the agent agreed to those terms on chain and nothing off chain may
 *      restate them.
 *   2. The Kanmani measurement API over HTTP: that agent's claim-truth rate across the bond's own
 *      block window. The rate is the share of its published payment claims that resolve on the
 *      chain the document names, with claims nobody could decide excluded from both sides.
 *
 * The workflow compares the two and produces a verdict. Every node runs the HTTP read independently
 * and the results are aggregated by field, so a single node cannot move the number: the window is
 * `identical` across nodes because it is derived from chain state, and the counts are `median`.
 *
 * What this does NOT do, stated here because it would be easy to imply otherwise: it does not prove
 * a slashing on mainnet. `cre workflow simulate` is a dry run whose MockForwarder records a report
 * and never calls `onReport`, so the receiver's own checks are not exercised by a simulation. The
 * read, the decision and the report encoding are real. The settlement is not, until Sclera is
 * deployed and the config sets `broadcast: true` (a value in the committed JSON config, NOT a CLI
 * flag): nothing but editing that config turns the sign-and-submit path on.
 */
import {
  bytesToHex,
  ConsensusAggregationByFields,
  CronCapability,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  handler,
  HTTPClient,
  type HTTPSendRequester,
  identical,
  json,
  LATEST_BLOCK_NUMBER,
  median,
  ok,
  prepareReportRequest,
  Runner,
  type Runtime,
} from "@chainlink/cre-sdk";
import { type Address, decodeFunctionResult, encodeFunctionData, zeroAddress } from "viem";
import { z } from "zod";
import { encodeReport, signVerdict } from "./verdict";

export type Config = {
  schedule: string;
  agentId: string;
  scleraAddress: string;
  slaApiBase: string;
  chainName: string;
  /**
   * Off by default. When true, and only then, the workflow signs the verdict with the attestor key
   * and submits it on chain through the forwarder. Left unset in the staging and production configs,
   * so the judged simulation reads and decides without ever touching the write path or a real bond.
   */
  broadcast?: boolean;
  /** The CRE secret holding the attestor private key. Read only when broadcast is on. */
  attestorSecretId?: string;
  attestorSecretNamespace?: string;
};

/** Monad mainnet, where Sclera is deployed. The EIP-712 signature is bound to this chain id. */
const SCLERA_CHAIN_ID = 143n;

/**
 * Only the two reads this workflow makes. Written out rather than imported from the contracts
 * package so the workflow has no build dependency on Foundry output, and so a reader can see
 * exactly what is called without opening another repo.
 */
const SCLERA_ABI = [
  {
    type: "function",
    name: "bonds",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "agent", type: "address" },
          { name: "postedAt", type: "uint64" },
          { name: "state", type: "uint8" },
          { name: "token", type: "address" },
          { name: "windowBlocks", type: "uint64" },
          { name: "amount", type: "uint128" },
          { name: "minTruthRateBps", type: "uint16" },
          { name: "minSampleSize", type: "uint32" },
          { name: "lastNonce", type: "uint64" },
        ],
      },
    ],
  },
] as const;

/** Mirrors `Sclera.State`. Only `Active` (1) is worth a verdict. */
const STATE_ACTIVE = 1;

/**
 * The shape the measurement API returns. Parsed rather than trusted: an endpoint that changed its
 * field names should fail loudly here, not produce a verdict from undefined counts.
 *
 * `rateBps` is deliberately NOT read back. The workflow recomputes the rate from the counts it
 * aggregated, because a rate taken on faith is a number the oracle did not measure.
 */
const slaSchema = z.object({
  agentId: z.number(),
  sampleSize: z.number(),
  trueCount: z.number(),
  unknownCount: z.number(),
});
type SlaReading = z.infer<typeof slaSchema>;

/**
 * Runs on every node independently. The URL carries the bond's own window, so each node asks the
 * same question of the same block range and consensus is meaningful.
 */
const fetchSla = (
  sendRequester: HTTPSendRequester,
  url: string,
): SlaReading => {
  const response = sendRequester.sendRequest({ url, method: "GET", timeout: "10s" }).result();
  if (!ok(response)) {
    throw new Error(`measurement API answered ${response.statusCode} for ${url}`);
  }
  const body = json(response) as { data?: unknown };
  // The API wraps its payload in an envelope that also carries the SQL that produced it.
  return slaSchema.parse(body.data ?? body);
};

const onCronTrigger = async (runtime: Runtime<Config>): Promise<string> => {
  const { agentId, scleraAddress, slaApiBase, chainName } = runtime.config;

  // `isTestnet` must be false here. The lookup short-circuits to the testnet map when it is true
  // and returns undefined for a mainnet chain, which is a confusing failure to debug.
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: chainName, isTestnet: false });
  if (!network) throw new Error(`unknown chain: ${chainName}`);
  const evmClient = new EVMClient(network.chainSelector.selector);

  /* ---------------------------------------------------- 1. the bond, read from Monad mainnet */

  const bondCall = encodeFunctionData({
    abi: SCLERA_ABI,
    functionName: "bonds",
    args: [BigInt(agentId)],
  });
  const bondReply = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: scleraAddress as Address,
        data: bondCall,
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();

  /**
   * An `eth_call` to an address with no contract returns empty data rather than reverting, and an
   * agent that never posted a bond returns a zero struct. Both are ordinary states for a scheduled
   * oracle, so neither may throw: the run continues in observation mode and reports the measurement
   * without claiming a verdict. Decoding empty bytes would crash here, which is how the first
   * simulation of this workflow failed.
   */
  const bondBytes = bytesToHex(bondReply.data);
  const haveBond = bondBytes !== "0x" && bondBytes.length > 2;

  let windowStart = 0n;
  let windowEnd = 0n;
  let floorBps = 0;
  let minSample = 0;
  let nonce = 0n;
  let mode: "verdict" | "observation" = "observation";

  if (haveBond) {
    const bond = decodeFunctionResult({
      abi: SCLERA_ABI,
      functionName: "bonds",
      data: bondBytes,
    });
    if (Number(bond.state) === STATE_ACTIVE) {
      mode = "verdict";
      windowStart = bond.postedAt;
      windowEnd = windowStart + bond.windowBlocks;
      floorBps = Number(bond.minTruthRateBps);
      minSample = Number(bond.minSampleSize);
      nonce = bond.lastNonce + 1n;
      runtime.log(
        `bond read from chain: floor ${floorBps}bps, window ${windowStart}..${windowEnd}, ` +
          `minSample ${minSample}, nonce ${nonce}`,
      );
    } else {
      runtime.log(`bond for agent ${agentId} is in state ${bond.state}, not active. Observation only.`);
    }
  } else {
    runtime.log(
      `no bond found for agent ${agentId} at ${scleraAddress}. ` +
        `Reporting the measurement without a verdict, because a rate is a fact and a breach is a claim about a promise.`,
    );
  }

  /**
   * With no bond there is no committed window, so the measurement covers the agent's whole history.
   * uint64 max as the ceiling, which the API clamps to the indexed head.
   */
  const fromBlock = mode === "verdict" ? windowStart : 0n;
  const toBlock = mode === "verdict" ? windowEnd : 18446744073709551615n;

  /* ------------------------------------- 2. the measurement, read over HTTP by every node */

  const url =
    `${slaApiBase}/api/sla/${agentId}?fromBlock=${fromBlock}&toBlock=${toBlock}`;

  const sla = new HTTPClient()
    .sendRequest(
      runtime,
      fetchSla,
      // The window is chain-derived so every node must agree on it exactly. The counts are
      // medianed so one node reading a half-written page cannot move the verdict.
      ConsensusAggregationByFields<SlaReading>({
        agentId: identical,
        sampleSize: median,
        trueCount: median,
        unknownCount: median,
      }),
    )(url)
    .result();

  /* ------------------------------------------------------------------ 3. decide */

  // The median of an even number of nodes can land on a .5, so the aggregated counts are rounded
  // back to integers before anything uses them. A verdict field is a uint32 on chain and BigInt()
  // throws on a fractional value, so a half-count would fail at signing time rather than here.
  const sampleSize = Math.round(sla.sampleSize);
  const trueCount = Math.round(sla.trueCount);
  const unknownCount = Math.round(sla.unknownCount);

  if (sampleSize === 0) {
    const msg = `agent ${agentId} has no decided payment claims in ${fromBlock}..${toBlock}, so there is nothing to rate`;
    runtime.log(msg);
    return msg;
  }

  // Recomputed, never taken from the API. Integer basis points, matching what the contract does
  // with `(trueCount * 10000) / sampleSize`.
  const rateBps = Math.floor((trueCount * 10_000) / sampleSize);

  runtime.log(
    `measured ${trueCount}/${sampleSize} claims true = ${rateBps}bps ` +
      `(${unknownCount} undecided, excluded from both sides)`,
  );

  if (mode === "observation") {
    const msg = `OBSERVED agent=${agentId} rate=${rateBps}bps sample=${sampleSize} (no bond, no verdict)`;
    runtime.log(msg);
    return msg;
  }

  if (sampleSize < minSample) {
    const msg =
      `sample ${sampleSize} is below the bond's minimum ${minSample}, so no verdict. ` +
      `One unresolved receipt out of one is a 0% rate and also noise.`;
    runtime.log(msg);
    return msg;
  }

  const breached = rateBps < floorBps;

  const verdict = {
    agentId: BigInt(agentId),
    windowStart,
    windowEnd,
    sampleSize: BigInt(sampleSize),
    trueCount: BigInt(trueCount),
    nonce,
  };

  runtime.log(
    `verdict: ${rateBps}bps against a ${floorBps}bps floor, ${breached ? "BREACH, bond forfeit" : "held"}`,
  );
  runtime.log(
    `verdict payload: ${JSON.stringify(verdict, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
  );

  // The write path. Off unless the config turns it on, so the judged simulation never reaches it and
  // never touches a real bond. When on, the verdict is signed with the attestor key (recovered by
  // Sclera, which trusts the signature rather than the permissionless forwarder) and submitted. The
  // signing is proven to match the app's verified signer; the submit through the CRE report and write
  // capabilities is exercised only by a real `cre workflow simulate --broadcast`, which spends gas and
  // can slash a live bond, so it stays behind this flag and an operator's explicit run.
  if (runtime.config.broadcast) {
    const secretId = runtime.config.attestorSecretId ?? "SCLERA_ATTESTOR_KEY";
    const namespace = runtime.config.attestorSecretNamespace ?? "main";
    const key = runtime.getSecret({ id: secretId, namespace }).result().value as `0x${string}`;
    const signature = await signVerdict(verdict, key, SCLERA_CHAIN_ID, scleraAddress as `0x${string}`);
    const payload = encodeReport(verdict, signature);
    const report = runtime.report(prepareReportRequest(payload)).result();
    evmClient.writeReport(runtime, { receiver: scleraAddress, report }).result();
    runtime.log(`submitted signed verdict to Sclera ${scleraAddress} through the forwarder`);
  }

  return breached
    ? `BREACH agent=${agentId} rate=${rateBps}bps floor=${floorBps}bps sample=${sampleSize}`
    : `HELD agent=${agentId} rate=${rateBps}bps floor=${floorBps}bps sample=${sampleSize}`;
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
