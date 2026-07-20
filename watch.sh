#!/usr/bin/env bash
# Durable CreatorRadar runner: start server → on exit, wait → restart.
# Intentional stop: ./stop.sh  (or touch data/server.stop)
# Do not kill this script from agent shells — leave it running (or use LaunchAgent).
#
# Survives: crash, SIGTERM on the node child (agents killing :8787), port races.
# Never exits the watchdog loop except on intentional stop — so LaunchAgent
# KeepAlive is a backstop, not the primary recovery path.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PID_FILE="${ROOT}/data/server.pid"
WATCH_PID_FILE="${ROOT}/data/watch.pid"
STOP_FILE="${ROOT}/data/server.stop"
LOG_FILE="${ROOT}/data/server.log"
PORT="${PORT:-8787}"
RESTART_DELAY="${RESTART_DELAY:-1}"
# Poll often so empty process / port-not-listening recover quickly
MONITOR_INTERVAL="${MONITOR_INTERVAL:-2}"
BUSY_DELAY="${BUSY_DELAY:-2}"
# Detect LaunchAgent so logs are clear (XPC_SERVICE_NAME is set by launchd).
LAUNCHD_MANAGED=0
if [[ "${XPC_SERVICE_NAME:-}" == "com.creatorradar.leadfinder" ]]; then
  LAUNCHD_MANAGED=1
fi

mkdir -p "${ROOT}/data"

resolve_node() {
  if [[ -n "${NODE_BIN:-}" && -x "${NODE_BIN}" ]]; then
    echo "$NODE_BIN"
    return
  fi
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
  "$NODE_BIN" -e "
    const http=require('http');
    const req=http.get('http://127.0.0.1:${PORT}/api/health',res=>{
      process.exit(res.statusCode===200?0:1);
    });
    req.on('error',()=>process.exit(1));
    req.setTimeout(2000,()=>{req.destroy();process.exit(1);});
  " 2>/dev/null
}

port_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

stop_requested() {
  [[ -f "$STOP_FILE" ]] || [[ "${intentional_stop:-0}" -eq 1 ]]
}

do_intentional_exit() {
  rm -f "$STOP_FILE" "$WATCH_PID_FILE" "$PID_FILE"
  echo "[watch] intentional stop — exiting" | tee -a "$LOG_FILE"
  exit 0
}

# Resolve node; if missing, wait and retry (do not exit — LaunchAgent thrash)
NODE_BIN=""
while [[ -z "$NODE_BIN" ]]; do
  NODE_BIN="$(resolve_node || true)"
  if [[ -z "$NODE_BIN" ]]; then
    echo "[watch] Node.js not found — retrying in 10s…" | tee -a "$LOG_FILE"
    sleep 10
  fi
done

intentional_stop=0
child_pid=""

kill_child() {
  if [[ -n "${child_pid}" ]] && kill -0 "$child_pid" 2>/dev/null; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  child_pid=""
  rm -f "$PID_FILE"
}

on_signal() {
  # Intentional stop (stop.sh touches STOP_FILE before signalling)
  if [[ -f "$STOP_FILE" ]]; then
    intentional_stop=1
    kill_child
    rm -f "$WATCH_PID_FILE" "$PID_FILE"
    echo "[watch] signal + stop file — exiting" | tee -a "$LOG_FILE"
    exit 0
  fi

  # Agent / stray SIGTERM on the node child path: kill child, stay in loop.
  # Under LaunchAgent KeepAlive, exiting would also revive — but staying up
  # avoids a gap and survives even if the agent was briefly unloaded.
  echo "[watch] unexpected signal — restarting child (watchdog stays up)" | tee -a "$LOG_FILE"
  kill_child
}

trap on_signal INT TERM

echo $$ >"$WATCH_PID_FILE"
echo "[watch] CreatorRadar watchdog pid=$$ node=$NODE_BIN port=$PORT launchd=${LAUNCHD_MANAGED} monitor=${MONITOR_INTERVAL}s" | tee -a "$LOG_FILE"
echo "[watch] Leave this running. Soft stop: ./stop.sh  |  Uninstall: ./stop.sh --uninstall" | tee -a "$LOG_FILE"

while true; do
  if stop_requested; then
    do_intentional_exit
  fi

  # Another process already serving health — adopt it (agents often kill node
  # but leave or race a second start). Keep watchdog alive and wait for drop.
  if health_ok; then
    echo "[watch] :${PORT} already healthy — monitoring (will restart if it dies)" | tee -a "$LOG_FILE"
    while health_ok; do
      if stop_requested; then
        do_intentional_exit
      fi
      # Refresh pid file from listener if possible
      if command -v lsof >/dev/null 2>&1; then
        listener="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
        if [[ -n "$listener" ]]; then
          echo "$listener" >"$PID_FILE"
        fi
      fi
      sleep "$MONITOR_INTERVAL"
    done
    echo "[watch] health lost on :${PORT} — restarting in ${RESTART_DELAY}s" | tee -a "$LOG_FILE"
    rm -f "$PID_FILE"
    sleep "$RESTART_DELAY"
    continue
  fi

  # Port held but not healthy (stale bind / still starting) — back off, no crash loop
  if port_listening; then
    echo "[watch] :${PORT} in use but unhealthy — waiting ${BUSY_DELAY}s" | tee -a "$LOG_FILE"
    sleep "$BUSY_DELAY"
    continue
  fi

  echo "[watch] starting server/index.js ($(date '+%Y-%m-%d %H:%M:%S'))" | tee -a "$LOG_FILE"
  "$NODE_BIN" server/index.js >>"$LOG_FILE" 2>&1 &
  child_pid=$!
  echo "$child_pid" >"$PID_FILE"

  wait "$child_pid"
  code=$?
  child_pid=""
  rm -f "$PID_FILE"

  if stop_requested; then
    do_intentional_exit
  fi

  # SIGTERM (143) / SIGKILL (137) from agents killing the port listener — normal recovery
  echo "[watch] server exited code=$code — restarting in ${RESTART_DELAY}s" | tee -a "$LOG_FILE"
  sleep "$RESTART_DELAY"
done
