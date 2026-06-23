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
  ipcMain.handle(
    "open-path-at-time",
    (_, { filePath, seconds, subtitlePaths }) => {
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

      const subFilePaths = Array.isArray(subtitlePaths)
        ? subtitlePaths
            .map((sp) => (typeof sp === "string" ? sp : sp?.path))
            .filter((p) => p && fs.existsSync(p))
        : [];
      const mpvSubArgs = subFilePaths.map((p) => `--sub-file=${p}`);
      const vlcSubArgs =
        subFilePaths.length > 0 ? [`--sub-file=${subFilePaths[0]}`] : [];

      if (sec > 0) {
        for (const mpv of mpvPaths) {
          if (tryLaunch(mpv, [`--start=${sec}`, ...mpvSubArgs, filePath]))
            return;
        }
        for (const vlc of vlcPaths) {
          if (tryLaunch(vlc, [`--start-time=${sec}`, ...vlcSubArgs, filePath]))
            return;
        }
      } else if (mpvSubArgs.length > 0) {
        for (const mpv of mpvPaths) {
          if (tryLaunch(mpv, [...mpvSubArgs, filePath])) return;
        }
        for (const vlc of vlcPaths) {
          if (tryLaunch(vlc, [...vlcSubArgs, filePath])) return;
        }
      }

      shell.openPath(filePath);
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
}

module.exports = { register };
