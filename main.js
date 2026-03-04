const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  dialog,
  safeStorage,
} = require("electron");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

// ── Block stats store ─────────────────────────────────────────────────────────
const blockStatsFile = () =>
  path.join(app.getPath("userData"), "blockStats.json");

let allBlockStats = { total: 0, domains: {} };
let pendingBlockBatch = null; // { total, domains } or null
let blockBatchTimer = null;
let blockSaveTimer = null;

function loadBlockStats() {
  try {
    const raw = fs.readFileSync(blockStatsFile(), "utf8");
    const parsed = JSON.parse(raw);
    allBlockStats = {
      total: parsed.total || 0,
      domains: parsed.domains || {},
    };
  } catch {
    allBlockStats = { total: 0, domains: {} };
  }
}

function saveBlockStats() {
  try {
    fs.writeFileSync(
      blockStatsFile(),
      JSON.stringify({
        total: allBlockStats.total,
        domains: allBlockStats.domains,
      }),
    );
  } catch {}
}

function recordBlockedRequest(url) {
  let domain;
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return;
  }

  // Update alltime in-memory
  allBlockStats.total++;
  allBlockStats.domains[domain] = (allBlockStats.domains[domain] || 0) + 1;

  // Accumulate into pending batch
  if (!pendingBlockBatch) {
    pendingBlockBatch = { total: 0, domains: {} };
  }
  pendingBlockBatch.total++;
  pendingBlockBatch.domains[domain] =
    (pendingBlockBatch.domains[domain] || 0) + 1;

  // Debounced IPC send to renderer (250ms after last block in burst)
  if (blockBatchTimer) clearTimeout(blockBatchTimer);
  blockBatchTimer = setTimeout(() => {
    blockBatchTimer = null;
    if (mainWindow && !mainWindow.isDestroyed() && pendingBlockBatch) {
      mainWindow.webContents.send("blocked-stats-update", pendingBlockBatch);
    }
    pendingBlockBatch = null;
  }, 250);

  // Debounced disk write (3s to reduce I/O during active playback)
  if (blockSaveTimer) clearTimeout(blockSaveTimer);
  blockSaveTimer = setTimeout(saveBlockStats, 3000);
}

// ── Download store ────────────────────────────────────────────────────────────
let downloads = [];
const downloadsFile = () =>
  path.join(app.getPath("userData"), "downloads.json");

// Track running child processes by download id
const activeProcs = new Map();

// ── Secure key/value store (OS-level encryption via safeStorage) ──────────────
// Falls back to plain JSON when encryption is unavailable (rare Linux setups).
const secureStoreFile = () =>
  path.join(app.getPath("userData"), "secure-store.json");

function readSecureStore() {
  try {
    return JSON.parse(fs.readFileSync(secureStoreFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeSecureStore(data) {
  fs.writeFileSync(secureStoreFile(), JSON.stringify(data));
}

function secureStoreGet(key) {
  const store = readSecureStore();
  const raw = store[key];
  if (!raw) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(raw, "base64"));
    }
    // Fallback: stored as plain base64-encoded UTF-8
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function secureStoreSet(key, value) {
  const store = readSecureStore();
  if (value === null || value === undefined || value === "") {
    delete store[key];
  } else {
    if (safeStorage.isEncryptionAvailable()) {
      store[key] = safeStorage.encryptString(value).toString("base64");
    } else {
      store[key] = Buffer.from(value, "utf8").toString("base64");
    }
  }
  writeSecureStore(store);
}

const PART_FILE_SUFFIXES = [
  ".part",
  ".ytdl",
  /\.part-Frag\d+$/,
  /\.part\.\d+$/,
  /\.part\.tmp$/,
  /\.tmp$/,
];

function loadDownloads() {
  try {
    const raw = fs.readFileSync(downloadsFile(), "utf8");
    const parsed = JSON.parse(raw);
    // Deduplicate: keep only the newest entry per (tmdbId, mediaType, season, episode)
    const seen = new Map();
    const sorted = [...parsed].sort(
      (a, b) =>
        (b.completedAt || b.startedAt || 0) -
        (a.completedAt || a.startedAt || 0),
    );
    for (const d of sorted) {
      const key =
        d.tmdbId && d.mediaType
          ? `${d.tmdbId}|${d.mediaType}|${d.season ?? ""}|${d.episode ?? ""}`
          : d.id; // no tmdbId → use id so it's always kept
      if (!seen.has(key)) seen.set(key, d);
    }
    downloads = [...seen.values()];
  } catch {
    downloads = [];
  }
}

function saveDownloads() {
  try {
    const toSave = downloads.filter(
      (d) => d.status !== "downloading" && d.status !== "error",
    );
    fs.writeFileSync(downloadsFile(), JSON.stringify(toSave, null, 2));
  } catch {}
}

function sendProgress(update) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("download-progress", update);
  }
}

// ── ZIP subtitle extractor (shared by get-subtitle-url and download-subtitles-for-file) ──
const zlib = require("zlib");
function extractFirstSubtitleFromZip(buf) {
  let offset = 0;
  while (offset < buf.length - 30) {
    if (
      buf[offset] === 0x50 &&
      buf[offset + 1] === 0x4b &&
      buf[offset + 2] === 0x03 &&
      buf[offset + 3] === 0x04
    ) {
      const compression = buf.readUInt16LE(offset + 8);
      const compressedSize = buf.readUInt32LE(offset + 18);
      const fileNameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const fileName = buf
        .slice(offset + 30, offset + 30 + fileNameLen)
        .toString("utf8");
      const dataOffset = offset + 30 + fileNameLen + extraLen;
      const ext = fileName.toLowerCase().split(".").pop();
      if (ext === "srt" || ext === "vtt" || ext === "ass" || ext === "ssa") {
        const compressedData = buf.slice(
          dataOffset,
          dataOffset + compressedSize,
        );
        let data;
        if (compression === 0) {
          data = compressedData;
        } else if (compression === 8) {
          try {
            data = zlib.inflateRawSync(compressedData);
          } catch {
            offset = dataOffset + compressedSize;
            continue;
          }
        } else {
          offset = dataOffset + compressedSize;
          continue;
        }
        return { data, name: fileName };
      }
      offset = dataOffset + compressedSize;
    } else {
      offset++;
    }
  }
  return null;
}

// ── Ad/tracker block list ─────────────────────
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

// ── Window ────────────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  loadDownloads();
  loadBlockStats();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // Videasy session: strip CSP/X-Frame-Options and capture m3u8 URLs
  const videasySession = session.fromPartition("persist:videasy");

  videasySession.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  );

  videasySession.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === "x-frame-options" || lower === "content-security-policy")
          delete headers[key];
      }
      callback({ responseHeaders: headers });
    },
  );

  // Block Google tracking & analytics + videasy trackers
  // Defined here so both videasy and trailer sessions can use the same list

  // ── Combined request interceptor ─────────────────────────────────────────
  // NOTE: Electron allows only ONE onBeforeRequest handler per session.
  // blocked domains and media URLs, then branches in JS.
  const MEDIA_URLS = [
    "*://*/*.m3u8*",
    "*://*/*.m3u8",
    "*://*/*.vtt*",
    "*://*/*.vtt",
  ];
  videasySession.webRequest.onBeforeRequest(
    { urls: [...BLOCKED_HOSTS, ...MEDIA_URLS] },
    (details, callback) => {
      const { url } = details;
      const isMedia = url.includes(".m3u8") || url.includes(".vtt");
      if (!isMedia) {
        // Matched a BLOCKED_HOSTS pattern → cancel and record
        recordBlockedRequest(url);
        callback({ cancel: true });
        return;
      }
      // Media URL, also check if it happens to be on a blocked domain
      const urlObj = (() => {
        try {
          return new URL(url);
        } catch {
          return null;
        }
      })();
      if (urlObj) {
        const host = urlObj.hostname;
        const blocked = BLOCKED_HOSTS.some((pat) => {
          const hostPat = pat.replace(/^\*:\/\//, "").split("/")[0];
          if (hostPat.startsWith("*.")) {
            return host.endsWith(hostPat.slice(1));
          }
          return host === hostPat || host === hostPat.replace(/^\*\./, "");
        });
        if (blocked) {
          recordBlockedRequest(url);
          callback({ cancel: true });
          return;
        }
      }
      // Pass through and notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (url.includes(".m3u8")) {
          mainWindow.webContents.send("m3u8-found", url);
        } else if (url.includes(".vtt")) {
          mainWindow.webContents.send("subtitle-found", {
            url,
            lang: extractSubtitleLang(url),
          });
        }
      }
      callback({});
    },
  );

  // Trailer session: strip X-Frame-Options/CSP so YouTube plays in-app
  const trailerSession = session.fromPartition("persist:trailer");

  trailerSession.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  );

  trailerSession.webRequest.onBeforeRequest(
    { urls: BLOCKED_HOSTS },
    (_, callback) => {
      callback({ cancel: true });
    },
  );

  trailerSession.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === "x-frame-options" || lower === "content-security-policy")
          delete headers[key];
      }
      callback({ responseHeaders: headers });
    },
  );

  // Pre-set YouTube consent cookie so tracking/cookie consent popup never appears
  // "SOCS=CAI" is the minimal value
  // YouTube recognises as "reject non-essential cookies", should supress Consent-Gate
  const youtubeDomains = [".youtube.com", ".youtube-nocookie.com"];
  for (const domain of youtubeDomains) {
    const ytCookie = {
      url: "https://www.youtube.com",
      domain,
      name: "SOCS",
      value: "CAI",
      path: "/",
      secure: true,
      httpOnly: false,
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 2, // 2 years
      sameSite: "no_restriction",
    };
    // Set for both sessions: trailer (YouTube trailers) and videasy (AllManga YouTube embeds)
    trailerSession.cookies.set(ytCookie).catch(() => {});
    videasySession.cookies.set(ytCookie).catch(() => {});
  }

  function cleanupTempFiles(downloadPath) {
    if (!downloadPath) return;
    const TEMP_PATTERNS = [
      /\.part$/,
      /\.part\.\d+$/,
      /\.part\.tmp$/,
      /\.tmp$/,
      /\.ytdl$/,
      /\.part-Frag\d+$/,
    ];
    try {
      const entries = fs.readdirSync(downloadPath);
      for (const entry of entries) {
        if (TEMP_PATTERNS.some((p) => p.test(entry))) {
          try {
            fs.unlinkSync(path.join(downloadPath, entry));
          } catch {}
        }
      }
    } catch {}
  }

  function killAllDownloads() {
    for (const [id, proc] of activeProcs.entries()) {
      try {
        proc.kill("SIGKILL");
      } catch {}
      // Mark as error in store
      const idx = downloads.findIndex((d) => d.id === id);
      if (idx !== -1) {
        downloads[idx].status = "error";
        downloads[idx].lastMessage = "Cancelled on exit";
      }
      activeProcs.delete(id);
    }
    // Clean up temp files for all known download folders
    const folders = new Set(
      downloads.map((d) => d.downloadPath).filter(Boolean),
    );
    for (const folder of folders) cleanupTempFiles(folder);
    saveDownloads();
  }

  // Block any popup windows spawned by webviews in trailer view
  // Also intercept fullscreen requests so only the player goes fullscreen,
  mainWindow.webContents.on("did-attach-webview", (_, webviewContents) => {
    webviewContents.setWindowOpenHandler(() => ({ action: "deny" }));

    webviewContents.on("enter-html-full-screen", () => {
      mainWindow.webContents.send("webview-enter-fullscreen");
    });
    webviewContents.on("leave-html-full-screen", () => {
      mainWindow.webContents.send("webview-leave-fullscreen");
    });
  });

  mainWindow.loadFile(path.join(__dirname, "dist/index.html"));

  // Intercept close, ask user if downloads are running
  let closeResponsePending = false;

  mainWindow.on("close", (e) => {
    const running = downloads.filter((d) => d.status === "downloading");
    if (running.length === 0) return; // no downloads, close normally

    e.preventDefault();
    if (closeResponsePending) return; // already waiting for a response, don't stack

    closeResponsePending = true;
    mainWindow.webContents.send("confirm-close", { count: running.length });
  });

  // Single persistent listener, never re-registers
  ipcMain.on("close-response", (_, confirmed) => {
    closeResponsePending = false;
    if (confirmed) {
      killAllDownloads();
      mainWindow.destroy();
    }
    // else: stay open
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

// ── Single-Instance Lock ──────────────────────────────────────────────────────
// Prevents the app from being opened twice.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running → quit right away
  app.quit();
} else {
  // Focus / restore the existing window when the user tries to open a second instance
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (mainWindow === null) createWindow();
  });
}

