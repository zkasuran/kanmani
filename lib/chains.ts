/**
 * The chain registry, typed.
 *
 * `shared/erc8004-chains.json` is the single source of truth and this file is the only way the site
 * reads it. Adding a chain is one entry there plus one env var; the conformance tests in
 * `chains.test.ts` fail with whatever is still missing, including anything that has drifted out of
 * step in the verifier or the indexer.
 *
 * ## Two dimensions, kept apart on purpose
 *
 * A chain can be **verifiable** without hosting any agents. Ethereum has no ERC-8004 registry in
 * this registry and we still read receipts on it, because an agent registered on Monad may well be
 * paid on Ethereum. So:
 *
 *   covered()      we can read a transaction there. Decides whether a claim is checkable at all.
 *   registrable()  the ERC-8004 registries are deployed there. Decides where an agent can exist.
 *
 * Collapsing those two would make "register on Monad, settle anywhere" unrepresentable, which is
 * the topology ERC-8004 itself describes: *"an agent registered and receiving feedback on chain A
 * can still operate and transact on other chains."*
 *
 * ## Coverage is a published artifact, not a config detail
 *
 * `locate` reads a cited transaction on the chain a document names, so coverage is part of the
 * claim: a `false` means "not found on the chains in this registry" and a reader has to be able to
 * see that list. `/chains` renders it. Two rules follow and neither is negotiable:
 *
 *   - **A chain we do not cover is `unknown`, never `false`.** We did not look.
 *   - **Widening the list is a published change**, because adding a chain can turn a `false` into a
 *     `true`, which is a correction with a before and an after rather than a number that quietly
 *     improves.
 */

// Relative rather than through the `@/` alias, because this module is imported both by Next, which
// resolves the alias, and by `node --test`, which does not. A path that works in one and not the
// other is a test that cannot run.
import registry from "../shared/erc8004-chains.json" with { type: "json" };

/** Where the three ERC-8004 registries live on a chain. */
export type Registries = {
  identity: `0x${string}`;
  reputation: `0x${string}`;
  validation: `0x${string}`;
};

export type Erc8004Deployment = {
  /** First block worth scanning. The proxy deployment, so a backfill skips empty history. */
  startBlock: number;
  /** True only when the chain is present in the live database, not merely configured. */
  indexed: boolean;
  note?: string;
};

export type Chain = {
  id: number;
  key: string;
  displayName: string;
  aliases: readonly string[];
  rpcEnv: string;
  explorer: string;
  /** null when the registries are not deployed there. */
  erc8004: Erc8004Deployment | null;
};

type RawChain = Omit<Chain, "erc8004"> & {
  erc8004: (Erc8004Deployment & { registries?: Registries }) | null;
};

const RAW = registry as unknown as {
  canonicalRegistries: Registries;
  chains: RawChain[];
};

/** The address set every mainnet deployment shares. A chain may override it. */
export const CANONICAL_REGISTRIES: Registries = RAW.canonicalRegistries;

export const CHAINS: readonly Chain[] = RAW.chains.map((c) => ({
  id: c.id,
  key: c.key,
  displayName: c.displayName,
  aliases: c.aliases,
  rpcEnv: c.rpcEnv,
  explorer: c.explorer,
  erc8004: c.erc8004
    ? { startBlock: c.erc8004.startBlock, indexed: c.erc8004.indexed, note: c.erc8004.note }
    : null,
}));

/**
 * The registries for a chain: its own override when it has one, the canonical set otherwise.
 *
 * Returns null rather than the canonical set for a chain with no deployment, because handing back
 * plausible addresses for a chain that has none is exactly how a wrong integration comes to look
 * like a working one.
 */
export function registriesFor(chainId: number): Registries | null {
  const raw = RAW.chains.find((c) => c.id === chainId);
  if (!raw?.erc8004) return null;
  return raw.erc8004.registries ?? RAW.canonicalRegistries;
}

export function byId(chainId: number): Chain | undefined {
  return CHAINS.find((c) => c.id === chainId);
}

export function byKey(key: string): Chain | undefined {
  return CHAINS.find((c) => c.key === key);
}

/**
 * Resolve whatever a document wrote into a chain.
 *
 * Matching is on the lowercased, trimmed alias list because authors type words. Returns undefined
 * for anything unrecognised, and a caller that gets undefined must record `unknown` rather than
 * guessing at the nearest chain: a document naming a chain we do not know is a document we did not
 * check, not a document that failed.
 */
export function resolveDeclared(declared: unknown): Chain | undefined {
  if (typeof declared !== "string") return undefined;
  const needle = declared.trim().toLowerCase();
  if (!needle) return undefined;
  return CHAINS.find((c) => c.aliases.includes(needle));
}

/** Chains an agent can exist on: the registries are deployed there. */
export function registrable(): readonly Chain[] {
  return CHAINS.filter((c) => c.erc8004 !== null);
}

/** Chains whose agents are in the live database right now, which is narrower than registrable. */
export function indexedChains(): readonly Chain[] {
  return CHAINS.filter((c) => c.erc8004?.indexed);
}

/**
 * Whether a chain is readable in this environment.
 *
 * Declared in the registry is not the same as usable: without the endpoint there is nothing to read
 * with, so the chain is uncovered and every claim naming it is `unknown`. That distinction is the
 * reason this takes an env rather than answering from the file alone.
 */
export function covered(chainId: number, env: Record<string, string | undefined> = process.env): boolean {
  const c = byId(chainId);
  return Boolean(c && env[c.rpcEnv]);
}

/** The published coverage table. This is the artifact `/chains` renders. */
export function coverage(env: Record<string, string | undefined> = process.env): {
  chain: Chain;
  configured: boolean;
  registries: Registries | null;
}[] {
  return CHAINS.map((chain) => ({
    chain,
    configured: Boolean(env[chain.rpcEnv]),
    registries: registriesFor(chain.id),
  }));
}

/** A transaction link a human can open, or null when we have no explorer for that chain. */
export function txUrl(chainId: number, hash: string): string | null {
  const c = byId(chainId);
  return c ? `${c.explorer}/tx/${hash}` : null;
}

export function addressUrl(chainId: number, address: string): string | null {
  const c = byId(chainId);
  return c ? `${c.explorer}/address/${address}` : null;
}
