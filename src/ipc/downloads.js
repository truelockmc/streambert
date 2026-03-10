// ── IPC: Downloads ────────────────────────────────────────────────────────────
// Manages the download queue, spawns the downloader binary, tracks progress,
// and handles all download-related IPC handlers.

const { app, ipcMain, shell, dialog, session } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const os = require("os");

// ── Download store ────────────────────────────────────────────────────────────

let downloads = [];
let _downloadsFile = null;
const downloadsFile = () =>
  _downloadsFile ||
  (_downloadsFile = path.join(app.getPath("userData"), "downloads.json"));

// Track running child processes by download id
const activeProcs = new Map();

let _getMainWindow = () => null;

function sendProgress(update) {
  const mw = _getMainWindow();
  if (mw && !mw.isDestroyed()) {
    mw.webContents.send("download-progress", update);
  }
}

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
          : d.id;
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
    const idx = downloads.findIndex((d) => d.id === id);
    if (idx !== -1) {
      downloads[idx].status = "error";
      downloads[idx].lastMessage = "Cancelled on exit";
    }
    activeProcs.delete(id);
  }
  const folders = new Set(downloads.map((d) => d.downloadPath).filter(Boolean));
  for (const folder of folders) cleanupTempFiles(folder);
  saveDownloads();
}

// ── Subtitle file downloader (used during run-download completion) ─────────────

