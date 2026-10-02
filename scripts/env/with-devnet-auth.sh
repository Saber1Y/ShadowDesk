#!/bin/bash
# Run a command with DevNet credentials taken from the dashboard's session store.
#
# The dashboard mints OIDC tokens on login and keeps them in a server-side
# session file. The agent scripts need those tokens in their own environment,
# and hand-copying a JWT into .env.devnet goes stale silently. This reads the
# live session at run time instead, so the agents always use the token the
# dashboard just refreshed.
#
# Usage:
#   scripts/env/with-devnet-auth.sh npm run e2e:real-dvp -- --holdings
#   scripts/env/with-devnet-auth.sh bash        # interactive shell, credentials loaded
#
# Tokens are exported into the child process only. Nothing is printed.
set -euo pipefail

ROOT="/Users/mac/codes/Shadow Desk"
PROFILE="$ROOT/frontend/.env.devnet"
SESSION_DIR="${SHADOWDESK_AUTH_SESSION_DIR:-$HOME/.config/shadowdesk/sessions}"

if [ ! -f "$PROFILE" ]; then
  echo "!! missing $PROFILE" >&2
  echo "   the DevNet profile holds the participant URLs and registry config" >&2
  exit 1
fi

# Load the profile without shell evaluation. SHADOWDESK_OIDC_SCOPES contains
# spaces, so `source` would break; reading line by line keeps values intact.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ""|'#'*) continue ;;
  esac
  case "$line" in
    *=*) ;;
    *) continue ;;
  esac
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    *[!A-Za-z0-9_]*|"") continue ;;
  esac
  export "$key=$value"
done < "$PROFILE"

if [ "${SHADOWDESK_NETWORK:-}" != "devnet" ]; then
  echo "!! $PROFILE does not set SHADOWDESK_NETWORK=devnet" >&2
  exit 1
fi

if [ ! -d "$SESSION_DIR" ]; then
  cat >&2 <<EOF
!! no session directory at $SESSION_DIR

   Log in through the dashboard once:
     ./scripts/env/use-profile.sh devnet
     open http://localhost:3001/api/auth/login
   That stores the tokens in the session file this script reads.
EOF
  exit 1
fi

# Pick the session with the longest-lived unexpired access token. The dashboard
# refreshes at a 60s margin, so anything inside that window is already stale.
CREDENTIALS="$(SESSION_DIR="$SESSION_DIR" python3 - <<'PY'
import json, os, shlex, sys, time
from pathlib import Path

session_dir = Path(os.environ["SESSION_DIR"])
margin_ms = 60_000
now = time.time() * 1000

candidates = []
for path in session_dir.glob("*.json"):
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        continue
    token = data.get("accessToken")
    subject = (data.get("user") or {}).get("sub")
    if not isinstance(token, str) or not token or not isinstance(subject, str) or not subject:
        continue
    candidates.append((data.get("accessTokenExpiresAt") or 0, token, subject,
                       data.get("refreshToken") or ""))

if not candidates:
    print("no-usable-session")
    sys.exit(0)

# Prefer a token that is still valid beyond the refresh margin.
fresh = [c for c in candidates if c[0] > now + margin_ms]
chosen = max(fresh or candidates, key=lambda c: c[0])

expires_at, access, subject, refresh = chosen
if expires_at <= now + margin_ms:
    print(f"stale-session:{expires_at}", file=sys.stderr)
    sys.exit(2)

print(f"export SHADOWDESK_CANTON_ACCESS_TOKEN={shlex.quote(access)}")
print(f"export SHADOWDESK_LEDGER_USER_ID={shlex.quote(subject)}")
print(f"export SHADOWDESK_SESSION_EXPIRES_AT={shlex.quote(str(int(expires_at)))}")
if refresh:
    print(f"export SHADOWDESK_CANTON_REFRESH_TOKEN={shlex.quote(refresh)}")
PY
)" && CREDENTIAL_STATUS=0 || CREDENTIAL_STATUS=$?

if [ "$CREDENTIAL_STATUS" -ne 0 ]; then
  cat >&2 <<EOF
!! the stored DevNet session has expired

   The dashboard refreshes tokens when it serves a request, so open the
   dashboard to renew it, then retry:
     http://localhost:3001
EOF
  exit 1
fi

case "$CREDENTIALS" in
  no-usable-session)
    cat >&2 <<EOF
!! no usable DevNet session in $SESSION_DIR

   Log in through the dashboard, then retry:
     ./scripts/env/use-profile.sh devnet
     open http://localhost:3001/api/auth/login
EOF
    exit 1
    ;;
esac

eval "$CREDENTIALS"

if [ "$#" -eq 0 ]; then
  echo "DevNet credentials loaded. Access token valid until $(date -r "$((SHADOWDESK_SESSION_EXPIRES_AT / 1000))" 2>/dev/null || echo 'soon')." >&2
  exec bash
fi

exec "$@"