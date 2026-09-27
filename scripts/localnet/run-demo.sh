#!/bin/bash
set -euo pipefail

export PATH="$HOME/.dpm/bin:$PATH"

# Bound the sandbox JVM heap. Left uncapped, the JVM sizes itself from
# whatever RAM it happens to see and overcommits, which shows up as
# LOCAL_VERDICT_TIMEOUT on the first contract create rather than as an
# obvious out-of-memory error. Export JAVA_OPTS yourself to override.
export JAVA_OPTS="${JAVA_OPTS:--Xmx2g}"

ROOT="/Users/mac/codes/Shadow Desk"
LOG_DIR="$ROOT/log/distributed"

# Resolve the DAR from the package version so a version bump cannot leave this
# script pointing at a build that no longer exists.
PKG_NAME="$(awk '/^name:/{print $2; exit}' "$ROOT/daml/daml.yaml")"
PKG_VERSION="$(awk '/^version:/{print $2; exit}' "$ROOT/daml/daml.yaml")"
DAR="$ROOT/daml/.daml/dist/${PKG_NAME}-${PKG_VERSION}.dar"

if [ ! -f "$DAR" ]; then
  echo "!! missing $DAR - build it first with: (cd \"$ROOT/daml\" && dpm build)"
  exit 1
fi

echo "==> killing any running sandbox"
pkill -9 -f "canton-open-source" 2>/dev/null || true
sleep 2

echo "==> starting two-participant sandbox"
mkdir -p "$LOG_DIR"
(cd "$LOG_DIR" && nohup dpm sandbox -c "$ROOT/daml/distributed-run.conf" > dpm.out 2>&1 &)

for i in $(seq 1 240); do
  if grep -q "Canton sandbox is ready." "$LOG_DIR/dpm.out" 2>/dev/null && \
     curl -sf -m 2 -o /dev/null "http://127.0.0.1:6864/v2/version" && \
     curl -sf -m 2 -o /dev/null "http://127.0.0.1:18003/v2/version"; then
    echo "==> sandbox ready after ${i}s"
    break
  fi
  if [ "$i" -eq 240 ]; then
    echo "!! sandbox did not become ready; tail of log:"
    tail -20 "$LOG_DIR/dpm.out"
    exit 1
  fi
  sleep 1
done

echo "==> upload DAR to participant1"
(cd "$ROOT/daml" && dpm script \
  --participant-config participants.json \
  --dar "$DAR" \
  --upload-dar=true \
  --script-name ShadowDesk.Test:noop > /dev/null)

echo "==> upload DAR to participant2"
(cd "$ROOT/daml" && dpm script \
  --participant-config participants-p2.json \
  --dar "$DAR" \
  --upload-dar=true \
  --script-name ShadowDesk.Test:noop > /dev/null)

echo "==> running agent demo"
(cd "$ROOT/agents" && npm run demo)

echo "==> done"