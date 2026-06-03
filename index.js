// -- Streambert main process entry point ---------------------------------------
// Responsible for: window creation, session setup, ad-blocking, scheduled
// backup trigger, and app lifecycle. All heavy IPC logic lives in src/ipc/.

const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  webContents,
  Notification,
} = require("electron");
const path = require("path");

// -- RAM / performance flags ---------------------------------------------------
app.commandLine.appendSwitch(
  "js-flags",
  "--max-old-space-size=256 --expose-gc",
);
app.commandLine.appendSwitch(
  "disable-features",
  "HardwareMediaKeyHandling,MediaSessionService,UseSandboxedXdgPortal",
);
// Run the network stack in the browser process → one less utility process
app.commandLine.appendSwitch("enable-features", "NetworkServiceInProcess2");
// NOTE: enable-low-end-device-mode removed, it cuts the GPU texture tile budget
// and causes visible seams/stripes/dots on large images.

// Cap disk cache and limit renderer processes (prevents RAM growth on multi-page navigation)
app.commandLine.appendSwitch("disk-cache-size", String(80 * 1024 * 1024));
app.commandLine.appendSwitch("renderer-process-limit", "3");

// -- Startup benchmark ---------------------------------------------------------
const _t0 = Date.now();
const _bench = (label) =>
  console.log(`[boot] ${label}: +${Date.now() - _t0}ms`);

// -- Sub-modules ---------------------------------------------------------------
const blockStats = require("./src/ipc/blockStats");
const storageIpc = require("./src/ipc/storage");
const downloadsIpc = require("./src/ipc/downloads");
const subtitlesIpc = require("./src/ipc/subtitles");
const allmangaIpc = require("./src/ipc/allmanga");
const playerIpc = require("./src/ipc/player");

// -- Ad/tracker block list -----------------------------------------------------
const BLOCKED_HOSTS = [
  "*://www.google-analytics.com/*",
  "*://analytics.google.com/*",
  "*://googletagmanager.com/*",
  "*://www.googletagmanager.com/*",
  "*://googletagservices.com/*",
  "*://doubleclick.net/*",
  "*://*.doubleclick.net/*",
  "*://adservice.google.com/*",
  "*://adservice.google.de/*",
  "*://pagead2.googlesyndication.com/*",
  "*://stats.g.doubleclick.net/*",
  "*://yt3.ggpht.com/ytc/*",
  "*://fonts.googleapis.com/*",
  "*://fonts.gstatic.com/*",
  "*://googleapis.com/*",
  "*://gstatic.com/*",
  "*://cdn.adx1.com/*",
  "*://intelligenceadx.com/*",
  "*://adsco.re/*",
  "*://mc.yandex.com/*",
  "*://mc.yandex.ru/*",
  "*://bvtpk.com/*",
  "*://my.rtmark.net/*",
  "*://bvtpk.com/*",
  "*://b7510.com/*",
  "*://gt.unbrownunflat.com/*",
  "*://im.malocacomals.com/*",
  "*://users.videasy.net/*",
  "*://nf.sixmossin.com/*",
  "*://realizationnewestfangs.com/*",
  "*://acscdn.com/*",
  "*://lt.taloseempest.com/*",
  "*://pl26708123.profitableratecpm.com/*",
  "*://preferencenail.com/*",
  "*://protrafficinspector.com/*",
  "*://s10.histats.com/*",
  "*://weirdopt.com/*",
  "*://static.cloudflareinsights.com/*",
  "*://kettledroopingcontinuation.com/*",
  "*://wayfarerorthodox.com/*",
  "*://woxaglasuy.net/*",
  "*://adeptspiritual.com/*",
  "*://www.calculating-laugh.com/*",
  "*://amavhxdlofklxjg.xyz/*",
  "*://7jtjubf8p5kq7x3z2.u3qleufcm6vure326ktfpbj.cfd/*",
  "*://5mq.get64t9vqg8pnbex1y463o.rest/*",
  "*://usrpubtrk.com/*",
  "*://adexchangeclear.com/*",
  "*://rzjzjnavztycv.online/*",
  "*://tmstr4.cloudnestra.com/*",
  "*://tmstr4.neonhorizonworkshops.com/*",
];

