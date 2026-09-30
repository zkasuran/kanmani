#!/usr/bin/env node
/**
 * Execute one real cross-chain fund: BSC USDT in, a funded Monad escrow job out.
 *
 * Deliberately drives `lib/intents.ts` rather than hand-rolling requests, so what runs here is the same
 * code path the site describes. A proof that used a different path would prove the wrong thing.
 *
 *   node scripts/fund-crosschain.mjs          dry run, prints the quote and stops
 *   node scripts/fund-crosschain.mjs --send    creates the execution
 *
 * The shortfall guard is the important part. `terms.amount` must equal the guaranteed delivered amount,
 * because Aqueous reverts unless it receives exactly what the job says. So the quote is fetched first,
 * `minAmountOut` becomes the job amount and the guard refuses to proceed if the two disagree.
 */

import { keccak256, toHex } from "viem";

import { privateKeyToAccount } from "viem/accounts";
import { buildFundingSteps, findMessageToSign, planAqueousFunding, requestExecution, submitSignature, toIntentsSignature, toWireSteps } from "../lib/intents.ts";

const KEY = process.env.AURORA_INTENTS_API_KEY;
if (!KEY) {
  console.error("AURORA_INTENTS_API_KEY is not set");
  process.exit(2);
}

const WALLET = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
const USDT_BSC = "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g";
const MONAD_USDC = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx";
const USDC_MONAD_ADDR = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

// Our own Sentinel agent, which is registered, bonded and answering. Hiring our own agent keeps the
// counterparty honest for a first run: nobody else's money is involved.
const AGENT = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";

// Spend what arrived, less a little, so a rounding difference cannot make the transfer fail.
const AMOUNT_IN = process.env.AMOUNT_IN ?? "120000000000000000"; // 0.12 USDT, 18dp

const cfg = { apiKey: KEY, timeoutMs: 45000 };
const quoteSpec = {
  originAsset: USDT_BSC,
  amount: AMOUNT_IN,
  destinationAsset: MONAD_USDC,
  slippageTolerance: 100,
  swapType: "EXACT_INPUT",
};

// Step one: ask what will actually land, with no steps attached. The job amount has to be the
// guaranteed figure, so it cannot be chosen before the quote exists.
const probe = await requestExecution({ wallet: WALLET, quote: quoteSpec, steps: [], dry: true }, cfg);
const delivered = probe.minAmountOut;
console.log(`  quote     ${AMOUNT_IN} USDT base units in`);
console.log(`  delivered ${delivered} USDC base units guaranteed`);
console.log(`  fee       ${probe.networkFee ?? "n/a"}`);
console.log(`  via       ${probe.intermediaryAddress ?? "n/a"}`);

/**
 * Converge, because the two numbers depend on each other.
 *
 * A quote with no steps guarantees more than the same quote with steps, since the service appends its
 * own fee transfer to the destination run. So the first pass returned 117024, the stepped quote returned
 * 115559 and the shortfall guard correctly refused: the job would have demanded more than the bridge
 * promised and Aqueous reverts unless it receives exactly the job amount.
 *
 * Two passes settle it. Build steps at the probe figure, read what the stepped quote actually guarantees,
 * then rebuild at that figure. The fee is flat, so the second pass is stable rather than chasing itself.
 */
async function guaranteedWithSteps(candidate) {
  const t = { ...baseTerms, amount: candidate, pricePerUnit: candidate };
  const { steps } = buildFundingSteps({ amount: candidate, terms: t });
  const q = await requestExecution(
    { wallet: WALLET, quote: quoteSpec, steps: toWireSteps(steps), dry: true },
    cfg,
  );
  return q.minAmountOut;
}

const baseTerms = {
  agent: AGENT,
  token: USDC_MONAD_ADDR,
  amount: delivered,
  pricePerUnit: delivered,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
  termsHash: keccak256(toHex("kanmani cross-chain proof, Sentinel 10256")),
  salt: keccak256(toHex(`salt-${Date.now()}`)),
};

const stepped = await guaranteedWithSteps(delivered);
console.log(`  stepped   ${stepped} guaranteed once the destination steps are attached`);
const settled = await guaranteedWithSteps(stepped);
if (settled < stepped) {
  console.error(`  did not converge: ${stepped} then ${settled}. Refusing rather than guessing.`);
  process.exit(1);
}
console.log(`  converged ${stepped}, second pass confirms ${settled}`);

const terms = { ...baseTerms, amount: stepped, pricePerUnit: stepped };

const planned = await planAqueousFunding({ wallet: WALLET, quote: quoteSpec, terms }, cfg);
console.log(`  steps     ${planned.built.length} built, job amount ${planned.amount}`);
console.log(`  guard     passed: the job asks for exactly what the bridge guarantees`);

if (!process.argv.includes("--send")) {
  console.log("\n  dry run only. Re-run with --send to create the execution.");
  process.exit(0);
}

const live = await requestExecution(
  { wallet: WALLET, quote: quoteSpec, steps: toWireSteps(planned.built), dry: false },
  cfg,
);
console.log("\n  EXECUTION CREATED", live.id);

// Sign BEFORE depositing, per Aurora (mentor answer 2026-09-29): with the authorization already in, the
// batch runs by itself when the bridge lands. Our first run signed afterwards and the funds sat at the
// intermediary for three days until we did.
const msg = findMessageToSign(live.raw);
if (!msg) {
  console.error("  no messageToSign in the create response. Not depositing: the steps could not run.");
  process.exit(1);
}
const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  console.error("  DEPLOYER_PRIVATE_KEY is not set, so the execution cannot be signed. Not depositing.");
  process.exit(2);
}
const signer = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
if (signer.address.toLowerCase() !== WALLET.toLowerCase()) {
  console.error(`  the key signs as ${signer.address}, not the execution wallet ${WALLET}. Not depositing.`);
  process.exit(1);
}
const sub = await submitSignature({ wallet: WALLET, executionId: live.id, signature: toIntentsSignature(await signer.signMessage({ message: msg })) }, cfg);
if (!sub.ok) {
  console.error(`  submit refused (HTTP ${sub.status}): ${JSON.stringify(sub.body).slice(0, 300)}. Not depositing.`);
  process.exit(1);
}
console.log("  signed and submitted: the steps will run as soon as the deposit lands");
console.log(`  deposit ${AMOUNT_IN} (18dp) USDT on BSC to: ${live.depositAddress}`);
console.log("  if less than quote.minAmountOut arrives, the batch reverts and the funds stay at the");
console.log(`  intermediary ${live.intermediary}; recover them with a steps-only execution or a withdrawal.`);
