// ── IPC: Player launch, window controls, auto-updater ─────────────────────────

const { ipcMain, shell, app } = require("electron");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const os = require("os");

let _updateAbortController = null;

// ── Trusted release sources for the auto-updater ──────────────────────────────
// Same validation logic applies to every entry below, adding a new source
// means adding a row here, not a new code path.
//
// IMPORTANT: GitHub and Codeberg use completely different asset URL structures:
//   GitHub:   https://github.com/<owner>/<repo>/releases/download/<tag>/<file>
//   Codeberg: https://codeberg.org/attachments/<uuid>
//             (Gitea stores release attachments under /attachments/, not under the repo path)
const TRUSTED_UPDATE_SOURCES = [
  {
    id: "github",
    origin: "https://github.com",
    // Must match the full repo path so an attacker can't use
    // a different repo on github.com to serve a malicious binary.
    pathPrefix: "/truelockmc/streambert/releases/download/",
    redirectHosts: [
      "github.com",
      "objects.githubusercontent.com",
      "release-assets.githubusercontent.com",
    ],
  },
  {
    id: "codeberg",
    origin: "https://codeberg.org",
    // Codeberg (Gitea) release assets are served from /attachments/<uuid>.
    // The UUID is random and unguessable.
    pathPrefix: "/attachments/",
    redirectHosts: ["codeberg.org"],
  },
];

// Returns the matching trusted source for a parsed URL, or null.
function findTrustedUpdateSource(parsedUrl) {
  return (
    TRUSTED_UPDATE_SOURCES.find(
      (s) =>
        parsedUrl.origin === s.origin &&
        parsedUrl.pathname.startsWith(s.pathPrefix),
    ) || null
  );
}

