// window.electron for the Android TV shell.
//
// The desktop app talks to Electron's main process through this object (see
// preload.js). On TV there is no main process: the few calls
// that matter are routed to the native `AndroidTV` @JavascriptInterface, the
// desktop-only ones (downloads, backups, Discord, window controls, updater)
// resolve to empty results, and any method not listed here falls back to a
// no-op so new upstream APIs don't crash the UI.
(function () {
  var A = window.AndroidTV || null;
  var ok = function (v) {
    return Promise.resolve(v);
  };
  var noop = function () {};
  var unsupported = { ok: false, error: "Not available on Android TV" };

  var api = {
    cleanUserAgent: (A && A.desktopUserAgent()) || navigator.userAgent,

    // Secrets (TMDB / Wyzie keys) live in the app's private SharedPreferences
    secureGet: function (key) {
      return ok(A ? A.secureGet(String(key)) : null);
    },
    secureSet: function (key, value) {
      if (A) A.secureSet(String(key), value == null ? "" : String(value));
      return ok({ ok: true });
    },

    getAppVersion: function () {
      return ok(A ? A.appVersion() : "tv");
    },
    getPlatform: function () {
      return ok("android");
    },
    openExternal: function (url) {
      if (A) A.openExternal(String(url));
      return ok();
    },
    wyzieOpenRedeem: function () {
      if (A) A.openExternal("https://sub.wyzie.io/redeem");
      return ok();
    },
    showNotification: function (n) {
      if (A && n) A.toast([n.title, n.body].filter(Boolean).join(": "));
      return ok();
    },
    quitApp: function () {
      if (A) A.quit();
      return ok();
    },
    setZoomFactor: function (factor) {
      document.documentElement.style.zoom = String(factor || 1);
    },

    // Player: progress comes from the script the native player injects into
    // every frame (see webview-element.js / PlayerController.java)
    queryVideoProgress: function () {
      return ok(window.__tvPlayer ? window.__tvPlayer.progress() : null);
    },
    playerStopped: noop,
    openPipWindow: function () {
      return ok({ ok: false, reason: "unsupported" });
    },
    closePipWindow: function () {
      return ok();
    },
    getPipWebContentsId: function () {
      return ok(null);
    },
    resolveHiAnime: function () {
      return ok({ ok: false, error: "Anime sources need the desktop app" });
    },

    // Desktop-only features
    getDownloads: function () {
      return ok([]);
    },
    fileExists: function () {
      return ok(false);
    },
    checkDownloader: function () {
      return ok(unsupported);
    },
    runDownload: function () {
      return ok(unsupported);
    },
    pickFolder: function () {
      return ok(null);
    },
    getCacheSize: function () {
      return ok(null);
    },
    getDownloadsSize: function () {
      return ok(null);
    },
    getBlockStats: function () {
      return ok({ total: 0 });
    },
    getScheduledBackupSettings: function () {
      return ok({ enabled: false });
    },
    searchSubtitles: function () {
      return ok(unsupported);
    },
    getSubtitleUrl: function () {
      return ok(unsupported);
    },
    wyzieValidateKey: function () {
      return ok({ ok: true });
    },
    windowIsMaximized: function () {
      return ok(true);
    },
    detectUpdateFormat: function () {
      return ok(null);
    },
  };

  window.electron = new Proxy(api, {
    get: function (target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string" || prop === "then" || prop === "toJSON")
        return undefined;
      // onX(cb) returns a handler/unsubscribe token, offX(token) is a no-op
      if (/^on[A-Z]/.test(prop))
        return function () {
          return noop;
        };
      if (/^off[A-Z]/.test(prop)) return noop;
      return function () {
        return ok(null);
      };
    },
  });
})();
