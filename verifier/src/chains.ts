/**
 * The chain list, which is a published artifact rather than a config detail.
 *
 * `locate` reads a cited transaction on the chain the document names. That makes coverage part of
 * the claim: **a `false` means "not found on the chains in this file" and a reader has to be able
 * to see that list.** An untested chain is a hole and it gets named rather than rounded away.
 *
 * Two rules that keep the verdicts honest:
 *
 *  - **A network we do not cover is `unknown`, never `false`.** We did not look, so we cannot say.
 *  - **Widening this list is a published change.** Adding a chain can turn a `false` into a `true`,
 *    which is a correction with a before and an after, not a number that quietly improves.
 */

export type Chain = {
  /** EIP-155 chain id. The only identifier that is not a matter of opinion. */
  readonly id: number;
  readonly key: string;
  readonly displayName: string;
  /**
   * What documents in the wild actually write. Authors do not use chain ids, they type a word, so
   * this is the part that decides whether a claim is even readable.
   */
  readonly aliases: readonly string[];
  /** Env var holding the RPC endpoint. Absent endpoint means the chain reads as uncovered. */
  readonly rpcEnv: string;
};

export const CHAINS: readonly Chain[] = [
  {
    id: 143,
    key: "monad",
    displayName: "Monad",
    aliases: ["monad", "monad mainnet", "monad-mainnet", "monadmainnet"],
    rpcEnv: "RPC_MONAD",
  },
  {
    id: 1,
    key: "ethereum",
    displayName: "Ethereum",
    aliases: ["ethereum", "eth", "mainnet", "ethereum mainnet", "homestead", "l1"],
    rpcEnv: "RPC_ETHEREUM",
  },
  {
    id: 10,
    key: "optimism",
    displayName: "OP Mainnet",
    aliases: ["optimism", "op", "op mainnet", "optimism mainnet", "op-mainnet"],
    rpcEnv: "RPC_OPTIMISM",
  },
  {
    id: 8453,
    key: "base",
    displayName: "Base",
    aliases: ["base", "base mainnet", "base-mainnet"],
    rpcEnv: "RPC_BASE",
  },
  {
    id: 42161,
    key: "arbitrum",
    displayName: "Arbitrum One",
    aliases: ["arbitrum", "arbitrum one", "arb", "arbitrum-one", "arbone"],
    rpcEnv: "RPC_ARBITRUM",
  },
  {
    id: 137,
    key: "polygon",
    displayName: "Polygon",
    aliases: ["polygon", "matic", "polygon mainnet", "polygon-pos"],
    rpcEnv: "RPC_POLYGON",
  },
  {
    id: 56,
    key: "bsc",
    displayName: "BNB Smart Chain",
    aliases: ["bsc", "bnb", "binance", "bnb smart chain", "binance smart chain", "bnb chain"],
    rpcEnv: "RPC_BSC",
  },
  {
    // Added 2026-10-05 after an outside agent (Mida's auditor) found two Monad claims whose cited
    // transaction is a real USDC payment on Celo. Widening this list is a published change.
    id: 42220,
    key: "celo",
    displayName: "Celo",
    aliases: ["celo", "celo mainnet", "celo-mainnet"],
    rpcEnv: "RPC_CELO",
  },
] as const;

export type ChainLookup =
  | { known: true; chain: Chain }
  /** Parsed fine, we simply do not cover it. The verdict must be `unknown`. */
  | { known: false; reason: string; normalised: string };

/**
 * Turn whatever a document wrote into a chain or say plainly that we cannot.
 *
 * Handles the three shapes seen in the wild: a bare name (`"monad"`), a CAIP-2 identifier
 * (`"eip155:143"`) and a raw chain id as a number or a numeric string.
 */
export function resolveChain(declared: unknown): ChainLookup {
  if (declared === null || declared === undefined) {
    return { known: false, reason: "document names no network", normalised: "" };
  }

  // A number or a string that is entirely digits, is a chain id.
  if (typeof declared === "number" || /^\d+$/.test(String(declared).trim())) {
    const id = Number(declared);
    const byId = CHAINS.find((c) => c.id === id);
    return byId
      ? { known: true, chain: byId }
      : { known: false, reason: `chain id ${id} is not in the covered list`, normalised: String(id) };
  }

  const normalised = String(declared).trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
  if (normalised === "") {
    return { known: false, reason: "document names no network", normalised: "" };
  }

  // CAIP-2, eip155:<id>. The id is authoritative, so read it rather than the surrounding text.
  const caip = normalised.match(/^eip155:(\d+)$/);
  if (caip) {
    const id = Number(caip[1]);
    const byId = CHAINS.find((c) => c.id === id);
    return byId
      ? { known: true, chain: byId }
      : {
          known: false,
          reason: `chain id ${id} is not in the covered list`,
          normalised,
        };
  }

  for (const c of CHAINS) {
    if (c.key === normalised || c.aliases.includes(normalised)) return { known: true, chain: c };
  }

  // Deliberately no fuzzy matching. Guessing that "ethereum-goerli" means Ethereum would turn an
  // unknown into a confident wrong answer and a wrong `false` is the most expensive output here.
  return { known: false, reason: `network "${normalised}" is not in the covered list`, normalised };
}

/** The list as a reader should see it, for the coverage section of a verdict page. */
export function coverageTable(env: NodeJS.ProcessEnv = process.env): {
  chain: string;
  id: number;
  configured: boolean;
}[] {
  return CHAINS.map((c) => ({
    chain: c.displayName,
    id: c.id,
    configured: Boolean(env[c.rpcEnv]),
  }));
}
