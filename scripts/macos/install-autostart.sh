#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="Streambert"
BUNDLE_ID="com.truelockmc.streambert"
AUTOSTART_LABEL="$BUNDLE_ID.autostart"
APP_PATH="${STREAMBERT_APP_PATH:-$HOME/Applications/$APP_NAME.app}"
PLIST_PATH="$HOME/Library/LaunchAgents/$AUTOSTART_LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Streambert"

cd "$REPO_ROOT"
npm run mac:app

SOURCE_APP="$(find "$REPO_ROOT/dist" -maxdepth 2 -type d -name "$APP_NAME.app" | sort | head -n 1)"
if [[ -z "$SOURCE_APP" || ! -d "$SOURCE_APP" ]]; then
  echo "Could not find packaged $APP_NAME.app under $REPO_ROOT/dist." >&2
  exit 1
fi

mkdir -p "$(dirname "$APP_PATH")" "$HOME/Library/LaunchAgents" "$LOG_DIR"
rm -rf "$APP_PATH"
ditto "$SOURCE_APP" "$APP_PATH"
xattr -dr com.apple.quarantine "$APP_PATH" >/dev/null 2>&1 || true

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$AUTOSTART_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>$APP_PATH</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/autostart.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/autostart.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/$AUTOSTART_LABEL"

open "$APP_PATH"

echo "Installed $APP_PATH"
echo "Enabled login autostart: $PLIST_PATH"
