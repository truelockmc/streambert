# macOS App Icon and Autostart

Streambert can be installed as a local macOS app bundle with the project icon
and a login LaunchAgent.

## Install

```sh
npm run mac:install-autostart
```

This command:

- builds `build/icon.icns` from `public/icon.png`;
- packages a local `Streambert.app` with Electron Builder;
- installs it to `~/Applications/Streambert.app`;
- writes `~/Library/LaunchAgents/com.truelockmc.streambert.autostart.plist`;
- loads the LaunchAgent and opens the app.

## Remove Autostart

```sh
npm run mac:uninstall-autostart
```

This removes only the LaunchAgent. The installed app bundle remains at
`~/Applications/Streambert.app`.

## Custom Install Path

Set `STREAMBERT_APP_PATH` when installing:

```sh
STREAMBERT_APP_PATH="$HOME/Applications/Streambert.app" npm run mac:install-autostart
```
