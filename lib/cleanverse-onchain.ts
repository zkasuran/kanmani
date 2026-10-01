/**
 * On-chain Cleanverse read surface for the `/compliance` page.
 *
 * The off-chain sibling `lib/cleanverse.ts` POSTs the Cleanverse Verify-CVI API, which needs an api-id
 * and an IP allowlist, so it is not a reliable live-on-load read from a browser or a server. This
 * module is the on-chain companion: it reads the gate's own `cviStatus(worker)` view with a public RPC
 * and no key, which is what the page calls on every load.
 *
 * It also holds the Cleanverse deployment facts in one place (the gate per chain, the validator, the
 * CVA) and the recorded pass and refuse evidence, so the page and the test read one source and cannot
 * drift from each other.
 *
 * Two rules copied from the off-chain sibling, because they are the whole point of this project:
 *  - **Unknown is never unverified.** A `1` word is a compliance refusal. A transport failure, an
 *    unreadable validator or an unregistered pool is operational, so it is `unknown`.
 *  - **Nothing reads verified unless the chain returned the `2` word.** No default, no optimistic pass.
 */
import { createPublicClient, defineChain, http } from "viem";

/** Three-state result, same vocabulary as the contract and the off-chain client. */
export type CviOnchainState = "verified" | "unverified" | "unknown";
export type CviOnchainResult = { state: CviOnchainState; reason: string; raw: number | null };

/* ---------------------------------------------------------------- addresses (never invented) */

/** The Cleanverse Compliance Validator. Same address on both chains. */
export const CLEANVERSE_VALIDATOR = "0xA64529732B52EFFD2B245320E88226D72c23b788" as const;
/** Access USDC, the CVA. `name()` "Access USDC", `symbol()` "aUSDC", `decimals()` 6. */
export const CLEANVERSE_CVA = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D" as const;
/** Mainnet gate v2, owner-bearing, deployed but not yet registered as a compliance pool. */
export const MAINNET_GATE = "0x4a21a5d8e24E683801ECC4CF19f178d7185e544A" as const;
/** Testnet gate, registered, the flow ran end to end against it. */
export const TESTNET_GATE = "0xfc831E2F4FF21C4FB0B241684CB39203Bd137d2f" as const;
/** The house deployer and default buyer. Holds no CVI, so it reads Unverified on testnet. */
export const DEPLOYER = "0xDB6c6340342e71A63cD11Ebac2185204b7777777" as const;
/** The testnet worker holding a tier 20 CVI. Recipient of issue-CVI tx 0x6ae7f07b and the pass settle. */
export const TESTNET_VERIFIED_WORKER = "0xaA514cD6573f95DdD0df78ec1Fdcb8dA05E70936" as const;

export type ComplianceChain = {
  chainId: number;
  key: "monad" | "monad-testnet";
  displayName: string;
  gate: `0x${string}`;
  validator: `0x${string}`;
  cva: `0x${string}`;
  explorer: string;
  rpcEnv: string;
  defaultRpc: string;
  /** True testnet, false mainnet until the gate is registered as a pool (6.5). */
  registered: boolean;
};
export const COMPLIANCE_CHAINS: readonly ComplianceChain[] = [
  {
    chainId: 143,
    key: "monad",
    displayName: "Monad mainnet",
    gate: MAINNET_GATE,
    validator: CLEANVERSE_VALIDATOR,
    cva: CLEANVERSE_CVA,
    explorer: "https://monadexplorer.com",
    rpcEnv: "RPC_MONAD",
    defaultRpc: "https://rpc.monad.xyz",
    registered: false,
  },
  {
    chainId: 10143,
    key: "monad-testnet",
    displayName: "Monad testnet",
    gate: TESTNET_GATE,
    validator: CLEANVERSE_VALIDATOR,
    cva: CLEANVERSE_CVA,
    explorer: "https://testnet.monadexplorer.com",
    rpcEnv: "RPC_MONAD_TESTNET",
    defaultRpc: "https://testnet-rpc.monad.xyz",
    registered: true,
  },
] as const;