function register(getMainWindow, { writeSecretMigration }) {
  // ── Open file at specific timestamp in mpv / VLC ─────────────────────────

  // Extensions considered safe to pass to an external media player.
  // This also gates the shell.openPath fallback.
  const ALLOWED_MEDIA_EXTENSIONS = new Set([
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".webm",
    ".m4v",
    ".ts",
    ".m2ts",
    ".m3u8",
  ]);

  const ALLOWED_SUBTITLE_EXTENSIONS = new Set([
    ".srt",
    ".ass",
    ".ssa",
    ".vtt",
    ".sub",
    ".idx",
    ".sup",
  ]);

  // Validate a path: must have an allowed extension and must resolve to a
  // real absolute path (prevents path-traversal tricks like "../../bin/sh").
  const validateMediaPath = (p, allowedExts) => {
    if (typeof p !== "string" || !p) return null;
    const ext = path.extname(p).toLowerCase();
    if (!allowedExts.has(ext)) return null;
    try {
      // fs.realpathSync throws if the file doesn't exist
      const real = fs.realpathSync(p);
      // Re-check extension after resolving symlinks
      if (!allowedExts.has(path.extname(real).toLowerCase())) return null;
      return real;
    } catch {
      return null;
    }
  };

  ipcMain.handle(
    "open-path-at-time",
    (_, { filePath, seconds, subtitlePaths }) => {
      // ── Validate filePath ─────────────────────────────────────────────────
      const safeFilePath = validateMediaPath(
        filePath,
        ALLOWED_MEDIA_EXTENSIONS,
      );
      if (!safeFilePath) return; // silently drop invalid paths

      const sec = Math.floor(seconds || 0);
      const platform = process.platform;

      const resolveBin = (bin) => {
        if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
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
          spawn(resolved, args, { detached: true, stdio: "ignore" }).unref();
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

      // ── Validate subtitle paths ───────────────────────────────────────────
      // Each subtitle path is independently validated.
      const subFilePaths = Array.isArray(subtitlePaths)
        ? subtitlePaths
            .map((sp) => (typeof sp === "string" ? sp : sp?.path))
            .map((sp) => validateMediaPath(sp, ALLOWED_SUBTITLE_EXTENSIONS))
            .filter(Boolean)
        : [];
      const mpvSubArgs = subFilePaths.map((p) => `--sub-file=${p}`);
      const vlcSubArgs =
        subFilePaths.length > 0 ? [`--sub-file=${subFilePaths[0]}`] : [];

      if (sec > 0) {
        for (const mpv of mpvPaths) {
          if (tryLaunch(mpv, [`--start=${sec}`, ...mpvSubArgs, safeFilePath]))
            return;
        }
        for (const vlc of vlcPaths) {
          if (
            tryLaunch(vlc, [`--start-time=${sec}`, ...vlcSubArgs, safeFilePath])
          )
            return;
        }
      } else if (mpvSubArgs.length > 0) {
        for (const mpv of mpvPaths) {
          if (tryLaunch(mpv, [...mpvSubArgs, safeFilePath])) return;
        }
        for (const vlc of vlcPaths) {
          if (tryLaunch(vlc, [...vlcSubArgs, safeFilePath])) return;
        }
      }
      shell.openPath(safeFilePath);
    },
  );

  // ── Window controls (custom Windows titlebar) ─────────────────────────────
  ipcMain.handle("window-minimize", () => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.minimize();
  });

  ipcMain.handle("window-toggle-maximize", () => {
    const mw = getMainWindow();
    if (!mw || mw.isDestroyed()) return;
    if (mw.isMaximized()) mw.unmaximize();
    else mw.maximize();
  });

  ipcMain.handle("window-close", () => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.close();
  });

  ipcMain.handle("window-is-maximized", () => {
    const mw = getMainWindow();
    return mw ? mw.isMaximized() : false;
  });

  // Push maximize state to the renderer so WindowTitlebar doesn't need to poll
  const pushMaximized = (v) => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.webContents.send("window-maximized", v);
  };
  const mwForEvents = getMainWindow();
  if (mwForEvents) {
    mwForEvents.on("maximize", () => pushMaximized(true));
    mwForEvents.on("unmaximize", () => pushMaximized(false));
    mwForEvents.on("enter-full-screen", () => pushMaximized(true));
    mwForEvents.on("leave-full-screen", () => pushMaximized(false));
  }

  ipcMain.handle("quit-app", () => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.close();
  });

  ipcMain.handle("get-platform", () => process.platform);

  // ── Get video duration via ffprobe ────────────────────────────────────────
  ipcMain.handle("get-video-duration", async (_, filePath) => {
    if (!filePath) return { ok: false };
    const platform = process.platform;

    // Probe paths for ffprobe
    const probePaths =
      platform === "win32"
        ? ["ffprobe", "C:\\ffmpeg\\bin\\ffprobe.exe"]
        : platform === "darwin"
          ? ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"]
          : ["/usr/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];

    for (const probe of probePaths) {
      try {
        const result = spawnSync(
          probe,
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            filePath,
          ],
          { encoding: "utf8", timeout: 8000 },
        );
        if (result.status === 0) {
          const secs = parseFloat(result.stdout.trim());
          if (!isNaN(secs) && secs > 0) return { ok: true, duration: secs };
        }
      } catch {}
    }

    // Fallback: try ffmpeg -i and parse Duration line
    const ffmpegPaths =
      platform === "win32"
        ? ["ffmpeg", "C:\\ffmpeg\\bin\\ffmpeg.exe"]
        : platform === "darwin"
          ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]
          : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];

    for (const ff of ffmpegPaths) {
      try {
        const r = spawnSync(ff, ["-i", filePath], {
          encoding: "utf8",
          timeout: 8000,
        });
        const combined = (r.stdout || "") + (r.stderr || "");
        const m = combined.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (m) {
          const secs =
            parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          if (secs > 0) return { ok: true, duration: secs };
        }
      } catch {}
    }

    return { ok: false };
  });

  // ── Auto-updater ──────────────────────────────────────────────────────────
  ipcMain.handle("detect-update-format", () => {
    if (process.platform === "win32") return "exe";
    if (process.platform === "darwin") return "dmg";
    if (process.platform === "linux") {
      if (process.env.APPIMAGE) return "appimage";
      const isArch =
        spawnSync("which", ["pacman"], { encoding: "utf8" }).status === 0;
      return isArch ? "pacman" : "deb";
    }
    return null;
  });

  ipcMain.handle("download-and-install-update", async (_, { url, format }) => {
    try {
      const ALLOWED_FORMATS = [
        "exe",
        "deb",
        "pacman",
        "dmg",
        "dmg_arm64",
        "appimage",
      ];
      if (!ALLOWED_FORMATS.includes(format)) {
        return { ok: false, error: "Invalid format" };
      }

      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, error: "Invalid URL" };
      }

      // Same check for every trusted source (GitHub, Codeberg, ...)
      // see TRUSTED_UPDATE_SOURCES above.
      const trustedSource = findTrustedUpdateSource(parsed);
      if (!trustedSource) {
        return { ok: false, error: "Unauthorized update source" };
      }
      const ALLOWED_REDIRECT_HOSTS = trustedSource.redirectHosts;

      _updateAbortController = new AbortController();
      const { signal } = _updateAbortController;

      const ext =
        format === "exe"
          ? ".exe"
          : format === "deb"
            ? ".deb"
            : format === "pacman"
              ? ".pacman"
              : format === "dmg"
                ? ".dmg"
                : ".AppImage";
      const destPath = path.join(os.tmpdir(), `streambert-update${ext}`);

      await new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error("Cancelled"));

        const doRequest = (reqUrl, redirectDepth = 0) => {
          // Guard against infinite redirect loops.
          if (redirectDepth > 5) {
            return reject(new Error("Too many redirects"));
          }
          let reqParsed;
          try {
            reqParsed = new URL(reqUrl);
          } catch {
            return reject(new Error("Invalid redirect URL"));
          }
          if (!ALLOWED_REDIRECT_HOSTS.includes(reqParsed.hostname)) {
            return reject(
              new Error(`Untrusted redirect host: ${reqParsed.hostname}`),
            );
          }

          const lib = reqUrl.startsWith("https") ? https : http;
          const req = lib.get(
            reqUrl,
            {
              headers: {
                "User-Agent": "Streambert-AutoUpdater",
                Accept: "application/octet-stream",
              },
            },
            (res) => {
              if (
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
              ) {
                res.resume();
                const next = res.headers.location.startsWith("http")
                  ? res.headers.location
                  : new URL(res.headers.location, reqUrl).toString();
                doRequest(next, redirectDepth + 1);
                return;
              }
              if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
              }

              const total = parseInt(res.headers["content-length"] || "0", 10);
              let downloaded = 0;
              const file = fs.createWriteStream(destPath);

              res.on("data", (chunk) => {
                if (signal.aborted) {
                  req.destroy();
                  file.destroy();
                  reject(new Error("Cancelled"));
                  return;
                }
                downloaded += chunk.length;
                file.write(chunk);
                const percent =
                  total > 0 ? Math.round((downloaded / total) * 100) : 0;
                const mb = (downloaded / 1e6).toFixed(1);
                const totalMb =
                  total > 0 ? `/ ${(total / 1e6).toFixed(1)} MB` : "";
                const mw = getMainWindow();
                if (mw && !mw.isDestroyed()) {
                  mw.webContents.send("update-progress", {
                    percent,
                    label: `Downloading… ${mb} MB ${totalMb}`,
                  });
                }
              });
              res.on("end", () => {
                file.end();
                file.on("finish", resolve);
                file.on("error", reject);
              });
              res.on("error", reject);
              req.on("error", reject);
            },
          );
          req.on("error", reject);
        };

        doRequest(url);
      });

      if (signal.aborted) return { ok: false, error: "Cancelled" };

      // ── Helper: send "Installing…" to renderer ──────────────────────────────
      const sendInstalling = () => {
        const mw = getMainWindow();
        if (mw && !mw.isDestroyed()) {
          mw.webContents.send("update-progress", {
            percent: 100,
            label: "Installing…",
          });
        }
      };

      if (format === "appimage") {
        sendInstalling();
        fs.chmodSync(destPath, 0o755);
        const currentAppImage = process.env.APPIMAGE;
        if (currentAppImage) {
          const scriptPath = path.join(os.tmpdir(), "streambert-update.sh");
          const pid = process.pid;
          const target = currentAppImage;
          const scriptContent =
            [
              "#!/bin/sh",
              `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done`,
              `mv -f "${destPath}" "${target}"`,
              `chmod +x "${target}"`,
              `"${target}" &`,
            ].join("\n") + "\n";
          fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
          spawn("sh", [scriptPath], {
            detached: true,
            stdio: "ignore",
          }).unref();
        } else {
          spawn(destPath, [], { detached: true, stdio: "ignore" }).unref();
        }
        writeSecretMigration();
        app.exit(0);
      } else if (format === "pacman") {
        sendInstalling();
        // Give the renderer a moment to process the IPC message and show
        // "Installing…" before spawnSync blocks the main thread
        await new Promise((r) => setTimeout(r, 150));
        fs.chmodSync(destPath, 0o644);
        const pacmanLaunchers = [
          { bin: "pkexec", args: ["pacman", "-U", "--noconfirm", destPath] },
          { bin: "pamac-installer", args: [destPath] },
        ];
        let launched = false;
        for (const { bin, args } of pacmanLaunchers) {
          try {
            const which = spawnSync("which", [bin], { encoding: "utf8" });
            if (which.status !== 0) continue;
            // spawnSync, to wait for pacman to finish before relaunching
            const result = spawnSync(bin, args, { stdio: "inherit" });
            if (result.status === 0) {
              launched = true;
              break;
            }
          } catch {
            continue;
          }
        }
        if (launched) {
          writeSecretMigration();
          app.relaunch();
          app.exit(0);
        } else {
          shell.openPath(destPath);
        }
      } else if (format === "deb") {
        sendInstalling();
        await new Promise((r) => setTimeout(r, 150));
        fs.chmodSync(destPath, 0o644);
        const debLaunchers = [
          { bin: "pkexec", args: ["dpkg", "-i", destPath] },
          { bin: "pkexec", args: ["apt", "install", "-y", destPath] },
          { bin: "gdebi-gtk", args: [destPath] },
          { bin: "pkexec", args: ["gdebi", "-n", destPath] },
        ];
        let launched = false;
        for (const { bin, args } of debLaunchers) {
          try {
            const which = spawnSync(
              process.platform === "win32" ? "where" : "which",
              [bin],
              { encoding: "utf8" },
            );
            if (which.status !== 0) continue;
            // spawnSync, to wait for dpkg to finish before relaunching
            const result = spawnSync(bin, args, { stdio: "inherit" });
            if (result.status === 0) {
              launched = true;
              break;
            }
          } catch {
            continue;
          }
        }
        if (launched) {
          writeSecretMigration();
          app.relaunch();
          app.exit(0);
        } else {
          shell.openPath(destPath);
        }
      } else if (format === "exe") {
        sendInstalling();
        spawn(destPath, [], { detached: true, stdio: "ignore" }).unref();
        app.exit(0);
      } else if (format === "dmg") {
        sendInstalling();
        spawn("hdiutil", ["attach", destPath], {
          detached: true,
          stdio: "ignore",
        }).unref();
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      _updateAbortController = null;
    }
  });

  ipcMain.handle("cancel-update", () => {
    _updateAbortController?.abort();
  });

  // ── Proxy release-note images through the main process ───────────────────
  // Codeberg (and GitHub) release images are blocked by Electron's renderer
  // CSP. Fetch them here in the main process and return a base64 data-URI.

  const ALLOWED_IMAGE_HOSTS = new Set([
    "codeberg.org",
    "github.com",
    "user-images.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "objects.githubusercontent.com",
  ]);
  const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

  const fetchImageSecure = (url, resolve, redirectDepth = 0) => {
    if (redirectDepth > 1) return resolve(null);
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return resolve(null);
    }
    if (parsed.protocol !== "https:") return resolve(null);
    if (!ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) return resolve(null);

    https
      .get(
        url,
        { headers: { "User-Agent": "Streambert-ReleaseNotes" } },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            const next = res.headers.location.startsWith("http")
              ? res.headers.location
              : new URL(res.headers.location, url).toString();
            return fetchImageSecure(next, resolve, redirectDepth + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }
          const ct = res.headers["content-type"] || "";
          if (!ct.startsWith("image/")) {
            res.resume();
            return resolve(null);
          }

          const chunks = [];
          let total = 0;
          res.on("data", (c) => {
            total += c.length;
            if (total > IMAGE_SIZE_LIMIT) {
              res.destroy();
              return resolve(null);
            }
            chunks.push(c);
          });
          res.on("end", () =>
            resolve(
              `data:${ct};base64,${Buffer.concat(chunks).toString("base64")}`,
            ),
          );
          res.on("error", () => resolve(null));
        },
      )
      .on("error", () => resolve(null));
  };

  ipcMain.handle(
    "fetch-release-image",
    (_, { url }) => new Promise((resolve) => fetchImageSecure(url, resolve)),
  );

  // ── Query video progress across all webview frames ────────────────────────
  // executeJavaScript on a webview only reaches the top frame.
  // VidSrc / 2embed nest the player inside cross-origin iframes, iterate
  // all frames from the main process where same-origin restrictions don't apply.
  ipcMain.handle("query-video-progress", async (_, webContentsId) => {
    try {
      const { webContents } = require("electron");
      const wc = webContents.fromId(webContentsId);
      if (!wc || wc.isDestroyed()) return null;

      // Recursively collect all frames
      const allFrames = [];
      const collect = (frame) => {
        allFrames.push(frame);
        for (const child of frame.frames || []) collect(child);
      };
      collect(wc.mainFrame);

      const JS = `
        (() => {
          const v = document.querySelector('video');
          if (!v || !v.duration || v.duration === Infinity || v.paused) return null;
          if (!v._seekTracked) {
            v._seekTracked = true;
            v.addEventListener('seeked', () => {
              v._lastUserSeek = Date.now();
              v._lastUserSeekTo = v.currentTime;
            });
          }
          return {
            currentTime: v.currentTime,
            duration: v.duration,
            recentUserSeek: v._lastUserSeek ? (Date.now() - v._lastUserSeek < 6000) : false,
            lastUserSeekTo: v._lastUserSeekTo ?? null,
          };
        })()
      `;

      for (const frame of allFrames) {
        try {
          const result = await frame.executeJavaScript(JS);
          if (result && result.duration > 0) return result;
        } catch {}
      }
      return null;
    } catch {
      return null;
    }
  });

  // ── Set subtitle delay/offset timing via textTracks cue manipulation ──────
  ipcMain.handle("set-subtitle-offset", async (_, { webContentsId, offsetSeconds, showOsd }) => {
    try {
      const { webContents } = require("electron");
      const wc = webContents.fromId(webContentsId);
      if (!wc || wc.isDestroyed()) return { ok: false };

      const allFrames = [];
      const collect = (frame) => {
        allFrames.push(frame);
        for (const child of frame.frames || []) collect(child);
      };
      collect(wc.mainFrame);

      const JS = `
        (() => {
          const offset = parseFloat(${offsetSeconds});
          window.__subtitleOffset = offset;
          
          const v = document.querySelector('video');
          if (!v || !v.textTracks) return false;
          
          if (!v._originalCues) {
            v._originalCues = new Map();
          }
          
          let modified = false;
          
          for (let i = 0; i < v.textTracks.length; i++) {
            const track = v.textTracks[i];
            const originalMode = track.mode;
            if (originalMode === 'disabled') {
              track.mode = 'hidden';
            }
            
            if (track.cues) {
              if (!v._originalCues.has(track)) {
                v._originalCues.set(track, []);
              }
              const originals = v._originalCues.get(track);
              const knownCues = new Set(originals.map(o => o.cue));
              
              for (let j = 0; j < track.cues.length; j++) {
                const c = track.cues[j];
                if (!knownCues.has(c)) {
                  originals.push({
                    cue: c,
                    startTime: c.startTime,
                    endTime: c.endTime
                  });
                }
              }
              
              for (const entry of originals) {
                entry.cue.startTime = entry.startTime + offset;
                entry.cue.endTime = entry.endTime + offset;
              }
              modified = true;
            }
            
            if (originalMode === 'disabled') {
              track.mode = 'disabled';
            } else {
              if (!track._redrawTimeout) {
                track._redrawTimeout = setTimeout(() => {
                  const currentMode = track.mode;
                  track.mode = 'disabled';
                  track.mode = currentMode;
                  track._redrawTimeout = null;
                }, 80);
              }
            }
          }
          function findElementDeep(selector, root = document.body || document.documentElement) {
            if (!root) return null;
            try {
              const el = root.querySelector(selector);
              if (el) return el;
            } catch (e) {}
            if (root.children) {
              for (let j = 0; j < root.children.length; j++) {
                const found = findElementDeep(selector, root.children[j]);
                if (found) return found;
              }
            }
            if (root.shadowRoot) {
              const found = findElementDeep(selector, root.shadowRoot);
              if (found) return found;
            }
            return null;
          }

          const card = findElementDeep('#__subtitle-delay-card');
          if (card) {
            const slider = card.querySelector('input[type="range"]') || card.querySelector('.streambert-slider');
            if (slider) slider.value = offset;
            const textInput = card.querySelector('.streambert-text-input');
            if (textInput) textInput.value = Math.round(offset * 1000);
            let labelEl = null;
            const labels = card.querySelectorAll('*');
            for (const el of labels) {
              if (el.textContent.trim().includes('ms')) {
                labelEl = el;
                break;
              }
            }
            if (labelEl) {
              const ms = Math.round(offset * 1000);
              labelEl.textContent = (ms > 0 ? "+" : "") + ms + " ms";
            }
          }
          if (${!!showOsd}) {
            const parent = document.fullscreenElement || v.parentElement || document.body;
            let osd = document.getElementById('__streambert-osd');
            if (!osd) {
              osd = document.createElement('div');
              osd.id = '__streambert-osd';
              osd.style.cssText = 'position: absolute; top: 28px; right: 28px; z-index: 2147483647; color: #ffffff; font-family: system-ui, -apple-system, sans-serif; font-size: 24px; font-weight: 800; text-shadow: 2px 2px 0px #000000, -1px -1px 0px #000000, 1px -1px 0px #000000, -1px 1px 0px #000000, 1px 1px 0px #000000; pointer-events: none; letter-spacing: 0.5px; opacity: 0; transition: opacity 0.15s ease;';
            }
            if (osd.parentElement !== parent) {
              parent.appendChild(osd);
            }
            const ms = Math.round(offset * 1000);
            osd.textContent = "Subtitle delay: " + (ms > 0 ? "+" : "") + ms + " ms";
            osd.style.opacity = '1';
            if (window.__osdTimeout) clearTimeout(window.__osdTimeout);
            window.__osdTimeout = setTimeout(() => {
              osd.style.opacity = '0';
            }, 2000);
          }
          return modified;
        })()
      `;

      for (const frame of allFrames) {
        try {
          const result = await frame.executeJavaScript(JS);
          if (result) return { ok: true };
        } catch {}
      }
      return { ok: false, reason: "No video player or active text tracks found in any frame" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("inject-subtitle-menu", async (_, webContentsId) => {
    try {
      const { webContents } = require("electron");
      const wc = webContents.fromId(webContentsId);
      if (!wc || wc.isDestroyed()) return { ok: false };

      const allFrames = [];
      const collect = (frame) => {
        allFrames.push(frame);
        for (const child of frame.frames || []) collect(child);
      };
      collect(wc.mainFrame);

      const JS = `
        (function() {
          if (window.__subtitleDelayControlsInjected) return;

          function findTextNodeDeep(text, root = document.body || document.documentElement) {
            if (!root) return null;
            if (root.nodeType === Node.TEXT_NODE && root.nodeValue.trim() === text) {
              return root;
            }
            if (root.childNodes) {
              for (const child of root.childNodes) {
                const found = findTextNodeDeep(text, child);
                if (found) return found;
              }
            }
            if (root.shadowRoot) {
              const found = findTextNodeDeep(text, root.shadowRoot);
              if (found) return found;
            }
            return null;
          }

          function findBlockContainer(text) {
            const node = findTextNodeDeep(text);
            if (!node) return null;
            
            let parent = node.parentElement;
            while (parent && parent.parentNode && parent.parentNode.tagName !== 'BODY') {
              const parentNode = parent.parentNode;
              const siblings = parentNode.children ? Array.from(parentNode.children) : [];
              const hasOther = siblings.some(sib => sib !== parent && (sib.textContent.includes("Subtitle Size") || sib.textContent.includes("Subtitle Position")));
              if (hasOther) {
                return parent;
              }
              if (parentNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE && parentNode.host) {
                parent = parentNode.host;
              } else {
                parent = parentNode;
              }
            }
            return node.parentElement;
          }

          function runInjection() {
            const posCard = findBlockContainer("Subtitle Position");
            const sizeCard = findBlockContainer("Subtitle Size");
            if (!posCard || !sizeCard) return;

            if (document.getElementById('__subtitle-delay-card')) return;

            // Inject custom slider styling into the card's containing ShadowRoot or document
            const rootNode = posCard.getRootNode();
            const styleContainer = (rootNode && rootNode !== document) ? rootNode : (document.head || document.documentElement);
            if (!styleContainer.querySelector('#__streambert-slider-styles')) {
              const style = document.createElement('style');
              style.id = '__streambert-slider-styles';
              style.textContent = '#__subtitle-delay-card * { overflow: visible !important; } #__subtitle-delay-card input.streambert-text-input { -webkit-appearance: none !important; appearance: none !important; width: 100% !important; height: 36px !important; background: rgba(255, 255, 255, 0.08) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; border-radius: 6px !important; outline: none !important; padding: 0 12px !important; font-family: inherit !important; font-size: 14px !important; font-weight: 500 !important; margin: 8px 0 !important; box-sizing: border-box !important; text-align: center !important; } #__subtitle-delay-card input.streambert-text-input:focus { border-color: var(--accent, #e50914) !important; background: rgba(255, 255, 255, 0.12) !important; } #__subtitle-delay-card input.streambert-text-input::-webkit-outer-spin-button, #__subtitle-delay-card input.streambert-text-input::-webkit-inner-spin-button { -webkit-appearance: none !important; margin: 0 !important; } #__subtitle-delay-card input.streambert-text-input[type=number] { -moz-appearance: textfield !important; }';
              styleContainer.appendChild(style);
            }

            const delayCard = posCard.cloneNode(true);
            delayCard.id = '__subtitle-delay-card';

            const walker = document.createTreeWalker(delayCard, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
              if (node.nodeValue.trim() === "Subtitle Position") {
                node.nodeValue = "Subtitle Delay";
                break;
              }
            }

            const iconSvg = delayCard.querySelector('svg');
            if (iconSvg) {
              iconSvg.outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;flex-shrink:0;margin-right:2px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
            }

            let labelEl = null;
            const labels = delayCard.querySelectorAll('*');
            for (const el of labels) {
              const txt = el.textContent.trim();
              if (txt.includes('%') || (txt.length > 0 && !isNaN(parseInt(txt)))) {
                labelEl = el;
                break;
              }
            }

            if (labelEl) {
              labelEl.style.color = 'var(--accent, var(--red))';
              labelEl.style.fontWeight = '700';
            }

            function updateLabel(val) {
              if (labelEl) {
                const ms = Math.round(val * 1000);
                labelEl.textContent = (ms > 0 ? "+" : "") + ms + " ms";
              }
            }

            function findSliderParallel(orig, clone) {
              if (!orig || !clone) return null;
              const tag = orig.tagName.toLowerCase();
              if (orig !== posCard) {
                if (
                  orig.shadowRoot ||
                  tag.includes('-') ||
                  tag.includes('slider') ||
                  tag.includes('range') ||
                  orig.getAttribute('role') === 'slider' ||
                  (orig.className && typeof orig.className === 'string' && (orig.className.includes('slider') || orig.className.includes('track')))
                ) {
                  return clone;
                }
              }
              for (let i = 0; i < orig.children.length; i++) {
                const found = findSliderParallel(orig.children[i], clone.children[i]);
                if (found) return found;
              }
              return null;
            }

            let inputEl = null;
            const targetSlider = findSliderParallel(posCard, delayCard);
            if (targetSlider) {
              inputEl = document.createElement('input');
              inputEl.type = 'number';
              inputEl.className = 'streambert-text-input';
              inputEl.placeholder = '0';
              targetSlider.parentNode.replaceChild(inputEl, targetSlider);
            } else {
              inputEl = document.createElement('input');
              inputEl.type = 'number';
              inputEl.className = 'streambert-text-input';
              inputEl.placeholder = '0';
              delayCard.appendChild(inputEl);
            }

            inputEl.value = Math.round((window.__subtitleOffset || 0) * 1000);
            updateLabel(window.__subtitleOffset || 0);

            function applyDelay(val) {
              window.__subtitleOffset = val;
              const v = document.querySelector('video');
              if (v && v.textTracks) {
                if (!v._originalCues) {
                  v._originalCues = new Map();
                }
                const offset = parseFloat(val);
                for (let i = 0; i < v.textTracks.length; i++) {
                  const track = v.textTracks[i];
                  const originalMode = track.mode;
                  if (originalMode === 'disabled') {
                    track.mode = 'hidden';
                  }
                  if (track.cues) {
                    if (!v._originalCues.has(track)) {
                      v._originalCues.set(track, []);
                    }
                    const originals = v._originalCues.get(track);
                    const knownCues = new Set(originals.map(o => o.cue));
                    for (let j = 0; j < track.cues.length; j++) {
                      const c = track.cues[j];
                      if (!knownCues.has(c)) {
                        originals.push({
                          cue: c,
                          startTime: c.startTime,
                          endTime: c.endTime
                        });
                      }
                    }
                    for (const entry of originals) {
                      entry.cue.startTime = entry.startTime + offset;
                      entry.cue.endTime = entry.endTime + offset;
                    }
                  }
                  
                  if (originalMode === 'disabled') {
                    track.mode = 'disabled';
                  } else {
                    if (!track._redrawTimeout) {
                      track._redrawTimeout = setTimeout(() => {
                        const currentMode = track.mode;
                        track.mode = 'disabled';
                        track.mode = currentMode;
                        track._redrawTimeout = null;
                      }, 80);
                    }
                  }
                }
              }
              // Show VLC-style OSD inside this frame
              if (v) {
                const parentElement = document.fullscreenElement || v.parentElement || document.body;
                let osd = document.getElementById('__streambert-osd');
                if (!osd) {
                  osd = document.createElement('div');
                  osd.id = '__streambert-osd';
                  osd.style.cssText = 'position: absolute; top: 28px; right: 28px; z-index: 2147483647; color: #ffffff; font-family: system-ui, -apple-system, sans-serif; font-size: 24px; font-weight: 800; text-shadow: 2px 2px 0px #000000, -1px -1px 0px #000000, 1px -1px 0px #000000, -1px 1px 0px #000000, 1px 1px 0px #000000; pointer-events: none; letter-spacing: 0.5px; opacity: 0; transition: opacity 0.15s ease;';
                }
                if (osd.parentElement !== parentElement) {
                  parentElement.appendChild(osd);
                }
                const ms = Math.round(val * 1000);
                osd.textContent = "Subtitle delay: " + (ms > 0 ? "+" : "") + ms + " ms";
                osd.style.opacity = '1';
                if (window.__osdTimeout) clearTimeout(window.__osdTimeout);
                window.__osdTimeout = setTimeout(() => {
                  osd.style.opacity = '0';
                }, 2000);
              }
              console.log('streambert:sub-offset-changed:' + val);
            }

            inputEl.addEventListener('input', (e) => {
              let valMs = parseFloat(e.target.value);
              if (isNaN(valMs)) valMs = 0;
              const valSec = valMs / 1000;
              updateLabel(valSec);
              applyDelay(valSec);
            });

            const buttonContainerTemplate = sizeCard.querySelector('button')?.parentElement;
            if (buttonContainerTemplate) {
              const btnContainer = buttonContainerTemplate.cloneNode(true);
              const btns = btnContainer.querySelectorAll('button');
              if (btns.length >= 3) {
                btns[0].textContent = "-50ms";
                const newBtn0 = btns[0].cloneNode(true);
                newBtn0.addEventListener('click', () => {
                  let currentValMs = parseFloat(inputEl.value);
                  if (isNaN(currentValMs)) currentValMs = 0;
                  const valMs = Math.max(-10000, currentValMs - 50);
                  inputEl.value = valMs;
                  const valSec = valMs / 1000;
                  updateLabel(valSec);
                  applyDelay(valSec);
                });
                btns[0].parentNode.replaceChild(newBtn0, btns[0]);

                btns[1].textContent = "Reset";
                const newBtn1 = btns[1].cloneNode(true);
                newBtn1.style.fontWeight = '600';
                newBtn1.addEventListener('click', () => {
                  inputEl.value = 0;
                  updateLabel(0);
                  applyDelay(0);
                });
                btns[1].parentNode.replaceChild(newBtn1, btns[1]);

                btns[2].textContent = "+50ms";
                const newBtn2 = btns[2].cloneNode(true);
                newBtn2.addEventListener('click', () => {
                  let currentValMs = parseFloat(inputEl.value);
                  if (isNaN(currentValMs)) currentValMs = 0;
                  const valMs = Math.min(10000, currentValMs + 50);
                  inputEl.value = valMs;
                  const valSec = valMs / 1000;
                  updateLabel(valSec);
                  applyDelay(valSec);
                });
                btns[2].parentNode.replaceChild(newBtn2, btns[2]);
              }
              delayCard.appendChild(btnContainer);
            }

            posCard.parentNode.insertBefore(delayCard, posCard.nextSibling);
          }

          setInterval(runInjection, 150);
          window.__subtitleDelayControlsInjected = true;
        })();
      `;

      for (const frame of allFrames) {
        try {
          frame.executeJavaScript(JS);
        } catch {}
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── Central audio-device-change recovery (macOS HDMI/TV fix) ─────────────────
// When the user switches audio output (e.g. Speakers → HDMI TV), Chromium
// suspends every AudioContext in every session.

function registerAudioDeviceRecovery() {
  if (process.platform !== "darwin") return; // only needed on macOS

  const { session, webContents, ipcMain: ipc } = require("electron");

  const RECOVERY_JS = `
    (() => {
      async function recoverAudio() {
        const ctxs = window.__audioContexts || [];
        for (const ctx of ctxs) {
          try { if (ctx.state === 'suspended') await ctx.resume(); } catch {}
        }
        const v = document.querySelector('video');
        if (!v || v.paused) return;
        const t = v.currentTime;
        try {
          v.pause();
          await new Promise(r => setTimeout(r, 80));
          v.currentTime = t;
          await v.play();
        } catch {}
      }
      recoverAudio();
    })()
  `;

  const recoverAllWebContents = () => {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed()) continue;
      wc.executeJavaScript(RECOVERY_JS).catch(() => {});
      try {
        for (const frame of wc.mainFrame?.framesInSubtree ?? []) {
          try {
            frame.executeJavaScript(RECOVERY_JS);
          } catch {}
        }
      } catch {}
    }
  };

  // Hook 1: Chromium's built-in device-selection event
  session.defaultSession.on(
    "select-audio-device",
    (event, details, callback) => {
      callback(""); // let Chromium pick the default, don't block
      setTimeout(recoverAllWebContents, 150);
    },
  );

  // Hook 2: renderer sends this when navigator.mediaDevices fires "devicechange"
  ipc.on("audio-device-changed", () => setTimeout(recoverAllWebContents, 150));
}

module.exports = { register, registerAudioDeviceRecovery };
