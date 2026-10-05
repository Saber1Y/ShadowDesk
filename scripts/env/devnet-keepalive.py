#!/usr/bin/env python3
"""Keep the stored DevNet session alive.

The DevNet identity provider expires an inactive session after roughly the same
interval as the access token, and the stored refresh token dies with it. A
session left alone for a few hours therefore stops being renewable, and the next
command fails until someone signs in through a browser.

Running this on an interval renews the session while it is still alive, which is
the only time renewal is possible. It is deliberately a separate command rather
than a background timer inside the dashboard: a Next.js dev server is not a
reliable place to keep a timer, and a lockout during a work session costs more
than one extra process.

    scripts/env/devnet-keepalive.sh          # renew once, print the result
    scripts/env/devnet-keepalive.sh --loop   # renew every 20 minutes until killed

Reuses the session picker, so there is one definition of "pick a usable session"
between this and with-devnet-auth.sh.
"""
import json
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SESSION_DIR = Path(os.environ.get("SHADOWDESK_AUTH_SESSION_DIR", Path.home() / ".config/shadowdesk/sessions"))
INTERVAL_SECONDS = 20 * 60


def pick_and_renew() -> tuple[bool, str]:
    """Renew the best available session, returning whether it worked and why."""
    if not SESSION_DIR.is_dir():
        return False, f"no session directory at {SESSION_DIR}"

    result = subprocess.run(
        ["bash", str(ROOT / "scripts" / "env" / "with-devnet-auth.sh"), "true"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            if line.startswith("export SHADOWDESK_SESSION_EXPIRES_AT="):
                raw = line.split("=", 1)[1].strip().strip("'\"")
                try:
                    remaining = int(raw) / 1000 - time.time()
                    return True, f"session valid for another {remaining / 60:.0f} min"
                except ValueError:
                    return True, "session renewed"
        return True, "session renewed"

    detail = (result.stderr or result.stdout).strip().splitlines()
    reason = detail[0] if detail else f"exit {result.returncode}"
    return False, reason


def main() -> int:
    loop = "--loop" in sys.argv
    while True:
        ok, message = pick_and_renew()
        stamp = time.strftime("%H:%M:%S")
        print(f"[{stamp}] {'ok' if ok else 'FAILED'}: {message}", flush=True)
        if not ok and not loop:
            print(
                "\nSign in once to restore the session:\n"
                "  open http://localhost:3001/api/auth/login\n",
                flush=True,
            )
            return 1
        if not loop:
            return 0
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
