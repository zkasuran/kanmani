#!/usr/bin/env bash
#
# Restore forge-std at the pinned revision.
#
# `contracts/lib/` is gitignored ("forge-std is a dependency, not our code"), so the library is not
# in the repository bytes. Before this script the only restore instruction was a bare
# `forge install foundry-rs/forge-std`, which pulls the LATEST tag. That meant the contract build was
# not reproducible: a clone today and a clone next month could compile the same sources against
# different test harnesses. This file is the pin, and it lives in the repo so the pin does too.
#
#   ./contracts/install-forge-std.sh
#
# Idempotent. If the library is already at the pinned revision it does nothing and says so.
#
# Changing the pin is a deliberate act: bump FORGE_STD_TAG and FORGE_STD_REV together, run the full
# contract suite, and commit both lines with the reason.

set -euo pipefail

# forge-std v1.16.2. The tag is for humans; the revision is what is enforced, because a tag can be
# moved and a commit hash cannot.
FORGE_STD_TAG="v1.16.2"
FORGE_STD_REV="bf647bd6046f2f7da30d0c2bf435e5c76a780c1b"
FORGE_STD_REPO="https://github.com/foundry-rs/forge-std.git"

CONTRACTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$CONTRACTS/lib/forge-std"

if [ -d "$LIB/.git" ]; then
  at="$(git -C "$LIB" rev-parse HEAD 2>/dev/null || echo none)"
  if [ "$at" = "$FORGE_STD_REV" ]; then
    echo "ok    forge-std already at $FORGE_STD_TAG ($FORGE_STD_REV)"
    exit 0
  fi
  echo "note  forge-std is at $at, moving it to $FORGE_STD_TAG"
else
  mkdir -p "$CONTRACTS/lib"
  rm -rf "$LIB"
  echo "note  cloning forge-std"
  git clone --quiet "$FORGE_STD_REPO" "$LIB"
fi

git -C "$LIB" fetch --quiet --tags origin
git -C "$LIB" checkout --quiet "$FORGE_STD_REV"

at="$(git -C "$LIB" rev-parse HEAD)"
if [ "$at" != "$FORGE_STD_REV" ]; then
  echo "FAIL  forge-std is at $at, expected $FORGE_STD_REV" >&2
  exit 1
fi
echo "ok    forge-std pinned at $FORGE_STD_TAG ($FORGE_STD_REV)"
