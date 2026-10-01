#!/usr/bin/env bash
#
# Full-history secret scan (flagship 0.2).
#
# Scans every commit on every ref with gitleaks, using the default ruleset plus the narrow
# public-address allowlist in .gitleaks.toml. Done-when: 0 findings, else each shown to be a public
# value. A real hex key or base64 token still trips, because the allowlist narrows by value not path.
#
#   ./scripts/scan-secrets.sh
#
# Needs gitleaks on PATH. The report is written to a temp dir OUTSIDE the repo, never a tracked path,
# so a scan never leaves an artefact in the tree it just scanned.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "FAIL  gitleaks is not installed. Get it from https://github.com/gitleaks/gitleaks (8.30+)." >&2
  exit 1
fi

# Nothing uncommitted ships unscanned: a full-history scan of HEAD cannot see working-tree changes.
if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL  working tree is not clean. Commit or stash before scanning, so nothing ships unscanned." >&2
  git status --short >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
REPORT="$TMP/kanmani-gitleaks.json"

echo "scanning every ref with gitleaks $(gitleaks version)"
set +e
gitleaks git --no-banner --redact=100 --log-opts="--all" \
  -c .gitleaks.toml --report-format json --report-path "$REPORT" .
code=$?
set -e

# gitleaks exits 0 clean, 1 on findings. Count from the report rather than trusting the code alone.
findings=0
if [ -f "$REPORT" ]; then
  findings=$(node -e "const r=require('$REPORT');process.stdout.write(String(Array.isArray(r)?r.length:0))" 2>/dev/null || echo "?")
fi

if [ "$code" -eq 0 ] && [ "$findings" = "0" ]; then
  echo "ALL CLEAN  0 findings across every ref"
  exit 0
fi

echo "FAIL  gitleaks exit $code, $findings finding(s). Each must be proven a public value and" >&2
echo "      allowlisted by its exact value in .gitleaks.toml, never by a path." >&2
exit 1
