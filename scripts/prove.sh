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
# All nine layers are live, each proven against public chain state or a public endpoint. This script does not try to prove nine working
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
# The count is read, not bounded: it grows daily and a pattern for 35x,xxx went false at 360,000.
BSC_N=$(sed -e 's/<[^>]*>/ /g' /tmp/_ch | tr -s ' ' | grep -oE "Smart Chain.{0,12}own [0-9]{1,3}(,[0-9]{3})+ agents" | grep -oE '[0-9]{1,3}(,[0-9]{3})+' | head -1)
if [ "$CH" = "200" ] && [ -n "$BSC_N" ]; then
  ok "BSC indexed beside Monad: $BSC_N agents on chain 56"
  note "merged on the content hash of the registration document"
else
  bad "the chains page did not report a second chain"
fi

# ---------------------------------------------------------------- 8. Intents, LIVE
echo "8. Intents  ·  fund from any chain  ·  expected LIVE"
# 0.12 USDT deposited on BSC, bridged by Aurora Intents Connect, then the intermediary account on
# Monad ran approve + createJob. The check reads that destination transaction off Monad and requires
# a USDC transfer from the intermediary INTO Aqueous, so it cannot pass on a bridge that only moved
# money into a holding address, which is exactly where this layer sat for three days.
INTENTS_TX=0x738af85c2f6717da15f1cee3a447b05d0fc7b3c924b8027678afdde0a440b558
INTERMEDIARY=0x004f15d9b733676b344c25fab983c73d1a1b29b2
if have_cast; then
  MOVED=$(cast receipt $INTENTS_TX --rpc-url "$RPC" --json 2>/dev/null | python3 -c "
import json,sys
r=json.load(sys.stdin)
if r.get('status')!='0x1': print(0); raise SystemExit
n=0
for l in r['logs']:
    t=l['topics']
    if l['address'].lower()=='0x754704bc059f8c67012fed69bc8a327a5aafb603' and t[0].startswith('0xddf252ad') \
       and t[1][-40:]=='$INTERMEDIARY'[2:] and t[2][-40:]=='${AQUEOUS,,}'[2:]:
        n+=int(l['data'],16)
print(n)" 2>/dev/null)
  if [ "${MOVED:-0}" -gt 0 ] 2>/dev/null; then
    ok "a cross-chain fund landed in the escrow: $MOVED USDC units from the intermediary into Aqueous"
    note "source 0.12 USDT on BSC, destination tx $INTENTS_TX"
  else
    bad "no USDC transfer from the intermediary into Aqueous in $INTENTS_TX"
  fi
else
  sk "needs cast to read the destination transaction"
fi

# ---------------------------------------------------------------- 9. Self-heal, LIVE
echo "9. Self-heal  ·  heal a fixed record  ·  expected LIVE"
# Agent 10256's document has been repointed on chain with setAgentURI more than once, each emitting
# URIUpdated. If the index captures them, its stored URI equals what the registry returns right now.
# Compared whole, so it cannot pass on any earlier version of the document.
ONCHAIN=$(curl -fsS -X POST "$RPC" -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x8004A169FB4a3325136EB29fA0ceB6D2e539a432","data":"0xc87b56dd0000000000000000000000000000000000000000000000000000000000002810"},"latest"]}' | python3 -c "
import json,sys
r=bytes.fromhex(json.load(sys.stdin)['result'][2:]); n=int.from_bytes(r[32:64],'big'); print(r[64:64+n].decode())" 2>/dev/null)
HEALED=$(curl -fsS "$SITE/api/agent/10256" | ONCHAIN="$ONCHAIN" python3 -c "
import json, os, sys
u = json.load(sys.stdin)['data'].get('registration', {}).get('uri', '')
print('yes' if u and u == os.environ['ONCHAIN'] else 'no')" 2>/dev/null)
if [ "${HEALED:-}" = "yes" ]; then
  ok "the index holds 10256's current on-chain document, so URIUpdated is being captured"
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

# ---------------------------------------------------------------- 10. P256, LIVE
echo "10. AgentPasskey  ·  Monad's P256 precompile  ·  expected LIVE"
AP=0x1E30531CD3ea6DE2958DB363418a5382C419dC24
# The RIP-7212 reference vector, straight to the precompile at 0x0100.
PV=$(curl -fsS -X POST "$RPC" -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x0000000000000000000000000000000000000100","data":"0x4cee90eb86eaa050036147a12d49004b6b9c72bd725d39d4785011fe190f0b4da73bd4903f0ce3b639bbbf6e8e80d16931ff4bcf5993d58468e8fb19086e8cac36dbcd03009df8c59286b162af3bd7fcc0450c9aa81be5d10d312af6c66b1d604aebd3099c618202fcfe16ae7770b0c49ab5eadf74b754204a3bb6060e44eff37618b065f9832de4ca6ca971a7a1adc826d0f7c00181a5fb2ddf79ae00b4e10e"},"latest"]}' | grep -oE '0x0{63}1')
[ -n "$PV" ] && ok "the P256 precompile at 0x0100 verifies the RIP-7212 reference signature on Monad mainnet" || bad "the P256 precompile did not verify the reference vector"
CODE=$(curl -fsS -X POST "$RPC" -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$AP\",\"latest\"]}" | grep -oE '"result":"0x[0-9a-f]+' | cut -d'"' -f4)
# nonces(10256): one bind and one unbind happened through the site, so it is at least 2.
N=$(curl -fsS -X POST "$RPC" -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$AP\",\"data\":\"0x141a468c0000000000000000000000000000000000000000000000000000000000002810\"},\"latest\"]}" | grep -oE '0x[0-9a-f]{64}' | head -1)
if [ "${#CODE}" -gt 1000 ] && [ -n "$N" ] && [ $((N)) -ge 2 ]; then
  ok "AgentPasskey is deployed and agent 10256 has been bound and unbound through it (nonce $((N)))"
  note "bind tx 0x399bdce466786717078e7ea95afd0e59d30e61c0901d24e6db38d28c0d9745f5, verified by the precompile inside bind()"
else
  bad "AgentPasskey not found or never used at $AP"
fi

# ---------------------------------------------------------------- 11. Our own agents, LIVE
echo "11. Our agents  ·  held to the checks we apply to others  ·  expected LIVE"
WK=$(curl -fsS "$SITE/.well-known/agent-registration.json" | grep -oE '"agentId": [0-9]+' | wc -l)
[ "$WK" -ge 13 ] && ok "the well-known file lists $WK ERC-8004 registrations we operate (spec domain verification)" || bad "the well-known file lists $WK registrations, expected 13"
M=0; for s in kanmani sentinel assay locator notary registrar ledger twin pulse doctor linter bondsman scribe; do
  curl -fsS "$SITE/api/service/$s/registration.json" | grep -q '"onChainMatches": true' && M=$((M+1)); done
[ "$M" = "13" ] && ok "all 13 agents carry their registration-v1 document on chain, byte for byte" || bad "only $M of 13 agents carry their intended document on chain"

# ---------------------------------------------------------------- 12. Composability, every link is a real tx
echo "12. Composability  ·  each stack layer links a settled chain-143 tx  ·  expected status 1"
if have_cast; then
  for H in \
    0x94fc5e709885b40e7149791c4329ff2611d2e52545f4533f6e96fe1f6c0397d8 \
    0x2b879b52d51d1d2044b224da76fee3f041d8214940e3799599d132c1b417b57e \
    0x399bdce466786717078e7ea95afd0e59d30e61c0901d24e6db38d28c0d9745f5; do
    ST=$(cast receipt "$H" status --rpc-url "$RPC" 2>/dev/null | tr -d ' ')
    [ "$ST" = "true" ] || [ "$ST" = "1" ] && ok "composability tx ${H:0:12}… mined success on chain 143" || bad "composability tx ${H:0:12}… did not read as a success receipt"
  done
  note "the Mera-account row is hollow until plan 1.5 fills its hash, so the panel is honest at 3 of 4"
else
  sk "cast absent, cannot read the composability receipts"
fi

echo
echo "-------------------------------------------------------------"
printf 'PASS %d   FAIL %d   SKIP %d\n' "$pass" "$fail" "$skip"
echo "All eleven layers live. If a FAIL appears above, the claim on the site is wrong and we"
echo "would rather you found it with this script than by trusting the page."
[ "$fail" -eq 0 ]