// ── Subtitle language extractor ───────────────────────────────────────────────
function extractSubtitleLang(url) {
  try {
    const u = new URL(url);
    for (const param of ["lang", "language", "locale", "sub", "l"]) {
      const v = u.searchParams.get(param);
      if (v && v.length >= 2 && v.length <= 20) return v.toLowerCase();
    }
    const pathname = u.pathname;
    const filename = pathname.split("/").filter(Boolean).pop() || "";
    const fileMatch = filename.match(/[._-]([a-z]{2,3})[._-]?(vtt|srt|ass)?$/i);
    if (fileMatch) return fileMatch[1].toLowerCase();
    const segments = pathname.split("/").filter(Boolean);
    for (const seg of segments.slice(0, -1)) {
      if (/^[a-z]{2,3}(-[A-Z]{2})?$/.test(seg)) return seg.toLowerCase();
    }
  } catch {}
  return "unknown";
}

// ── Subtitle file downloader ──────────────────────────────────────────────────
// Downloads a .vtt or .srt file to destPath. Returns true on success.
function downloadSubtitleFile(url, destPath) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol === "file:") {
        try {
          const src = decodeURIComponent(parsedUrl.pathname);
          fs.copyFileSync(src, destPath);
          resolve(true);
        } catch {
          resolve(false);
        }
        return;
      }
      const lib = parsedUrl.protocol === "https:" ? https : http;
      const req = lib.get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
            Referer: parsedUrl.origin,
            Accept: "*/*",
          },
        },
        (res) => {
          // Follow one level of redirect
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const loc = res.headers.location.startsWith("http")
              ? res.headers.location
              : parsedUrl.origin + res.headers.location;
            downloadSubtitleFile(loc, destPath).then(resolve);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            resolve(false);
            return;
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve(true);
          });
          file.on("error", () => {
            try {
              fs.unlinkSync(destPath);
            } catch {}
            resolve(false);
          });
          res.on("error", () => resolve(false));
        },
      );
      req.on("error", () => resolve(false));
      req.setTimeout(20000, () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

// ── IPC: downloader binary detection ─────────────────────────────────────────
ipcMain.handle("check-downloader", (_, folderPath) => {
  if (!folderPath) return { exists: false };
  try {
    const entries = fs.readdirSync(folderPath);
    const hasInternal = entries.includes("_internal");
    if (!hasInternal) return { exists: false };
    const binary = entries.find((e) => {
      if (e === "_internal" || e.startsWith(".")) return false;
      try {
        return fs.statSync(path.join(folderPath, e)).isFile();
      } catch {
        return false;
      }
    });
    const binaryPath = binary ? path.join(folderPath, binary) : null;
    return { exists: !!binaryPath, binaryPath };
  } catch {
    return { exists: false };
  }
});

// ── IPC: start download ───────────────────────────────────────────────────────
ipcMain.handle(
  "run-download",
  (
    _,
    {
      binaryPath,
      m3u8Url,
      name,
      downloadPath,
      mediaId,
      mediaType,
      season,
      episode,
      posterPath,
      tmdbId,
      subtitles,
    },
  ) => {
    try {
      const id = crypto.randomUUID();

      const entry = {
        id,
        name,
        m3u8Url,
        downloadPath,
        filePath: null,
        status: "downloading",
        progress: 0,
        speed: "",
        size: "",
        totalFragments: 0,
        completedFragments: 0,
        lastMessage: "Starting…",
        startedAt: Date.now(),
        completedAt: null,
        mediaId: mediaId || null,
        mediaType: mediaType || null,
        season: season || null,
        episode: episode || null,
        posterPath: posterPath || null,
        tmdbId: tmdbId || mediaId || null,
        subtitles: Array.isArray(subtitles) ? subtitles : [],
        subtitlePaths: [], // [{lang, path}] filled after download completes
      };
      downloads.push(entry);

      // Remove any stale entries for the same media (e.g. file deleted externally
      // and re-downloaded before the renderer's fileExists check could clean up).
      // Keep only the freshly created entry when tmdbId + type + season + episode match.
      const isSameMedia = (d) =>
        d.id !== id &&
        d.tmdbId &&
        d.tmdbId === entry.tmdbId &&
        d.mediaType === entry.mediaType &&
        String(d.season ?? "") === String(entry.season ?? "") &&
        String(d.episode ?? "") === String(entry.episode ?? "");
      downloads = downloads.filter((d) => !isSameMedia(d));
      // Do NOT call sendProgress here. The renderer adds the initial entry via
      // handleDownloadStarted() after invoke() resolves. Calling sendProgress()
      // synchronously inside the handler causes the event to arrive at the renderer
      // BEFORE invoke() resolves, so the renderer adds it via onDownloadProgress
      // AND again via handleDownloadStarted, resulting in two cards.

      const args = [
        "--cli",
        m3u8Url,
        "-f",
        "mp4 (with Audio)",
        "-r",
        "best",
        "-b",
        "320",
        "-n",
        name,
        "-d",
        downloadPath,
      ];

      const proc = spawn(binaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      activeProcs.set(id, proc);

      // ── Per-download line parser ───────────────────────────────────────────
      //
      // Actual binary output (uses \r between updates, we split on \r|\n):
      //
      //   [hlsnative] Total fragments: 672
      //   [download] Destination: /home/user/aW5k….mp4
      //   [download] /home/user/file.part-Frag4 has already been downloaded
      //   Downloading: 0.31% (2939944/938676480.0 bytes)/s ETA Unknown (frag 4/672)
      //   [download]   0.8% of ~ 352.64MiB at 3.2MiB/s ETA 01:50 (frag 6/672)
      //   Downloading: 2.23% (2943016/131755366.4 bytes) ... (frag 15/672)
      //   ...
      //
      // Key insight: "(frag N/total)" appears in BOTH "Downloading:" and "[download]"
      // lines. The leading "Downloading: X%" is byte-level progress within the
      // current fragment (oscillates 0→100 per fragment), DO NOT use it for
      // overall progress. Use (frag N/total) exclusively.

      const handleLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const idx = downloads.findIndex((d) => d.id === id);
        if (idx === -1) return;

        // Build an update object by scanning the line for all known patterns.
        // Multiple patterns can match the same line (e.g. frag + speed + size).
        const update = {};

        // ── (frag N/total), THE source of truth for HLS overall progress ───
        // Appears as: "... (frag 4/672)" or "(frag 4/672)"
        const fragMatch = trimmed.match(/\(frag\s+(\d+)\/(\d+)\)/);
        if (fragMatch) {
          const currentFrag = parseInt(fragMatch[1]);
          const total = parseInt(fragMatch[2]);
          update.completedFragments = currentFrag;
          update.totalFragments = total;
          update.progress = Math.min(
            99,
            Math.round((currentFrag / total) * 100),
          );
          update.lastMessage = `Fragment ${currentFrag} / ${total}`;
        }

        // ── [download] X% of Y, direct mp4 HTTP download progress ──────────
        // e.g. "[download]  43.2% of  271.89MiB at  3.05MiB/s ETA 02:30"
        // Only use when there are no fragments (i.e. not HLS)
        if (!fragMatch && !downloads[idx].totalFragments) {
          const dlPctMatch = trimmed.match(
            /^\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*(?:[KMGT]i?B|B))/i,
          );
          if (dlPctMatch) {
            const pct = parseFloat(dlPctMatch[1]);
            update.progress = Math.min(99, Math.round(pct));
            update.size = dlPctMatch[2].trim();
            // Extract speed if present: "at X.XMiB/s"
            const spMatch = trimmed.match(
              /\bat\s+([\d.]+\s*(?:[KMGT]i?B|B)\/s)/i,
            );
            if (spMatch) update.speed = spMatch[1].trim();
            update.lastMessage = `${Math.round(pct)}% of ${update.size}`;
          }
        }

        // ── ffmpeg Duration line: "Duration: HH:MM:SS.xx" ───────────────────
        // Emitted early in ffmpeg stderr,  used to compute % from time=
        const durationMatch = trimmed.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (durationMatch) {
          const totalSecs =
            parseInt(durationMatch[1]) * 3600 +
            parseInt(durationMatch[2]) * 60 +
            parseFloat(durationMatch[3]);
          if (totalSecs > 0) {
            downloads[idx]._ffmpegTotalSecs = totalSecs;
          }
          return;
        }

        // ── ffmpeg progress: "size= 122880kB time=00:10:36.34 bitrate=..." ──
        const ffmpegMatch = trimmed.match(
          /size=\s*([\d.]+\s*\w+)\s+time=(\d+):(\d+):([\d.]+)/i,
        );
        if (ffmpegMatch) {
          const elapsedSecs =
            parseInt(ffmpegMatch[2]) * 3600 +
            parseInt(ffmpegMatch[3]) * 60 +
            parseFloat(ffmpegMatch[4]);
          const totalSecs = downloads[idx]._ffmpegTotalSecs || 0;
          if (totalSecs > 0) {
            update.progress = Math.min(
              99,
              Math.round((elapsedSecs / totalSecs) * 100),
            );
          }
          // Parse size: "122880kB" → convert to human-readable MiB
          const rawSize = ffmpegMatch[1].trim();
          const kbMatch = rawSize.match(/([\d.]+)\s*kB/i);
          if (kbMatch) {
            const mb = parseFloat(kbMatch[1]) / 1024;
            update.size =
              mb >= 1024
                ? `${(mb / 1024).toFixed(1)} GiB`
                : `${mb.toFixed(1)} MiB`;
          } else {
            update.size = rawSize;
          }
          // Parse speed: "speed=29.4x" → show as multiplier
          const speedXMatch = trimmed.match(/speed=\s*([\d.]+)x/i);
          if (speedXMatch) update.speed = `${speedXMatch[1]}x`;
          // Parse bitrate
          const bitrateMatch = trimmed.match(
            /bitrate=\s*([\d.]+\s*\S+bits\/s)/i,
          );
          if (bitrateMatch) {
            update.lastMessage = `Processing… ${update.size}${update.speed ? ` at ${update.speed}` : ""}`;
          } else {
            update.lastMessage = `Processing… ${update.size}`;
          }
        }

        // ── Retry / timeout, reset speed to 0, show status ─────────────────
        // Matches lines like: "[download] Got error: ... Retrying (1/100)..."
        // or "[yt-dlp DEBUG] Sleeping N seconds ..."
        const retryMatch =
          trimmed.match(/Retrying\s+\(\d+\/\d+\)/i) ||
          trimmed.match(/Got error:.*timed?\s*out/i) ||
          trimmed.match(/Read timed? out/i);
        if (retryMatch) {
          update.speed = "0 MB/s";
          const retryNumMatch = trimmed.match(/Retrying\s+\((\d+)\/(\d+)\)/i);
          update.lastMessage = retryNumMatch
            ? `Retrying… (${retryNumMatch[1]}/${retryNumMatch[2]})`
            : "Retrying…";
          downloads[idx] = { ...downloads[idx], ...update };
          sendProgress({ id, ...update, status: downloads[idx].status });
          return;
        }

        const speedMatch = trimmed.match(
          /\bat\s+([\d.]+\s*(?:[KMGT]i?B|B)\/s)/i,
        );
        if (speedMatch) update.speed = speedMatch[1].trim();

        // ── size: "of ~ X.XMiB" or "of X.XMiB" ─────────────────────────────
        const sizeMatch = trimmed.match(
          /\bof\s+~?\s*([\d.]+\s*(?:[KMGT]i?B|B))\b/i,
        );
        if (sizeMatch) update.size = sizeMatch[1].trim();

        // ── [hlsnative] Total fragments: N ───────────────────────────────────
        const fragTotalMatch = trimmed.match(/Total fragments:\s+(\d+)/);
        if (fragTotalMatch) {
          const total = parseInt(fragTotalMatch[1]);
          const u = {
            totalFragments: total,
            completedFragments: 0,
            lastMessage: `HLS: ${total} fragments`,
          };
          downloads[idx] = { ...downloads[idx], ...u };
          sendProgress({ id, ...u, status: downloads[idx].status });
          return;
        }

        // ── [download] Destination: /path/file ───────────────────────────────
        const destMatch = trimmed.match(/^\[download\] Destination:\s+(.+)/);
        if (destMatch) {
          const u = {
            filePath: destMatch[1].trim(),
            lastMessage: "Downloading…",
          };
          downloads[idx] = { ...downloads[idx], ...u };
          sendProgress({ id, ...u, status: downloads[idx].status });
          return;
        }

        // ── [Merger] output path ──────────────────────────────────────────────
        const mergeMatch = trimmed.match(
          /\[Merger\] Merging formats into "(.+)"/,
        );
        if (mergeMatch) {
          const u = {
            filePath: mergeMatch[1].trim(),
            lastMessage: "Merging…",
            progress: 99,
          };
          downloads[idx] = { ...downloads[idx], ...u };
          sendProgress({ id, ...u, status: downloads[idx].status });
          return;
        }

        // ── Send whatever we gathered (skip if nothing useful) ───────────────
        // Lines that should never surface in the UI
        const SUPPRESS_PATTERNS = [
          /Sleeping\s+[\d.]+\s+seconds/i,
          /^\[yt-dlp\s+DEBUG\]/i,
          /^\[debug\]/i,
        ];
        if (Object.keys(update).length === 0) {
          const suppress =
            downloads[idx].lastMessage.startsWith("Fragment") ||
            downloads[idx].lastMessage.startsWith("Retrying") ||
            SUPPRESS_PATTERNS.some((p) => p.test(trimmed));
          if (!suppress) {
            update.lastMessage = trimmed;
          }
        }

        if (Object.keys(update).length > 0) {
          downloads[idx] = { ...downloads[idx], ...update };
          sendProgress({ id, ...update, status: downloads[idx].status });
        }
      };

      let buf = "";
      proc.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        // Binary uses \r to overwrite lines in a terminal, split on all variants
        const lines = buf.split(/\r\n|\r|\n/);
        buf = lines.pop(); // hold incomplete last chunk
        lines.forEach(handleLine);
      });
      proc.stderr.on("data", (chunk) => {
        chunk
          .toString()
          .split(/\r\n|\r|\n/)
          .forEach(handleLine);
      });

      proc.on("close", (code) => {
        activeProcs.delete(id);
        if (buf.trim()) handleLine(buf.trim());
        const idx = downloads.findIndex((d) => d.id === id);
        if (idx !== -1) {
          // Status is determined ONLY by exit code, never by mid-stream messages
          const status = code === 0 ? "completed" : "error";
          downloads[idx].status = status;
          downloads[idx].completedAt = Date.now();
          if (code === 0) downloads[idx].progress = 100;

          // Try to detect output file if destination line wasn't caught
          if (code === 0 && !downloads[idx].filePath) {
            try {
              const VIDEO_EXTS = [
                ".mp4",
                ".mkv",
                ".webm",
                ".avi",
                ".ts",
                ".m4v",
              ];
              const match = fs
                .readdirSync(downloadPath)
                .filter((f) =>
                  VIDEO_EXTS.some((e) => f.toLowerCase().endsWith(e)),
                )
                .map((f) => ({
                  f,
                  mtime: fs.statSync(path.join(downloadPath, f)).mtimeMs,
                }))
                .sort((a, b) => b.mtime - a.mtime)[0];
              if (match)
                downloads[idx].filePath = path.join(downloadPath, match.f);
            } catch {}
          }

          // Rename file to proper media name (binary saves using URL-derived name)
          if (code === 0 && downloads[idx].filePath) {
            try {
              const ext = path.extname(downloads[idx].filePath) || ".mp4";
              // Sanitize: strip characters illegal in filenames on all platforms
              const safeName = name
                .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
                .replace(/\s+/g, " ")
                .trim();
              if (safeName) {
                const newPath = path.join(downloadPath, safeName + ext);
                if (newPath !== downloads[idx].filePath) {
                  fs.renameSync(downloads[idx].filePath, newPath);
                  downloads[idx].filePath = newPath;
                }
              }
            } catch {}
          }

          // Real file size from disk
          if (downloads[idx].filePath) {
            try {
              const bytes = fs.statSync(downloads[idx].filePath).size;
              downloads[idx].size =
                bytes > 1e9
                  ? (bytes / 1e9).toFixed(2) + " GB"
                  : bytes > 1e6
                    ? (bytes / 1e6).toFixed(1) + " MB"
                    : bytes > 1e3
                      ? (bytes / 1e3).toFixed(1) + " KB"
                      : bytes + " B";
            } catch {}
          }

          // Download all subtitle files with language in filename
          if (
            code === 0 &&
            downloads[idx].subtitles?.length > 0 &&
            downloads[idx].filePath
          ) {
            const videoBase = downloads[idx].filePath.replace(/\.[^.]+$/, "");
            const langCounter = {};
            const subPromises = downloads[idx].subtitles.map(
              ({ url, lang, name, file_id }) => {
                const KNOWN_SUB_EXTS = [
                  ".vtt",
                  ".srt",
                  ".ass",
                  ".ssa",
                  ".sub",
                  ".idx",
                ];
                // 1. Try URL itself (strip query/hash first)
                const urlClean = url.split("?")[0].split("#")[0];
                const urlExt = path
                  .extname(urlClean)
                  .toLowerCase()
                  .replace(/[^a-z0-9.]/g, "");
                // 2. Fallback: extract from name field (e.g. "Movie.Title.srt")
                const nameExt = name
                  ? path
                      .extname(name)
                      .toLowerCase()
                      .replace(/[^a-z0-9.]/g, "")
                  : "";
                const subExt = KNOWN_SUB_EXTS.includes(urlExt)
                  ? urlExt
                  : KNOWN_SUB_EXTS.includes(nameExt)
                    ? nameExt
                    : ".srt";
                const safeLang = (lang || "unknown").replace(
                  /[^a-z0-9_-]/gi,
                  "",
                );
                const lIdx = langCounter[safeLang] ?? 0;
                langCounter[safeLang] = lIdx + 1;
                const suffix = lIdx > 0 ? `.${lIdx}` : "";
                const subDestPath = `${videoBase}.${safeLang}${suffix}${subExt}`;
                return downloadSubtitleFile(url, subDestPath).then((ok) =>
                  ok
                    ? {
                        lang: lang || "unknown",
                        path: subDestPath,
                        file_id: file_id || null,
                      }
                    : null,
                );
              },
            );
            Promise.all(subPromises).then((results) => {
              const i2 = downloads.findIndex((d) => d.id === id);
              if (i2 !== -1) {
                downloads[i2].subtitlePaths = results.filter(Boolean);
                saveDownloads();
                sendProgress({
                  id,
                  subtitlePaths: downloads[i2].subtitlePaths,
                });
              }
            });
          }

          sendProgress({
            id,
            status: downloads[idx].status,
            progress: downloads[idx].progress,
            completedAt: downloads[idx].completedAt,
            filePath: downloads[idx].filePath,
            size: downloads[idx].size,
            completedFragments: downloads[idx].completedFragments,
            totalFragments: downloads[idx].totalFragments,
          });
          saveDownloads();
        }
      });

      return { ok: true, id };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
);

