#!/usr/bin/env bash
#
# Clean-clone hygiene (flagship 0.3).
#
# Prove a stranger can clone, install, test and build this repo with no env file and no access to our
# infrastructure. Done-when: a fresh clone builds and `npm test` passes in a temp dir.
#
#   ./scripts/clean-clone.sh                 clone from the local .git
#   REPO=https://github.com/zkasuran/kanmani.git ./scripts/clean-clone.sh   once public
#
# Uses `npm ci` not `npm install`, so the lockfile is the source of truth and the run is
# reproducible. The DB tests skip loudly without a database, which is a pass, not a failure.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO:-file://$ROOT/.git}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DEST="$TMP/kanmani"

echo "clone  $SRC"
git clone --no-local "$SRC" "$DEST" 2>/dev/null || git clone "$SRC" "$DEST"
cd "$DEST"

echo "npm ci"
npm ci

echo "npm test  (DB tests skip loudly without a database, which is a pass)"
npm test

echo "npm run build  (must succeed with no .env.local present)"
npm run build

echo "check-links  (README + docs, offline)"
node scripts/check-links.mjs README.md docs

echo "CLEAN CLONE OK"
