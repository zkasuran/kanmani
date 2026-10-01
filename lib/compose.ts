/**
 * The stack, each piece tied to a real Monad mainnet transaction.
 *
 * The composability bonus is not a logo wall. The claim is that each piece is load-bearing, so each
 * row links the moment that piece actually happened on chain 143. Three of the four hashes were read
 * back on chain (status success) before shipping. The Mera-account row is honestly hollow until a
 * passkey-derived account sends its own settle (plan 1.5): a null txHash renders the node as pending
 * rather than a dead link, so the panel is truthful at three of four and completes itself when the
 * hash is filled in.
 *
 * On the upto and escrow runs the payer and the payee are both the house EOA and the agent is ours,
 * so these prove the machinery works, not that a stranger paid us. That line travels with the rows.
 */

export type ComposeRow = {
  name: string;
  /** The internal codename, shown small, matching the homepage framing. */
  codename: string;
  chainId: number;
  /** null renders a hollow pending node. A hash renders a live explorer link via txUrl. */
  txHash: string | null;
  /** The contract the tx hit, when naming it helps a reader. */
  contract?: `0x${string}`;
  /** One load-bearing line: what this piece does and why it is not a bounty grab. */
  why: string;
  /** Where a pending (null-tx) row points instead of a dead explorer link. */
  href?: string;
};

/** The four pieces, in stack and money-flow order. */
export const COMPOSE: ComposeRow[] = [
  {
    name: "Mera account",
    codename: "Iris · Mera",
    chainId: 143,
    txHash: null,
    why: "One passkey derives the account that signs. Fund it and it sends its own gasless settle, no wallet, no seed phrase.",
    href: "/pay",
  },
  {
    name: "x402 upto",
    codename: "upto",
    chainId: 143,
    txHash: "0x94fc5e709885b40e7149791c4329ff2611d2e52545f4533f6e96fe1f6c0397d8",
    why: "The buyer signed a 0.01 ceiling and only 0.002 moved. Pay for what the work cost, not the maximum, with no second signature.",
  },
  {
    name: "Aqueous escrow",
    codename: "Aqueous",
    chainId: 143,
    txHash: "0x2b879b52d51d1d2044b224da76fee3f041d8214940e3799599d132c1b417b57e",
    contract: "0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32",
    why: "USDC locked before any work, buyer-signed and relayer-paid, so a hire does not trust the agent with the money up front.",
  },
  {
    name: "AgentPasskey precompile",
    codename: "AgentPasskey · P256 0x0100",
    chainId: 143,
    txHash: "0x399bdce466786717078e7ea95afd0e59d30e61c0901d24e6db38d28c0d9745f5",
    contract: "0x1E30531CD3ea6DE2958DB363418a5382C419dC24",
    why: "A WebAuthn signature verified on chain by the P256 precompile at 0x0100, so the passkey binds to an agent without a wallet in between.",
  },
];
