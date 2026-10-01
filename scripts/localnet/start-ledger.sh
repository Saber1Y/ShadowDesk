#!/bin/bash
# Boot the two-participant Canton sandbox, vet the DAR on both participants, and
# print the local party ids. Unlike run-demo.sh this leaves the ledger running
# and does not start an agent round, so it is the entry point for manual and
# dashboard testing. The sandbox is started in its own session so it survives
# the calling shell.
set -euo pipefail

export PATH="$HOME/.dpm/bin:$PATH"
export JAVA_OPTS="${JAVA_OPTS:--Xmx2g}"

ROOT="/Users/mac/codes/Shadow Desk"
LOG_DIR="$ROOT/log/distributed"

PKG_NAME="$(awk '/^name:/{print $2; exit}' "$ROOT/daml/daml.yaml")"
PKG_VERSION="$(awk '/^version:/{print $2; exit}' "$ROOT/daml/daml.yaml")"
DAR="$ROOT/daml/.daml/dist/${PKG_NAME}-${PKG_VERSION}.dar"

if [ ! -f "$DAR" ]; then
  echo "!! missing $DAR - build it with: (cd \"$ROOT/daml\" && dpm build)"
  exit 1
fi

echo "==> stopping any running sandbox"
pkill -9 -f "canton-open-source" 2>/dev/null || true
sleep 2

echo "==> starting two-participant sandbox (detached)"
mkdir -p "$LOG_DIR"
SANDBOX_OUT="$LOG_DIR/sandbox.out"
: > "$SANDBOX_OUT"
LOG_DIR="$LOG_DIR" DAR_CONF="$ROOT/daml/distributed-run.conf" python3 - <<'PY'
import os
import subprocess

cwd = os.environ["LOG_DIR"]
log = open(os.path.join(cwd, "sandbox.out"), "ab")
process = subprocess.Popen(
    ["dpm", "sandbox", "-c", os.environ["DAR_CONF"]],
    stdout=log,
    stderr=log,
    cwd=cwd,
    env=dict(os.environ),
    start_new_session=True,
)
print(f"    sandbox launcher pid={process.pid}")
PY

echo "==> waiting for participant HTTP ledgers"
for i in $(seq 1 150); do
  p1="$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:6864/v2/version || true)"
  p2="$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:18003/v2/version || true)"
  if [ "$p1" = "200" ] && [ "$p2" = "200" ]; then
    echo "    sandbox ready after ${i}s"
    break
  fi
  if [ "$i" -eq 150 ]; then
    echo "!! sandbox did not become ready; tail of $SANDBOX_OUT:"
    tail -20 "$SANDBOX_OUT"
    exit 1
  fi
  sleep 2
done

# The HTTP ledgers answer before the synchronizer is connected, so a cold start
# can pass the readiness probe and then fail the upload with
# PACKAGE_SERVICE_CANNOT_AUTODETECT_SYNCHRONIZER. Retry the upload, which is the
# step that actually needs the synchronizer, instead of only probing HTTP.
vet_package() {
  config="$1"
  label="$2"
  for attempt in $(seq 1 20); do
    if (cd "$ROOT/daml" && dpm script --participant-config "$config" --dar "$DAR" \
      --upload-dar=true --script-name ShadowDesk.Test:noop > "$LOG_DIR/upload-$label.log" 2>&1); then
      return 0
    fi
    if grep -q "CANNOT_AUTODETECT_SYNCHRONIZER\|no synchronizers currently connected" \
      "$LOG_DIR/upload-$label.log"; then
      if [ "$attempt" = "1" ]; then
        echo "    synchronizer not connected yet; retrying upload to $label"
      fi
      sleep 3
      continue
    fi
    echo "!! upload to $label failed for a reason other than synchronizer startup:"
    tail -20 "$LOG_DIR/upload-$label.log"
    return 1
  done
  echo "!! synchronizer never connected for $label; tail of $LOG_DIR/upload-$label.log:"
  tail -20 "$LOG_DIR/upload-$label.log"
  return 1
}

echo "==> vetting $PKG_NAME-$PKG_VERSION on participant1"
vet_package participants.json p1 || exit 1
echo "==> vetting $PKG_NAME-$PKG_VERSION on participant2"
vet_package participants-p2.json p2 || exit 1

# The v2 settlement package is a separate DAR. Upload it when it has been built
# so the ledger serves both packages; a missing v2 build is not fatal here
# because v1-only scripts do not need it.
V2_PKG_NAME="$(awk '/^name:/{print $2; exit}' "$ROOT/daml-v2/daml.yaml" 2>/dev/null || true)"
V2_PKG_VERSION="$(awk '/^version:/{print $2; exit}' "$ROOT/daml-v2/daml.yaml" 2>/dev/null || true)"
V2_DAR="$ROOT/daml-v2/.daml/dist/${V2_PKG_NAME}-${V2_PKG_VERSION}.dar"
if [ -f "$V2_DAR" ]; then
  for label in p1 p2; do
    port=6864
    [ "$label" = "p2" ] && port=18003
    echo "==> uploading $V2_PKG_NAME-$V2_PKG_VERSION to $label"
    code="$(curl -s -m 60 -o "$LOG_DIR/upload-$label-v2.log" -w '%{http_code}' \
      -X POST -H "Content-Type: application/octet-stream" \
      --data-binary "@$V2_DAR" "http://127.0.0.1:$port/v2/packages" || true)"
    if [ "$code" != "200" ]; then
      echo "!! v2 upload to $label returned HTTP $code; see $LOG_DIR/upload-$label-v2.log"
      cat "$LOG_DIR/upload-$label-v2.log"
      exit 1
    fi
  done
else
  echo "    skipping v2 package; build it with: (cd \"$ROOT/daml-v2\" && dpm build)"
fi

echo "==> sandbox parties on participant1"
curl -s http://127.0.0.1:6864/v2/parties \
  | python3 -c 'import json,sys
for detail in json.load(sys.stdin)["partyDetails"]:
    scope = "local " if detail["isLocal"] else "remote"
    print(f"    {scope} {detail["party"]}")'

echo "==> ledger ready: participant1=http://127.0.0.1:6864 participant2=http://127.0.0.1:18003"