// ── IPC: delete a download ────────────────────────────────────────────────────
ipcMain.handle("get-downloads", () => downloads);

ipcMain.handle("delete-download", (_, { id, filePath }) => {
  try {
    const dlEntry = downloads.find((d) => d.id === id);

    // Kill the running process if active
    if (activeProcs.has(id)) {
      try {
        activeProcs.get(id).kill("SIGKILL");
      } catch {}
      activeProcs.delete(id);
    }

    // Delete the main video file
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }

    // Delete subtitle files
    for (const sp of dlEntry?.subtitlePaths || []) {
      try {
        if (sp?.path && fs.existsSync(sp.path)) fs.unlinkSync(sp.path);
      } catch {}
    }

    // Clean up temp/partial files in the download folder
    const dlPath = dlEntry?.downloadPath;
    if (dlPath) cleanupTempFiles(dlPath);

    downloads = downloads.filter((d) => d.id !== id);
    saveDownloads();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: show file in file manager ────────────────────────────────────────────
ipcMain.handle("show-in-folder", (_, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  } else {
    shell.openPath(path.dirname(filePath || ""));
  }
});

// ── IPC: check if file exists ────────────────────────────────────────────────
ipcMain.handle("file-exists", (_, filePath) => {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
});

// ── IPC: folder picker ────────────────────────────────────────────────────────
ipcMain.handle("pick-folder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Folder",
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── IPC: open external URL ────────────────────────────────────────────────────
ipcMain.handle("open-external", (_, url) => {
  shell.openExternal(url);
});

// ── IPC: open file with system default app ──────────────────────────────────
ipcMain.handle("open-path", (_, filePath) => {
  shell.openPath(filePath);
});

// ── IPC: open file at specific timestamp ─────────────────────────────────────
ipcMain.handle(
  "open-path-at-time",
  (_, { filePath, seconds, subtitlePaths }) => {
    const sec = Math.floor(seconds || 0);
    const platform = process.platform;

    // Resolve a binary to its full path synchronously.
    // For absolute paths: check fs.existsSync.
    // For bare names: use `which` (Linux/mac) or `where` (Windows) via spawnSync.
    const resolveBin = (bin) => {
      if (path.isAbsolute(bin)) {
        return fs.existsSync(bin) ? bin : null;
      }
      const whichCmd = platform === "win32" ? "where" : "which";
      try {
        const result = spawnSync(whichCmd, [bin], { encoding: "utf8" });
        if (result.status === 0 && result.stdout.trim()) {
          return result.stdout.trim().split("\n")[0].trim();
        }
      } catch {}
      return null;
    };

    const tryLaunch = (bin, args) => {
      const resolved = resolveBin(bin);
      if (!resolved) return false;
      try {
        const proc = spawn(resolved, args, { detached: true, stdio: "ignore" });
        proc.unref();
        return true;
      } catch {
        return false;
      }
    };

    const vlcPaths =
      platform === "win32"
        ? [
            "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
            "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
            "vlc",
          ]
        : platform === "darwin"
          ? ["/Applications/VLC.app/Contents/MacOS/VLC", "vlc"]
          : ["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc", "vlc"];

    const mpvPaths =
      platform === "win32"
        ? ["mpv", "C:\\Program Files\\mpv\\mpv.exe"]
        : platform === "darwin"
          ? ["/opt/homebrew/bin/mpv", "/usr/local/bin/mpv", "mpv"]
          : ["/usr/bin/mpv", "/usr/local/bin/mpv", "/snap/bin/mpv", "mpv"];

    // Build --sub-file= args for MPV from subtitlePaths (supports multiple subs)
    const subFilePaths = Array.isArray(subtitlePaths)
      ? subtitlePaths
          .map((sp) => (typeof sp === "string" ? sp : sp?.path))
          .filter((p) => p && fs.existsSync(p))
      : [];
    const mpvSubArgs = subFilePaths.map((p) => `--sub-file=${p}`);
    // VLC only supports a single --sub-file, use the first one
    const vlcSubArgs =
      subFilePaths.length > 0 ? [`--sub-file=${subFilePaths[0]}`] : [];

    if (sec > 0) {
      // Try mpv first
      for (const mpv of mpvPaths) {
        if (tryLaunch(mpv, [`--start=${sec}`, ...mpvSubArgs, filePath])) return;
      }
      // Try VLC
      for (const vlc of vlcPaths) {
        if (tryLaunch(vlc, [`--start-time=${sec}`, ...vlcSubArgs, filePath]))
          return;
      }
    } else {
      // No timestamp but still pass subtitles
      if (mpvSubArgs.length > 0) {
        for (const mpv of mpvPaths) {
          if (tryLaunch(mpv, [...mpvSubArgs, filePath])) return;
        }
        for (const vlc of vlcPaths) {
          if (tryLaunch(vlc, [...vlcSubArgs, filePath])) return;
        }
      }
    }

    // Fallback: open with default app (no timestamp)
    shell.openPath(filePath);
  },
);

// ── IPC: scan directory for video files ──────────────────────────────────────
ipcMain.handle("scan-directory", (_, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) return [];
    const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"];
    const results = [];
    const scanDir = (dir, depth = 0) => {
      if (depth > 3) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (VIDEO_EXTS.includes(ext)) {
            let size = "";
            try {
              const bytes = fs.statSync(fullPath).size;
              size =
                bytes > 1e9
                  ? (bytes / 1e9).toFixed(2) + " GB"
                  : bytes > 1e6
                    ? (bytes / 1e6).toFixed(1) + " MB"
                    : bytes > 1e3
                      ? (bytes / 1e3).toFixed(1) + " KB"
                      : bytes + " B";
            } catch {}
            results.push({
              filePath: fullPath,
              name: path.basename(entry.name, ext),
              size,
              ext,
            });
          }
        }
      }
    };
    scanDir(folderPath);
    return results;
  } catch {
    return [];
  }
});