// -- Module-level state --------------------------------------------------------
let mainWindow = null;
const getMainWindow = () => mainWindow;

const playerWcIds = new Set();
let sessionsConfigured = false;

function setupSession(playerSession, trailerSession) {
  const stripHeaders = (details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === "x-frame-options" || lower === "content-security-policy")
        delete headers[key];
    }
    callback({ responseHeaders: headers });
  };

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  playerSession.setUserAgent(UA);
  trailerSession.setUserAgent(UA);

  playerSession.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    stripHeaders,
  );
  trailerSession.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    stripHeaders,
  );

  // Trailer: block ads only (no media intercept needed)
  trailerSession.webRequest.onBeforeRequest({ urls: BLOCKED_HOSTS }, (_, cb) =>
    cb({ cancel: true }),
  );

  // Player session: block ads + intercept m3u8/vtt URLs for renderer
  const MEDIA_URLS = [
    "*://*/*.m3u8*",
    "*://*/*.m3u8",
    "*://*/*.vtt*",
    "*://*/*.vtt",
  ];
  playerSession.webRequest.onBeforeRequest(
    { urls: [...BLOCKED_HOSTS, ...MEDIA_URLS] },
    (details, callback) => {
      const { url } = details;
      const isMedia = url.includes(".m3u8") || url.includes(".vtt");
      if (!isMedia) {
        blockStats.recordBlockedRequest(url);
        callback({ cancel: true });
        return;
      }
      // Media URL: check if it also happens to be on a blocked domain
      try {
        const host = new URL(url).hostname;
        const blocked = BLOCKED_HOSTS.some((pat) => {
          const hostPat = pat.replace(/^\*:\/\//, "").split("/")[0];
          return hostPat.startsWith("*.")
            ? host.endsWith(hostPat.slice(1))
            : host === hostPat || host === hostPat.replace(/^\*\./, "");
        });
        if (blocked) {
          blockStats.recordBlockedRequest(url);
          callback({ cancel: true });
          return;
        }
      } catch {}
      // Pass through + notify renderer
      const mw = getMainWindow();
      if (mw && !mw.isDestroyed()) {
        if (url.includes(".m3u8")) {
          mw.webContents.send("m3u8-found", url);
        } else if (url.includes(".vtt")) {
          const { extractSubtitleLang } = require("./src/ipc/subtitles");
          mw.webContents.send("subtitle-found", {
            url,
            lang: extractSubtitleLang(url),
          });
        }
      }
      callback({});
    },
  );

  // YouTube consent cookie → suppress consent gate in both sessions
  const ytCookie = {
    url: "https://www.youtube.com",
    name: "SOCS",
    value: "CAI",
    path: "/",
    secure: true,
    httpOnly: false,
    sameSite: "no_restriction",
    expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 2,
  };
  for (const domain of [".youtube.com", ".youtube-nocookie.com"]) {
    const cookie = { ...ytCookie, domain };
    trailerSession.cookies.set(cookie).catch(() => {});
    playerSession.cookies.set(cookie).catch(() => {});
  }
}

