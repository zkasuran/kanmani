/**
 * Optic: writing verdicts to the ERC-8004 Validation Registry.
 *
 * The registry at `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` on Monad is live and on
 * 2026-09-20 it held **zero** validations against the Reputation Registry's 9,188 feedbacks.
 * Monad's own ERC-8004 guide still calls it "coming soon" while it sits there with 131 bytes of
 * code answering calls.
 *
 * It holds one row now, ours, for agent 10252 at block 106470718. That is not a boast, it is the
 * "before" picture becoming checkable: `getValidatorRequests` and `getAgentValidations` both
 * return exactly that one hash and the indexer that follows this contract went from 0 rows to 1.
 *
 * So the reputation half of ERC-8004 is in heavy use on this chain and the validation half was
 * untouched. The reason is below and it is not apathy.
 *
 * ## The mapping problem and the rule that settles it
 *
 * `validationResponse` takes `uint8 response` and `getSummary` **averages** it across
 * validators. That is a score and our verdicts are not a score. Four outcomes do not sit on a
 * scale and squeezing them onto one would produce exactly the confident number this project
 * exists to argue against.
 *
 * **So we only write what we actually checked.**
 *
 * | verdict | written on chain? | response |
 * |---|---|---|
 * | `true` | yes | 100 |
 * | `false` | yes | 0 |
 * | `unknown` | **no** | there is nothing to say |
 * | `noClaim` | **no** | there was no claim to check |
 *
 * The absence of a row is the signal that we did not check, rather than a zero standing in for
 * it. A registry entry from us means a transaction was looked for on the chain a document named,
 * and the average of our responses is the proportion of checked claims that were found. That is a
 * number with a meaning, which is more than an average over four incomparable states would be.
 *
 * The `tag` scopes it further, so a consumer calling `getSummary` with our tag gets exactly the
 * question we answered rather than a general opinion about the agent.
 */
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const VALIDATION_REGISTRY: Address = "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58";
export const MONAD_CHAIN_ID = 143;

/**
 * What our response is about, so `getSummary` answers our question rather than a vague one.
 *
 * Versioned in the string. A change to what we measure is a new tag, never the same tag meaning
 * something different, because the old rows stay on chain forever.
 */
export const TAG = "kanmani.payment-claim.v1";