function downloadSubtitleFile(url, destPath) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol === "file:") {
        try {
          fs.copyFileSync(decodeURIComponent(parsedUrl.pathname), destPath);
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

// ── IPC registration ──────────────────────────────────────────────────────────

function register(getMainWindow) {
  _getMainWindow = getMainWindow;

  // ── downloader binary detection ──────────────────────────────────────────
  ipcMain.handle("check-downloader", (_, folderPath) => {
    if (!folderPath) return { exists: false };
    try {
      const entries = fs.readdirSync(folderPath);
      if (!entries.includes("_internal")) return { exists: false };
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

  // ── start download ────────────────────────────────────────────────────────
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
        const logPath = path.join(os.tmpdir(), `streambert_dl_${id}.log`);

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
          subtitlePaths: [],
          logPath,
        };

        // Create log file with header
        try {
          fs.writeFileSync(
            logPath,
            `Streambert Download Log\nName: ${name}\nURL: ${m3u8Url}\nStarted: ${new Date().toISOString()}\n${"─".repeat(60)}\n`,
            "utf8",
          );
        } catch {}

        downloads.push(entry);

        // Remove stale entries for the same media
        const isSameMedia = (d) =>
          d.id !== id &&
          d.tmdbId &&
          d.tmdbId === entry.tmdbId &&
          d.mediaType === entry.mediaType &&
          String(d.season ?? "") === String(entry.season ?? "") &&
          String(d.episode ?? "") === String(entry.episode ?? "");
        downloads = downloads.filter((d) => !isSameMedia(d));

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

        const handleLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          const idx = downloads.findIndex((d) => d.id === id);
          if (idx === -1) return;

          const update = {};

          // (frag N/total), source of truth for HLS progress
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

          // [download] X% of Y (direct mp4, no fragments)
          if (!fragMatch && !downloads[idx].totalFragments) {
            const dlPctMatch = trimmed.match(
              /^\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*(?:[KMGT]i?B|B))/i,
            );
            if (dlPctMatch) {
              const pct = parseFloat(dlPctMatch[1]);
              update.progress = Math.min(99, Math.round(pct));
              update.size = dlPctMatch[2].trim();
              const spMatch = trimmed.match(
                /\bat\s+([\d.]+\s*(?:[KMGT]i?B|B)\/s)/i,
              );
              if (spMatch) update.speed = spMatch[1].trim();
              update.lastMessage = `${Math.round(pct)}% of ${update.size}`;
            }
          }

          // ffmpeg Duration line
          const durationMatch = trimmed.match(
            /Duration:\s*(\d+):(\d+):([\d.]+)/,
          );
          if (durationMatch) {
            const totalSecs =
              parseInt(durationMatch[1]) * 3600 +
              parseInt(durationMatch[2]) * 60 +
              parseFloat(durationMatch[3]);
            if (totalSecs > 0) downloads[idx]._ffmpegTotalSecs = totalSecs;
            return;
          }

          // ffmpeg progress: size=… time=…
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
            const speedXMatch = trimmed.match(/speed=\s*([\d.]+)x/i);
            if (speedXMatch) update.speed = `${speedXMatch[1]}x`;
            update.lastMessage = `Processing… ${update.size}${update.speed ? ` at ${update.speed}` : ""}`;
          }

          // Retry / timeout
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

          const sizeMatch = trimmed.match(
            /\bof\s+~?\s*([\d.]+\s*(?:[KMGT]i?B|B))\b/i,
          );
          if (sizeMatch) update.size = sizeMatch[1].trim();

          // [hlsnative] Total fragments: N
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

          // [download] Destination: /path/file
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

          // [Merger] output path
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
            if (!suppress) update.lastMessage = trimmed;
          }

          if (Object.keys(update).length > 0) {
            downloads[idx] = { ...downloads[idx], ...update };
            sendProgress({ id, ...update, status: downloads[idx].status });
          }
        };

        let buf = "";
        let stderrBuf = "";

        const appendLog = (line) => {
          try {
            fs.appendFileSync(logPath, line + "\n", "utf8");
          } catch {}
        };

        proc.stdout.on("data", (chunk) => {
          buf += chunk.toString();
          const lines = buf.split(/\r\n|\r|\n/);
          buf = lines.pop();
          lines.forEach((l) => {
            appendLog(l);
            handleLine(l);
          });
        });
        proc.stderr.on("data", (chunk) => {
          const text = chunk.toString();
          stderrBuf += text;
          text.split(/\r\n|\r|\n/).forEach((l) => {
            appendLog(l);
            handleLine(l);
          });
        });

        proc.on("close", (code) => {
          activeProcs.delete(id);
          if (buf.trim()) {
            appendLog(buf.trim());
            handleLine(buf.trim());
          }
          const idx = downloads.findIndex((d) => d.id === id);
          if (idx === -1) return;

          const status = code === 0 ? "completed" : "error";
          downloads[idx].status = status;
          downloads[idx].completedAt = Date.now();
          if (code === 0) {
            downloads[idx].progress = 100;
            // Success: delete log file, clear logPath
            downloads[idx].logPath = null;
            try {
              fs.unlinkSync(logPath);
            } catch {}
          } else {
            // Failure: append footer to log and keep the path
            try {
              fs.appendFileSync(
                logPath,
                `${"─".repeat(60)}\nFailed: exit code ${code}\nFinished: ${new Date().toISOString()}\n`,
                "utf8",
              );
            } catch {}
            // Extract most meaningful error line from stderr
            const errorLine =
              stderrBuf
                .split(/\r\n|\r|\n/)
                .map((l) => l.trim())
                .filter(Boolean)
                .reverse()
                .find((l) => /error|failed|unable|cannot|denied/i.test(l)) ||
              "";
            const prev = downloads[idx].lastMessage || "";
            const base = errorLine || prev;
            downloads[idx].lastMessage = base
              ? `${base} (exit ${code})`
              : `Download failed (exit code ${code})`;
          }

          // Detect output file if destination line wasn't caught
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

          // Rename file to proper media name
          if (code === 0 && downloads[idx].filePath) {
            try {
              const ext = path.extname(downloads[idx].filePath) || ".mp4";
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

          // Download subtitle files
          if (
            code === 0 &&
            downloads[idx].subtitles?.length > 0 &&
            downloads[idx].filePath
          ) {
            const videoBase = downloads[idx].filePath.replace(/\.[^.]+$/, "");
            const langCounter = {};
            const KNOWN_SUB_EXTS = [
              ".vtt",
              ".srt",
              ".ass",
              ".ssa",
              ".sub",
              ".idx",
            ];
            const subPromises = downloads[idx].subtitles.map(
              ({ url, lang, name: subName, file_id }) => {
                const urlClean = url.split("?")[0].split("#")[0];
                const urlExt = path
                  .extname(urlClean)
                  .toLowerCase()
                  .replace(/[^a-z0-9.]/g, "");
                const nameExt = subName
                  ? path
                      .extname(subName)
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
            name,
            status: downloads[idx].status,
            progress: downloads[idx].progress,
            completedAt: downloads[idx].completedAt,
            filePath: downloads[idx].filePath,
            size: downloads[idx].size,
            completedFragments: downloads[idx].completedFragments,
            totalFragments: downloads[idx].totalFragments,
            lastMessage: downloads[idx].lastMessage,
            logPath: downloads[idx].logPath,
          });
          saveDownloads();
        });

        return { ok: true, id };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  );

  ipcMain.handle("get-downloads", () => downloads);

  ipcMain.handle("delete-download", (_, { id, filePath }) => {
    try {
      const dlEntry = downloads.find((d) => d.id === id);
      if (activeProcs.has(id)) {
        try {
          activeProcs.get(id).kill("SIGKILL");
        } catch {}
        activeProcs.delete(id);
      }
      if (filePath) {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {}
      }
      for (const sp of dlEntry?.subtitlePaths || []) {
        try {
          if (sp?.path && fs.existsSync(sp.path)) fs.unlinkSync(sp.path);
        } catch {}
      }
      const dlPath = dlEntry?.downloadPath;
      if (dlPath) cleanupTempFiles(dlPath);
      downloads = downloads.filter((d) => d.id !== id);
      saveDownloads();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

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

  ipcMain.handle("get-downloads-size", async () => {
    let bytes = 0;
    await Promise.all(
      downloads.map(async (dl) => {
        if (!dl.filePath) return;
        try {
          const stat = await fs.promises.stat(dl.filePath);
          if (stat.isFile()) bytes += stat.size;
        } catch {}
      }),
    );
    return { bytes };
  });

  ipcMain.handle("show-in-folder", (_, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
    else shell.openPath(path.dirname(filePath || ""));
  });

  ipcMain.handle("file-exists", (_, filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  });

  ipcMain.handle("pick-folder", async () => {
    const mw = getMainWindow();
    if (!mw) return null;
    const result = await dialog.showOpenDialog(mw, {
      properties: ["openDirectory"],
      title: "Select Folder",
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("open-external", (_, url) => {
    shell.openExternal(url);
  });
  ipcMain.handle("open-path", (_, filePath) => {
    shell.openPath(filePath);
  });

  ipcMain.handle("scan-directory", (_, folderPath) => {
    try {
      if (!folderPath || !fs.existsSync(folderPath)) return [];
      const VIDEO_EXTS = [
        ".mp4",
        ".mkv",
        ".webm",
        ".avi",
        ".mov",
        ".m4v",
        ".ts",
      ];
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

  ipcMain.handle("clear-watch-data", async () => {
    try {
      const vs = session.fromPartition("persist:videasy");
      await vs.clearStorageData();
      await vs.clearCache();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("get-cache-size", async () => {
    try {
      const sessions = [
        session.defaultSession,
        session.fromPartition("persist:videasy"),
        session.fromPartition("persist:trailer"),
      ];
      const sizes = await Promise.all(sessions.map((s) => s.getCacheSize()));
      return { bytes: sizes.reduce((a, b) => a + b, 0) };
    } catch {
      return { bytes: 0 };
    }
  });

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
}

module.exports = {
  register,
  loadDownloads,
  saveDownloads,
  killAllDownloads,
  getDownloads: () => downloads,
};
