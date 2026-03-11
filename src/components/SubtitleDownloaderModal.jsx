import { useState, useEffect, useRef, useCallback } from "react";
import { TrashIcon, SubtitlesIcon } from "./Icons";
import { storage, STORAGE_KEYS, secureStorage } from "../utils/storage";
import { SUBTITLE_LANGUAGES } from "../utils/subtitles";

// ── Subtitle Downloader Modal (for retroactive subtitle download) ──────────────
export default function SubtitleDownloaderModal({
  dl,
  onClose,
  onSubtitlesSaved,
  onSubtitleDeleted,
}) {
  const defaultLang = storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "en";
  const [subdlApiKey, setSubdlApiKey] = useState(null); // null = not yet loaded
  useEffect(() => {
    let mounted = true;
    secureStorage.get(STORAGE_KEYS.SUBDL_API_KEY).then((val) => {
      if (mounted) setSubdlApiKey(val || "");
    });
    return () => {
      mounted = false;
    };
  }, []);

  const [langFilter, setLangFilter] = useState(defaultLang);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selectedSubs, setSelectedSubs] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState(null);
  const [done, setDone] = useState(false);
  const doneTimerRef = useRef(null);
  useEffect(
    () => () => {
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    },
    [],
  );
  const [deletingPath, setDeletingPath] = useState(null); // path currently being deleted

  const existingSubs = dl.subtitlePaths || [];
  const existingFileIds = new Set(
    existingSubs.map((s) => s.file_id).filter(Boolean),
  );
  const existingLangs = new Set(existingSubs.map((s) => s.lang));

  const doSearch = useCallback(
    async (lang) => {
      if (!dl.tmdbId) return;
      setSearching(true);
      setSearchError(null);
      setResults(null);
      try {
        const res = await window.electron.searchSubtitles({
          tmdbId: dl.tmdbId,
          mediaType: dl.mediaType,
          season: dl.season,
          episode: dl.episode,
          languages: lang || "",
          subdlApiKey,
        });
        if (!res.ok) {
          setSearchError(res.error || "Search failed");
          setResults([]);
        } else setResults(res.results || []);
      } catch (e) {
        setSearchError(e.message);
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [dl, subdlApiKey],
  );

  useEffect(() => {
    // Wait until subdlApiKey has been loaded from secure storage before searching
    if (subdlApiKey === null) return;
    doSearch(langFilter);
  }, [subdlApiKey]);

  const handleDownload = async () => {
    if (!selectedSubs.length || !dl.filePath) return;
    setDownloading(true);
    setDlError(null);
    try {
      const res = await window.electron.downloadSubtitlesForFile({
        filePath: dl.filePath,
        selectedSubs,
      });
      if (res.ok && res.subtitlePaths?.length > 0) {
        setDone(true);
        onSubtitlesSaved(res.subtitlePaths);
        // Reset after moment so the modal stays open with updated manage-section
        doneTimerRef.current = setTimeout(() => {
          setDone(false);
          setSelectedSubs([]);
        }, 1500);
      } else {
        setDlError(res.error || "No subtitles could be saved.");
      }
    } catch (e) {
      setDlError(e.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleDeleteSub = async (sp) => {
    if (
      !confirm(
        `Delete subtitle "${(sp.lang || "?").toUpperCase()}"${sp.release ? ` (${sp.release})` : ""}?`,
      )
    )
      return;
    setDeletingPath(sp.path);
    try {
      await window.electron.deleteSubtitleFile({
        downloadId: dl.id,
        subtitlePath: sp.path,
      });
      onSubtitleDeleted(sp.path);
    } catch (e) {
      console.error("Delete subtitle error:", e);
    } finally {
      setDeletingPath(null);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: 620,
          maxWidth: "95vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "15px 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <SubtitlesIcon size={14} />
            Subtitles: {dl.name}
          </span>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* ── Existing / downloaded subtitles section ── */}
        {existingSubs.length > 0 && (
          <div
            style={{
              padding: "10px 20px 12px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
              background: "rgba(99,202,183,0.04)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text3)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Downloaded subtitles
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {existingSubs.map((sp) => (
                <div
                  key={sp.path}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    padding: "6px 10px",
                  }}
                >
                  {/* Lang badge */}
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
                      flexShrink: 0,
                    }}
                  >
                    {(sp.lang || "?").toUpperCase()}
                  </span>
                  {/* Source badge */}
                  {sp.source && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background:
                          sp.source === "subdl"
                            ? "rgba(99,149,255,0.15)"
                            : "rgba(180,130,255,0.15)",
                        color: sp.source === "subdl" ? "#6395ff" : "#b482ff",
                        border: `1px solid ${sp.source === "subdl" ? "rgba(99,149,255,0.3)" : "rgba(180,130,255,0.3)"}`,
                        textTransform: "uppercase",
                        flexShrink: 0,
                      }}
                    >
                      {sp.source === "subdl" ? "SubDL" : "Wyzie"}
                    </span>
                  )}
                  {/* Release name */}
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
                    title={sp.release || sp.path}
                  >
                    {sp.release || sp.path.split(/[\\/]/).pop()}
                  </span>
                  {/* File path hint */}
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--text3)",
                      flexShrink: 0,
                    }}
                    title={sp.path}
                  >
                    .{sp.path.split(".").pop()}
                  </span>
                  {/* Delete button */}
                  <button
                    className="icon-btn"
                    disabled={deletingPath === sp.path}
                    onClick={() => handleDeleteSub(sp)}
                    title="Delete this subtitle file"
                    style={{
                      flexShrink: 0,
                      opacity: deletingPath === sp.path ? 0.4 : 1,
                      fontSize: 13,
                    }}
                  >
                    {deletingPath === sp.path ? "…" : <TrashIcon />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Lang filter + search controls ── */}
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text3)" }}>
            Download more:
          </span>
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
          <button
            className="btn btn-ghost"
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => doSearch(langFilter)}
            disabled={searching}
          >
            {searching ? "…" : "⟳ Refresh"}
          </button>
          {selectedSubs.length > 0 && (
            <span
              style={{
                fontSize: 12,
                color: "var(--text3)",
                marginLeft: "auto",
              }}
            >
              {selectedSubs.length} selected
            </span>
          )}
        </div>

        {/* ── Results list ── */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {searching && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 24,
                color: "var(--text3)",
                fontSize: 13,
                justifyContent: "center",
              }}
            >
              <div
                className="spinner"
                style={{ width: 16, height: 16, borderWidth: 2 }}
              />{" "}
              Searching…
            </div>
          )}
          {searchError && !searching && (
            <div
              style={{
                padding: "16px 20px",
                color: "var(--red)",
                fontSize: 13,
              }}
            >
              ⚠ {searchError}
            </div>
          )}
          {!searching && results?.length === 0 && (
            <div
              style={{
                padding: 20,
                color: "var(--text3)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              No subtitles found for this language
            </div>
          )}
          {!searching &&
            results?.map((r) => {
              const isSelected = selectedSubs.some(
                (s) => s.file_id === r.file_id,
              );
              const rLang = (r.language || "")
                .replace(/[^a-z0-9_-]/gi, "")
                .toLowerCase();
              const alreadyHave = r.file_id
                ? existingFileIds.has(r.file_id)
                : existingLangs.has(rLang);
              return (
                <div
                  key={r.file_id}
                  onClick={() => {
                    if (alreadyHave) return; // can't re-download same lang (use delete first)
                    setSelectedSubs((prev) =>
                      isSelected
                        ? prev.filter((s) => s.file_id !== r.file_id)
                        : [...prev, r],
                    );
                  }}
                  style={{
                    padding: "8px 16px",
                    cursor: alreadyHave ? "default" : "pointer",
                    borderBottom: "1px solid var(--border)",
                    background: alreadyHave
                      ? "rgba(255,255,255,0.01)"
                      : isSelected
                        ? "rgba(229,9,20,0.07)"
                        : "transparent",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    transition: "background 0.1s",
                    opacity: alreadyHave ? 0.45 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !alreadyHave)
                      e.currentTarget.style.background = "var(--surface2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = alreadyHave
                      ? "rgba(255,255,255,0.01)"
                      : isSelected
                        ? "rgba(229,9,20,0.07)"
                        : "transparent";
                  }}
                >
                  {/* Checkbox */}
                  <div
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: 3,
                      border: `2px solid ${alreadyHave ? "var(--border)" : isSelected ? "var(--red)" : "var(--border)"}`,
                      background: alreadyHave
                        ? "var(--surface2)"
                        : isSelected
                          ? "var(--red)"
                          : "transparent",
                      flexShrink: 0,
                      marginTop: 3,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {alreadyHave ? (
                      <span style={{ color: "var(--text3)", fontSize: 9 }}>
                        ✓
                      </span>
                    ) : isSelected ? (
                      <span style={{ color: "#fff", fontSize: 9 }}>✓</span>
                    ) : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        marginBottom: 2,
                        flexWrap: "wrap",
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
                        }}
                      >
                        {r.language}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: r.via_subdl
                            ? "rgba(99,149,255,0.15)"
                            : "rgba(180,130,255,0.15)",
                          color: r.via_subdl ? "#6395ff" : "#b482ff",
                          border: `1px solid ${r.via_subdl ? "rgba(99,149,255,0.3)" : "rgba(180,130,255,0.3)"}`,
                          textTransform: "uppercase",
                        }}
                      >
                        {r.via_subdl ? "SubDL" : "Wyzie"}
                      </span>
                      {alreadyHave && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--text3)",
                            fontStyle: "italic",
                          }}
                        >
                          already downloaded
                        </span>
                      )}
                      {r.hearing_impaired && (
                        <span
                          style={{ fontSize: 10, color: "var(--text3)" }}
                          title="HI"
                        >
                          ♿
                        </span>
                      )}
                      {r.ai_translated && (
                        <span
                          style={{ fontSize: 10, color: "var(--text3)" }}
                          title="AI"
                        >
                          🤖
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.release ||
                        r.file_name ||
                        `${r.language?.toUpperCase()} subtitle`}
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

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
          }}
        >
          {done ? (
            <span style={{ fontSize: 13, color: "#48c774", fontWeight: 600 }}>
              ✓ Subtitles downloaded!
            </span>
          ) : (
            <>
              <button
                className="btn btn-primary"
                disabled={
                  downloading || selectedSubs.length === 0 || !dl.filePath
                }
                onClick={handleDownload}
                style={{
                  opacity: downloading || selectedSubs.length === 0 ? 0.5 : 1,
                }}
              >
                {downloading
                  ? "Downloading…"
                  : selectedSubs.length > 0
                    ? `↓ Download (${selectedSubs.length})`
                    : "Select subtitles above"}
              </button>
              {!dl.filePath && (
                <span style={{ fontSize: 12, color: "var(--red)" }}>
                  No file path, needs completed download
                </span>
              )}
              {dlError && (
                <span style={{ fontSize: 12, color: "var(--red)" }}>
                  ⚠ {dlError}
                </span>
              )}
            </>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
