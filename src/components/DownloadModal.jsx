import { useState, useEffect, useCallback } from "react";
import { CloseIcon, DownloadIcon, SettingsIcon, SubtitlesIcon } from "./Icons";
import {
  storage,
  STORAGE_KEYS,
  secureStorage,
  isElectron,
} from "../utils/storage";
import {
  SUBTITLE_LANGUAGES,
  LANG_LABEL,
  sourceBadgeStyle,
  sourceBadgeLabel,
} from "../utils/subtitles";

// ── Subtitle Browser (standalone component to avoid re-mount on parent re-render) ──
export function SubtitleBrowser({
  tmdbId,
  mediaType,
  season,
  episode,
  subdlApiKey,
  selectedSubs,
  setSelectedSubs,
  onClose,
  defaultLang,
}) {
  const [langFilter, setLangFilter] = useState(defaultLang);
  const [browseResults, setBrowseResults] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState(null);

  const doSearch = async (lang) => {
    setBrowsing(true);
    setBrowseError(null);
    try {
      const res = await window.electron.searchSubtitles({
        tmdbId,
        mediaType,
        season,
        episode,
        languages: lang || "",
        subdlApiKey,
      });
      if (!res.ok) {
        const errMsg = res.error || "Search failed";
        const is403 =
          errMsg.includes("403") ||
          errMsg.toLowerCase().includes("cannot consume");
        setBrowseError(
          is403
            ? "API error 403 – your OpenSubtitles API key is missing or invalid. Add a valid key in Settings."
            : errMsg,
        );
        setBrowseResults([]);
      } else setBrowseResults(res.results);
    } catch (e) {
      setBrowseError(e.message);
      setBrowseResults([]);
    } finally {
      setBrowsing(false);
    }
  };

  useEffect(() => {
    doSearch(langFilter);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={() => onClose()}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: 580,
          maxWidth: "95vw",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <SubtitlesIcon size={14} /> Browse Subtitles
            {selectedSubs.length > 0
              ? ` · ${selectedSubs.length} selected`
              : ""}
          </span>
          <button className="icon-btn" onClick={() => onClose()}>
            <CloseIcon />
          </button>
        </div>

        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text3)" }}>Language:</span>
          <select
            value={langFilter}
            onChange={(e) => {
              setLangFilter(e.target.value);
              doSearch(e.target.value);
            }}
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              padding: "5px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <option value="">All languages</option>
            {SUBTITLE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
          {browsing && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: 24,
                color: "var(--text3)",
                fontSize: 13,
              }}
            >
              <div
                className="spinner"
                style={{ width: 16, height: 16, borderWidth: 2 }}
              />{" "}
              Searching…
            </div>
          )}
          {browseError && (
            <div
              style={{
                padding: "16px 20px",
                color: "var(--red)",
                fontSize: 13,
              }}
            >
              ⚠ {browseError}
            </div>
          )}
          {!browsing && browseResults?.length === 0 && (
            <div
              style={{
                padding: "20px",
                color: "var(--text3)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              No subtitles found
            </div>
          )}
          {!browsing &&
            browseResults?.map((r) => {
              const isSelected = selectedSubs.some(
                (s) => s.file_id === r.file_id,
              );
              return (
                <div
                  key={r.file_id}
                  onClick={() => {
                    setSelectedSubs((prev) =>
                      isSelected
                        ? prev.filter((s) => s.file_id !== r.file_id)
                        : [...prev, r],
                    );
                  }}
                  style={{
                    padding: "9px 16px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--border)",
                    background: isSelected
                      ? "rgba(229,9,20,0.08)"
                      : "transparent",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = "var(--surface2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isSelected
                      ? "rgba(229,9,20,0.08)"
                      : "transparent";
                  }}
                >
                  {/* Checkbox */}
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      border: `2px solid ${isSelected ? "var(--red)" : "var(--border)"}`,
                      background: isSelected ? "var(--red)" : "transparent",
                      flexShrink: 0,
                      marginTop: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.15s",
                    }}
                  >
                    {isSelected && (
                      <span
                        style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        marginBottom: 3,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: "rgba(99,202,183,0.15)",
                          color: "#63cab7",
                          border: "1px solid rgba(99,202,183,0.3)",
                          textTransform: "uppercase",
                        }}
                      >
                        {r.language}
                      </span>
                      <span style={sourceBadgeStyle(r)}>
                        {sourceBadgeLabel(r)}
                      </span>
                      {r.hearing_impaired && (
                        <span
                          style={{ fontSize: 10, color: "var(--text3)" }}
                          title="Hearing impaired"
                        >
                          ♿
                        </span>
                      )}
                      {r.ai_translated && (
                        <span
                          style={{ fontSize: 10, color: "var(--text3)" }}
                          title="AI translated"
                        >
                          🤖
                        </span>
                      )}
                      {r.from_trusted && (
                        <span
                          style={{ fontSize: 10, color: "#4caf50" }}
                          title="Trusted"
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text)",
                        marginBottom: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.release ||
                        r.file_name ||
                        `${r.language.toUpperCase()} subtitle`}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>
                      {r.uploader} · {(r.download_count || 0).toLocaleString()}{" "}
                      downloads
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text3)" }}>
            {selectedSubs.length === 0
              ? "Click rows to select subtitles"
              : `${selectedSubs.length} subtitle${selectedSubs.length > 1 ? "s" : ""} selected`}
          </span>
          <button
            className="btn btn-primary"
            style={{ padding: "6px 18px", fontSize: 13 }}
            onClick={() => onClose()}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DownloadModal({
  onClose,
  m3u8Url,
  subtitles = [],
  mediaName,
  downloaderFolder,
  setDownloaderFolder,
  onOpenSettings,
  onDownloadStarted,
  mediaId,
  mediaType,
  season,
  episode,
  posterPath,
  tmdbId,
}) {
  const [downloadPath, setDownloadPath] = useState(
    () => storage.get("downloadPath") || "",
  );
  const [settingPath, setSettingPath] = useState(false);
  const [downloader, setDownloader] = useState(null);
  const [checking, setChecking] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState(null);

  const [subEnabled, setSubEnabled] = useState(
    () =>
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== 0 &&
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== "0",
  );
  const [subdlApiKey, setSubdlApiKey] = useState("");
  useEffect(() => {
    let mounted = true;
    secureStorage.get(STORAGE_KEYS.SUBDL_API_KEY).then((val) => {
      if (mounted && val) setSubdlApiKey(val);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const defaultLang = storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "en";

  const [subResults, setSubResults] = useState(null);
  const [subSearching, setSubSearching] = useState(false);
  const [subSearchError, setSubSearchError] = useState(null);
  const [selectedSubs, setSelectedSubs] = useState([]);
  const [showBrowser, setShowBrowser] = useState(false);

  const canSearchOS = isElectron && !!tmdbId;

  const ua = navigator.userAgent.toLowerCase();
  const binaryHint = ua.includes("win")
    ? "Windows_x64-portable"
    : ua.includes("mac")
      ? "For MacOS you will have to compile it yourself"
      : "Linux_x64-portable";
  const releaseUrl =
    "https://github.com/truelockmc/video-downloader/releases/latest";

  useEffect(() => {
    if (!downloaderFolder || !isElectron) return;
    let mounted = true;
    setChecking(true);
    window.electron.checkDownloader(downloaderFolder).then((result) => {
      if (!mounted) return;
      setDownloader(result);
      setChecking(false);
    });
    return () => {
      mounted = false;
    };
  }, [downloaderFolder]);

  const searchSubtitles = useCallback(
    async (lang) => {
      if (!canSearchOS) return;
      setSubSearching(true);
      setSubSearchError(null);
      setSubResults(null);
      setSelectedSubs([]);
      try {
        const res = await window.electron.searchSubtitles({
          tmdbId,
          mediaType,
          season,
          episode,
          languages: lang,
          subdlApiKey,
        });
        if (!res.ok) {
          const errMsg = res.error || "Search failed";
          const is403 =
            errMsg.includes("403") ||
            errMsg.toLowerCase().includes("cannot consume");
          setSubSearchError(
            is403
              ? "API error 403 – your OpenSubtitles API key is missing or invalid. Add a valid key in Settings."
              : errMsg,
          );
          setSubResults([]);
          return;
        }
        setSubResults(res.results);
        if (res.results.length > 0) setSelectedSubs([res.results[0]]);
      } catch (e) {
        setSubSearchError(e.message);
        setSubResults([]);
      } finally {
        setSubSearching(false);
      }
    },
    [canSearchOS, tmdbId, mediaType, season, episode, subdlApiKey],
  );

  useEffect(() => {
    if (m3u8Url && subEnabled && canSearchOS) {
      searchSubtitles(defaultLang);
    }
  }, [m3u8Url, subEnabled]);

  const pickBinaryFolder = async () => {
    const folder = await window.electron.pickFolder();
    if (folder) setDownloaderFolder(folder);
  };
  const pickDownloadFolder = async () => {
    const folder = await window.electron.pickFolder();
    if (folder) {
      setDownloadPath(folder);
      storage.set("downloadPath", folder);
      setSettingPath(false);
    }
  };

  const handleDownload = async () => {
    if (!downloader?.binaryPath || !downloadPath || !m3u8Url) return;
    setDownloadStatus("starting");

    let resolvedSubs = [...subtitles];
    if (subEnabled && selectedSubs.length > 0) {
      for (const sub of selectedSubs) {
        try {
          let url = sub.direct_url || null;
          let resolvedFileName = null;
          if (!url && sub.file_id) {
            const urlRes = await window.electron.getSubtitleUrl({
              fileId: sub.file_id,
            });
            if (urlRes.ok) {
              url = urlRes.url;
              resolvedFileName = urlRes.file_name || null;
            }
          }
          if (url) {
            resolvedSubs.push({
              url,
              lang: sub.language,
              name: resolvedFileName || sub.release || sub.file_name,
              file_id: sub.file_id || null,
            });
          }
        } catch {}
      }
    }

    const result = await window.electron.runDownload({
      binaryPath: downloader.binaryPath,
      m3u8Url,
      subtitles: resolvedSubs,
      name: mediaName,
      downloadPath,
      mediaId,
      mediaType,
      season,
      episode,
      posterPath: posterPath || null,
      tmdbId: tmdbId || mediaId || null,
    });

    if (result.ok) {
      onDownloadStarted?.({
        id: result.id,
        name: mediaName,
        m3u8Url,
        downloadPath,
        filePath: null,
        status: "downloading",
        progress: 0,
        speed: "",
        size: "",
        totalFragments: 0,
        lastMessage: "Starting…",
        startedAt: Date.now(),
        completedAt: null,
        mediaId,
        mediaType,
        season,
        episode,
        posterPath: posterPath || null,
        tmdbId: tmdbId || mediaId || null,
        subtitles: resolvedSubs,
        subtitlePaths: [],
      });
      setDownloadStatus("ok");
    } else {
      setDownloadStatus(result.error || "Failed to start");
    }
  };

  // ── No download path ───────────────────────────────────────────────────────
  if (!downloadPath || settingPath) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="download-modal" onClick={(e) => e.stopPropagation()}>
          <div className="download-modal-header">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DownloadIcon /> Set Download Folder
            </span>
            <button className="icon-btn" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <div style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 14,
                color: "var(--text2)",
                marginBottom: 20,
                lineHeight: 1.6,
              }}
            >
              {settingPath ? (
                "Choose where downloaded videos should be saved:"
              ) : (
                <>
                  <span style={{ color: "var(--red)", fontWeight: 600 }}>
                    No download folder set.
                  </span>
                  <br />
                  Choose where to save downloaded videos:
                </>
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <input
                className="apikey-input"
                style={{ flex: 1, minWidth: 200, marginBottom: 0 }}
                placeholder="/home/you/Movies"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
              />
              {isElectron && (
                <button
                  className="btn btn-secondary"
                  onClick={pickDownloadFolder}
                >
                  Browse …
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={!downloadPath.trim()}
                onClick={() => {
                  storage.set("downloadPath", downloadPath.trim());
                  setSettingPath(false);
                }}
              >
                Confirm
              </button>
              {settingPath && (
                <button
                  className="btn btn-ghost"
                  onClick={() => setSettingPath(false)}
                >
                  Cancel
                </button>
              )}
            </div>
            {onOpenSettings && (
              <div style={{ marginTop: 14, textAlign: "center" }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, color: "var(--text3)" }}
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                >
                  <SettingsIcon /> Open Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main modal ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="download-modal" onClick={(e) => e.stopPropagation()}>
          <div className="download-modal-header">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DownloadIcon /> Download
            </span>
            <button className="icon-btn" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          {!m3u8Url && (
            <div className="download-waiting">
              <div
                className="spinner"
                style={{ width: 24, height: 24, borderWidth: 2 }}
              />
              Waiting for stream URL … (start the video first)
            </div>
          )}

          {m3u8Url && (
            <>
              <div className="download-url-block">
                <div className="download-url-label">Stream URL found</div>
                <code className="download-url-code">{m3u8Url}</code>
              </div>

              {/* ── Subtitle section ──────────────────────────────────────── */}
              <div
                style={{
                  padding: "12px 20px",
                  borderBottom: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: subEnabled ? 8 : 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <SubtitlesIcon size={14} /> Subtitles
                  </span>
                  <div style={{ flex: 1 }} />
                  {/* Toggle */}
                  <button
                    onClick={() => {
                      const next = !subEnabled;
                      setSubEnabled(next);
                      storage.set(STORAGE_KEYS.SUBTITLE_ENABLED, next ? 1 : 0);
                      if (next && !subResults && canSearchOS)
                        searchSubtitles(defaultLang);
                    }}
                    title={
                      subEnabled
                        ? "Disable subtitle download"
                        : "Enable subtitle download"
                    }
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      background: subEnabled ? "var(--red)" : "var(--surface2)",
                      position: "relative",
                      transition: "background 0.2s",
                      flexShrink: 0,
                      outline: "none",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        left: subEnabled ? 18 : 2,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: "#fff",
                        transition: "left 0.2s",
                      }}
                    />
                  </button>
                </div>

                {subEnabled && (
                  <>
                    {!canSearchOS && (
                      <div style={{ fontSize: 12, color: "var(--text3)" }}>
                        No TMDB ID: Subtitle search unavailable
                      </div>
                    )}
                    {subSearching && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 12,
                          color: "var(--text3)",
                        }}
                      >
                        <div
                          className="spinner"
                          style={{ width: 12, height: 12, borderWidth: 1.5 }}
                        />
                        Searching for {LANG_LABEL[defaultLang] || defaultLang}{" "}
                        subtitles…
                      </div>
                    )}
                    {subSearchError && !subSearching && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--red)",
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        ⚠ {subSearchError}
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          onClick={() => searchSubtitles(defaultLang)}
                        >
                          Retry
                        </button>
                        {onOpenSettings && (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "2px 8px", fontSize: 11 }}
                            onClick={() => {
                              onClose();
                              onOpenSettings();
                            }}
                          >
                            Open Settings
                          </button>
                        )}
                      </div>
                    )}
                    {canSearchOS &&
                      !subSearching &&
                      subResults !== null &&
                      !subSearchError && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            width: "100%",
                          }}
                        >
                          {selectedSubs.length > 0 ? (
                            <>
                              {selectedSubs.map((sub) => (
                                <div
                                  key={sub.file_id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                    padding: "4px 8px",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      padding: "1px 5px",
                                      borderRadius: 3,
                                      background: "rgba(99,202,183,0.15)",
                                      color: "#63cab7",
                                      border: "1px solid rgba(99,202,183,0.3)",
                                      textTransform: "uppercase",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {sub.language}
                                  </span>
                                  <span style={sourceBadgeStyle(sub)}>
                                    {sourceBadgeLabel(sub)}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: "var(--text2)",
                                      flex: 1,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      minWidth: 0,
                                    }}
                                  >
                                    {sub.release ||
                                      sub.file_name ||
                                      `${sub.language.toUpperCase()} subtitle`}
                                  </span>
                                  <button
                                    className="btn btn-ghost"
                                    style={{
                                      padding: "1px 6px",
                                      fontSize: 11,
                                      flexShrink: 0,
                                      color: "var(--text3)",
                                    }}
                                    onClick={() =>
                                      setSelectedSubs((prev) =>
                                        prev.filter(
                                          (s) => s.file_id !== sub.file_id,
                                        ),
                                      )
                                    }
                                    title="Remove"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </>
                          ) : (
                            <span
                              style={{ fontSize: 12, color: "var(--text3)" }}
                            >
                              No subtitles found for{" "}
                              {LANG_LABEL[defaultLang] || defaultLang}
                            </span>
                          )}
                          <div
                            style={{ display: "flex", gap: 8, marginTop: 2 }}
                          >
                            <button
                              className="btn btn-ghost"
                              style={{ padding: "3px 10px", fontSize: 11 }}
                              onClick={() => setShowBrowser(true)}
                            >
                              {selectedSubs.length > 0
                                ? "＋ Add / Change"
                                : "Browse"}
                            </button>
                            {selectedSubs.length > 0 && (
                              <button
                                className="btn btn-ghost"
                                style={{
                                  padding: "3px 8px",
                                  fontSize: 11,
                                  color: "var(--text3)",
                                }}
                                onClick={() => setSelectedSubs([])}
                                title="Clear all"
                              >
                                Clear all
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    {canSearchOS &&
                      !subSearching &&
                      subResults === null &&
                      !subSearchError && (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <span style={{ fontSize: 12, color: "var(--text3)" }}>
                            Not searched yet
                          </span>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "3px 10px", fontSize: 11 }}
                            onClick={() => searchSubtitles(defaultLang)}
                          >
                            Search
                          </button>
                        </div>
                      )}
                    {!subdlApiKey && (
                      <div
                        style={{
                          marginTop: 5,
                          fontSize: 11,
                          color: "var(--text3)",
                        }}
                      >
                        💡 Add a free SubDL API key in Settings for better
                        results
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Downloader setup ──────────────────────────────────────── */}
              {!downloader?.exists && (
                <div className="download-instructions">
                  <div className="download-instructions-title">
                    Set up Video Downloader
                  </div>
                  <ol className="download-steps">
                    <li>
                      Download the latest release from{" "}
                      <a
                        className="download-link"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          isElectron &&
                            window.electron.openExternal(releaseUrl);
                        }}
                      >
                        github.com/truelockmc/video-downloader
                      </a>{" "}
                      , for your OS: <code>{binaryHint}</code>
                    </li>
                    <li>Extract the release into a folder of your choice</li>
                    <li>
                      Select that folder below, it must contain{" "}
                      <code>_internal</code> and the binary
                    </li>
                  </ol>
                  <div className="download-folder-row">
                    <button
                      className="btn btn-secondary"
                      onClick={pickBinaryFolder}
                    >
                      Choose folder …
                    </button>
                    {downloaderFolder && (
                      <span className="download-folder-path">
                        {downloaderFolder}
                      </span>
                    )}
                  </div>
                  {checking && (
                    <div className="download-checking">
                      <div
                        className="spinner"
                        style={{ width: 16, height: 16, borderWidth: 2 }}
                      />{" "}
                      Checking …
                    </div>
                  )}
                  {!checking &&
                    downloader &&
                    !downloader.exists &&
                    downloaderFolder && (
                      <div className="download-error">
                        No binary found. Make sure <code>_internal</code> and
                        the binary are inside the chosen folder.
                      </div>
                    )}
                </div>
              )}

              {downloader?.exists && (
                <div className="download-ready">
                  <div className="download-found-badge">
                    ✓ Video Downloader found
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      marginBottom: 14,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>
                      Wrong binary folder?
                    </span>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={pickBinaryFolder}
                    >
                      Change
                    </button>
                  </div>

                  {downloadStatus !== "ok" && (
                    <button
                      className="btn btn-primary"
                      onClick={handleDownload}
                      disabled={downloadStatus === "starting"}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      <DownloadIcon />
                      {downloadStatus === "starting"
                        ? "Starting …"
                        : "Start Download"}
                    </button>
                  )}

                  {downloadStatus === "ok" && (
                    <div style={{ textAlign: "center", padding: "12px 0" }}>
                      <div
                        className="download-success"
                        style={{ fontSize: 15, marginBottom: 8 }}
                      >
                        ✓ Download started!
                      </div>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 13 }}
                        onClick={onClose}
                      >
                        Close — track progress in Downloads
                      </button>
                    </div>
                  )}
                  {downloadStatus &&
                    downloadStatus !== "ok" &&
                    downloadStatus !== "starting" && (
                      <div className="download-error">{downloadStatus}</div>
                    )}

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      marginTop: 14,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>
                      Save to: <code>{downloadPath}</code>
                    </span>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => setSettingPath(true)}
                    >
                      Change
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {showBrowser && (
        <SubtitleBrowser
          tmdbId={tmdbId}
          mediaType={mediaType}
          season={season}
          episode={episode}
          subdlApiKey={subdlApiKey}
          selectedSubs={selectedSubs}
          setSelectedSubs={setSelectedSubs}
          onClose={() => setShowBrowser(false)}
          defaultLang={defaultLang}
        />
      )}
    </>
  );
}
