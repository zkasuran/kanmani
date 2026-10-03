#!/usr/bin/env bash
# Point git at the tracked hooks in .githooks/.
#
# Hooks under .git/hooks are not cloned, so a fresh clone used to have no guard at all until someone
# remembered to scaffold one. The hooks live in the repo now and this makes git use them. Run once
# per clone or worktree.
#
#   ./scripts/install-hooks.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
chmod +x .githooks/pre-commit .githooks/pre-push
git config core.hooksPath .githooks
echo "ok    hooks active from .githooks (pre-commit, pre-push)"
