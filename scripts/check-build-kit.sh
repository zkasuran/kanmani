#!/usr/bin/env bash
# Check the build kit as a stranger's tool sees it: every published file answers, points at the
# public site and not at a developer's machine, and the two free checks return what the guide says.
# Usage: scripts/check-build-kit.sh [https://kanmani.xyz]
set -uo pipefail
SITE="${1:-https://kanmani.xyz}"
pass=0; fail=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1"; fail=$((fail+1)); }

for p in /skill.md /build/AGENTS.md /openapi.json /.well-known/agent-card.json /llms.txt /mcp; do
  body=$(curl -fsS "$SITE$p") || { bad "$p did not answer"; continue; }
  # A published link to localhost or a private address is a dead link for everyone but its author.
  if echo "$body" | grep -qE 'https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.)'; then
    bad "$p links to a local address: $(echo "$body" | grep -oE 'https?://(localhost|127\.0\.0\.1)[^" )]*' | head -1)"
  else ok "$p answers and every link is public"; fi
done

r=$(curl -fsS -X POST "$SITE/api/registration/check" -H 'content-type: application/json' -d '{"draft":{"name":"check-build-kit"}}')
echo "$r" | grep -q '"ready": true' && echo "$r" | grep -q '"function": "register(string)"' && ok "registration check returns register() calldata" || bad "registration check: $(echo "$r" | head -c 200)"

e=$(curl -fsS -X POST "$SITE/api/evidence/check" -H 'content-type: application/json' -d '{"document":"https://example.com/x.json"}' -o /dev/null -w '%{http_code}')
[ "$e" = "400" ] && ok "evidence check refuses to fetch a URL" || bad "evidence check with a URL returned $e"

m=$(curl -fsS -X POST "$SITE/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
n=$(echo "$m" | grep -oE '"name": ?"(check_registration|check_evidence|get_agent|get_account|list_claims)"' | sort -u | wc -l)
[ "$n" = "5" ] && ok "MCP lists all five tools" || bad "MCP tools/list found $n of 5"

echo; echo "PASS $pass   FAIL $fail"
[ "$fail" = "0" ]
