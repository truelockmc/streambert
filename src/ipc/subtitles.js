// ── IPC: Subtitles ────────────────────────────────────────────────────────────
// Handles subtitle search (SubDL + Wyzie), ZIP extraction, download-for-file,
// and subtitle registry management in the downloads store.

const { ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const os = require("os");
const zlib = require("zlib");

// ── Robust fetch with timeout (AbortSignal.timeout is unreliable in some Electron versions) ──
function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// ── ZIP subtitle extractor ────────────────────────────────────────────────────

// Max decompressed zip size (10mb) to prevent zip-bombs
const ZIP_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

// Only these extensions are accepted as subtitle files.
const SUBTITLE_EXTS = new Set(["srt", "vtt", "ass", "ssa"]);

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
      const rawFileName = buf
        .slice(offset + 30, offset + 30 + fileNameLen)
        .toString("utf8");
      const dataOffset = offset + 30 + fileNameLen + extraLen;

      const fileName = path.basename(rawFileName);

      const ext = fileName.toLowerCase().split(".").pop();
      if (SUBTITLE_EXTS.has(ext)) {
        const compressedData = buf.slice(
          dataOffset,
          dataOffset + compressedSize,
        );
        let data;
        if (compression === 0) {
          // Stored (no compression)
          if (compressedData.length > ZIP_MAX_OUTPUT_BYTES) {
            offset = dataOffset + compressedSize;
            continue;
          }
          data = compressedData;
        } else if (compression === 8) {
          // cap the decompressed output to guard against ZIP-bombs
          try {
            data = zlib.inflateRawSync(compressedData, {
              maxOutputLength: ZIP_MAX_OUTPUT_BYTES,
            });
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

// ── Subtitle language extractor (from URL) ────────────────────────────────────

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

// ── IPC registration ──────────────────────────────────────────────────────────

function register({ getDownloads, saveDownloads }) {
  // ── Subtitle search ────────────────────────────────────────────────────────
  ipcMain.handle(
    "search-subtitles",
    async (
      _,
      {
        tmdbId,
        mediaType,
        season,
        episode,
        languages,
        subdlApiKey,
        wyzieApiKey,
      },
    ) => {
      function toSubDLLang(lang) {
        if (!lang) return "";
        return lang.split("-")[0].toUpperCase();
      }

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

          const res = await fetchWithTimeout(
            `https://api.subdl.com/api/v1/subtitles?${params}`,
            { headers: { "User-Agent": "Streambert" } },
            12000,
          );
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            return {
              ok: false,
              error: `SubDL error ${res.status}: ${errText}`,
            };
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
          const msg =
            e.name === "AbortError"
              ? "SubDL timed out, server may be temporarily unavailable"
              : e.message;
          return { ok: false, error: msg };
        }
      }

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

          if (wyzieApiKey) params.set("key", wyzieApiKey);

          const baseUrl = wyzieApiKey
            ? "https://sub.wyzie.io/search"
            : "https://subs.wyzie.ru/search";

          const res = await fetchWithTimeout(`${baseUrl}?${params}`, {}, 12000);
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              return {
                ok: false,
                error: `Wyzie API key invalid or expired (${res.status})`,
                wyzie_auth_error: true,
              };
            }
            return { ok: false, error: `Wyzie error ${res.status}` };
          }
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
          const msg =
            e.name === "AbortError"
              ? "Subtitle service timed out, it may be temporarily down. Try adding a free SubDL API key in Settings for reliable results."
              : e.message;
          return { ok: false, error: msg };
        }
      }
      const errors = [];
      if (subdlApiKey) {
        const r = await searchSubDL();
        if (r.ok) return r;
        errors.push(r.error);
      }
      const r = await searchWyzie();
      if (r.ok) return r;
      errors.push(r.error);
      const allTimedOut = errors.every((e) => e && e.includes("timed out"));
      return {
        ok: false,
        error: allTimedOut
          ? "Subtitle service timed out, it may be temporarily down. Add a free SubDL API key in Settings for reliable results."
          : errors.length > 0
            ? errors.join(" · ")
            : "No subtitles found. Try a different language or add a SubDL API key in Settings.",
      };
    },
  );

  // ── Get subtitle download URL ──────────────────────────────────────────────
  const TEMP_SUB_TTL_MS = 5 * 60 * 1000; // 5 minutes

  ipcMain.handle("get-subtitle-url", async (_, { fileId }) => {
    try {
      if (String(fileId).startsWith("subdl_")) {
        const parts = String(fileId).split("_");
        const subdlPath = decodeURIComponent(parts.slice(2).join("_"));
        const downloadUrl = `https://dl.subdl.com${subdlPath}`;
        const res = await fetchWithTimeout(
          downloadUrl,
          { headers: { "User-Agent": "Streambert" } },
          30000,
        );
        if (!res.ok)
          return { ok: false, error: `SubDL download error ${res.status}` };
        const zipBuffer = Buffer.from(await res.arrayBuffer());
        const extracted = extractFirstSubtitleFromZip(zipBuffer);
        if (!extracted)
          return { ok: false, error: "No subtitle file found in SubDL ZIP" };

        // extracted.name is already basename-sanitised by extractFirstSubtitleFromZip.
        const safeName = path.basename(extracted.name);
        const tmpPath = path.join(
          os.tmpdir(),
          `streambert_sub_${Date.now()}_${safeName}`,
        );
        fs.writeFileSync(tmpPath, extracted.data);

        // Schedule automatic cleanup so temp subtitles don't accumulate
        setTimeout(() => {
          try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          } catch {}
        }, TEMP_SUB_TTL_MS);

        return {
          ok: true,
          url: `file://${tmpPath}`,
          file_name: extracted.name,
          remaining: null,
          reset_time: null,
          via_subdl: true,
        };
      }

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

  // ── Download subtitles for an already-completed file ──────────────────────
  ipcMain.handle(
    "download-subtitles-for-file",
    async (_, { filePath, selectedSubs }) => {
      try {
        const resolvedFilePath = path.resolve(filePath);

        // The target must be an existing regular file.
        let targetStat;
        try {
          targetStat = fs.statSync(resolvedFilePath);
        } catch {
          return { ok: false, error: "Target file does not exist" };
        }
        if (!targetStat.isFile()) {
          return { ok: false, error: "Target path is not a file" };
        }

        // The file must reside inside a directory that was previously chosen
        // by the user as a download location (present in the downloads store),
        // OR it must be a known filePath from the registry.  This prevents a
        // compromised renderer from writing subtitle files to arbitrary paths.
        const allDownloads = getDownloads();
        const resolvedDir = path.dirname(resolvedFilePath);
        const isKnownFile = allDownloads.some(
          (d) => d.filePath && path.resolve(d.filePath) === resolvedFilePath,
        );
        const isInKnownDownloadDir = allDownloads.some((d) => {
          if (!d.downloadPath) return false;
          const dp = path.resolve(d.downloadPath);
          return (
            resolvedDir === dp || resolvedDir.startsWith(dp + path.sep)
          );
        });
        if (!isKnownFile && !isInKnownDownloadDir) {
          return {
            ok: false,
            error: "File is not in a known download directory",
          };
        }

        const dir = path.dirname(resolvedFilePath);
        const baseName = path.basename(resolvedFilePath, path.extname(resolvedFilePath));
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
              const subdlPath = decodeURIComponent(parts.slice(2).join("_"));
              const res = await fetchWithTimeout(
                `https://dl.subdl.com${subdlPath}`,
                { headers: { "User-Agent": "Streambert" } },
                30000,
              );
              if (!res.ok) continue;
              const zipBuf = Buffer.from(await res.arrayBuffer());
              const extracted = extractFirstSubtitleFromZip(zipBuf);
              if (!extracted) continue;
              fileData = extracted.data;

              ext = extracted.name.split(".").pop().toLowerCase();
              if (!SUBTITLE_EXTS.has(ext)) continue;
            } else {
              const url =
                sub.direct_url ||
                (String(sub.file_id).startsWith("wyzie_")
                  ? decodeURIComponent(
                      String(sub.file_id).split("_").slice(2).join("_"),
                    )
                  : null);
              if (!url) continue;
              const res = await fetchWithTimeout(url, {}, 30000);
              if (!res.ok) continue;
              fileData = Buffer.from(await res.arrayBuffer());
              const urlExt = url.split("?")[0].split(".").pop().toLowerCase();
              ext = SUBTITLE_EXTS.has(urlExt) ? urlExt : "srt";
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

        // Merge into download registry
        if (results.length > 0 && resolvedFilePath) {
          const downloads = getDownloads();
          const idx = downloads.findIndex((d) => d.filePath === resolvedFilePath);
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

  // ── Prune subtitle paths that no longer exist on disk ─────────────────────
  ipcMain.handle("prune-subtitle-paths", (_, { downloadId }) => {
    try {
      const downloads = getDownloads();
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

  // ── Delete a single subtitle file ─────────────────────────────────────────
  ipcMain.handle("delete-subtitle-file", (_, { downloadId, subtitlePath }) => {
    try {
      if (subtitlePath && fs.existsSync(subtitlePath))
        fs.unlinkSync(subtitlePath);
      if (downloadId) {
        const downloads = getDownloads();
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
}

module.exports = { register, extractSubtitleLang };
