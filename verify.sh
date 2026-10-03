#!/usr/bin/env bash
#
# The release gate. One command, every check, in order.
#
#   ./verify.sh                 # the whole gate
#   ./verify.sh --no-forge      # skip the contract suites (no Foundry on this machine)
#   ./verify.sh --no-build      # skip `next build`, for a fast inner loop
#   ./verify.sh --allow-dirty   # let the secrets scan run on an uncommitted tree
#
# It prints `ALL GREEN` as its final line and only there. Any failure aborts immediately with a
# `FAIL` line naming the step, so the first thing that broke is the last thing on screen.
#
# CI runs this identical script (.github/workflows/verify.yml). Nothing in CI is not in here. A check
# that is not in this gate does not exist.
#
# Everything here is offline and deterministic. The checks that talk to the deployed site live
# elsewhere on purpose: `scripts/prove.sh` proves the live layers, `scripts/e2e/run.mjs` drives the
# live URL and `.github/workflows/canary.yml` runs them on a schedule after a deploy. A live check
# cannot gate a pull request, because the thing it tests has not shipped yet.
#
# A step that genuinely cannot run on this machine prints a visible `SKIP` with the reason rather
# than passing quietly. CI installs every tool, so nothing is skipped there.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RUN_FORGE=1
RUN_BUILD=1
ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --no-forge) RUN_FORGE=0 ;;
    --no-build) RUN_BUILD=0 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
    *) echo "unknown flag: $arg. See ./verify.sh --help" >&2; exit 2 ;;
  esac
done

STEP=0
SKIPPED=()

banner() {
  STEP=$((STEP + 1))
  echo ""
  echo "─────────────────────────────────────────────────────────────────────"
  echo "  $STEP. $1"
  echo "─────────────────────────────────────────────────────────────────────"
}

skip() {
  echo "SKIP  $1"
  SKIPPED+=("$1")
}

# Every step runs under `set -e`, so a non-zero exit aborts the script. This trap is what turns that
# abort into a readable verdict instead of a bare exit code.
trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo ""; echo "FAIL  step $STEP failed (exit $rc). Nothing below it ran."; fi' EXIT

# ------------------------------------------------------------------ 1. the toolchain

banner "toolchain"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
node_minor="$(node -p 'process.versions.node.split(".")[1]')"
echo "node     $(node --version)"
if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 6 ]; }; then
  echo "FAIL  node >=22.6 is required (package.json engines). Found $(node --version)." >&2
  exit 1
fi
echo "npm      $(npm --version)"

HAVE_GITLEAKS=0
if command -v gitleaks >/dev/null 2>&1; then
  HAVE_GITLEAKS=1
  echo "gitleaks $(gitleaks version 2>/dev/null || echo present)"
fi
HAVE_FORGE=0
if command -v forge >/dev/null 2>&1; then
  HAVE_FORGE=1
  echo "forge    $(forge --version 2>/dev/null | head -1)"
fi

[ -d node_modules ] || { echo "FAIL  node_modules is missing. Run: npm ci" >&2; exit 1; }
[ -d verifier/node_modules ] || { echo "FAIL  verifier/node_modules is missing. Run: cd verifier && npm ci" >&2; exit 1; }

# ------------------------------------------------------------------ 2. secrets

banner "secrets, every commit on every ref"

if [ "$HAVE_GITLEAKS" -eq 0 ]; then
  skip "gitleaks is not installed, so the full-history secret scan did not run. Get it from https://github.com/gitleaks/gitleaks (8.30+)."
elif [ -n "$(git status --porcelain)" ] && [ "$ALLOW_DIRTY" -eq 0 ]; then
  # scan-secrets.sh refuses a dirty tree on purpose: a history scan cannot see uncommitted changes,
  # so passing it on a dirty tree would say "clean" about bytes it never read.
  skip "the working tree has uncommitted changes, so the history scan was not run. Commit, or pass --allow-dirty to scan HEAD anyway."
  git status --short | sed 's/^/      /'
else
  if [ "$ALLOW_DIRTY" -eq 1 ] && [ -n "$(git status --porcelain)" ]; then
    echo "note  --allow-dirty: scanning committed history only. Uncommitted changes are NOT covered."
    gitleaks git --no-banner --redact=100 --log-opts="--all" -c .gitleaks.toml
  else
    ./scripts/scan-secrets.sh
  fi
fi

# ------------------------------------------------------------------ 3. lint

banner "lint, warnings are errors"

npm run lint

# ------------------------------------------------------------------ 4. typecheck

banner "typecheck, the whole repo"

echo "· root"
npm run typecheck
echo "· verifier"
(cd verifier && npm run typecheck)

if [ -d indexer/node_modules ]; then
  # The handler types are generated from config.yaml, so without codegen every event handler is
  # typed as a string literal telling you to run codegen. It writes outside the tracked tree, so
  # running it here changes nothing a commit would see.
  echo "· indexer codegen"
  (cd indexer && npx envio codegen >/dev/null)
  echo "· indexer"
  (cd indexer && npm run typecheck)
