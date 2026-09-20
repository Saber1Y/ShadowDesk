#!/bin/bash
set -euo pipefail

BASE_URL="${SHADOWDESK_URL:-http://127.0.0.1:3001}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> checking dashboard state"
curl -fsS --max-time 20 "$BASE_URL/api/state" > "$TMP_DIR/state.json"
python3 - "$TMP_DIR/state.json" <<'PY'
import json
import sys

state = json.load(open(sys.argv[1]))
participants = state["participants"]
if not all(participant["reachable"] for participant in participants):
    raise SystemExit("not all Canton participants are reachable")
print("participants reachable")
PY

echo "==> running custom cTBILL/cUSDC round"
curl -fsS --max-time 180 -N \
  -H 'Content-Type: application/json' \
  -d '{"amount":500000,"maxPrice":101,"assetToBuy":"cTBILL","settlementAsset":"cUSDC"}' \
  "$BASE_URL/api/replay" > "$TMP_DIR/round.ndjson"
python3 - "$TMP_DIR/round.ndjson" <<'PY'
import json
import sys

rows = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
if not any(row.get("done") is True for row in rows):
    raise SystemExit("round did not complete successfully")
snapshot = next(row["snapshot"] for row in reversed(rows) if "snapshot" in row)
rfq = snapshot["institutional"]["rfqs"][-1]
receipt = snapshot["institutional"]["receipts"][-1]
if rfq["amount"] != "500000.0000000000" or receipt["quantity"] != "500000.0000000000":
    raise SystemExit("custom amount was not reflected in the ledger projection")
if snapshot["privacy"]["losingSeesWinnerQuotes"] != 0:
    raise SystemExit("privacy check did not report zero winner quotes")
print("custom round settled and privacy check passed")
PY

echo "==> checking readable request validation"
status="$(curl -sS --max-time 20 -o "$TMP_DIR/invalid.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d '{"amount":0,"maxPrice":101,"assetToBuy":"cTBILL","settlementAsset":"cUSDC"}' \
  "$BASE_URL/api/replay")"
if [ "$status" != "400" ]; then
  echo "expected HTTP 400 for invalid amount, got $status"
  exit 1
fi
python3 - "$TMP_DIR/invalid.json" <<'PY'
import json
import sys

body = json.load(open(sys.argv[1]))
if "positive" not in body.get("reason", ""):
    raise SystemExit("validation response was not readable")
print("validation error is readable")
PY

echo "==> smoke test passed"
