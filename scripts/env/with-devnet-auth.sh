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
"""Pick a DevNet session, renewing it in place when the access token has lapsed.

This used to fail outright on a stale session and tell you to open the dashboard.
The refresh token lives in the same file, so the CLI can renew the session itself
rather than making a browser login a prerequisite for running a command.
"""
import json, os, shlex, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

session_dir = Path(os.environ["SESSION_DIR"])
margin_ms = 60_000
now = time.time() * 1000

issuer = os.environ.get("SHADOWDESK_OIDC_ISSUER", "")
client_id = os.environ.get("SHADOWDESK_OIDC_CLIENT_ID", "")
scopes = os.environ.get("SHADOWDESK_OIDC_SCOPES", "openid profile email offline_access daml_ledger_api")


def renew(path, data):
    """Exchange the stored refresh token for a fresh access token.

    Returns the updated session, or None when the grant cannot be renewed. A
    transport failure and a spent refresh token both land here, so the reason is
    reported rather than collapsed into "expired".
    """
    token = data.get("refreshToken")
    if not token or not issuer or not client_id:
        print("cannot renew: missing refresh token or OIDC client configuration", file=sys.stderr)
        return None
    try:
        cfg = json.load(urllib.request.urlopen(issuer.rstrip("/") + "/.well-known/openid-configuration", timeout=15))
    except Exception as exc:
        print(f"cannot reach the identity provider: {exc}", file=sys.stderr)
        return None
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": token,
        "scope": scopes,
    }).encode()
    request = urllib.request.Request(
        cfg["token_endpoint"], data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        result = json.load(urllib.request.urlopen(request, timeout=20))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:200]
        # invalid_grant means the refresh token itself is spent. Anything else may
        # be transient, so the session is kept rather than discarded.
        print(f"the identity provider refused the refresh ({exc.code}): {detail}", file=sys.stderr)
        return None
    except Exception as exc:
        print(f"could not refresh the session: {exc}", file=sys.stderr)
        return None

    data["accessToken"] = result.get("access_token") or data.get("accessToken")
    data["accessTokenExpiresAt"] = int(time.time() * 1000) + int(result.get("expires_in", 3600) * 1000)
    if result.get("refresh_token"):
        data["refreshToken"] = result["refresh_token"]
    if result.get("id_token"):
        data["idToken"] = result["id_token"]
    try:
        path.write_text(json.dumps(data))
        os.chmod(path, 0o600)
    except OSError as exc:
        print(f"renewed but could not save the session: {exc}", file=sys.stderr)
    return data


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
    candidates.append((data.get("accessTokenExpiresAt") or 0, token, subject, path, data))

if not candidates:
    print("no-usable-session")
    sys.exit(0)

# Prefer the longest-lived token, then renew it if it has already lapsed.
expires_at, access, subject, path, data = max(candidates, key=lambda c: c[0])

if expires_at <= now + margin_ms:
    renewed = renew(path, data)
    if not renewed:
        print(f"stale-session:{expires_at}", file=sys.stderr)
        sys.exit(2)
    access = renewed.get("accessToken") or access
    subject = (renewed.get("user") or {}).get("sub") or subject
    expires_at = renewed.get("accessTokenExpiresAt") or expires_at
    if expires_at <= now + margin_ms:
        print(f"stale-session:{expires_at}", file=sys.stderr)
        sys.exit(2)

print(f"export SHADOWDESK_CANTON_ACCESS_TOKEN={shlex.quote(access)}")
print(f"export SHADOWDESK_LEDGER_USER_ID={shlex.quote(subject)}")
print(f"export SHADOWDESK_SESSION_EXPIRES_AT={shlex.quote(str(int(expires_at)))}")
if data.get("refreshToken"):
    print(f"export SHADOWDESK_CANTON_REFRESH_TOKEN={shlex.quote(data['refreshToken'])}")
PY
)" && CREDENTIAL_STATUS=0 || CREDENTIAL_STATUS=$?

if [ "$CREDENTIAL_STATUS" -ne 0 ]; then
  cat >&2 <<EOF
!! the stored DevNet session could not be renewed

   The refresh token in $SESSION_DIR has expired, which happens after a few hours
   of inactivity. Sign in again once:
     open http://localhost:3001/api/auth/login

   Until then the localnet sandbox still works:
     ./scripts/env/use-profile.sh localnet
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