#!/usr/bin/env node
/**
 * Print the Sclera oracle attestor ADDRESS and nothing else.
 *
 * The address is public and belongs in a deploy command, a README and a submission. The private key
 * never leaves this process, is never printed and is never written to a file. That asymmetry is the
 * reason this is a separate entry point from `oracle-attestor.mjs`.
 *
 *   set -a && . ~/Downloads/hackathon-hq/.env && set +a
 *   node tools/attestor-address.mjs
 */
import { deriveOracleAttestor } from "./oracle-attestor.mjs";

const house = process.env.HOUSE_WALLET_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
if (!house) {
  process.stderr.write(
    "no house key in the environment. Source it at the point of use:\n" +
      "  set -a && . ~/Downloads/hackathon-hq/.env && set +a\n",
  );
  process.exit(1);
}

let attestor;
try {
  attestor = deriveOracleAttestor(house.startsWith("0x") ? house : `0x${house}`);
} catch (e) {
  // Never echo the input on a parse failure. The message says what shape was expected, not what
  // was received.
  process.stderr.write(`could not derive the attestor: ${e.message}\n`);
  process.exit(1);
}

process.stdout.write(`${attestor.address}\n`);
