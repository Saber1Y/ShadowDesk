#!/bin/bash
set -euo pipefail

export PATH="$HOME/.dpm/bin:$PATH"

ROOT="/Users/mac/codes/Shadow Desk"
FRONTEND="$ROOT/frontend"

echo "==> bootstrapping sandbox + agents (clean ledger)"
"$ROOT/scripts/localnet/run-demo.sh"

echo "==> starting dashboard on http://localhost:3001"
cd "$FRONTEND"

if lsof -nP -iTCP:3001 -sTCP:LISTEN > /dev/null 2>&1; then
  echo "==> dashboard already running on :3001"
else
  if [ ! -d node_modules ]; then
    npm install
  fi
  nohup npm run dev > /tmp/shadowdesk-dev.log 2>&1 &
fi

for i in $(seq 1 30); do
  if curl -sf -m 2 -o /dev/null "http://localhost:3001/api/state"; then
    echo "==> dashboard ready after ${i}s: http://localhost:3001"
    exit 0
  fi
  sleep 1
done
echo "!! dashboard did not come up; tail of /tmp/shadowdesk-dev.log:"
tail -20 /tmp/shadowdesk-dev.log
exit 1