#!/usr/bin/env bash
# Launch a throwaway headless Chrome, run the native-input checks against it,
# then make sure that Chrome is gone even when a check fails.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

PROFILE_UNIX="/tmp/dvb-native-verify-$$"
PROFILE_WIN="$(cygpath -w "$PROFILE_UNIX")"
rm -rf "$PROFILE_UNIX"
mkdir -p "$PROFILE_UNIX"

CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --remote-debugging-port=0 --user-data-dir="$PROFILE_WIN" \
  --no-first-run --no-default-browser-check --mute-audio about:blank >/tmp/dvb-native-chrome.log 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 60); do
  [ -f "$PROFILE_UNIX/DevToolsActivePort" ] && break
  sleep 0.5
done
if [ ! -f "$PROFILE_UNIX/DevToolsActivePort" ]; then
  echo "chrome did not expose a DevTools port:" && tail -5 /tmp/dvb-native-chrome.log
  kill "$CHROME_PID" 2>/dev/null
  exit 2
fi

DVB_CHROME_PROFILE="$PROFILE_WIN" node test/manual-native-inputs.mjs
STATUS=$?

kill "$CHROME_PID" 2>/dev/null
sleep 1
taskkill //F //FI "WINDOWTITLE eq about:blank" >/dev/null 2>&1
exit $STATUS
