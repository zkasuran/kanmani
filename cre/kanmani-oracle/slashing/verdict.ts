/**
 * Sign a Sclera verdict the way the contract recovers it, inside the CRE workflow.
 *
 * The signature this produces is cross-checked to equal the app's proven `lib/verdict.ts` output, and
 * that module is proven against the deployed contract by `contracts/test/ScleraCrossSign.t.sol`. This
 * copy uses only viem, the workflow's own dependency, rather than reaching across packages or pulling a
 * second `@noble` version whose subpaths differ.
 *
 * The domain, the field order and the widths are copied from `contracts/src/Sclera.sol`. viem enforces
 * low-s and normalises v to 27 or 28, which is exactly what `_signedByAttestor` reads.
 */
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Verdict = {
  agentId: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  sampleSize: bigint;
  trueCount: bigint;
  nonce: bigint;
};

const VERDICT_TYPES = {
  Verdict: [
    { name: "agentId", type: "uint256" },
    { name: "windowStart", type: "uint64" },
    { name: "windowEnd", type: "uint64" },
    { name: "sampleSize", type: "uint32" },
    { name: "trueCount", type: "uint32" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

/** Sign a verdict with the on-chain attestor key. 65 bytes, r || s || v, low-s, v in {27,28}. */
export async function signVerdict(
  v: Verdict,
  privateKeyHex: `0x${string}`,
  chainId: bigint,
  verifyingContract: `0x${string}`,
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKeyHex);
  return account.signTypedData({
    domain: { name: "Sclera", version: "1", chainId: Number(chainId), verifyingContract },
    types: VERDICT_TYPES,
    primaryType: "Verdict",
    message: {
      agentId: v.agentId,
      windowStart: v.windowStart,
      windowEnd: v.windowEnd,
      sampleSize: Number(v.sampleSize),
      trueCount: Number(v.trueCount),
      nonce: v.nonce,
    },
  });
}

/** The report payload Sclera.onReport decodes: abi.encode(Verdict, signature). */
export function encodeReport(v: Verdict, signature: `0x${string}`): `0x${string}` {
  return encodeAbiParameters(parseAbiParameters("(uint256,uint64,uint64,uint32,uint32,uint64), bytes"), [
    [v.agentId, v.windowStart, v.windowEnd, Number(v.sampleSize), Number(v.trueCount), v.nonce],
    signature,
  ]);
}
