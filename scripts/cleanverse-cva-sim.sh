#!/usr/bin/env bash
#
# Simulate, read only, whether our Aqueous escrow path can move aUSDC (a Cleanverse Verified Asset)
# and who needs a Cleanverse Verified Identity (CVI) for it to work. No key, no funds, no state change.
# Every line is an eth_call against a public Monad RPC, so a judge or a teammate reruns it as is.
#
#   bash scripts/cleanverse-cva-sim.sh
#
# What it establishes (flagship 6.1):
#   1. aUSDC gates every transfer through its own CVA Policy, the same policy on mainnet and testnet.
#   2. The policy rule is minTier 5, no group, no country, so a party is compliant only with a CVI
#      of tier 5 or higher.
#   3. The policy checks BOTH the sender and the recipient of a transfer.
#   4. Our buyer, gate and Aqueous addresses hold no CVI, so every aUSDC hop in open and settle reverts.
#   5. The one CVI-holding testnet worker passes, which is the "would have worked" control.
#
# Needs: foundry's `cast` on PATH (https://getfoundry.sh).
set -uo pipefail

RPC_M="${RPC_MONAD:-https://rpc.monad.xyz}"
RPC_T="${RPC_MONAD_TESTNET:-https://testnet-rpc.monad.xyz}"

# Cleanverse contracts, read live on 2026-10-01. EIP-1967 proxies, identical bytecode on both chains.
AUSDC=0xaC0893567D43C3E7e6e35a72803df05416C1f20D   # Access USDC, the CVA. decimals 6
POLICY=0x36489bE45fa84f70a0c2BDB11D824Be608CB12Dd   # the CVA Policy that gates aUSDC transfers
VALIDATOR=0xA64529732B52EFFD2B245320E88226D72c23b788 # the gate's own Compliance Validator

# Our deployed escrow path. None of these holds a CVI today.
BUYER=0xDB6c6340342e71A63cD11Ebac2185204b7777777     # the house EOA, default buyer
M_GATE=0x4a21a5d8e24E683801ECC4CF19f178d7185e544A     # mainnet CleanverseGate
M_AQ=0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32       # mainnet Aqueous escrow
T_GATE=0xfc831E2F4FF21C4FB0B241684CB39203Bd137d2f     # testnet CleanverseGate (registered)
T_AQ=0xAbB85ab157357676eBE7ae17A161168912A3c232       # testnet Aqueous escrow
WORKER=0xaA514cD6573f95DdD0df78ec1Fdcb8dA05E70936     # testnet worker holding a tier 20 CVI

CANTRANSFER="canTransfer(address,address,address,uint256)(bool)"

command -v cast >/dev/null 2>&1 || { echo "cast not found. Install foundry: https://getfoundry.sh"; exit 1; }

# Read one canTransfer and say what it means. A clean "true" is compliant. A revert is classified by
# its selector: 0xa6725971 is the policy blocking a non-compliant party (the trailing word names it),
# 0xe450d38c is ERC20InsufficientBalance, which only fires AFTER compliance passed, so it is the
# "would have worked" control.
probe() {
  local label="$1" rpc="$2" from="$3" to="$4" out sel who
  out="$(cast call "$POLICY" "$CANTRANSFER" "$AUSDC" "$from" "$to" 1 --rpc-url "$rpc" 2>&1 || true)"
  if [[ "$out" == *"true"* ]]; then
    printf '  %-34s => PASS (true)\n' "$label"
    return
  fi
  sel="$(printf '%s' "$out" | grep -oE '0x[0-9a-fA-F]{8}' | head -1 | tr 'A-F' 'a-f')"
  who="$(printf '%s' "$out" | grep -oE '0x[0-9a-fA-F]{72}' | head -1)"
  who="0x${who: -40}"
  case "$sel" in
    0xa6725971) printf '  %-34s => BLOCKED by compliance %s (no CVI) selector 0xa6725971\n' "$label" "$who" ;;
    0xe450d38c) printf '  %-34s => compliance PASSED, balance only (0xe450d38c) the would-have-worked control\n' "$label" ;;
    *)          printf '  %-34s => %s\n' "$label" "$out" ;;
  esac
}

