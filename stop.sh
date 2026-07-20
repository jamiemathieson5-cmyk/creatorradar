#!/usr/bin/env bash
# Stop CreatorRadar server processes.
#
# Default: soft stop — does NOT unload the LaunchAgent.
#   • If LaunchAgent is loaded: only kill the :8787 listener; watch.sh restarts it.
#   • If no LaunchAgent: stop watchdog + server for real.
#
# Permanent stop / unload LaunchAgent:
#   ./stop.sh --uninstall

set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="${ROOT}/data/server.pid"
WATCH_PID_FILE="${ROOT}/data/watch.pid"
STOP_FILE="${ROOT}/data/server.stop"
PORT="${PORT:-8787}"
LABEL="com.creatorradar.leadfinder"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --uninstall|--unload|-u) UNINSTALL=1 ;;
    --help|-h)
      cat <<'EOF'
Stop CreatorRadar

  ./stop.sh              Soft stop (keeps LaunchAgent; server comes back if installed)
  ./stop.sh --uninstall  Stop + unload LaunchAgent (stays down until reinstall)
EOF
      exit 0
      ;;
  esac
done

mkdir -p "${ROOT}/data"

agent_loaded() {
  command -v launchctl >/dev/null 2>&1 && launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1
}

kill_port_listeners() {
  if command -v lsof >/dev/null 2>&1; then
    for p in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
      kill "$p" 2>/dev/null || true
    done
  fi
}

if [[ "$UNINSTALL" -eq 1 ]]; then
  touch "$STOP_FILE"

  if command -v launchctl >/dev/null 2>&1; then
    if agent_loaded; then
      launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
    elif [[ -f "$PLIST" ]]; then
      launchctl unload "$PLIST" 2>/dev/null || true
    fi
  fi

  if [[ -f "$WATCH_PID_FILE" ]]; then
    wpid="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$wpid" ]] && kill -0 "$wpid" 2>/dev/null; then
      kill "$wpid" 2>/dev/null || true
      sleep 0.3
    fi
  fi

  if [[ -f "$PID_FILE" ]]; then
    spid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$spid" ]] && kill -0 "$spid" 2>/dev/null; then
      kill "$spid" 2>/dev/null || true
    fi
  fi

  kill_port_listeners
  rm -f "$PID_FILE" "$WATCH_PID_FILE" "$STOP_FILE"
  echo "CreatorRadar stopped and LaunchAgent unloaded."
  echo "Re-enable 24/7: ./scripts/install-keepalive.sh"
  exit 0
fi

# Soft stop
if agent_loaded; then
  # Leave watchdog + LaunchAgent alone; bounce only the node listener.
  kill_port_listeners
  if [[ -f "$PID_FILE" ]]; then
    spid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$spid" ]] && kill -0 "$spid" 2>/dev/null; then
      kill "$spid" 2>/dev/null || true
    fi
  fi
  echo "CreatorRadar soft-stopped (listener killed)."
  echo "LaunchAgent KeepAlive / watch.sh will restart :${PORT} shortly."
  exit 0
fi

# No LaunchAgent — full local stop
touch "$STOP_FILE"
if [[ -f "$WATCH_PID_FILE" ]]; then
  wpid="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$wpid" ]] && kill -0 "$wpid" 2>/dev/null; then
    kill "$wpid" 2>/dev/null || true
    sleep 0.3
  fi
fi
if [[ -f "$PID_FILE" ]]; then
  spid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$spid" ]] && kill -0 "$spid" 2>/dev/null; then
    kill "$spid" 2>/dev/null || true
  fi
fi
kill_port_listeners
rm -f "$PID_FILE" "$WATCH_PID_FILE" "$STOP_FILE"
echo "CreatorRadar stopped (no LaunchAgent was loaded)."
echo "For 24/7: ./scripts/install-keepalive.sh"
