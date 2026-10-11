/**
 * Which chain the payment path targets, as a small pure registry.
 *
 * The mainnet `/pay` and `/api/verify` carry real USDC and are the live submission surface, so the
 * testnet free-judge path is added BESIDE them rather than by rewriting lib/x402 or lib/pay. This
 * file is the one place the two configs live. Every mainnet value is pulled straight from lib/x402,
 * so `requirementsFor("mainnet")` is byte-identical to `requirements()` and the mainnet path provably
 * did not move. A test asserts exactly that.
 *
 * Testnet uses TestUSDC (contracts/src/TestUSDC.sol), a USDC-shaped ERC-20 with real EIP-3009 and six
 * decimals. Its EIP-712 domain name is "Kanmani Test USD" and version "1", NOT the mainnet
 * {name:"USDC", version:"2"}. docs.monad.xyz/guides/x402: "Testnet has no built-in entry and requires
 * the custom money parser", which is why these come from here rather than an SDK default.
 */
import { NETWORK, PAY_TO, PRICE_ATOMIC, USDC_MONAD, type PaymentRequirements } from "./x402.ts";

export type PayNetName = "mainnet" | "testnet";

export type PayNet = {
  net: PayNetName;
  /** CAIP-2 network id. */
  network: string;
  chainId: number;
  asset: `0x${string}`;
  /** EIP-712 domain name the token signs under. */
  name: string;
  /** EIP-712 domain version. */
  version: string;
  decimals: number;
  priceAtomic: string;
  payTo: `0x${string}`;
  /** The explorer base a settled tx links to, including the trailing slash. */
  explorerTx: string;
};

/**
 * The known TestUSDC deploy on chain 10143, used when `TESTNET_USDC` is unset so a build with no env
 * still points somewhere real. A redeploy is one env change, never a code edit.
 */
export const TESTNET_USDC_FALLBACK = "0x841057C182b74408628FadAFba01Ad178cDA2E2f";

/** Mainnet, every value from lib/x402 so it cannot drift from the live payment path. */
const MAINNET: PayNet = {
  net: "mainnet",
  network: NETWORK,
  chainId: 143,
  asset: USDC_MONAD as `0x${string}`,
  name: "USDC",
  version: "2",
  decimals: 6,
  priceAtomic: PRICE_ATOMIC,
  payTo: PAY_TO as `0x${string}`,
  explorerTx: "https://monadscan.com/tx/",
};

function testnet(): PayNet {
  return {
    net: "testnet",
    network: "eip155:10143",
    chainId: 10143,
    asset: (process.env.TESTNET_USDC ?? TESTNET_USDC_FALLBACK) as `0x${string}`,
    name: "Kanmani Test USD",
    version: "1",
    decimals: 6,
    priceAtomic: "10000",
    // The same house EOA on every chain, so the payee pin holds on testnet too.
    payTo: PAY_TO as `0x${string}`,
    explorerTx: "https://testnet.monadscan.com/tx/",
  };
}

/** Resolve a network. Reads env for the testnet asset, so a redeploy needs no code change. */
export function payNet(net: PayNetName): PayNet {
  return net === "testnet" ? testnet() : MAINNET;
}

/**
 * The x402 `exact` requirements for a network.
 *
 * For mainnet this is byte-identical to `requirements()` in lib/x402, so threading `net` through the
 * payment path cannot change the mainnet bytes a facilitator recovers against.
 */
export function requirementsFor(net: PayNetName): PaymentRequirements {
  const n = payNet(net);
  return {
    scheme: "exact",
    network: n.network,
    amount: n.priceAtomic,
    asset: n.asset,
    payTo: n.payTo,
    maxTimeoutSeconds: 60,
    extra: { name: n.name, version: n.version },
  };
}

/** The EIP-712 domain the token signs `TransferWithAuthorization` under, for a network. */
export function usdcDomainFor(net: PayNetName): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
} {
  const n = payNet(net);
  return { name: n.name, version: n.version, chainId: n.chainId, verifyingContract: n.asset };
}
