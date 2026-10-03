#!/usr/bin/env bash
# The paths that must never reach a repository that goes public. Shared by pre-commit and pre-push
# so the two can never disagree about what is private.
#
#   .hq/     private working files: house rules, decisions, notes, defence material.
#   submit/  form fills carrying the author's real name, email and the submission internals.
#   build/   generated export dumps, including a full copy of the measurement database.
#   .env*    at any depth: .env.local, indexer/.env and cre/.env carry live tokens, the Postgres
#            password and the Hasura admin secret.
#
# submit/, build/ and .env* are gitignored too, so only `git add -f` reaches them. That is exactly
# the case this refuses: a deliberate force-add is how private data gets published by accident.
#
# A sample env file is the one .env path that is meant to be committed. .gitignore un-ignores
# .env.example, so this allows .env.example and .env.sample and nothing else.

GUARD_PATTERNS=('^\.hq/' '^submit/' '^build/' '(^|/)\.env')

# Reads path names on stdin, prints the ones that are refused.
guard_refused() {
  # `|| true`: grep exits 1 when it filters out every line, and under pipefail a commit of nothing
  # but a sample env file would then be refused for no reason.
  { grep -vE '(^|/)\.env\.(example|sample)$' || true; } | while IFS= read -r path; do
    for p in "${GUARD_PATTERNS[@]}"; do
      if printf '%s\n' "$path" | grep -qE "$p"; then
        printf '%s\n' "$path"
        break
      fi
    done
  done
}