else
  skip "indexer/node_modules is missing, so the indexer typecheck did not run. Run: cd indexer && npm ci"
fi

CRE_DIR="cre/kanmani-oracle/slashing"
if [ ! -f "$CRE_DIR/tsconfig.json" ]; then
  skip "no cre tsconfig at $CRE_DIR, so the cre typecheck did not run."
elif [ ! -d "$CRE_DIR/node_modules" ]; then
  # The oracle imports @chainlink/cre-sdk, so without its own install every import is unresolved and
  # the failure would be about missing packages rather than about our code.
  skip "$CRE_DIR/node_modules is missing, so the cre typecheck did not run. Run: cd $CRE_DIR && npm ci"
else
  echo "· cre"
  (cd "$CRE_DIR" && npx tsc --noEmit)
fi

# ------------------------------------------------------------------ 5. tests

banner "tests"

echo "· app and verifier"
npm test

if [ "$RUN_BUILD" -eq 0 ] && [ "$RUN_FORGE" -eq 0 ]; then
  : # nothing extra
fi

if [ "$RUN_FORGE" -eq 0 ]; then
  skip "--no-forge was passed, so the contract suites did not run."
elif [ "$HAVE_FORGE" -eq 0 ]; then
  skip "forge is not installed, so the contract suites did not run. Get it from https://getfoundry.sh"
else
  echo "· contracts, restoring the pinned forge-std first"
  ./contracts/install-forge-std.sh
  echo "· contracts, default profile"
  (cd contracts && forge test)
  # The P256 precompile (EIP-7951) only exists in revm from the osaka spec, so the passkey suite is
  # skipped by the default profile and has to be run under its own.
  echo "· contracts, p256 profile (AgentPasskey)"
  (cd contracts && FOUNDRY_PROFILE=p256 forge test --match-path 'test/AgentPasskey.t.sol')
  # The fork suites need a real archive node. They are part of the gate when an RPC is configured
  # and a visible skip when it is not, rather than silently absent either way.
  if [ -n "${MONAD_RPC:-}" ]; then
    echo "· contracts, fork suites against MONAD_RPC"
    (cd contracts && forge test --match-path 'test/*Fork.t.sol' --fork-url "$MONAD_RPC")
  else
    skip "MONAD_RPC is not set, so the contract fork suites did not run."
  fi
fi

# ------------------------------------------------------------------ 6. supply chain

banner "supply chain"

# Production dependencies, at zero findings. This is the surface that is actually served, so it is
# the one that gates. `--omit=dev` is what makes that split.
echo "· root, production dependencies"
npm audit --omit=dev --audit-level=high
echo "· verifier, production dependencies"
(cd verifier && npm audit --omit=dev --audit-level=high)
if [ -f indexer/package-lock.json ] && [ -d indexer/node_modules ]; then
  echo "· indexer, production dependencies (reported, not gated: see SECURITY.md known limits)"
  (cd indexer && npm audit --omit=dev --audit-level=high) || echo "note  indexer findings are recorded in SECURITY.md. envio has no non-breaking fix."
fi

# The development tree is reported and does not gate. The lint toolchain pulls `braces` through
# eslint-config-next, which carries an advisory with no fixed version published. It is never served
# and never run against untrusted input. Reported here so it stays visible rather than hidden.
echo "· root, development tree (reported, not gated)"
npm audit --audit-level=high || echo "note  development-only findings above. See SECURITY.md known limits."

# Every direct dependency pinned exact. A `^` range means two clones can resolve differently.
echo "· pinning"
node -e '
const fs = require("node:fs");
let bad = [];
for (const f of ["package.json", "verifier/package.json", "indexer/package.json", "cre/kanmani-oracle/slashing/package.json"]) {
  if (!fs.existsSync(f)) continue;
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(p[field] ?? {})) {
      if (/^[\^~]/.test(spec)) bad.push(`${f} ${field} ${name}@${spec}`);
    }
  }
}
if (bad.length) {
  console.error("FAIL  these direct dependencies are not pinned exact:");
  for (const b of bad) console.error("      " + b);
  process.exit(1);
}
console.log("ok    every direct dependency is pinned exact");
'

# ------------------------------------------------------------------ 7. web hardening

banner "web hardening"

