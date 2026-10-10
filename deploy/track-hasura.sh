#!/usr/bin/env bash
# Track Retina's tables in Kanmani's own Hasura and open them to anonymous reads.
#
# Why this exists as a script rather than relying on the indexer: envio runs its
# "Tracking tables in Hasura" step once, during storage init, which happens BEFORE the
# entity tables exist. On a fresh volume it therefore tracks nothing, reports no error on
# later runs and leaves an empty GraphQL surface. Doing it here makes it explicit,
# repeatable and reviewable instead of a side effect of startup ordering.
#
# Anonymous select matters: a judge opening the GraphQL endpoint must not need our admin
# secret. The data is a public chain read, so there is nothing here to protect.
#
#   ./deploy/track-hasura.sh
set -euo pipefail

HASURA="${HASURA_URL:-http://127.0.0.1:8081}"
# Required, never defaulted. This used to fall back to "testing", which is the secret the stack
# itself used to default to, so the pair silently worked and nobody had to set either one.
SECRET="${HASURA_GRAPHQL_ADMIN_SECRET:?HASURA_GRAPHQL_ADMIN_SECRET is required, see .env.local}"

# Every entity in schema.graphql plus envio's own chain_metadata. A table missing from this list
# is invisible to anonymous callers, which is the safe default and the reason the list is
# explicit rather than discovered.
TABLES=(Agent AgentRecord AgentRecordOwner Feedback Validation Verdict IndexState chain_metadata)

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

  # Anonymous read, bounded. A row LIMIT caps any single query, aggregations stay on for the counts
  # the UI needs, and subscriptions are closed to the public role. Depth/node/complexity ceilings are
  # Hasura EE/Cloud only, so on this CE image the row limit plus the Postgres statement_timeout plus
  # the loopback binding behind the Next proxy are the controls. Envio adds chainId to every entity.
  p=$(meta "{\"type\":\"pg_create_select_permission\",\"args\":{\"source\":\"default\",\"table\":{\"schema\":\"public\",\"name\":\"$t\"},\"role\":\"public\",\"permission\":{\"columns\":\"*\",\"filter\":{},\"limit\":1000,\"allow_aggregations\":true,\"query_root_fields\":[\"select\",\"select_by_pk\",\"select_aggregate\"],\"subscription_root_fields\":[]}}}")
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
