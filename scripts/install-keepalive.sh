#!/usr/bin/env bash
# Install a macOS LaunchAgent so CreatorRadar stays up across Terminal closes and logouts.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.creatorradar.leadfinder"
PLIST_SRC="${ROOT}/scripts/${LABEL}.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"

mkdir -p "${HOME}/Library/LaunchAgents" "${ROOT}/data"
chmod +x "${ROOT}/watch.sh" "${ROOT}/start.sh" "${ROOT}/stop.sh" "$0"

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

NODE_RESOLVED="$(resolve_node || true)"
if [[ -z "$NODE_RESOLVED" ]]; then
  echo "Node.js not found — cannot install keepalive." >&2
  exit 127
fi

# Clear intentional-stop marker so watch does not exit immediately
rm -f "${ROOT}/data/server.stop"

# Soft-stop any ad-hoc instance so LaunchAgent owns the port (do NOT unload via stop.sh)
if [[ -f "${ROOT}/data/watch.pid" ]]; then
  wpid="$(cat "${ROOT}/data/watch.pid" 2>/dev/null || true)"
  if [[ -n "$wpid" ]] && kill -0 "$wpid" 2>/dev/null; then
    # Only kill orphan watchdogs not already managed by launchd
    if ! launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
      kill "$wpid" 2>/dev/null || true
      sleep 0.3
    fi
  fi
fi

# Prefer health reuse: if already up, we still (re)install the agent around it
sed \
  -e "s|__LEAD_FINDER_ROOT__|${ROOT}|g" \
  -e "s|__NODE_BIN__|${NODE_RESOLVED}|g" \
  "$PLIST_SRC" >"$PLIST_DST"

# Prefer modern bootout/bootstrap; fall back to unload/load
if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
  sleep 0.4
fi
# Clear stop again after any prior stop.sh side effects
rm -f "${ROOT}/data/server.stop"

if ! launchctl bootstrap "gui/${UID_NUM}" "$PLIST_DST" 2>/dev/null; then
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  launchctl load -w "$PLIST_DST"
fi

# Kick it if needed
launchctl enable "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true

echo "Installed LaunchAgent: ${PLIST_DST}"
echo "NODE_BIN=${NODE_RESOLVED}"
echo "CreatorRadar should stay up at http://localhost:8787"
echo "Soft stop: cd ${ROOT} && ./stop.sh"
echo "Uninstall 24/7: cd ${ROOT} && ./stop.sh --uninstall && rm -f ${PLIST_DST}"

# Brief health wait
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -fsS --max-time 2 "http://127.0.0.1:8787/api/health" >/dev/null 2>&1; then
    echo "Health check: OK"
    launchctl list | grep -E "${LABEL}|PID" || true
    exit 0
  fi
  sleep 0.5
done
echo "LaunchAgent installed; health not ready yet — check ${ROOT}/data/server.log"
exit 0
