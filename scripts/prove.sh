#!/usr/bin/env bash
#
# Prove what each of the nine layers actually is, from a clean machine.
#
# Every check below reads a public endpoint or public chain state. No key, no env file and no access to
# our infrastructure. The point is that you do not have to trust this repository: run it and compare.
#
#   ./scripts/prove.sh              print to the terminal
#   ./scripts/prove.sh > proof.txt  capture it
#
# Needs curl. `cast` (foundry) is used where a check has to read the chain directly and is skipped with
# a visible SKIP line if absent rather than silently passing.
#
# IMPORTANT: eight layers are live and one is not. This script does not try to prove nine working
# things, because two of them are not working things yet. Intents is proven to be
# BUILT, which means the code and tests exist and nothing has run in production. A script that reported
# nine greens would be the exact kind of claim this project exists to catch.

set -uo pipefail

SITE="${SITE:-https://kanmani.xyz}"
RPC="${RPC:-https://rpc.monad.xyz}"
REG=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
SCLERA=0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf
AQUEOUS=0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32
VALIDATION=0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58

pass=0
fail=0
skip=0

ok()   { printf '  PASS  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); }
note() { printf '        %s\n' "$1"; }
sk()   { printf '  SKIP  %s\n' "$1"; skip=$((skip+1)); }

have_cast() { command -v cast >/dev/null 2>&1; }

echo "Kanmani proof run"
echo "  at   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  site $SITE"
echo "  rpc  $RPC"
if have_cast; then echo "  head $(cast block-number --rpc-url "$RPC" 2>/dev/null)"; else echo "  head (cast absent)"; fi
echo

# ---------------------------------------------------------------- 1. Retina, LIVE
echo "1. Retina  ·  index the evidence  ·  expected LIVE"
AGENTS=$(curl -fsS "$SITE/api/claims" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['total'])" 2>/dev/null)
FEED=$(curl -fsS "$SITE/feed.json" | python3 -c "import json,sys;print(json.load(sys.stdin)['checkedAtBlock'])" 2>/dev/null)
if [ -n "${AGENTS:-}" ] && [ "${AGENTS:-0}" -gt 0 ] 2>/dev/null; then
  ok "the index answers and holds $AGENTS checkable claims"
  note "checkedAtBlock $FEED"
else
  bad "the index did not return a claim count"
fi

# ---------------------------------------------------------------- 2. Fovea, LIVE
echo "2. Fovea  ·  verify the claim  ·  expected LIVE"
SUM=$(curl -fsS "$SITE/feed.json" | python3 -c "
import json,sys
s=json.load(sys.stdin)['data']['summary']
print(s['paymentClaims'], s['resolve'], s['doNotResolve'])" 2>/dev/null)
if [ -n "${SUM:-}" ]; then
  set -- $SUM
  ok "verdicts exist: $1 payment claims, $2 resolve, $3 do not"
  note "a false verdict means the chain was read and the transaction was absent, never that we failed to look"
else
  bad "no verdict summary returned"
fi

# ---------------------------------------------------------------- 3. Aqueous, LIVE
echo "3. Aqueous  ·  escrow the job  ·  expected LIVE"
if have_cast; then
  SZ=$(( ($(cast code $AQUEOUS --rpc-url "$RPC" 2>/dev/null | wc -c) - 2) / 2 ))
  if [ "$SZ" -gt 1000 ]; then ok "escrow deployed, $SZ bytes at $AQUEOUS"; else bad "no code at $AQUEOUS"; fi
else
  sk "needs cast to read contract code"
fi

# ---------------------------------------------------------------- 4. Iris, x402, LIVE
echo "4. Iris · x402  ·  pay without a wallet  ·  expected LIVE"
# No -f here on purpose: 402 IS the expected answer and -f would discard the challenge body.
CODE=$(curl -sS -o /tmp/_402 -w '%{http_code}' -X POST "$SITE/api/verify" \
  -H 'content-type: application/json' -d '{"uri":"data:application/json,%7B%7D"}' 2>/dev/null || true)
if [ "$CODE" = "402" ] && grep -q x402Version /tmp/_402; then
  ok "the priced endpoint answers 402 with an x402 challenge"
  note "$(python3 -c "import json;d=json.load(open('/tmp/_402'));a=d['accepts'][0];print(f\"asks {a['amount']} atomic {a['asset'][:10]}… on {a['network']}\")" 2>/dev/null)"
else
  bad "expected 402 with an x402 body, got $CODE"
fi

# ---------------------------------------------------------------- 5. Optic, LIVE
echo "5. Optic  ·  answer on chain  ·  expected LIVE"
if have_cast; then
  SZ=$(( ($(cast code $VALIDATION --rpc-url "$RPC" 2>/dev/null | wc -c) - 2) / 2 ))
  # A minimal proxy, so the bytecode is tiny. An earlier version of this script used a 1000-byte floor
  # and reported a live registry as dead, which is why the threshold is now "has any code at all".
  if [ "$SZ" -gt 0 ]; then
    ok "validation registry live at $VALIDATION, $SZ bytes (minimal proxy)"
    note "our row is visible at $SITE/validate"
  else bad "no code at the validation registry"; fi
else
  sk "needs cast"
fi

# ---------------------------------------------------------------- 6. Sclera, LIVE
echo "6. Sclera  ·  bond the promise  ·  expected LIVE"
B=$(curl -fsS "$SITE/api/agent/10256" | python3 -c "
import json,sys
b=json.load(sys.stdin)['data'].get('bond')
print('' if b is None else f\"{b['state']} {b['amountAtomic']} floor {b['minTruthRateBps']}bps\")" 2>/dev/null)
if [ -n "${B:-}" ]; then
  ok "agent 10256 carries a bond: $B"
  note "read live from the contract, not from an index, because a window matures without emitting anything"
else
  bad "no bond reported for agent 10256"
fi
if have_cast; then
  ST=$(cast call $SCLERA 'bonds(uint256)(address,uint64,uint8,address,uint64,uint128,uint16,uint32,uint64)' 10256 --rpc-url "$RPC" 2>/dev/null | sed -n '3p' | tr -d ' ')
  [ "$ST" = "1" ] && ok "the contract agrees: state 1 Active" || bad "contract state is '$ST', expected 1"
  # The ownership guard from audit Finding 9. Bonding an agent you do not own must revert.
  # 0x390772fc is NotAgentOwner(). Matching the selector rather than the word "revert" means this
  # cannot pass on some unrelated failure, which is the whole point of a guard check.
  GUARD=$(cast call $SCLERA 'postBond(uint256,address,uint128,uint16,uint64,uint32)' 10182 \
       0x754704Bc059F8C67012fEd69BC8A327a5aafb603 10000 8000 216000 5 \
       --from 0xDB6c6340342e71A63cD11Ebac2185204b7777777 --rpc-url "$RPC" 2>&1 || true)
  if printf '%s' "$GUARD" | grep -q '0x390772fc'; then
    ok "the ownership guard holds: postBond reverts NotAgentOwner() for an agent we do not own"
  else
    bad "postBond did not revert NotAgentOwner(). Got: $(printf '%s' "$GUARD" | head -c 90)"
  fi
else
  sk "contract-level bond checks need cast"
fi

# ---------------------------------------------------------------- 7. Chiasm, LIVE
echo "7. Chiasm  ·  read every chain at once  ·  expected LIVE"
CH=$(curl -fsS "$SITE/chains" -o /tmp/_ch -w '%{http_code}')
if [ "$CH" = "200" ] && grep -qE '35[0-9],[0-9]{3}' /tmp/_ch; then
  ok "BSC indexed beside Monad: $(grep -oE '35[0-9],[0-9]{3}' /tmp/_ch | head -1) agents on chain 56"
  note "merged on the content hash of the registration document"
else
  bad "the chains page did not report a second chain"
fi

# ---------------------------------------------------------------- 8. Intents, BUILT
echo "8. Intents  ·  fund from any chain  ·  expected BUILT, NOT live"
if [ -f lib/intents.ts ] && [ -f lib/intents.test.ts ]; then
  ok "the module and its tests exist"
  note "no cross-chain fund has been executed. This is proven BUILT, not live, on purpose"
  note "run: npm test -- lib/intents.test.ts"
else
  sk "run from the repository root to check the module"
fi

# ---------------------------------------------------------------- 9. Self-heal, LIVE
echo "9. Self-heal  ·  heal a fixed record  ·  expected LIVE"
# Agent 10256's document was repaired on chain with setAgentURI, which emits URIUpdated. If the index
# captured it, the Sclera address is in the indexed record. That string exists ONLY in the repaired
# version, so this cannot pass on the original document.
HEALED=$(curl -fsS "$SITE/api/agent/10256" | python3 -c "
import base64, json, sys
u = json.load(sys.stdin)['data'].get('registration', {}).get('uri', '')
pre = 'data:application/json;base64,'
if not u.startswith(pre):
    print('notinline'); raise SystemExit
print('yes' if '57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf' in base64.b64decode(u[len(pre):]).decode('utf8', 'replace') else 'no')" 2>/dev/null)
if [ "${HEALED:-}" = "yes" ]; then
  ok "a repaired document is reflected in the index, so URIUpdated is being captured"
  note "before this was wired, setAgentURI moved metadataUpdateCount and left the stored URI stale forever"
else
  bad "the repaired document is not in the index (got '${HEALED:-empty}')"
fi
WH=$(curl -fsS -o /dev/null -w '%{http_code}' "$SITE/api/webhooks/alchemy" 2>/dev/null || true)
if [ "$WH" = "200" ] || [ "$WH" = "405" ] || [ "$WH" = "401" ]; then
  ok "the optional Alchemy delivery path is deployed and answering ($WH)"
  note "healing does not depend on it. Zero deliveries have ever arrived and the layer is live anyway"
else
  bad "the webhook route did not answer, got $WH"
fi

echo
echo "-------------------------------------------------------------"
printf 'PASS %d   FAIL %d   SKIP %d\n' "$pass" "$fail" "$skip"
echo "Eight layers live, one built. If a FAIL appears above, the claim on the site is wrong and we"
echo "would rather you found it with this script than by trusting the page."
[ "$fail" -eq 0 ]