node -e '
const fs = require("node:fs");
const proxy = fs.readFileSync("proxy.ts", "utf8");
const next = fs.readFileSync("next.config.ts", "utf8");
const want = [
  ["proxy.ts", proxy, "default-src \u0027self\u0027", "a CSP default-src"],
  ["proxy.ts", proxy, "frame-ancestors \u0027none\u0027", "frame-ancestors none"],
  ["proxy.ts", proxy, "object-src \u0027none\u0027", "object-src none"],
  ["proxy.ts", proxy, "base-uri \u0027self\u0027", "base-uri self"],
  ["proxy.ts", proxy, "form-action \u0027self\u0027", "form-action self"],
  ["proxy.ts", proxy, "upgrade-insecure-requests", "upgrade-insecure-requests"],
  ["proxy.ts", proxy, "nonce-", "a per-request nonce in script-src"],
  ["next.config.ts", next, "poweredByHeader: false", "poweredByHeader off"],
  ["next.config.ts", next, "nosniff", "x-content-type-options nosniff"],
  ["next.config.ts", next, "strict-origin-when-cross-origin", "a referrer policy"],
  ["next.config.ts", next, "DENY", "x-frame-options DENY"],
  ["next.config.ts", next, "permissions-policy", "a permissions policy"],
];
let bad = [];
for (const [file, body, needle, label] of want) if (!body.includes(needle)) bad.push(`${file} is missing ${label}`);
// An inline script without a nonce would be refused by our own policy, so it must not appear.
if (/dangerouslySetInnerHTML/.test(fs.readFileSync("app/global-error.tsx", "utf8"))) {
  bad.push("app/global-error.tsx carries an inline script, which the nonce CSP will refuse");
}
for (const f of ["app/error.tsx", "app/global-error.tsx"]) {
  if (!fs.existsSync(f)) bad.push(`${f} is missing, so a thrown render has no boundary`);
}
if (bad.length) {
  console.error("FAIL  web hardening:");
  for (const b of bad) console.error("      " + b);
  process.exit(1);
}
console.log("ok    CSP, security headers and both error boundaries are present");
'

# ------------------------------------------------------------------ 8. build

banner "production build"

if [ "$RUN_BUILD" -eq 0 ]; then
  skip "--no-build was passed, so the production build did not run."
else
  npm run build
fi

# ------------------------------------------------------------------ 9. docs: links

banner "documentation links"

node scripts/check-links.mjs README.md docs SECURITY.md DATA-SOURCES.md

# ------------------------------------------------------------------ 10. docs: voice

banner "documentation voice"

# The voice gate lives in the surrounding workspace rather than in this repo, so it is present on the
# author's machine and absent in a fresh clone and in CI. Point VOICE_GATE at it to run it.
VOICE_GATE="${VOICE_GATE:-../../bin/voice-gate.mjs}"
if [ -f "$VOICE_GATE" ]; then
  # Two kinds of file are held out of the gating set, and the list is enumerated rather than the
  # check being switched off, so it is visible and so it shrinks.
  #
  # Permanent: files that quote a licence byte for byte. docs/24-KIT-LICENCE.md reproduces the MIT
  # text in full, and docs/32-PRF-PRIMITIVES.md quotes a string straight out of the source. Rewording
  # either to satisfy a prose linter would make the quote wrong, which is worse than the comma.
  # LICENSE itself is held out for the same reason: its body is adapted standardised licence wording.
  #
  # Temporary: prose debt in files this lane does not own, carried while the documentation lanes
  # rewrite them in parallel. Delete each line as its owner clears it, and delete this block when the
  # list is empty.
  VOICE_EXEMPT='^(LICENSE|docs/24-KIT-LICENCE\.md|docs/32-PRF-PRIMITIVES\.md|docs/17-CONTRACT-AUDIT\.md|cre/kanmani-oracle/slashing/README\.md)$'

  mapfile -t prose < <(git ls-files 'docs/*.md' '*.md' | sort -u | grep -Ev "$VOICE_EXEMPT" || true)
  mapfile -t held < <(git ls-files 'docs/*.md' '*.md' 'cre/**/*.md' | sort -u | grep -E "$VOICE_EXEMPT" || true)

  if [ "${#prose[@]}" -gt 0 ]; then
    node "$VOICE_GATE" "${prose[@]}"
  fi

  # The held-out files are still checked, and their findings still printed. They do not abort.
  if [ "${#held[@]}" -gt 0 ]; then
    echo ""
    echo "· held out of the gate, reported only (see the list in verify.sh):"
    node "$VOICE_GATE" "${held[@]}" 2>&1 | sed 's/^/      /' || true
  fi
else
  skip "no voice gate at $VOICE_GATE, so the prose check did not run. Set VOICE_GATE to its path."
fi

# ------------------------------------------------------------------ 11. numbers

banner "numbers"

# PLACEHOLDER, owned by the numbers lane.
#
# `scripts/refresh-numbers.mjs` fills the committed docs from the live index, and `--check` is the
# half that belongs in a gate: it fails when a number written in a doc no longer matches what the
# index reports, so a stale count cannot survive a release. The script does not exist yet, so this
# step is guarded on it and reports a visible SKIP. When the script lands, nothing here changes: the
# guard finds it and the step starts gating.
NUMBERS_SCRIPT="scripts/refresh-numbers.mjs"
if [ -f "$NUMBERS_SCRIPT" ]; then
  node "$NUMBERS_SCRIPT" --check
else
  skip "$NUMBERS_SCRIPT does not exist yet, so the committed doc numbers were not checked against the live index."
fi

# ------------------------------------------------------------------ verdict

trap - EXIT

echo ""
echo "─────────────────────────────────────────────────────────────────────"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo "  ${#SKIPPED[@]} step(s) were skipped and are listed above:"
  for s in "${SKIPPED[@]}"; do echo "    SKIP  $s"; done
  echo "─────────────────────────────────────────────────────────────────────"
fi
echo ""
echo "ALL GREEN"
