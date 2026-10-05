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

# The two TypeScript suites run separately rather than through `npm test`, so each one's counts can
# be read and held against lib/counts.ts. That file is what the site and the docs publish, and before
# this step it was typed by hand and nothing ever checked it against a run.
TESTLOG="$(mktemp -d)"
trap 'rc=$?; rm -rf "$TESTLOG"; if [ "$rc" -ne 0 ]; then echo ""; echo "FAIL  step $STEP failed (exit $rc). Nothing below it ran."; fi' EXIT

suite() { # name, glob
  echo "· $1"
  node --test --experimental-strip-types "$2" | tee "$TESTLOG/$1.tap" | grep -E '^# (tests|pass|fail|skipped) '
  [ "${PIPESTATUS[0]}" -eq 0 ]
}
suite app 'lib/**/*.test.ts'
suite verifier 'verifier/src/**/*.test.ts'

if [ "$RUN_FORGE" -eq 0 ]; then
  skip "--no-forge was passed, so the contract suites did not run."
elif [ "$HAVE_FORGE" -eq 0 ]; then
  skip "forge is not installed, so the contract suites did not run. Get it from https://getfoundry.sh"
else
  echo "· contracts, restoring the pinned forge-std first"
  ./contracts/install-forge-std.sh
  echo "· contracts, default profile"
  (cd contracts && forge test) | tee "$TESTLOG/contracts.out" | grep -E "test suites|Suite result: FAILED" || true
  [ "${PIPESTATUS[0]}" -eq 0 ]
  # The P256 precompile (EIP-7951) only exists in revm from the osaka spec, so the passkey suite is
  # skipped by the default profile and has to be run under its own.
  echo "· contracts, p256 profile (AgentPasskey)"
  (cd contracts && FOUNDRY_PROFILE=p256 forge test --match-path 'test/AgentPasskey.t.sol')
  # The fork suites need a real archive node. They are part of the gate when an RPC is configured
  # and a visible skip when it is not, rather than silently absent either way. `MONAD_RPC` is the
  # name contracts/foundry.toml uses; `MONAD_RPC_URL` is the name the app's own env uses, so either
  # is accepted and nobody has to set the same URL twice.
  FORK_RPC="${MONAD_RPC:-${MONAD_RPC_URL:-}}"
  if [ -n "$FORK_RPC" ]; then
    echo "· contracts, fork suites against a live archive node"
    (cd contracts && forge test --match-path 'test/*Fork.t.sol' --fork-url "$FORK_RPC")
  else
    skip "neither MONAD_RPC nor MONAD_RPC_URL is set, so the contract fork suites did not run."
  fi
fi

# The published counts must be the measured ones. Totals are compared always. Pass counts are
# compared only when no database is configured, because a database turns its skips into passes and
# the published figure is defined as the default run without one.
echo "· the published counts in lib/counts.ts"
TESTLOG="$TESTLOG" HAVE_DB="${ENVIO_PG_PASSWORD:-${FOVEA_DATABASE_URL:-}}" node -e '
const fs = require("node:fs");
const dir = process.env.TESTLOG;
const src = fs.readFileSync("lib/counts.ts", "utf8");
const pub = (name) => {
  const m = src.match(new RegExp(name + ":\\s*\\{\\s*pass:\\s*(\\d+),\\s*total:\\s*(\\d+)"));
  return { pass: +m[1], total: +m[2] };
};
const tap = (f) => {
  const t = fs.readFileSync(`${dir}/${f}.tap`, "utf8");
  const g = (k) => +(t.match(new RegExp(`^# ${k} (\\d+)`, "m")) ?? [0, NaN])[1];
  return { pass: g("pass"), total: g("tests") };
};
const measured = { site: tap("app"), verifier: tap("verifier") };
if (fs.existsSync(`${dir}/contracts.out`)) {
  const m = fs.readFileSync(`${dir}/contracts.out`, "utf8").match(/(\d+) tests passed, \d+ failed, \d+ skipped \((\d+) total tests\)/);
  if (m) measured.contracts = { pass: +m[1], total: +m[2] };
}
const bad = [];
for (const [name, got] of Object.entries(measured)) {
  const p = pub(name);
  if (got.total !== p.total) bad.push(`${name}: ran ${got.total} tests, lib/counts.ts says ${p.total}`);
  if (!process.env.HAVE_DB && got.pass !== p.pass) bad.push(`${name}: ${got.pass} passed, lib/counts.ts says ${p.pass}`);
}
if (bad.length) {
  console.error("FAIL  lib/counts.ts no longer matches the suites:");
  for (const b of bad) console.error("      " + b);
  console.error("      Run npm run counts. It updates lib/counts.ts, the docs, the badge and the README art together.");
  process.exit(1);
}
const shown = Object.entries(measured).map(([n, v]) => `${n} ${v.pass}/${v.total}`).join(", ");
console.log(`ok    lib/counts.ts matches the run: ${shown}`);
'

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
// connect-src names its hosts. A bare https: there would let an injected script post to anywhere.
const cs = (proxy.match(/connect-src[^\n]*/) ?? [""])[0];
if (/\shttps:(?![\/])/.test(cs)) bad.push("proxy.ts allows connect-src to any https host");
if (!proxy.includes("CONNECT_HOSTS")) bad.push("proxy.ts no longer builds connect-src from the chain registry");
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

# scripts/voice-gate.mjs is in the repo, so a fresh clone and CI run the same prose check as the
# author's machine. Every tracked markdown file, gated. Text quoted byte for byte (the MIT and OFL
# grants) carries a voice-gate:off fence in the file itself, so the exception sits next to the quote
# it covers. LICENSE is not markdown and is not in this set: its body is adapted standardised licence
# wording, and rewording a legal clause for a prose linter is the wrong trade.
mapfile -t prose < <(git ls-files '*.md' | sort -u)
node scripts/voice-gate.mjs "${prose[@]}"

# ------------------------------------------------------------------ 11. numbers

banner "numbers"

# Every current figure in the docs is a marker filled from docs/numbers.json, and the test counts in
# that snapshot come from lib/counts.ts, which step 5 just held against a real run. This step fails if
# any marked figure, the README badge or the snapshot's test counts disagree. Offline, so it can gate
# a pull request. Whether the snapshot still matches the live site is the canary's job
# (`--check --live`), since a live read cannot gate a change that has not shipped.
node scripts/refresh-numbers.mjs --check
# The README art is drawn from the same snapshot. Redraw it and fail if anything moved, so the hero
# image can never show a count the badge and the docs no longer show.
ART_BEFORE="$(cat public/readme/*.svg | sha256sum)"
python3 scripts/build-readme-art.py > /dev/null
if [ "$(cat public/readme/*.svg | sha256sum)" != "$ART_BEFORE" ]; then
  echo "FAIL  public/readme was stale against docs/numbers.json. It has just been redrawn: commit it."
  exit 1
fi
echo "ok    README art matches docs/numbers.json"

# ------------------------------------------------------------------ verdict

trap - EXIT
rm -rf "$TESTLOG"

echo ""
echo "─────────────────────────────────────────────────────────────────────"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo "  ${#SKIPPED[@]} step(s) were skipped and are listed above:"
  for s in "${SKIPPED[@]}"; do echo "    SKIP  $s"; done
  echo "─────────────────────────────────────────────────────────────────────"
fi
echo ""
echo "ALL GREEN"