function createWindow() {
  storageIpc.applySecretMigrationIfNeeded();
  downloadsIpc.loadDownloads();
  blockStats.loadBlockStats();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    icon:
      process.platform === "linux"
        ? path.join(__dirname, "public/sized/256x256.png")
        : undefined,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    frame: process.platform !== "win32",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: true,
      spellcheck: false,
      // Caps the renderer's V8 heap + exposes gc() for manual GC hints after navigation
      additionalArguments: ["--js-flags=--max-old-space-size=256 --expose-gc"],
    },
  });

  // Force long-lived disk caching for TMDB images in the default session.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["*://image.tmdb.org/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      headers["cache-control"] = ["public, max-age=604800, immutable"]; // 7 days
      delete headers["pragma"];
      delete headers["expires"];
      callback({ responseHeaders: headers });
    },
  );

  // -- Lazy session setup ----------------------------------------------------
  // Player/trailer sessions are configured on the first webview attach or
  // when the pop-out window opens, whichever comes first.

  // Block popups from webviews, intercept fullscreen, lazy-init sessions
  mainWindow.webContents.on("did-attach-webview", (_, wc) => {
    if (!sessionsConfigured) {
      sessionsConfigured = true;
      const playerSession = session.fromPartition("persist:player");
      const trailerSession = session.fromPartition("persist:trailer");
      setupSession(playerSession, trailerSession);
    }

    // Track player webviews for cleanup on player-stopped
    try {
      if (wc.session === session.fromPartition("persist:player")) {
        playerWcIds.add(wc.id);
        wc.once("destroyed", () => playerWcIds.delete(wc.id));
      }
    } catch {}

    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("enter-html-full-screen", () =>
      mainWindow.webContents.send("webview-enter-fullscreen"),
    );
    wc.on("leave-html-full-screen", () =>
      mainWindow.webContents.send("webview-leave-fullscreen"),
    );
  });

  mainWindow.loadFile(path.join(__dirname, "dist/index.html"));

  // Trigger scheduled backup after load
  mainWindow.webContents.once("did-finish-load", () => {
    _bench("renderer loaded");
    const sbSettings = storageIpc.loadScheduledBackupSettings();
    if (storageIpc.shouldRunScheduledBackup(sbSettings)) {
      mainWindow.webContents.send("scheduled-backup-requested");
    }
  });

  // Intercept close if downloads are active
  let closeResponsePending = false;
  mainWindow.on("close", (e) => {
    const running = downloadsIpc
      .getDownloads()
      .filter((d) => d.status === "downloading");
    if (running.length === 0) return;
    e.preventDefault();
    if (closeResponsePending) return;
    closeResponsePending = true;
    mainWindow.webContents.send("confirm-close", { count: running.length });
  });

  ipcMain.on("close-response", (_, confirmed) => {
    closeResponsePending = false;
    if (confirmed) {
      downloadsIpc.killAllDownloads();
      mainWindow.destroy();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

// -- Register all IPC modules --------------------------------------------------
storageIpc.register();
downloadsIpc.register(getMainWindow);
subtitlesIpc.register({
  getDownloads: downloadsIpc.getDownloads,
  saveDownloads: downloadsIpc.saveDownloads,
});
allmangaIpc.register();
playerIpc.register(getMainWindow, {
  writeSecretMigration: storageIpc.writeSecretMigration,
});
blockStats.init(getMainWindow);

// get-block-stats lives with its data
ipcMain.handle("get-block-stats", () => blockStats.getBlockStats());

// -- Player memory cleanup ---------------------------------------------
// Called by MoviePage / TVPage on component unmount.
// Destroys the player webview WebContents by tracked ID, then flushes caches and GCs.
ipcMain.on("player-stopped", () => {
  // Step 1: Mute + destroy all tracked player WebContents by ID.
  for (const id of playerWcIds) {
    try {
      const wc = webContents.fromId(id);
      if (wc && !wc.isDestroyed()) {
        try {
          wc.setAudioMuted(true);
        } catch {}
        wc.destroy();
      }
    } catch {}
  }
  playerWcIds.clear();

  // Step 2: Flush HTTP + shader caches from the player session.
  try {
    const ps = session.fromPartition("persist:player");
    ps.clearCache().catch(() => {});
    ps.clearStorageData({ storages: ["shadercache", "cachestorage"] }).catch(
      () => {},
    );
  } catch {}

  // Step 3: GC hints
  if (typeof global.gc === "function") global.gc();
  const mw = mainWindow;
  if (mw && !mw.isDestroyed()) {
    mw.webContents
      .executeJavaScript("if(typeof gc==='function') gc();")
      .catch(() => {});
  }
});

// -- Desktop notifications -----------------------------------------------------
// Called from the renderer whenever it wants a native OS notification.
ipcMain.handle(
  "show-notification",
  (_event, { title, body, silent = false }) => {
    try {
      if (!Notification.isSupported()) return;
      const n = new Notification({
        title: String(title),
        body: String(body),
        silent,
      });
      n.show();
    } catch {}
  },
);

// -- Picture-in-Picture / Pop-Out window --------------------------------------
// Opens the player URL in a small always-on-top BrowserWindow (full site UI,
// with subtitles and controls). The Main Window closes the stream to avoid duplication.
let pipWindow = null;
const getPipWindow = () => pipWindow;

ipcMain.handle("open-pip-window", (_, { url, title }) => {
  if (!url || url === "about:blank") return { ok: false, reason: "no-url" };

  // Guarantee tracker/ad blocking is active in persist:player before any load
  if (!sessionsConfigured) {
    sessionsConfigured = true;
    const playerSession = session.fromPartition("persist:player");
    const trailerSession = session.fromPartition("persist:trailer");
    setupSession(playerSession, trailerSession);
  }

  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.loadURL(url);
    pipWindow.focus();
    return { ok: true };
  }

  pipWindow = new BrowserWindow({
    width: 640,
    height: 360,
    minWidth: 320,
    minHeight: 180,
    alwaysOnTop: true,
    title: title ? `${title} - Pop-out` : "Pop-out Player",
    backgroundColor: "#000000",
    // Same custom title bar as the main window
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    frame: process.platform !== "win32",
    webPreferences: {
      partition: "persist:player",
      nodeIntegration: false,
      contextIsolation: true,
      // Injects the custom title bar and wires window-control IPC
      preload: path.join(__dirname, "popout-preload.js"),
    },
  });

  // Block all popup windows from the streaming site and any nested frames
  pipWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // If the site uses <webview> elements (unlikely but safe), block there too
  pipWindow.webContents.on("did-attach-webview", (_, wc) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  pipWindow.loadURL(url);

  // Push maximize state into the popout renderer so the title bar icon updates
  pipWindow.on("maximize", () => {
    if (!pipWindow.isDestroyed())
      pipWindow.webContents.send("popout-window-maximized", true);
  });
  pipWindow.on("unmaximize", () => {
    if (!pipWindow.isDestroyed())
      pipWindow.webContents.send("popout-window-maximized", false);
  });

  const notifyMain = (channel) => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.webContents.send(channel);
  };

  pipWindow.on("closed", () => {
    pipWindow = null;
    notifyMain("pip-window-closed");
  });

  notifyMain("pip-window-opened");
  return { ok: true };
});

ipcMain.handle("close-pip-window", () => {
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
});

ipcMain.handle("get-pip-webcontents-id", () => {
  if (pipWindow && !pipWindow.isDestroyed()) return pipWindow.webContents.id;
  return null;
});

// -- Popout window controls (used by popout-preload.js title bar buttons) -----
ipcMain.handle("popout-window-minimize", () => {
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.minimize();
});
ipcMain.handle("popout-window-toggle-maximize", () => {
  if (!pipWindow || pipWindow.isDestroyed()) return;
  if (pipWindow.isMaximized()) pipWindow.unmaximize();
  else pipWindow.maximize();
});
ipcMain.handle("popout-window-close", () => {
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
});
ipcMain.handle("popout-window-is-maximized", () => {
  return pipWindow && !pipWindow.isDestroyed()
    ? pipWindow.isMaximized()
    : false;
});

// -- Single-instance lock ------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    _bench("app ready");
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (mainWindow === null) createWindow();
  });
}
