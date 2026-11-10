#!/usr/bin/env bash
#
# Diagnoses a refused admin login on a deployed kiosk.
#
#   bash scripts/diagnose-admin.sh
#
# Reports facts only — it never prints a password, and never writes anything.
# Exits non-zero when it finds something that would break the login.
#
# The usual causes, in the order they bite:
#   1. The deployment predates the commit that loads the repo-root .env.
#   2. ADMIN_PASSWORD is absent, so a throwaway password is generated per run.
#   3. The value is quoted or space-padded in .env.
#   4. A stale process still holds the port, serving its own older password.
#   5. pm2 (or systemd) sets a variable that overrides the .env file.
set -u

# Resolve the repo from this script's location, so it works from any directory.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1

problems=0
note() { printf '   %s\n' "$*"; }
bad() { printf '   !! %s\n' "$*"; problems=$((problems + 1)); }

# Last definition wins, matching how the app layers its env files. Surrounding
# quotes and stray whitespace are stripped, as loadEnv.ts does.
envval() {
  local key="$1" value="" line
  for file in .env .env.local backend/.env; do
    [ -f "$file" ] || continue
    line=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -1)
    [ -n "$line" ] && value="${line#*=}"
  done
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$(echo "$value" | xargs 2>/dev/null)"
}

port=$(envval API_PORT)
[ -z "$port" ] && port=$(envval PORT)
[ -z "$port" ] && port=4000

echo "1. deployed code"
note "commit: $(git log --oneline -1 2>/dev/null || echo 'not a git checkout')"
git fetch -q 2>/dev/null
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
if [ "${behind:-0}" -gt 0 ]; then
  bad "$behind commit(s) behind origin/main — run: git pull && bun install"
else
  note "up to date with origin/main"
fi
if [ -f backend/src/lib/loadEnv.ts ]; then
  note "loadEnv.ts present — the repo-root .env is loaded regardless of cwd"
else
  bad "loadEnv.ts missing: this deployment ignores the repo-root .env entirely"
fi

echo "2. environment files"
found_password=0
for file in .env .env.local backend/.env; do
  if [ ! -f "$file" ]; then
    printf '   %-16s -\n' "$file"
    continue
  fi
  if grep -qE '^[[:space:]]*ADMIN_PASSWORD=' "$file"; then
    raw=$(grep -E '^[[:space:]]*ADMIN_PASSWORD=' "$file" | tail -1)
    raw="${raw#*=}"
    found_password=1
    quoted=0
    case "$raw" in
      \"*\"|\'*\') quoted=1 ;;
    esac

    if [ "$quoted" -eq 1 ]; then
      # Strip the quotes to report the password's real length.
      inner="${raw%?}"; inner="${inner#?}"
      printf '   %-16s ADMIN_PASSWORD set, %s chars, quoted\n' "$file" "${#inner}"
    else
      printf '   %-16s ADMIN_PASSWORD set, %s chars' "$file" "${#raw}"
      case "$raw" in
        *'#'*)
          # An unquoted '#' opens a comment, so the password is only the part
          # before it — the single most common cause of "the password is wrong".
          before="${raw%%#*}"
          printf '  [CUT AT # — only %s chars reach the API; quote it]' "${#before}"
          problems=$((problems + 1))
          ;;
      esac
      case "$raw" in
        *' ') printf '  [TRAILING SPACE]'; problems=$((problems + 1)) ;;
      esac
      echo
    fi
  else
    printf '   %-16s exists, no ADMIN_PASSWORD\n' "$file"
  fi
done
[ "$found_password" -eq 0 ] && bad "ADMIN_PASSWORD is not set anywhere: a new password is generated on every restart"
note "API port from env: $port"
if [ -n "$(envval ADMIN_SESSION_SECRET)" ]; then
  note "ADMIN_SESSION_SECRET set"
else
  bad "ADMIN_SESSION_SECRET absent: every restart invalidates existing sessions"
fi

echo "3. processes on port $port"
# Count distinct PIDs, not rows: ss prints a separate line for the IPv4 and
# IPv6 views of one socket, which would otherwise look like a stale duplicate.
# Pick the tool by availability: piping ss into grep keeps a zero exit status
# even where ss does not exist, so a `||` fallback would never fire.
if command -v ss >/dev/null 2>&1; then
  holders=$(ss -lptnH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u | grep -c .)
else
  holders=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u | grep -c .)
fi
if [ "$holders" -eq 0 ]; then
  bad "nothing is listening — the API is not running on $port"
elif [ "$holders" -gt 1 ]; then
  bad "$holders processes hold the port"
else
  note "one process holds the port"
fi

# The port can only be bound once, so a stale instance shows up as an extra
# API process that failed to bind and kept running with its old password.
# `pgrep -c` is GNU-only; counting lines works on both Linux and macOS.
api_procs=$(pgrep -f "src/index.ts" 2>/dev/null | grep -c . )
if [ "${api_procs:-0}" -gt 1 ]; then
  bad "$api_procs API processes running: a restart did not replace the old one"
  note "fix: stop them all, then start once — otherwise the old password stays live"
fi

echo "4. process-manager overrides"
if command -v pm2 >/dev/null 2>&1; then
  overrides=$(pm2 jlist 2>/dev/null | grep -oE '"(API_PORT|ADMIN_PASSWORD|ADMIN_SESSION_SECRET)":[^,}]*' | sort -u)
  if [ -n "$overrides" ]; then
    printf '%s\n' "$overrides" | sed 's/^/   pm2 sets /'
    note "a real environment variable always beats the .env file"
  else
    note "pm2 sets none of these — the .env file wins"
  fi
else
  note "pm2 not installed; check your unit file for Environment= lines"
fi

echo "5. what the API reports"
logs=""
command -v pm2 >/dev/null 2>&1 && logs=$(pm2 logs kiosk-api --lines 300 --nostream 2>/dev/null)
if [ -n "$logs" ]; then
  printf '%s\n' "$logs" \
    | grep -aiE 'Admin:|No ADMIN_PASSWORD|login refused|whitespace|trimmed|listening on' \
    | tail -8 | sed 's/^/   /'
else
  note "no pm2 logs for 'kiosk-api' — check however you run the API"
fi

echo "6. reachability"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/health" 2>/dev/null)
[ "$code" = "200" ] && note "health check OK on 127.0.0.1:$port" || bad "health check returned ${code:-no response} on 127.0.0.1:$port"

echo
if [ "$problems" -eq 0 ]; then
  echo "No configuration problems found. If the login is still refused, the"
  echo "'login refused' line above compares both sides by length and fingerprint."
else
  echo "$problems problem(s) found — see the !! lines."
fi
exit "$problems"