export const ABI = [
  {
    type: "function",
    name: "validationRequest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "requestURI", type: "string" },
      { name: "requestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "validationResponse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestHash", type: "bytes32" },
      { name: "response", type: "uint8" },
      { name: "responseURI", type: "string" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getValidationStatus",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "response", type: "uint8" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
      { name: "lastUpdate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "validatorAddresses", type: "address[]" },
      { name: "tag", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "average", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "getAgentValidations",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "getValidatorRequests",
    stateMutability: "view",
    inputs: [{ name: "validatorAddress", type: "address" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
] as const;

export type Writable = { claimId: string; agentId: bigint; outcome: "true" | "false" };

/**
 * **Only an agent's NFT owner can open a validation** and they name the validator when they do.
 *
 * Verified by simulating `validationRequest` from three addresses on mainnet: ours reverts with
 * `Not authorized`, the agent's own declared wallet reverts the same way and the owner passes.
 * So this module cannot publish an opinion about somebody else's agent however true it is, and
 * `writeValidation` below only ever runs against an agent we own.
 *
 * That constraint explains a number we had measured and not explained: this registry held zero
 * rows while the Reputation Registry held 9,188 feedbacks. Anyone can leave feedback about
 * anyone. Only an owner can invite a check.
 */

/**
 * Decide whether a verdict may go on chain at all.
 *
 * Exported and tested rather than inlined, because this one branch is the whole honesty position
 * and a refactor that widens it would be invisible in a diff full of viem calls.
 */
export function isWritable(outcome: string): outcome is "true" | "false" {
  return outcome === "true" || outcome === "false";
}

/** 100 for found, 0 for not found. There is no third value, because there is no third state. */
export function responseFor(outcome: "true" | "false"): number {
  return outcome === "true" ? 100 : 0;
}

/**
 * The request hash, which is also the key the response is filed under.
 *
 * Derived from the claim id rather than random, so the same claim always maps to the same request
 * and a re-check updates its own row instead of accumulating duplicates that would each be
 * counted by `getSummary`. Deterministic here means "our average is not inflated by us checking
 * twice".
 */
export function requestHashFor(claimId: string): Hex {
  return keccak256(toHex(`${TAG}\n${claimId}`));
}

export type OpticConfig = {
  rpcUrl: string;
  privateKey: Hex;
  /** Where a human can read the verdict this row points at. */
  siteUrl: string;
};

export function opticClients(cfg: OpticConfig) {
  const account = privateKeyToAccount(cfg.privateKey);
  const chain = {
    id: MONAD_CHAIN_ID,
    name: "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  } as const;

  return {
    account,
    publicClient: createPublicClient({ chain, transport: http(cfg.rpcUrl) }),
    walletClient: createWalletClient({ account, chain, transport: http(cfg.rpcUrl) }),
  };
}

export type WriteResult = {
  claimId: string;
  agentId: bigint;
  requestHash: Hex;
  requestTx: Hex | null;
  responseTx: Hex | null;
  /** Whatever stopped it, recorded rather than thrown away. */
  error: string | null;
};

/**
 * Request a validation from ourselves, then answer it.
 *
 * Two transactions because the registry is built for a third party to ask and a validator to
 * answer. We are both, which is honest and is stated on the page: nobody has asked us to check
 * anything, so the request is ours too. The alternative is writing a response to a request that
 * does not exist, which the contract would reject anyway.
 *
 * **The request hash is returned before the second transaction is sent** and the caller records
 * it. A response that broadcasts and then fails to have its receipt read is a real state and a
 * run that lost the hash could not reconcile it and would re-send.
 */
export async function writeValidation(
  cfg: OpticConfig,
  clients: ReturnType<typeof opticClients>,
  item: Writable,
  receiptHash: Hex,
): Promise<WriteResult> {
  const requestHash = requestHashFor(item.claimId);
  const uri = `${cfg.siteUrl}/claim/${encodeURIComponent(item.claimId)}`;
  const out: WriteResult = {
    claimId: item.claimId,
    agentId: item.agentId,
    requestHash,
    requestTx: null,
    responseTx: null,
    error: null,
  };

  try {
    // Skip the request when this row already exists, so a re-run costs one transaction rather
    // than two and never tries to re-open a request the contract already has.
    //
    // `getValidationStatus` **reverts** on a hash it does not know, rather than returning a zero
    // address. Found by running it: the first attempt treated the read as a plain query, the
    // revert propagated and two validations failed before anything was written. A revert here is
    // the answer "no such request", so it is caught and read as one.
    let alreadyRequested = false;
    try {
      const status = await clients.publicClient.readContract({
        address: VALIDATION_REGISTRY,
        abi: ABI,
        functionName: "getValidationStatus",
        args: [requestHash],
      });
      alreadyRequested = status[0] !== "0x0000000000000000000000000000000000000000";
    } catch {
      alreadyRequested = false;
    }

    if (!alreadyRequested) {
      out.requestTx = await clients.walletClient.writeContract({
        address: VALIDATION_REGISTRY,
        abi: ABI,
        functionName: "validationRequest",
        args: [clients.account.address, item.agentId, uri, requestHash],
      });
      await clients.publicClient.waitForTransactionReceipt({ hash: out.requestTx });
    }

    out.responseTx = await clients.walletClient.writeContract({
      address: VALIDATION_REGISTRY,
      abi: ABI,
      functionName: "validationResponse",
      args: [requestHash, responseFor(item.outcome), uri, receiptHash, TAG],
    });
    await clients.publicClient.waitForTransactionReceipt({ hash: out.responseTx });
  } catch (e) {
    // Recorded, never swallowed. A partially written validation is a real state and the caller
    // needs to know which half landed.
    out.error = (e as Error).message.split("\n")[0] ?? String(e);
  }

  return out;
}