echo "================ Cleanverse aUSDC transfer-gate simulation (read only) ================"
echo
echo "A. aUSDC routes every transfer through one CVA Policy, the same on both chains"
printf '  mainnet aUSDC.policy()  = %s\n' "$(cast call "$AUSDC" 'policy()(address)' --rpc-url "$RPC_M" 2>&1 || true)"
printf '  testnet aUSDC.policy()  = %s\n' "$(cast call "$AUSDC" 'policy()(address)' --rpc-url "$RPC_T" 2>&1 || true)"
printf '  aUSDC decimals          = %s (not 18)\n' "$(cast call "$AUSDC" 'decimals()(uint8)' --rpc-url "$RPC_M" 2>&1 || true)"
echo
echo "   The gate's own validator does not know aUSDC, so this policy is the only aUSDC gate:"
printf '  mainnet validator.isRegistered(aUSDC) = %s\n' "$(cast call "$VALIDATOR" 'isRegistered(address)(bool)' "$AUSDC" --rpc-url "$RPC_M" 2>&1 || true)"
printf '  testnet validator.isRegistered(aUSDC) = %s\n' "$(cast call "$VALIDATOR" 'isRegistered(address)(bool)' "$AUSDC" --rpc-url "$RPC_T" 2>&1 || true)"
echo
echo "B. The policy rule for aUSDC: (allowedGroup, allowedSubGroup, minTier, minSubTier, countryBitmap)"
printf '  mainnet getRulesV2(aUSDC) = %s\n' "$(cast call "$POLICY" 'getRulesV2(address)((bytes2,bytes2,uint8,uint8,uint256)[])' "$AUSDC" --rpc-url "$RPC_M" 2>&1 || true)"
printf '  testnet getRulesV2(aUSDC) = %s\n' "$(cast call "$POLICY" 'getRulesV2(address)((bytes2,bytes2,uint8,uint8,uint256)[])' "$AUSDC" --rpc-url "$RPC_T" 2>&1 || true)"
echo "   minTier 5, no group, no country. A party is compliant only with a CVI of tier 5 or higher."
echo
echo "C. Both sides are checked. Testnet, the tier 20 worker against a counterparty with no CVI:"
probe "worker -> t_gate (checks 'to')"   "$RPC_T" "$WORKER" "$T_GATE"
probe "t_gate -> worker (checks 'from')"  "$RPC_T" "$T_GATE" "$WORKER"
probe "worker -> worker (both compliant)" "$RPC_T" "$WORKER" "$WORKER"
echo
echo "D. Our escrow addresses on testnet, every hop open and settle would make:"
probe "buyer -> t_gate"    "$RPC_T" "$BUYER"  "$T_GATE"
probe "t_gate -> t_aqueous" "$RPC_T" "$T_GATE" "$T_AQ"
probe "t_aqueous -> t_gate" "$RPC_T" "$T_AQ"   "$T_GATE"
echo
echo "E. Our escrow addresses on mainnet, the same hops:"
probe "buyer -> m_gate"    "$RPC_M" "$BUYER"  "$M_GATE"
probe "m_gate -> m_aqueous" "$RPC_M" "$M_GATE" "$M_AQ"
probe "m_aqueous -> m_gate" "$RPC_M" "$M_AQ"   "$M_GATE"
echo
echo "======================================= VERDICT ======================================="
echo "YES. Aqueous and the gate both need whitelisting, together with the buyer and the worker."
echo "The whitelist is a Cleanverse CVI of tier 5 or higher issued to each of the four addresses."
echo "No contract change is needed. Aqueous and the gate are immutable and token agnostic, so"
echo "aUSDC's rule stays Cleanverse's. The only lever is getting CVIs issued to our addresses."
echo "Expected: buyer, gate and Aqueous BLOCKED (0xa6725971); the tier 20 worker PASSES."
