// Signs a Sclera verdict with the Iris on-chain attestor key, for a forge FFI cross-check.
//
// This is the whole point of the cross-check: the signature the contract verifies is produced by
// the real product code (lib/verdict.ts signing with a key lib/iris.ts derives), not by Solidity's
// vm.sign. If the two implementations of the EIP-712 digest ever diverge, the recovered signer is
// wrong and the forge test fails. Neither language is checking its own homework here.
//
// Called by ScleraCrossSign.t.sol via ffi. Args, all decimal or 0x hex:
//   node sign-verdict.mjs <chainId> <verifyingContract> <agentId> <windowStart> <windowEnd> \
//                         <sampleSize> <trueCount> <nonce>
// Prints, on one line, `<attestorAddress> <signature>` as two 0x-prefixed hex strings, which the
// test reads with vm.split on the space.
import { deriveKeys } from "../../../lib/iris.ts";
import { signVerdict } from "../../../lib/verdict.ts";

const [chainId, verifyingContract, agentId, windowStart, windowEnd, sampleSize, trueCount, nonce] =
  process.argv.slice(2);

// The pinned demo PRF vector, the same bytes [1..32] iris.test.ts and verdict.test.ts pin against,
// so the attestor this produces is the published 0x722cf70... address.
const PRF = new Uint8Array(32).map((_, i) => i + 1);
const keys = await deriveKeys(PRF);

const verdict = {
  agentId: BigInt(agentId),
  windowStart: BigInt(windowStart),
  windowEnd: BigInt(windowEnd),
  sampleSize: BigInt(sampleSize),
  trueCount: BigInt(trueCount),
  nonce: BigInt(nonce),
};

const sig = signVerdict(verdict, keys.onchainAttestation.privateKey, BigInt(chainId), verifyingContract);

// forge ffi reads stdout as the return bytes. A trailing newline is fine, extra output is not.
process.stdout.write(`${keys.onchainAttestation.address} ${sig}`);