/* ---------------------------------------------------------------- the live read */

const CVI_STATUS_ABI = [
  {
    type: "function",
    name: "cviStatus",
    stateMutability: "view",
    inputs: [{ name: "worker", type: "address" }],
    outputs: [{ type: "uint8" }],
  },
] as const;

/**
 * Map a raw status word to a result. Pure, so every branch is reachable in a test with no network.
 *
 * The contract enum is `Unknown=0, Unverified=1, Verified=2`. The gate's `cviStatus` never reverts
 * on chain: a reverting or codeless validator is folded into `0` by the gate's own staticcall. So on
 * mainnet, where the gate is not yet a registered pool, every wallet reads `0`, and the reason names
 * that rather than leaving a reader thinking the lookup is broken.
 */
export function interpretCviStatus(raw: number | null, registered: boolean): CviOnchainResult {
  if (raw === 2) return { state: "verified", reason: "the validator returned a valid active CVI for this wallet", raw };
  if (raw === 1) return { state: "unverified", reason: "the validator answered and this wallet is not cleared to receive", raw };
  if (raw === 0) {
    return {
      state: "unknown",
      reason: registered
        ? "the validator could not be read, so the gate fails closed"
        : "the gate is not yet registered as a compliance pool on this chain, so every wallet reads unknown and every settle fails closed",
      raw,
    };
  }
  return { state: "unknown", reason: `unrecognised status word ${raw === null ? "null" : raw}`, raw };
}

/** Read `cviStatus(worker)` from one chain's gate. Server-side only, no key, public RPC.
 *
 * `read` is injected in tests so every branch is reachable with no network. The default builds a viem
 * client against the chain's RPC. */
export async function readCviStatus(
  worker: `0x${string}`,
  c: ComplianceChain,
  env: Record<string, string | undefined> = process.env,
  read: () => Promise<number> = () => rpcReadCviStatus(worker, c, env),
): Promise<CviOnchainResult> {
  try {
    const raw = await read();
    return interpretCviStatus(Number(raw), c.registered);
  } catch (e) {
    // A thrown read is transport only; cviStatus never reverts on chain. Unknown, never unverified.
    return { state: "unknown", reason: `chain read failed: ${e instanceof Error ? e.message : String(e)}`, raw: null };
  }
}

async function rpcReadCviStatus(
  worker: `0x${string}`,
  c: ComplianceChain,
  env: Record<string, string | undefined>,
): Promise<number> {
  const chain = defineChain({
    id: c.chainId,
    name: c.displayName,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [env[c.rpcEnv] || c.defaultRpc] } },
  });
  const client = createPublicClient({ chain, transport: http(undefined, { timeout: 8000 }) });
  return Number(
    await client.readContract({ address: c.gate, abi: CVI_STATUS_ABI, functionName: "cviStatus", args: [worker] }),
  );
}
/* ---------------------------------------------------------------- recorded evidence and copy */

/** A real testnet transaction from the end-to-end run (docs/20 section 6). */
export type EvidenceRow = {
  step: string;
  /** `setup` rows build the pool, `pass`/`refuse` are the two settlement outcomes. */
  kind: "setup" | "pass" | "refuse";
  /** The escrowed asset. tUSDC today, swapped to aUSDC when plan 6.3 reruns it. */
  asset: "tUSDC" | "aUSDC";
  chainId: number;
  txHash: `0x${string}`;
  outcome: string;
  /** The revert the refuse path produced, so the table states it rather than implying success. */
  revert?: string;
};

/**
 * The pass and refuse txs on Monad testnet. These used tUSDC. When plan 6.3 reruns pass and refuse
 * with aUSDC, swap the hashes here and relabel `asset`, and nothing else on the page changes.
 */
