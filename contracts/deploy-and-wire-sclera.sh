#!/usr/bin/env bash
#
# Deploy Sclera to Monad mainnet and wire its address into the CRE workflow, in one command.
#
# This spends real MON for gas, so it is not run for you. It is the one ready command the deploy
# is held behind. Read it, then run it yourself.
#
#   bash contracts/deploy-and-wire-sclera.sh
#
# What it does, in order:
#   1. Sources the house key from the workspace .env (never copied, only sourced).
#   2. Derives the oracle attestor address from that key. The private key stays in the deriving
#      process and is never printed. See tools/oracle-attestor.mjs for why the attestor is a
#      separate identity from the deployer.
#   3. Broadcasts DeploySclera. The script refuses the demo attestor, the zero address and an
#      attestor equal to the deployer, so a misconfigured run reverts rather than deploying a
#      contract anyone could slash.
#   4. Reads the deployed address out of the broadcast receipt, not out of the log text.
#   5. Writes that address into cre/kanmani-oracle/slashing/config.staging.json, replacing the
#      zero address, so the CRE workflow reads a real bond instead of falling to observation mode.
#
# After it runs, re-simulate to see the chain half light up:
#   cd cre/kanmani-oracle && cre workflow simulate ./slashing --target staging-settings \
#     --non-interactive --trigger-index 0
#
# The workflow will still say "no bond found" until an agent posts one. Posting a demo bond needs
# a test USDC balance and is a separate step, documented in the oracle README.

set -euo pipefail

LANE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$LANE/../.." && pwd)"
FORGE="$HOME/.foundry/bin/forge"
CONFIG="$LANE/cre/kanmani-oracle/slashing/config.staging.json"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "no $ROOT/.env, cannot source the house key" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY missing from .env}"

SCLERA_ATTESTOR="$(node "$LANE/tools/attestor-address.mjs")"
export SCLERA_ATTESTOR
export SCLERA_SLASH_BENEFICIARY="0xDB6c6340342e71A63cD11Ebac2185204b7777777"

echo "deployer      $(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
echo "attestor      $SCLERA_ATTESTOR"
echo "beneficiary   $SCLERA_SLASH_BENEFICIARY"
echo

cd "$LANE/contracts"
"$FORGE" script script/DeploySclera.s.sol:DeploySclera \
  --rpc-url monad \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast

# The broadcast writes a receipt. Read the created address from it rather than scraping stdout, so
# a change in log formatting cannot put a wrong address into the config.
RECEIPT="$LANE/contracts/broadcast/DeploySclera.s.sol/143/run-latest.json"
ADDR="$(python3 -c "
import json, sys
r = json.load(open('$RECEIPT'))
created = [t['contractAddress'] for t in r['transactions']
           if t.get('contractName') == 'Sclera' and t.get('contractAddress')]
if len(created) != 1:
    sys.exit('expected exactly one Sclera creation in the receipt, found %d' % len(created))
print(created[0])
")"

echo
echo "Sclera deployed at $ADDR"

python3 -c "
import json
p = '$CONFIG'
cfg = json.load(open(p))
cfg['scleraAddress'] = '$ADDR'
json.dump(cfg, open(p, 'w'), indent=2)
open(p, 'a').write('\n')
print('wired scleraAddress into', p)
"

echo
echo "Done. Re-simulate:"
echo "  cd $LANE/cre/kanmani-oracle && cre workflow simulate ./slashing --target staging-settings --non-interactive --trigger-index 0"
