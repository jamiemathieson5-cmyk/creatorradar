#!/usr/bin/env bash
# One-time / refresh TikLeap Premium login for CreatorRadar diamond filtering.
# Opens headed Chrome with a persistent profile, waits for you to log in,
# then exports cookies to data/tikleap-cookies.json.
#
# Usage:
#   cd lead-finder && ./scripts/tikleap-login.sh
#
# Scrape stability (after login):
#   - TikLeap Chrome defaults to headed/off-screen (Cloudflare-safe).
#   - TikTok feed Chrome stays headless by default.
#   - LEAD_FINDER_HEADED=1          → also show TikTok feed window (off-screen)
#   - LEAD_FINDER_TIKLEAP_HEADLESS=1 → force TikLeap headless (often gets 403)
#   - LEAD_FINDER_TIKLEAP_WORKERS=N  → lookup tabs (default 26; +1 list tab)
#
# After cookies are saved, Get leads can look up L28 diamonds.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  elif [[ -x "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node" ]]; then
    NODE_BIN="/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node"
  else
    echo "node not found" >&2
    exit 1
  fi
fi

mkdir -p "$ROOT/data"
echo "Opening TikLeap login… Log in with Premium, then return here."
echo "Cookies will be saved to data/tikleap-cookies.json"
exec "$NODE_BIN" "$ROOT/scripts/tikleap-login.js"