export const PASS_REFUSE_EVIDENCE: readonly EvidenceRow[] = [
  { step: "register pool", kind: "setup", asset: "tUSDC", chainId: 10143, txHash: "0x1fde7e517ca70b15a8894f7f778c68747e8dcd29a91017e170c936b9f2d64cce", outcome: "is_register returns true" },
  { step: "set rule", kind: "setup", asset: "tUSDC", chainId: 10143, txHash: "0x87eb6dabd44dfc2c51dfe80c896ba6241d8d8278d38e9248027f2459bdb333d9", outcome: "any active CVI, tier 1 or higher" },
  { step: "issue CVI", kind: "setup", asset: "tUSDC", chainId: 10143, txHash: "0x6ae7f07b5da99abb8d93ef430ff3fea175b7e76507406bb98f9149f148aef057", outcome: "worker tier 20, status active" },
  { step: "pass: open", kind: "pass", asset: "tUSDC", chainId: 10143, txHash: "0xb18196cb24acea15b5950f0542befee1604678dce0590c4485c2c143e05047de", outcome: "job opened for the verified worker" },
  { step: "pass: settle", kind: "pass", asset: "tUSDC", chainId: 10143, txHash: "0xea913ac399f270daec96bd6e1b374263a50803d84a4606a509dbc7176395174f", outcome: "paid the worker 1,000,000 units" },
  { step: "refuse: open", kind: "refuse", asset: "tUSDC", chainId: 10143, txHash: "0xbd1bd65f8835fc1b8aca10431de7c782c4cda0ac4ba8f1a3da6acbb32d585a35", outcome: "job opened for a fresh wallet with no CVI" },
  { step: "refuse: settle", kind: "refuse", asset: "tUSDC", chainId: 10143, txHash: "0xd381c3e12f5535f05f066ff4ceabcf048075b593fd393f565c39a7017a0539d0", outcome: "reverted, no money moved", revert: "CviNotVerified() 0xbfeb29e5" },
] as const;

/** The badge state an evidence row maps to, so the table and the badge cannot disagree. */
export function evidenceCviState(kind: EvidenceRow["kind"]): CviOnchainState {
  if (kind === "pass") return "verified";
  if (kind === "refuse") return "unverified";
  return "unknown";
}

/** A chain-aware transaction link. `TxLink` in components/ui.tsx only knows mainnet 143. */
export function txHref(chainId: number, hash: string): string | null {
  const c = COMPLIANCE_CHAINS.find((x) => x.chainId === chainId);
  return c ? `${c.explorer}/tx/${hash}` : null;
}

/** The drawn flow: CVI verify then the CVA transfer gate (docs/20 section 2 and 6). */
export const FLOW_STEPS = [
  { key: "open", title: "buyer funds escrow", detail: "open() escrows the hire through Aqueous with the gate as both buyer and agent, so only the gate can move the money.", fn: "open" },
  { key: "verify", title: "settle reads complianceVerify(gate, worker)", detail: "settle(), buyer only, reads cviStatus through the Compliance Validator before any money leaves escrow.", fn: "cviStatus" },
  { key: "verified", title: "Verified: release and pay in the CVA", detail: "the escrow releases and the worker is paid in aUSDC, which re-checks the recipient CVI on its own transfer, so the payout is guarded twice.", branch: "verified" as const },
  { key: "unverified", title: "Unverified: revert CviNotVerified", detail: "no money moves.", branch: "unverified" as const },
  { key: "unknown", title: "Unknown: revert CviUnknown", detail: "an unregistered pool or an unreadable validator fails closed, so money never moves on doubt.", branch: "unknown" as const },
] as const;

/** The off-chain Verify-CVI code map, rendered as a static documentation table, never called live. */
export const OFFCHAIN_CODE_MAP: readonly { code: number; meaning: string; state: CviOnchainState }[] = [
  { code: 1, meaning: "CVA not found", state: "unknown" },
  { code: 2, meaning: "user does not have a CVI", state: "unverified" },
  { code: 3, meaning: "CVI exists but cannot transfer (expired or frozen)", state: "unverified" },
  { code: 4, meaning: "success, valid CVI and transfer allowed", state: "verified" },
] as const;


