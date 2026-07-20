#!/usr/bin/env bash
# Start CreatorRadar with watchdog keepalive (auto-restart on crash/exit).
# Reuses an already-healthy process on :8787 instead of double-starting.
# For durability across Terminal/agent exits, prefer: ./scripts/install-keepalive.sh
#
# Usage:
#   ./start.sh           # watchdog (default) — leave running
#   ./start.sh --once    # single process, no restart loop
#   ./start.sh --detach  # nohup watchdog in background

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PORT="${PORT:-8787}"
PID_FILE="${ROOT}/data/server.pid"
WATCH_PID_FILE="${ROOT}/data/watch.pid"
STOP_FILE="${ROOT}/data/server.stop"
MODE="watch"
DETACH=0

for arg in "$@"; do
  case "$arg" in
    --once) MODE="once" ;;
    --detach|-d) DETACH=1 ;;
    --help|-h)
      cat <<'EOF'
CreatorRadar / Lead Finder

  ./start.sh           Start with auto-restart watchdog (foreground)
  ./start.sh --detach  Start watchdog in background (survives this shell)
  ./start.sh --once    Start server once without watchdog
  ./stop.sh            Soft stop (LaunchAgent KeepAlive revives if installed)
  ./stop.sh --uninstall
                       Stop + unload LaunchAgent (stays down)
  ./scripts/install-keepalive.sh
                       Install macOS LaunchAgent (survives logout/reboot login)

Open http://localhost:8787 when healthy.

Env (optional):
  ADMIN_USER / ADMIN_PASSWORD   admin login
  SESSION_SECRET                session cookie HMAC
  SCRAPE_MODE=tiktok_feed       Railway default (no TikLeap)
  ENABLE_TIKLEAP=1              local full TikLeap pipeline
EOF
      exit 0
      ;;
  esac
done

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  local candidates=(
    "$HOME/.nvm/versions/node/"*/bin/node
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done

  return 1
}

health_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1
    return $?
  fi
  # Fallback without curl
  local node_bin="$1"
  "$node_bin" -e "
    const http=require('http');
    const req=http.get('http://127.0.0.1:${PORT}/api/health',res=>{
      process.exit(res.statusCode===200?0:1);
    });
    req.on('error',()=>process.exit(1));
    req.setTimeout(2000,()=>{req.destroy();process.exit(1);});
  " 2>/dev/null
}

NODE_BIN="$(resolve_node || true)"

if [[ -z "${NODE_BIN}" ]]; then
  cat <<'EOF' >&2
Node.js is not installed (command not found: node).

Install it, then re-run ./start.sh:

  macOS (Homebrew):
    brew install node

  Or download LTS from:
    https://nodejs.org/

Cursor ships a Node helper that this script will use if present:
  /Applications/Cursor.app/Contents/Resources/app/resources/helpers/node
EOF
  exit 127
fi

export NODE_BIN
mkdir -p "${ROOT}/data"

# Reuse existing healthy server — avoid agent kill/restart thrash
if health_ok "$NODE_BIN"; then
  echo "CreatorRadar already healthy at http://localhost:${PORT}"
  echo "PID file: ${PID_FILE} (leave watch.sh / LaunchAgent running — do not kill)"
  if [[ -f "$PID_FILE" ]]; then
    echo "server pid: $(cat "$PID_FILE" 2>/dev/null || echo '?')"
  fi
  if [[ -f "$WATCH_PID_FILE" ]]; then
    echo "watchdog pid: $(cat "$WATCH_PID_FILE" 2>/dev/null || echo '?')"
  fi
  exit 0
fi

rm -f "$STOP_FILE"

echo "Using Node: $NODE_BIN ($("$NODE_BIN" -v))"
echo "CreatorRadar → http://localhost:${PORT}"
echo "Tip: leave watchdog running; agents should not kill port ${PORT}."
echo "Durable across logouts: ./scripts/install-keepalive.sh"
echo "Chrome: scrape profile (chrome-tikleap-profile) headed, CDP keep-minimized, reused across Get leads."
echo "  Personal Chrome is never targeted. Soft stop leaves scrape Chrome running."
echo "  LEAD_FINDER_TIKLEAP_HEADLESS=1   force TikLeap headless (often CF 403)"
echo "  LEAD_FINDER_TIKLEAP_WORKERS=N    TikLeap lookup tabs (default 26, max 31)"
echo "Login refresh: ./scripts/tikleap-login.sh"

if [[ "$MODE" == "once" ]]; then
  exec "$NODE_BIN" server/index.js
fi

if [[ "$DETACH" -eq 1 ]]; then
  # Detach so Cursor agent shell teardown does not SIGTERM the server
  nohup "$ROOT/watch.sh" >/dev/null 2>&1 &
  disown 2>/dev/null || true
  echo "Watchdog started in background (pid $!)."
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if health_ok "$NODE_BIN"; then
      echo "Healthy: http://localhost:${PORT}"
      exit 0
    fi
    sleep 0.5
  done
  echo "Started but health check not ready yet — check data/server.log" >&2
  exit 0
fi

exec "$ROOT/watch.sh"
