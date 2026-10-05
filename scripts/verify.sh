#!/usr/bin/env bash
# Run every check that guards this repository, and report once at the end.
#
# Each of these was run by hand many times while building the real-token flow, and
# every one of them caught something. Keeping them in a single command means a
# change can be verified without remembering the list, and it makes a failure
# obvious rather than something noticed three steps later.
#
#   scripts/verify.sh              everything
#   scripts/verify.sh --quick      skip the checks that need a running sandbox
#
# The sandbox-backed checks need `scripts/localnet/start-ledger.sh` to have been
# run, and they are separated from the rest for that reason.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.dpm/bin:$PATH"

QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

PASSED=()
FAILED=()
SKIPPED=()

run() {
  local label="$1"
  shift
  printf '\n=== %s\n' "$label"
  if "$@"; then
    PASSED+=("$label")
    printf '    PASS  %s\n' "$label"
  else
    FAILED+=("$label")
    printf '    FAIL  %s\n' "$label"
  fi
}

skip() {
  SKIPPED+=("$1")
  printf '\n=== %s\n    SKIP  %s\n' "$1" "$1"
}

# --- static checks: no ledger needed -----------------------------------------
run "agents typecheck" npm --prefix agents run typecheck
run "frontend typecheck" npm --prefix frontend run typecheck
run "frontend build" npm --prefix frontend run build

# --- Daml: the contract guards ----------------------------------------------
run "daml test" bash -c "cd '$ROOT/daml' && dpm test"

# --- sandbox-backed: need a running local ledger -----------------------------
ledger_up() {
  curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:6864/v2/version 2>/dev/null | grep -q 200
}

if [ "$QUICK" = "1" ]; then
  skip "localnet demo (--quick)"
  skip "e2e award-chain (--quick)"
  skip "e2e atomic-submit (--quick)"
  skip "e2e v2-settlement (--quick)"
elif ! ledger_up; then
  skip "localnet demo (no sandbox on :6864 - run scripts/localnet/start-ledger.sh)"
  skip "e2e award-chain (no sandbox)"
  skip "e2e atomic-submit (no sandbox)"
  skip "e2e v2-settlement (no sandbox)"
else
  run "localnet demo" npm --prefix agents run demo
  run "e2e award-chain" npm --prefix agents run e2e:award-chain
  run "e2e atomic-submit" npm --prefix agents run e2e:atomic-submit
  run "e2e v2-settlement" npm --prefix agents run e2e:v2-settlement
fi

# --- summary -----------------------------------------------------------------
printf '\n========================================\n'
printf 'passed  %d\n' "${#PASSED[@]}"
for label in "${PASSED[@]:-}"; do [ -n "$label" ] && printf '  ok    %s\n' "$label"; done
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  printf 'skipped %d\n' "${#SKIPPED[@]}"
  for label in "${SKIPPED[@]:-}"; do [ -n "$label" ] && printf '  skip  %s\n' "$label"; done
fi
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf 'FAILED  %d\n' "${#FAILED[@]}"
  for label in "${FAILED[@]:-}"; do [ -n "$label" ] && printf '  FAIL  %s\n' "$label"; done
  exit 1
fi
printf 'FAILED  0\n'
