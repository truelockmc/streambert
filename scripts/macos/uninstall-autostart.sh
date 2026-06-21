#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ID="com.truelockmc.streambert"
AUTOSTART_LABEL="$BUNDLE_ID.autostart"
PLIST_PATH="$HOME/Library/LaunchAgents/$AUTOSTART_LABEL.plist"

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "Disabled login autostart: $PLIST_PATH"