// ── IPC: Clear browser cache ──────────────────────────────────────────────────
ipcMain.handle("clear-app-cache", async () => {
  try {
    const sessions = [
      session.defaultSession,
      session.fromPartition("persist:videasy"),
      session.fromPartition("persist:trailer"),
    ];
    await Promise.all(sessions.map((s) => s.clearCache()));
    await Promise.all(
      sessions.map((s) =>
        s.clearStorageData({
          storages: ["shadercache", "serviceworkers", "cachestorage"],
        }),
      ),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Clear watch progress & videasy partition data ────────────────────────
ipcMain.handle("clear-watch-data", async () => {
  try {
    const videasySession = session.fromPartition("persist:videasy");
    await videasySession.clearStorageData();
    await videasySession.clearCache();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Delete all downloads (files + registry) ──────────────────────────────
ipcMain.handle("delete-all-downloads", async () => {
  try {
    let deleted = 0,
      errors = 0;
    for (const dl of downloads) {
      if (dl.filePath) {
        try {
          if (fs.existsSync(dl.filePath)) {
            fs.unlinkSync(dl.filePath);
            deleted++;
          }
        } catch {
          errors++;
        }
      }
      for (const sp of dl.subtitlePaths || []) {
        try {
          if (sp?.path && fs.existsSync(sp.path)) fs.unlinkSync(sp.path);
        } catch {}
      }
    }
    downloads = [];
    saveDownloads();
    return { ok: true, deleted, errors };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Get cache size ───────────────────────────────────────────────────────
ipcMain.handle("get-cache-size", async () => {
  try {
    const sessions = [
      session.defaultSession,
      session.fromPartition("persist:videasy"),
      session.fromPartition("persist:trailer"),
    ];
    const sizes = await Promise.all(sessions.map((s) => s.getCacheSize()));
    return { bytes: sizes.reduce((a, b) => a + b, 0) };
  } catch (e) {
    return { bytes: 0 };
  }
});

// ── IPC: Get downloads total size on disk ─────────────────────────────────────
ipcMain.handle("get-downloads-size", () => {
  let bytes = 0;
  for (const dl of downloads) {
    if (dl.filePath) {
      try {
        const stat = fs.statSync(dl.filePath);
        if (stat.isFile()) bytes += stat.size;
      } catch {}
    }
  }
  return { bytes };
});

// ── IPC: Block stats ─────────────────────────────────────────────────────────
ipcMain.handle("get-block-stats", () => ({
  total: allBlockStats.total,
  domains: allBlockStats.domains,
}));

// ── IPC: App version ──────────────────────
ipcMain.handle("get-app-version", () => app.getVersion());

// ── IPC: Secure key store (safeStorage) ───────────────────────────────────────
ipcMain.handle("secure-store-get", (_, key) => {
  try {
    return { ok: true, value: secureStoreGet(key) };
  } catch (e) {
    return { ok: false, value: null };
  }
});

ipcMain.handle("secure-store-set", (_, { key, value }) => {
  try {
    secureStoreSet(key, value);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Subtitle search ──────────────────────────────────────────────────────
// Priority: SubDL (with API key) → Wyzie (always available, no key needed)
ipcMain.handle(
  "search-subtitles",
  async (_, { tmdbId, mediaType, season, episode, languages, subdlApiKey }) => {
    // Convert app language code (en/zh-CN) to SubDL uppercase code (EN/ZH)
    function toSubDLLang(lang) {
      if (!lang) return "";
      return lang.split("-")[0].toUpperCase();
    }

    // ── Helper: SubDL search ──────────────────────────────────────────────────
    async function searchSubDL() {
      try {
        const params = new URLSearchParams({
          api_key: subdlApiKey,
          tmdb_id: String(tmdbId),
          type: mediaType === "tv" ? "tv" : "movie",
          subs_per_page: "30",
        });
        if (mediaType === "tv" && season != null)
          params.set("season_number", String(season));
        if (mediaType === "tv" && episode != null)
          params.set("episode_number", String(episode));
        if (languages) params.set("languages", toSubDLLang(languages));

        const res = await fetch(
          `https://api.subdl.com/api/v1/subtitles?${params}`,
          {
            headers: { "User-Agent": "Streambert v1" },
            signal: AbortSignal.timeout(12000),
          },
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          return { ok: false, error: `SubDL error ${res.status}: ${errText}` };
        }
        const data = await res.json();
        if (!data.status)
          return { ok: false, error: "SubDL returned no results" };
        const results = (data.subtitles || []).map((s) => ({
          file_id: `subdl_${s.sd_id}_${encodeURIComponent(s.url)}`,
          file_name: s.name || s.release_name || "",
          language: (s.lang || "").toLowerCase(),
          release: s.release_name || s.name || "",
          uploader: s.author || "SubDL",
          download_count: s.downloads || 0,
          hearing_impaired: !!s.hi,
          ai_translated: false,
          machine_translated: false,
          ratings: 0,
          fps: null,
          from_trusted: false,
          via_subdl: true,
        }));
        if (results.length === 0)
          return { ok: false, error: "SubDL: no results" };
        return { ok: true, results, via_subdl: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // ── Helper: Wyzie Subs (no key required) ─────────────────────────────────
    async function searchWyzie() {
      try {
        const params = new URLSearchParams({
          id: String(tmdbId),
          format: "srt",
        });
        if (languages) params.set("language", languages);
        if (mediaType === "tv" && season != null)
          params.set("season", String(season));
        if (mediaType === "tv" && episode != null)
          params.set("episode", String(episode));
        const res = await fetch(`https://subs.wyzie.ru/search?${params}`, {
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) return { ok: false, error: `Wyzie error ${res.status}` };
        const data = await res.json();
        const results = (Array.isArray(data) ? data : [])
          .filter((r) => r.url)
          .map((r, i) => {
            const rawUrl = r.url || "";
            const fullUrl = rawUrl.startsWith("http")
              ? rawUrl
              : `https://subs.wyzie.ru${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
            const displayName =
              r.display_name ||
              r.name ||
              r.release_name ||
              r.title ||
              r.SubFileName ||
              r.fileName ||
              "";
            const lang = (r.language || "").toUpperCase();
            const hiTag = r.isHearingImpaired ? " [HI]" : "";
            const aiTag = r.isAiTranslated ? " [AI]" : "";
            const src = r.source ? ` · ${r.source}` : "";
            const fallback = `${lang} subtitle${hiTag}${aiTag}${src} #${i + 1}`;
            return {
              file_id: `wyzie_${i}_${encodeURIComponent(fullUrl)}`,
              direct_url: fullUrl,
              file_name: displayName || fallback,
              language: r.language || "",
              release: displayName || fallback,
              uploader: "Wyzie",
              download_count: 0,
              hearing_impaired: !!r.isHearingImpaired,
              ai_translated: !!r.isAiTranslated,
              machine_translated: false,
              ratings: 0,
              fps: null,
              from_trusted: false,
              via_wyzie: true,
              original_source: r.source || "",
            };
          });
        if (results.length === 0)
          return { ok: false, error: "Wyzie: no results" };
        return { ok: true, results, via_wyzie: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // ── Search priority chain ─────────────────────────────────────────────────
    // SubDL is used if an API key is configured (higher quality, Subscene library).
    // Wyzie Subs is always tried as default/fallback (no key required).
    const errors = [];

    if (subdlApiKey) {
      const r = await searchSubDL();
      if (r.ok) return r;
      errors.push(r.error);
    }

    const r = await searchWyzie();
    if (r.ok) return r;
    errors.push(r.error);

    return {
      ok: false,
      error:
        errors.length > 0
          ? errors.join(" · ")
          : "No subtitles found. Try a different language or add a SubDL API key in Settings.",
    };
  },
);

// ── IPC: Get subtitle download URL (handles SubDL ZIP and Wyzie direct) ──
ipcMain.handle("get-subtitle-url", async (_, { fileId }) => {
  try {
    // ── SubDL: download ZIP and extract first SRT/VTT ─────────────────────
    if (String(fileId).startsWith("subdl_")) {
      const parts = String(fileId).split("_");
      // format: subdl_{sd_id}_{encodedUrl}
      const encodedUrl = parts.slice(2).join("_");
      const subdlPath = decodeURIComponent(encodedUrl);
      const downloadUrl = `https://dl.subdl.com${subdlPath}`;

      const res = await fetch(downloadUrl, {
        headers: { "User-Agent": "Streambert v1" },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok)
        return { ok: false, error: `SubDL download error ${res.status}` };

      const arrayBuffer = await res.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuffer);
      const extracted = extractFirstSubtitleFromZip(zipBuffer);
      if (!extracted)
        return { ok: false, error: "No subtitle file found in SubDL ZIP" };

      // Save to temp file and return file:// URL
      const os = require("os");
      const tmpDir = os.tmpdir();
      const tmpPath = path.join(
        tmpDir,
        `streambert_sub_${Date.now()}_${extracted.name}`,
      );
      fs.writeFileSync(tmpPath, extracted.data);

      return {
        ok: true,
        url: `file://${tmpPath}`,
        file_name: extracted.name,
        remaining: null,
        reset_time: null,
        via_subdl: true,
      };
    }

    // ── Wyzie: direct URL, no extra step needed ───────────────────────────
    if (String(fileId).startsWith("wyzie_")) {
      const url = decodeURIComponent(
        String(fileId).split("_").slice(2).join("_"),
      );
      return {
        ok: true,
        url,
        file_name: "",
        remaining: null,
        reset_time: null,
        via_wyzie: true,
      };
    }

    return { ok: false, error: "Unknown subtitle source" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Download subtitles for an already-completed file ────────────────────
ipcMain.handle(
  "download-subtitles-for-file",
  async (_, { filePath, selectedSubs }) => {
    try {
      const dir = path.dirname(filePath);
      const baseName = path.basename(filePath, path.extname(filePath));
      const results = [];
      const langCounter = {};

      for (const sub of selectedSubs) {
        try {
          const langCode = (sub.language || sub.lang || "unknown").replace(
            /[^a-z0-9_-]/gi,
            "",
          );
          let fileData, ext;

          if (String(sub.file_id).startsWith("subdl_")) {
            const parts = String(sub.file_id).split("_");
            const encodedUrl = parts.slice(2).join("_");
            const subdlPath = decodeURIComponent(encodedUrl);
            const downloadUrl = `https://dl.subdl.com${subdlPath}`;
            const res = await fetch(downloadUrl, {
              headers: { "User-Agent": "Streambert v1" },
              signal: AbortSignal.timeout(30000),
            });
            if (!res.ok) continue;
            const zipBuf = Buffer.from(await res.arrayBuffer());
            const extracted = extractFirstSubtitleFromZip(zipBuf);
            if (!extracted) continue;
            fileData = extracted.data;
            ext = extracted.name.split(".").pop().toLowerCase();
          } else {
            // Wyzie direct URL (or any direct_url)
            const url =
              sub.direct_url ||
              (String(sub.file_id).startsWith("wyzie_")
                ? decodeURIComponent(
                    String(sub.file_id).split("_").slice(2).join("_"),
                  )
                : null);
            if (!url) continue;
            const res = await fetch(url, {
              signal: AbortSignal.timeout(30000),
            });
            if (!res.ok) continue;
            fileData = Buffer.from(await res.arrayBuffer());
            const urlExt = url.split("?")[0].split(".").pop().toLowerCase();
            ext = ["srt", "vtt", "ass", "ssa"].includes(urlExt)
              ? urlExt
              : "srt";
          }

          const lIdx = langCounter[langCode] ?? 0;
          langCounter[langCode] = lIdx + 1;
          const suffix = lIdx > 0 ? `.${lIdx}` : "";
          const destPath = path.join(
            dir,
            `${baseName}.${langCode}${suffix}.${ext}`,
          );
          fs.writeFileSync(destPath, fileData);
          results.push({
            lang: langCode,
            path: destPath,
            file_id: sub.file_id || null,
            release: sub.release || sub.file_name || null,
            source: sub.via_subdl ? "subdl" : "wyzie",
          });
        } catch (subErr) {
          console.error("Subtitle download error:", subErr);
        }
      }

      // Update the download registry entry (merge, skip already-present langs)
      if (results.length > 0 && filePath) {
        const idx = downloads.findIndex((d) => d.filePath === filePath);
        if (idx >= 0) {
          const existing = downloads[idx].subtitlePaths || [];
          const existingFileIds = new Set(
            existing.map((s) => s.file_id).filter(Boolean),
          );
          downloads[idx].subtitlePaths = [
            ...existing,
            ...results.filter(
              (r) => !r.file_id || !existingFileIds.has(r.file_id),
            ),
          ];
          saveDownloads();
        }
      }

      return { ok: true, subtitlePaths: results };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
);

// ── IPC: Delete a single subtitle file and remove from registry ───────────────
// ── IPC: prune subtitle paths that no longer exist on disk ───────────────────
// Returns the surviving subtitlePaths array (already persisted in registry).
ipcMain.handle("prune-subtitle-paths", (_, { downloadId }) => {
  try {
    const idx = downloads.findIndex((d) => d.id === downloadId);
    if (idx < 0) return { ok: true, subtitlePaths: [] };

    const before = downloads[idx].subtitlePaths || [];
    const after = before.filter((sp) => {
      const p = typeof sp === "string" ? sp : sp?.path;
      return p && fs.existsSync(p);
    });

    if (after.length !== before.length) {
      downloads[idx].subtitlePaths = after;
      saveDownloads();
    }

    return { ok: true, subtitlePaths: after };
  } catch (e) {
    return { ok: false, error: e.message, subtitlePaths: [] };
  }
});

ipcMain.handle("delete-subtitle-file", (_, { downloadId, subtitlePath }) => {
  try {
    // Delete the physical file
    if (subtitlePath && fs.existsSync(subtitlePath)) {
      fs.unlinkSync(subtitlePath);
    }
    // Remove from registry
    if (downloadId) {
      const idx = downloads.findIndex((d) => d.id === downloadId);
      if (idx >= 0) {
        downloads[idx].subtitlePaths = (
          downloads[idx].subtitlePaths || []
        ).filter((sp) => sp.path !== subtitlePath);
        saveDownloads();
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Quit app ─────────────────────────
ipcMain.handle("quit-app", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// ── IPC: Full app reset ───────────────────────────────────────────────────────
ipcMain.handle("reset-app", async () => {
  try {
    const sessions = [
      session.defaultSession,
      session.fromPartition("persist:videasy"),
      session.fromPartition("persist:trailer"),
    ];
    await Promise.all(sessions.map((s) => s.clearStorageData()));
    await Promise.all(sessions.map((s) => s.clearCache()));

    const dlFile = downloadsFile();
    if (fs.existsSync(dlFile)) fs.unlinkSync(dlFile);
    downloads = [];

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: AllAnime (allmanga.to) episode resolver ─────────────────────────────
// Mirrors ani-cli's approach exactly:
//   1. Search via GQL GET -> get show _id
//   2. Episode GQL GET -> get sourceUrls (hex-encoded paths)
//   3. Decode "--" hex path, fetch https://allanime.day{path} -> get mp4 links
//   4. Return best-resolution direct mp4 URL for the webview and downloader
//
// For S2+: uses AniList GQL to find the correct season title
// (e.g. "Jujutsu Kaisen" S2 -> "Jujutsu Kaisen 2nd Season") before searching

// Custom hex cipher from ani-cli (maps obfuscated hex pairs to characters)
const ALLANIME_HEX_MAP = {
  79: "A",
  "7a": "B",
  "7b": "C",
  "7c": "D",
  "7d": "E",
  "7e": "F",
  "7f": "G",
  70: "H",
  71: "I",
  72: "J",
  73: "K",
  74: "L",
  75: "M",
  76: "N",
  77: "O",
  68: "P",
  69: "Q",
  "6a": "R",
  "6b": "S",
  "6c": "T",
  "6d": "U",
  "6e": "V",
  "6f": "W",
  60: "X",
  61: "Y",
  62: "Z",
  59: "a",
  "5a": "b",
  "5b": "c",
  "5c": "d",
  "5d": "e",
  "5e": "f",
  "5f": "g",
  50: "h",
  51: "i",
  52: "j",
  53: "k",
  54: "l",
  55: "m",
  56: "n",
  57: "o",
  48: "p",
  49: "q",
  "4a": "r",
  "4b": "s",
  "4c": "t",
  "4d": "u",
  "4e": "v",
  "4f": "w",
  40: "x",
  41: "y",
  42: "z",
  "08": "0",
  "09": "1",
  "0a": "2",
  "0b": "3",
  "0c": "4",
  "0d": "5",
  "0e": "6",
  "0f": "7",
  "00": "8",
  "01": "9",
  15: "-",
  16: ".",
  67: "_",
  46: "~",
  "02": ":",
  17: "/",
  "07": "?",
  "1b": "#",
  63: "[",
  65: "]",
  78: "@",
  19: "!",
  "1c": "$",
  "1e": "&",
  10: "(",
  11: ")",
  12: "*",
  13: "+",
  14: ",",
  "03": ";",
  "05": "=",
  "1d": "%",
};

function decodeAllanimeUrl(encoded) {
  if (encoded.startsWith("--")) encoded = encoded.slice(2);
  let result = "";
  for (let i = 0; i < encoded.length; i += 2) {
    const pair = encoded.slice(i, i + 2);
    result +=
      ALLANIME_HEX_MAP[pair] !== undefined ? ALLANIME_HEX_MAP[pair] : pair;
  }
  return result.replace(/\\u002F/gi, "/").replace(/\\\|/g, "");
}

// Generic HTTPS GET helper (used for both allanime API and link fetching)
function httpsGet(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
        Referer: "https://allmanga.to",
        Accept: "*/*",
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      // Follow redirects
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const loc = res.headers.location.startsWith("http")
          ? res.headers.location
          : u.origin + res.headers.location;
        httpsGet(loc, headers).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

// GET request to api.allanime.day/api with GQL params
function allanimeGQL(variables, query) {
  const qs =
    "variables=" +
    encodeURIComponent(JSON.stringify(variables)) +
    "&query=" +
    encodeURIComponent(query);
  return httpsGet("https://api.allanime.day/api?" + qs);
}

// Normalize a title for fuzzy matching / alternate search attempts:
// strips curly/straight apostrophes, colons, dots and collapses spaces.
function sanitizeTitle(t) {
  return t
    .replace(/[''`´]/g, "") // remove apostrophes (JoJo's → JoJos)
    .replace(/[:!.]/g, "") // remove punctuation that breaks queries
    .replace(/\s+/g, " ")
    .trim();
}

// AniList GQL to look up the correct season title for S2+
// Returns e.g. "Jujutsu Kaisen 2nd Season" for (title="Jujutsu Kaisen", season=2)
function anilistSeasonTitle(baseTitle, seasonNumber) {
  return new Promise((resolve) => {
    const resolveS1 = seasonNumber <= 1;

    const query = `query($search:String){Media(search:$search,type:ANIME,sort:SEARCH_MATCH){title{english romaji}episodes relations{edges{relationType node{type format title{english romaji}episodes startDate{year}seasonYear}}}}}`;
    const body = JSON.stringify({ query, variables: { search: baseTitle } });

    const opts = {
      hostname: "graphql.anilist.co",
      path: "/",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const media = json?.data?.Media;
          // Always capture the S1 romaji as a fallback candidate
          const s1Romaji = media?.title?.romaji || null;

          if (!media)
            return resolve({
              title: baseTitle,
              romaji: null,
              episodes: null,
              nextTitle: null,
              nextRomaji: null,
            });

          const s1Episodes = media?.episodes || null;

          const sequels = (media.relations?.edges || [])
            .filter(
              (e) =>
                e.relationType === "SEQUEL" &&
                e.node.type === "ANIME" &&
                (e.node.format === "TV" || e.node.format === "TV_SHORT"),
            )
            .sort((a, b) => {
              const ya = a.node.startDate?.year || a.node.seasonYear || 9999;
              const yb = b.node.startDate?.year || b.node.seasonYear || 9999;
              return ya - yb;
            });

          const getSequelTitle = (node) =>
            node.title?.english || node.title?.romaji || null;
          const getSequelRomaji = (node) => node.title?.romaji || null;

          if (resolveS1) {
            const eng = media.title?.english || baseTitle;
            const nextSequel = sequels[0] ? sequels[0].node : null;
            return resolve({
              title: eng,
              romaji: s1Romaji,
              episodes: s1Episodes,
              nextTitle: nextSequel ? getSequelTitle(nextSequel) : null,
              nextRomaji: nextSequel ? getSequelRomaji(nextSequel) : null,
            });
          }

          const target = sequels[seasonNumber - 2];
          if (!target)
            return resolve({
              title: baseTitle,
              romaji: s1Romaji,
              episodes: null,
              nextTitle: null,
              nextRomaji: null,
            });
          const t = getSequelTitle(target.node) || baseTitle;
          const romaji = getSequelRomaji(target.node) || s1Romaji;
          const targetEpisodes = target.node.episodes || null;
          const nextTarget = sequels[seasonNumber - 1];
          const nextNode = nextTarget ? nextTarget.node : null;
          resolve({
            title: t,
            romaji,
            episodes: targetEpisodes,
            nextTitle: nextNode ? getSequelTitle(nextNode) : null,
            nextRomaji: nextNode ? getSequelRomaji(nextNode) : null,
          });
        } catch {
          resolve({
            title: baseTitle,
            romaji: null,
            episodes: null,
            nextTitle: null,
            nextRomaji: null,
          });
        }
      });
    });
    req.on("error", () =>
      resolve({
        title: baseTitle,
        romaji: null,
        episodes: null,
        nextTitle: null,
        nextRomaji: null,
      }),
    );
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({
        title: baseTitle,
        romaji: null,
        episodes: null,
        nextTitle: null,
        nextRomaji: null,
      });
    });
    req.write(body);
    req.end();
  });
}

// Hardcoded AllAnime show IDs for franchises where title search is unreliable.
// Key: lowercase TMDB title. Value: array of show IDs indexed by season (0-based).
const HARDCODED_SHOW_IDS = {
  "jojo's bizarre adventure": [
    "MeX4czvkwKGo3zdDp", // S1
    "zyqDjR8te4z6taKyk", // S2
    "GTAQH8Z9K6WbAdXsS", // S3
    "JS9PzKiPanesGRvs5", // S4
    "b6xFsr7MDSMcJArB9", // S5
    "pwduJkjBLytqiWCvM", // S6
  ],
};

// Shows where one TMDB season spans multiple AllManga entries.
// Key: lowercase TMDB title
// Value: map of TMDB season number -> ordered array of parts
// Each part: { from (1-indexed TMDB ep where this part starts),
//              showId (AllManga ID, null = use title search),
//              offset (subtract from TMDB ep to get AllManga ep) }
const SPLIT_SEASONS = {
  "spy x family": {
    1: [
      { from: 1, showId: null, offset: 0 },
      { from: 13, showId: "H8Aey6QXE7HSqwvW3", offset: 12 },
    ],
  },
};

// Resolve video URL directly from a known AllAnime show ID + episode string.
// Returns a result object on success or null if nothing worked.
async function resolveEpisodeFromId(showId, epStr, dubSub) {
  const PROVIDER_PRIORITY = ["S-mp4", "Luf-Mp4", "Yt-mp4", "Default", "Sl-Hls"];

  const epStrCandidates = [epStr];
  if (!epStr.includes(".")) epStrCandidates.push(epStr + ".0");

  let sourceUrls = null;
  for (const attempt of epStrCandidates) {
    const epRes = await allanimeGQL(
      { showId, translationType: dubSub, episodeString: attempt },
      EPISODE_GQL,
    );
    if (!epRes.body) continue;
    try {
      const epJson = JSON.parse(epRes.body);
      const urls = epJson?.data?.episode?.sourceUrls;
      if (urls?.length) {
        sourceUrls = urls;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!sourceUrls) return null;

  const decodedSources = sourceUrls
    .filter((s) => s.sourceUrl && s.sourceUrl.startsWith("--"))
    .map((s) => {
      let path = decodeAllanimeUrl(s.sourceUrl);
      path = path.replace("/clock", "/clock.json");
      return {
        sourceName: s.sourceName || "",
        priority: s.priority || 0,
        path,
      };
    });

  decodedSources.sort((a, b) => {
    const ai = PROVIDER_PRIORITY.indexOf(a.sourceName);
    const bi = PROVIDER_PRIORITY.indexOf(b.sourceName);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const src of decodedSources) {
    let fetchUrl = src.path;
    if (fetchUrl.startsWith("//")) fetchUrl = "https:" + fetchUrl;
    else if (fetchUrl.startsWith("/"))
      fetchUrl = "https://allanime.day" + fetchUrl;
    else if (!fetchUrl.startsWith("http"))
      fetchUrl = "https://allanime.day/" + fetchUrl;

    try {
      const linkRes = await httpsGet(fetchUrl, {
        Referer: "https://allmanga.to",
      });
      if (linkRes.status !== 200 || !linkRes.body) continue;
      let linkJson;
      try {
        linkJson = JSON.parse(linkRes.body);
      } catch {
        continue;
      }
      const links = linkJson?.links;
      if (!links?.length) continue;
      const allLinks = links.filter((l) => l.link);
      const mp4Links = allLinks.filter(
        (l) => !l.link.includes(".m3u8") && !l.link.includes("master."),
      );
      const candidates = mp4Links.length ? mp4Links : allLinks;
      if (!candidates.length) continue;
      candidates.sort(
        (a, b) =>
          (parseInt(b.resolutionStr) || 0) - (parseInt(a.resolutionStr) || 0),
      );
      const best = candidates[0];
      return {
        ok: true,
        url: best.link,
        resolution: best.resolutionStr || "?",
        sourceName: src.sourceName,
        isDirectMp4: !best.link.includes(".m3u8"),
        referer: "https://allmanga.to",
      };
    } catch {
      continue;
    }
  }
  return null;
}

const SEARCH_GQL = `query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){edges{_id name availableEpisodes __typename}}}`;

const EPISODE_GQL = `query($showId:String! $translationType:VaildTranslationTypeEnumType! $episodeString:String!){episode(showId:$showId translationType:$translationType episodeString:$episodeString){episodeString sourceUrls}}`;

// ── Local video player server ─────────────────────────────────────────────────
// Serves a minimal HTML5 video page so the webview plays mp4/m3u8 directly
// instead of triggering a download. Also proxies the video stream with the
// correct Referer header so CDN servers accept the request.

let _playerServer = null;
let _currentVideoUrl = null;
let _currentVideoReferer = "https://allmanga.to";
let _currentVideoStartTime = 0;

function getPlayerServer() {
  if (_playerServer) return Promise.resolve(_playerServer);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");

      // Serve the player HTML page
      if (url.pathname === "/player" || url.pathname === "/") {
        const videoUrl = _currentVideoUrl || "";
        const isM3u8 = videoUrl.includes(".m3u8");
        const startTime = _currentVideoStartTime || 0;
        // For m3u8 we use hls.js; for mp4 a plain <video> suffices
        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:#000; overflow:hidden; }
  video { width:100%; height:100%; object-fit:contain; display:block; }
</style>
</head>
<body>
<video id="v" src="${isM3u8 ? "" : "/proxy?url=" + encodeURIComponent(videoUrl)}" autoplay controls playsinline crossorigin="anonymous"></video>
${
  isM3u8
    ? `
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js"></script>
<script>
  const video = document.getElementById('v');
  const src = decodeURIComponent("${encodeURIComponent(videoUrl)}");
  const startTime = ${startTime};
  if (Hls.isSupported()) {
    const hls = new Hls({ xhrSetup: (xhr) => xhr.setRequestHeader('Referer','${_currentVideoReferer}') });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (startTime > 0) video.currentTime = startTime;
      video.play().catch(()=>{});
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    if (startTime > 0) video.addEventListener('loadedmetadata', () => { video.currentTime = startTime; }, { once: true });
  }
</script>`
    : startTime > 0
      ? `<script>
  const v = document.getElementById('v');
  v.addEventListener('loadedmetadata', () => { v.currentTime = ${startTime}; }, { once: true });
</script>`
      : ""
}
</body>
</html>`;
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Cache-Control": "no-store",
        });
        res.end(html);
        return;
      }

      // Proxy video bytes with correct Referer so CDNs accept the request
      if (url.pathname === "/proxy") {
        const target = url.searchParams.get("url");
        if (!target) {
          res.writeHead(400);
          res.end();
          return;
        }

        try {
          const targetUrl = new URL(target);
          const isHttps = targetUrl.protocol === "https:";
          const lib = isHttps ? https : http;

          const proxyReq = lib.request(
            {
              hostname: targetUrl.hostname,
              path: targetUrl.pathname + targetUrl.search,
              method: req.method || "GET",
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
                Referer: _currentVideoReferer,
                Range: req.headers["range"] || "",
                Accept: "*/*",
              },
            },
            (proxyRes) => {
              // Pass through status + headers (especially Range/Content-Range for seeking)
              const passHeaders = {};
              for (const h of [
                "content-type",
                "content-length",
                "content-range",
                "accept-ranges",
                "last-modified",
                "etag",
              ]) {
                if (proxyRes.headers[h]) passHeaders[h] = proxyRes.headers[h];
              }
              passHeaders["Access-Control-Allow-Origin"] = "*";
              passHeaders["Cache-Control"] = "no-store";
              res.writeHead(proxyRes.statusCode, passHeaders);
              proxyRes.pipe(res);
            },
          );
          proxyReq.on("error", () => {
            res.writeHead(502);
            res.end();
          });
          req.pipe(proxyReq);
        } catch {
          res.writeHead(500);
          res.end();
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      _playerServer = server;
      resolve(server);
    });
    server.on("error", reject);
  });
}

ipcMain.handle("set-player-video", async (_, { url, referer, startTime }) => {
  _currentVideoUrl = url;
  _currentVideoReferer = referer || "https://allmanga.to";
  _currentVideoStartTime = startTime || 0;
  const server = await getPlayerServer();
  const port = server.address().port;
  return { playerUrl: `http://127.0.0.1:${port}/player` };
});

ipcMain.handle(
  "resolve-allmanga",
  async (
    _,
    { title, seasonNumber, episodeNumber, isMovie, translationType },
  ) => {
    try {
      const season = seasonNumber || 1;
      const dubSub = translationType === "dub" ? "dub" : "sub";

      if (!isMovie) {
        const splitParts = SPLIT_SEASONS[title.toLowerCase()]?.[season];
        if (splitParts) {
          let activePart = splitParts[0];
          for (const part of splitParts) {
            if (episodeNumber >= part.from) activePart = part;
          }
          const partEp = episodeNumber - activePart.offset;
          if (activePart.showId) {
            const result = await resolveEpisodeFromId(
              activePart.showId,
              String(partEp),
              dubSub,
            );
            if (result) return result;
          }
        }
      }

      if (!isMovie) {
        const hardcodedIds = HARDCODED_SHOW_IDS[title.toLowerCase()];
        if (hardcodedIds) {
          const showId =
            hardcodedIds[season - 1] ?? hardcodedIds[hardcodedIds.length - 1];
          const result = await resolveEpisodeFromId(
            showId,
            String(episodeNumber),
            dubSub,
          );
          if (result) return result;
        }
      }

      const anilistResult = isMovie
        ? {
            title,
            romaji: null,
            episodes: null,
            nextTitle: null,
            nextRomaji: null,
          }
        : await anilistSeasonTitle(title, season);

      let searchTitle = anilistResult.title;
      let adjustedEpisodeNumber = episodeNumber;

      if (
        !isMovie &&
        anilistResult.episodes &&
        episodeNumber > anilistResult.episodes &&
        anilistResult.nextTitle
      ) {
        adjustedEpisodeNumber = episodeNumber - anilistResult.episodes;
        searchTitle = anilistResult.nextTitle;
      }

      const epStr = isMovie ? "1" : String(adjustedEpisodeNumber);

      // Build ordered list of title candidates to try if the first search fails.
      // Deduplication via Set keeps the list clean.
      const candidateSet = new Set([
        searchTitle,
        sanitizeTitle(searchTitle),
        ...(anilistResult.romaji && searchTitle === anilistResult.title
          ? [anilistResult.romaji]
          : []),
        ...(anilistResult.nextRomaji && searchTitle === anilistResult.nextTitle
          ? [anilistResult.nextRomaji]
          : []),
        title,
        sanitizeTitle(title),
      ]);
      const candidates = [...candidateSet].filter(Boolean);

      // ── Step 2: Search allanime for the show (try each candidate) ─────────
      // Helper: run one search and return edges or null
      async function searchAllmanga(query) {
        const vars = {
          search: { allowAdult: false, allowUnknown: false, query },
          limit: 40,
          page: 1,
          translationType: dubSub,
          countryOrigin: "ALL",
        };
        const res = await allanimeGQL(vars, SEARCH_GQL);
        if (!res.body) return null;
        try {
          const json = JSON.parse(res.body);
          const edges = json?.data?.shows?.edges;
          return edges?.length ? edges : null;
        } catch {
          return null;
        }
      }

      let edges = null;
      let matchedTitle = searchTitle;
      for (const candidate of candidates) {
        edges = await searchAllmanga(candidate);
        if (edges) {
          matchedTitle = candidate;
          break;
        }
      }

      if (!edges) return { ok: false, error: "No results for: " + searchTitle };

      // Best match: exact name match on the winning candidate, else first result
      const titleLower = matchedTitle.toLowerCase();
      const anime =
        edges.find((e) => (e.name || "").toLowerCase() === titleLower) ||
        edges[0];
      const showId = anime._id;

      // ── Step 3: Get episode sourceUrls ────────────────────────────────────
      const epVars = { showId, translationType: dubSub, episodeString: epStr };
      const epRes = await allanimeGQL(epVars, EPISODE_GQL);
      if (!epRes.body) return { ok: false, error: "Empty episode response" };

      let epJson;
      try {
        epJson = JSON.parse(epRes.body);
      } catch {
        return {
          ok: false,
          error: "Episode parse error: " + epRes.body.slice(0, 200),
        };
      }

      const sourceUrls = epJson?.data?.episode?.sourceUrls;
      if (!sourceUrls?.length)
        return { ok: false, error: "No sourceUrls for ep " + epStr };

      // ── Step 4: Decode sourceUrls and build fetch URLs ───────────────────
      // ani-cli flow: decode "--" hex string -> apply /clock->/clock.json transform
      // -> prepend https://allanime.day if path is relative
      // -> fetch that URL with Referer -> parse {"links":[{"link":"...","resolutionStr":"..."}]}

      // Priority: S-mp4 and Luf-Mp4 give direct mp4, Default gives wixmp mp4/m3u8
      const PROVIDER_PRIORITY = [
        "S-mp4",
        "Luf-Mp4",
        "Yt-mp4",
        "Default",
        "Sl-Hls",
      ];

      const decodedSources = sourceUrls
        .filter((s) => s.sourceUrl && s.sourceUrl.startsWith("--"))
        .map((s) => {
          let path = decodeAllanimeUrl(s.sourceUrl);
          // Critical: ani-cli applies s|/clock|/clock.json| transform
          path = path.replace("/clock", "/clock.json");
          return {
            sourceName: s.sourceName || "",
            priority: s.priority || 0,
            path,
          };
        });

      decodedSources.sort((a, b) => {
        const ai = PROVIDER_PRIORITY.indexOf(a.sourceName);
        const bi = PROVIDER_PRIORITY.indexOf(b.sourceName);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

      const debugPaths = [];

      for (const src of decodedSources) {
        let fetchUrl = src.path;

        // Build correct fetch URL:
        // - starts with "/" -> relative path on allanime.day
        // - starts with "//" -> protocol-relative, but still fetch via allanime.day
        // - already has a host (contains ".") but no protocol -> add https://
        // - full URL -> use as-is
        if (fetchUrl.startsWith("//")) {
          // Protocol-relative external URL, fetch directly
          fetchUrl = "https:" + fetchUrl;
        } else if (fetchUrl.startsWith("/")) {
          fetchUrl = "https://allanime.day" + fetchUrl;
        } else if (!fetchUrl.startsWith("http")) {
          fetchUrl = "https://allanime.day/" + fetchUrl;
        }

        debugPaths.push(`[${src.sourceName}] ${fetchUrl}`);

        try {
          const linkRes = await httpsGet(fetchUrl, {
            Referer: "https://allmanga.to",
          });
          if (linkRes.status !== 200 || !linkRes.body) continue;

          let linkJson;
          try {
            linkJson = JSON.parse(linkRes.body);
          } catch {
            continue;
          }

          const links = linkJson?.links;
          if (!links?.length) continue;

          // Prefer direct mp4 over m3u8
          const allLinks = links.filter((l) => l.link);
          const mp4Links = allLinks.filter(
            (l) => !l.link.includes(".m3u8") && !l.link.includes("master."),
          );

          const candidates = mp4Links.length ? mp4Links : allLinks;
          if (!candidates.length) continue;

          // Pick highest resolution
          candidates.sort(
            (a, b) =>
              (parseInt(b.resolutionStr) || 0) -
              (parseInt(a.resolutionStr) || 0),
          );
          const best = candidates[0];

          return {
            ok: true,
            url: best.link,
            resolution: best.resolutionStr || "?",
            sourceName: src.sourceName,
            searchTitle,
            isDirectMp4: !best.link.includes(".m3u8"),
            referer: "https://allmanga.to",
          };
        } catch {
          continue;
        }
      }

      return {
        ok: false,
        error: "No playable link found. Tried: " + debugPaths.join(" | "),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
);

// Debug handler
ipcMain.handle("debug-allmanga", async (_, args) => {
  try {
    if (args.path) {
      let url = args.path.startsWith("http")
        ? args.path
        : "https://allanime.day" + args.path;
      const r = await httpsGet(url, { Referer: "https://allmanga.to" });
      return { status: r.status, body: r.body.slice(0, 3000) };
    }
    if (args.showId) {
      const vars = {
        showId: args.showId,
        translationType: "sub",
        episodeString: String(args.epNum || 1),
      };
      const r = await allanimeGQL(vars, EPISODE_GQL);
      let parsed;
      try {
        parsed = JSON.parse(r.body);
      } catch {}
      // Decode all sourceUrls for inspection
      if (parsed?.data?.episode?.sourceUrls) {
        parsed._decoded = parsed.data.episode.sourceUrls
          .filter((s) => s.sourceUrl?.startsWith("--"))
          .map((s) => {
            let path = decodeAllanimeUrl(s.sourceUrl);
            path = path.replace("/clock", "/clock.json");
            let fetchUrl = path.startsWith("//")
              ? "https:" + path
              : path.startsWith("/")
                ? "https://allanime.day" + path
                : path.startsWith("http")
                  ? path
                  : "https://allanime.day/" + path;
            return { sourceName: s.sourceName, path, fetchUrl };
          });
      }
      return { status: r.status, parsed, raw: r.body.slice(0, 2000) };
    }
    const season = args.season || 1;
    const resolvedTitle = await anilistSeasonTitle(args.title || "", season);
    const vars = {
      search: { allowAdult: false, allowUnknown: false, query: resolvedTitle },
      limit: 10,
      page: 1,
      translationType: "sub",
      countryOrigin: "ALL",
    };
    const r = await allanimeGQL(vars, SEARCH_GQL);
    return { resolvedTitle, status: r.status, body: r.body.slice(0, 3000) };
  } catch (e) {
    return { error: e.message };
  }
});
