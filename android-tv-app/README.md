# Streambert for Android TV

An Android TV app that runs Streambert's existing React UI (`../src`) in a WebView, with a native fullscreen player and remote-control navigation. The desktop source is not modified; everything TV-specific lives in this folder.

## How it works

- `web/` builds the UI with Vite into `app/src/main/assets/www`.
  - `public/tv-shim.js` replaces `window.electron`. Secrets go to the app's private storage; desktop-only features (downloads, backups, Discord, updater, PiP, HiAnime) return empty results.
  - `webview-element.js` replaces Electron's `<webview>` (retargeted in `vite.config.mjs`). Player URLs are handed to the native player, and load events / `executeJavaScript` are forwarded back.
  - `tv-nav.js` maps the D-pad onto the existing gamepad spatial navigation (`src/utils/gamepadSpatialNav.js`).
- `app/` is the Android shell (Java, no Kotlin).
  - `MainActivity` hosts the UI and the `window.AndroidTV` bridge.
  - `PlayerController` is the fullscreen player WebView. It blocks popups and the desktop app's `BLOCKED_HOSTS` (copied from `../index.js` at build time) and injects `assets/player-inject.js` into every frame to track and control the video.

## Remote controls

| Where | Key | Action |
| --- | --- | --- |
| Menus | Arrows | Move focus |
| Menus | OK | Select / open keyboard on text fields |
| Menus | Back | Close keyboard or dialog, then go back; twice on the home screen exits |
| Player | OK, Play/Pause | Play / pause (taps the play button before playback starts) |
| Player | Left / Right | Seek 10 s |
| Player | Up / Down | Pointer mode: arrows move a cursor, OK clicks (for source menus) |
| Player | Back | Leave pointer mode, then close the player |

## Building

Requirements: Node.js, JDK 17, Android SDK (platform 35).

```bash
cd android-tv-app/web
npm install
npm run build
cd ..
./gradlew assembleRelease   # or assembleDebug
```

Create `android-tv-app/local.properties` (ignored by git):

```properties
sdk.dir=/path/to/Android/Sdk
# Optional: sign the release APK
release.storeFile=/path/to/key.jks
release.storePassword=...
release.keyAlias=...
release.keyPassword=...
# Optional, personal builds only: a TMDB Read Access Token used until one is
# entered in the app. It ends up inside the APK, so never publish such a build.
tmdb.token=
```

Install with `adb install app/build/outputs/apk/release/app-release.apk`.

Debug builds enable WebView remote debugging (`chrome://inspect`).
