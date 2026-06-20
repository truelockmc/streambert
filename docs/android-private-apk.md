# Streambert Android Private APK

This repo includes a Capacitor Android shell for personal sideloaded builds.
It is not configured as a Play Store release.

## What This Build Does

- Packages the existing Streambert React/Vite UI into an Android WebView.
- Keeps the app UI local inside the APK.
- Adds Android-native WebView controls in `MainActivity`:
  - popup windows are denied;
  - external top-level navigation is consumed instead of leaving Streambert;
  - known ad/tracker resource hosts are cancelled in `shouldInterceptRequest`;
  - camera, microphone, and geolocation requests are denied;
  - third-party cookies and inline media playback are enabled for player compatibility.

This is closer to the Electron app behavior than the public web build because
Android lets the app control its own WebView. It is still not a native
direct-stream player; the current movie/TV sources are embed providers.

## Prerequisites

- Node.js and npm.
- Android Studio with Android SDK installed.
- A working Java runtime compatible with the generated Android Gradle Plugin.
  Use the JDK bundled with current Android Studio or another JDK 17+ install.
- Optional: `adb` for installing the APK on a device.

## Build A Debug APK

```sh
npm ci
npm run android:debug
```

The debug APK is written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a connected Android device:

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Sync Web Changes Into Android

After changing React/Vite code:

```sh
npm run android:sync
```

Then rebuild with:

```sh
cd android
./gradlew assembleDebug
```

## TMDB Token

Do not commit TMDB tokens or other secrets into the APK source tree.

For personal testing, launch the Android app and use the normal Streambert setup
screen to enter the TMDB read access token. It is stored in the app's local
storage for that installed app instance.

## Known Limits

- Downloads remain desktop/Electron-only in this codebase.
- The Android app still uses provider embeds for movie/TV playback.
- A future iframe-free Android player should use a direct stream resolver plus
  Android Media3/ExoPlayer or a web HLS player only when a direct `.m3u8` URL is
  available.
