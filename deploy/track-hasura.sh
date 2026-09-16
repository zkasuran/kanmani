#!/usr/bin/env bash
# Track Retina's tables in Kanmani's own Hasura, and open them to anonymous reads.
#
# Why this exists as a script rather than relying on the indexer: envio runs its
# "Tracking tables in Hasura" step once, during storage init, which happens BEFORE the
# entity tables exist. On a fresh volume it therefore tracks nothing, reports no error on
# later runs, and leaves an empty GraphQL surface. Doing it here makes it explicit,
# repeatable and reviewable instead of a side effect of startup ordering.
#
# Anonymous select matters: a judge opening the GraphQL endpoint must not need our admin
# secret. The data is a public chain read, so there is nothing here to protect.
#
#   ./deploy/track-hasura.sh
set -euo pipefail

HASURA="${HASURA_URL:-http://127.0.0.1:8081}"
SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:-testing}"

TABLES=(Agent AgentRecord Feedback Validation Verdict IndexState chain_metadata)

meta() {
  curl -sS --max-time 25 -X POST "$HASURA/v1/metadata" \
    -H 'content-type: application/json' \
    -H "x-hasura-admin-secret: $SECRET" \
    --data "$1"
}

echo "Tracking ${#TABLES[@]} tables on $HASURA"
for t in "${TABLES[@]}"; do
  r=$(meta "{\"type\":\"pg_track_table\",\"args\":{\"source\":\"default\",\"table\":{\"schema\":\"public\",\"name\":\"$t\"}}}")
  code=$(printf '%s' "$r" | python3 -c 'import json,sys;
try: print(json.load(sys.stdin).get("code","ok"))
except Exception: print("ok")')
  echo "  track $t -> $code"

  # Anonymous read. Envio adds chainId to every entity, so no column is filtered out.
  p=$(meta "{\"type\":\"pg_create_select_permission\",\"args\":{\"source\":\"default\",\"table\":{\"schema\":\"public\",\"name\":\"$t\"},\"role\":\"public\",\"permission\":{\"columns\":\"*\",\"filter\":{},\"allow_aggregations\":true}}}")
  pcode=$(printf '%s' "$p" | python3 -c 'import json,sys;
try: print(json.load(sys.stdin).get("code","ok"))
except Exception: print("ok")')
  echo "  perm  $t -> $pcode"
done

echo "Reloading metadata"
meta '{"type":"reload_metadata","args":{"reload_remote_schemas":true}}' >/dev/null
echo "Done. Anonymous check:"
curl -sS --max-time 20 -X POST "$HASURA/v1/graphql" -H 'content-type: application/json' \
  --data '{"query":"{ Agent_aggregate { aggregate { count } } Feedback_aggregate { aggregate { count } } }"}'
echo
