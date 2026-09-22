import { json, SITE } from "@/lib/api.ts";

export const dynamic = "force-dynamic";

/**
 * Our own ERC-8004 record, served the way we expect everyone else's to be served.
 *
 * Published deliberately. This site measures whether other people's registration documents still
 * answer and 8,093 agents on Monad point at one that does not. Holding ourselves to the same
 * check is the minimum, so this is a real endpoint rather than a file somebody forgot to renew.
 *
 * Note what is NOT here: no payment claim. We have not been paid through this record, so it does
 * not assert one. A document that claims nothing cannot be wrong about it.
 */
export async function GET() {
  return json({
    protocolVersion: "0.3.0",
    name: "Kanmani",
    description:
      "Checks whether the payment an ERC-8004 evidence document describes actually happened, by reading the cited transaction on the chain the document names.",
    url: SITE,
    // The one EVM identity behind this work, the same on every chain.
    agentWallet: "0xDB6c6340342e71A63cD11Ebac2185204b7777777",
    capabilities: { streaming: false, pushNotifications: false },
    skills: [
      {
        id: "verify-payment-claim",
        name: "Verify a payment claim",
        description:
          "Given an evidence document URI and optionally its on-chain commitment, returns one of true, false, noClaim or unknown, with the reason and the block the check was made at.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        endpoint: `${SITE}/api/verify`,
        // Priced because it spends a request on somebody else's server and an RPC call.
        payment: { protocol: "x402", scheme: "exact", network: "monad" },
      },
      {
        id: "read-verdicts",
        name: "Read recorded verdicts",
        description: "The full checked population, filterable. Free, because it costs us a query.",
        outputModes: ["application/json"],
        endpoint: `${SITE}/api/claims`,
      },
    ],
    // What we will not do, in the record itself rather than only in prose.
    refuses: [
      "Returning false for a document we failed to fetch.",
      "Ranking agents by a score that is not published.",
      "Stating intent. A verdict describes what was observed.",
    ],
    trust: {
      method: `${SITE}/method`,
      corrections: `${SITE}/status`,
      appendOnly: true,
    },
    registries: [
      {
        chainId: 143,
        identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
      },
    ],
  });
}
