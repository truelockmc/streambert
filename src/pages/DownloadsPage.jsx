import { useState, useEffect, useRef, useCallback } from "react";
import {
  DownloadIcon,
  TrashIcon,
  FolderIcon,
  PlayIcon,
  FilmIcon,
  WatchedIcon,
  SubtitlesIcon,
} from "../components/Icons";
import { storage, STORAGE_KEYS, secureStorage } from "../utils/storage";
import { SUBTITLE_LANGUAGES } from "../utils/subtitles";
import { imgUrl } from "../utils/api";

const STATUS_CLASS = {
  downloading: "dl-status--downloading",
  completed: "dl-status--completed",
  error: "dl-status--error",
  interrupted: "dl-status--interrupted",
};

const STATUS_LABEL = {
  downloading: "Downloading",
  completed: "Completed",
  error: "Error",
  interrupted: "Interrupted",
};

function timeAgo(ts) {
  if (!ts) return "";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
  return Math.floor(sec / 86400) + "d ago";
}

function Poster({ posterPath, size = 48 }) {
  const [errored, setErrored] = useState(false);
  const style = { width: size, height: size * 1.5 };
  if (posterPath && !errored) {
    return (
      <img
        src={imgUrl(posterPath, "w154")}
        alt=""
        onError={() => setErrored(true)}
        className="dl-poster"
        style={style}
      />
    );
  }
  return (
    <div className="dl-poster dl-poster--fallback" style={style}>
      <FilmIcon />
    </div>
  );
}

export default function DownloadsPage({
  downloads,
  onDeleteDownload,
  onHistory,
  onSaveProgress,
  progress,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  highlightId,
  onClearHighlight,
  onSelect,
  onUpdateDownload,
}) {
  const [fileExistsCache, setFileExistsCache] = useState({});
  const [localFiles, setLocalFiles] = useState(
    () => storage.get("localFiles") || [],
  );
  const [scanning, setScanning] = useState(false);
  const [scanFolder, setScanFolder] = useState(
    () => storage.get("downloadPath") || "",
  );
  const highlightRef = useRef(null);
  const [subtitleModalDl, setSubtitleModalDl] = useState(null);

  const isElectron = typeof window !== "undefined" && !!window.electron;

  const active = downloads.filter((d) => d.status === "downloading");
  const finished = downloads
    .filter((d) => d.status !== "downloading")
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  useEffect(() => {
    if (!highlightId || !highlightRef.current) return;
    const el = highlightRef.current;
    setTimeout(
      () => el.scrollIntoView({ behavior: "smooth", block: "center" }),
      150,
    );
    const t = setTimeout(() => onClearHighlight?.(), 3000);
    return () => clearTimeout(t);
  }, [highlightId]);

  useEffect(() => {
    if (!isElectron) return;
    finished.forEach((d) => {
      if (
        d.filePath &&
        d.status === "completed" &&
        fileExistsCache[d.id] === undefined
      ) {
        window.electron.fileExists(d.filePath).then((exists) => {
          setFileExistsCache((prev) => ({ ...prev, [d.id]: exists }));
          // Auto-remove from registry if video file was deleted externally
          if (!exists) {
            window.electron.deleteDownload({ id: d.id, filePath: null });
            onDeleteDownload(d.id);
          }
        });
      }

      // Prune subtitle paths that were deleted externally from the filesystem
      if (
        d.status === "completed" &&
        d.subtitlePaths?.length > 0 &&
        window.electron.pruneSubtitlePaths
      ) {
        window.electron.pruneSubtitlePaths(d.id).then((res) => {
          if (res?.ok && res.subtitlePaths.length !== d.subtitlePaths.length) {
            onUpdateDownload?.(d.id, { subtitlePaths: res.subtitlePaths });
          }
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished.length, onDeleteDownload]);

  const handleScanFolder = useCallback(async () => {
    if (!isElectron || !scanFolder) return;
    setScanning(true);
    try {
      const files = await window.electron.scanDirectory(scanFolder);
      const knownPaths = new Set(
        downloads.map((d) => d.filePath).filter(Boolean),
      );
      const unique = (files || []).filter((f) => !knownPaths.has(f.filePath));
      setLocalFiles(unique);
      storage.set("localFiles", unique);

      // Re-check subtitle files for all completed downloads
      if (window.electron.pruneSubtitlePaths) {
        for (const d of finished) {
          if (d.subtitlePaths?.length > 0) {
            const res = await window.electron.pruneSubtitlePaths(d.id);
            if (
              res?.ok &&
              res.subtitlePaths.length !== d.subtitlePaths.length
            ) {
              onUpdateDownload?.(d.id, { subtitlePaths: res.subtitlePaths });
            }
          }
        }
      }
    } finally {
      setScanning(false);
    }
  }, [scanFolder, downloads, finished, onUpdateDownload]);

  const handleDelete = async (dl) => {
    if (!confirm(`Delete "${dl.name}"${dl.filePath ? " and its file" : ""}?`))
      return;
    await window.electron.deleteDownload({ id: dl.id, filePath: dl.filePath });
    onDeleteDownload(dl.id);
  };

  const localFileItems = localFiles.map((f) => ({
    id: f.filePath,
    name: f.name,
    filePath: f.filePath,
    size: f.size,
    status: "local",
    isLocalOnly: true,
  }));

  const allLocalItems = [
    ...finished.filter((d) => fileExistsCache[d.id] !== false),
    ...localFileItems.filter(
      (lf) => !finished.some((d) => d.filePath === lf.filePath),
    ),
  ];

  return (
    <div className="fade-in dl-page">
      {subtitleModalDl && (
        <SubtitleDownloaderModal
          dl={subtitleModalDl}
          onClose={() => setSubtitleModalDl(null)}
          onSubtitlesSaved={(newPaths) => {
            const existing = subtitleModalDl.subtitlePaths || [];
            const existingIds = new Set(
              existing.map((e) => e.file_id).filter(Boolean),
            );
            const existingLangsSet = new Set(existing.map((e) => e.lang));
            const updated = [
              ...existing,
              ...newPaths.filter((np) =>
                np.file_id
                  ? !existingIds.has(np.file_id)
                  : !existingLangsSet.has(np.lang),
              ),
            ];
            onUpdateDownload?.(subtitleModalDl.id, { subtitlePaths: updated });
            // Keep modal open with updated list so user can manage / delete subs
            setSubtitleModalDl((prev) =>
              prev ? { ...prev, subtitlePaths: updated } : null,
            );
          }}
          onSubtitleDeleted={(deletedPath) => {
            const updated = (subtitleModalDl.subtitlePaths || []).filter(
              (sp) => sp.path !== deletedPath,
            );
            onUpdateDownload?.(subtitleModalDl.id, { subtitlePaths: updated });
            // Keep the modal open with the updated list
            setSubtitleModalDl((prev) =>
              prev ? { ...prev, subtitlePaths: updated } : null,
            );
          }}
        />
      )}
      <div className="dl-page__title">DOWNLOADS</div>
      <div className="dl-page__subtitle">
        {active.length > 0 ? `${active.length} active` : "No active downloads"}{" "}
        · {allLocalItems.length} completed
      </div>

      {active.length > 0 && (
        <div className="dl-page__section">
          <div className="settings-section-title dl-section-title">Active</div>
          <div className="dl-page__list">
            {active.map((dl) => (
              <ActiveCard
                key={dl.id}
                dl={dl}
                onDelete={() => handleDelete(dl)}
                onSelect={
                  dl.tmdbId && dl.mediaType
                    ? () =>
                        onSelect?.({
                          id: dl.tmdbId,
                          media_type: dl.mediaType,
                          title: dl.mediaType === "movie" ? dl.name : undefined,
                          name: dl.mediaType === "tv" ? dl.name : undefined,
                          poster_path: dl.posterPath || null,
                          season:
                            dl.mediaType === "tv" && dl.season != null
                              ? Number(dl.season)
                              : undefined,
                        })
                    : null
                }
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="dl-page__local-header">
          <div className="settings-section-title dl-section-title--inline">
            Local Files
          </div>
          <div className="dl-page__scan-controls">
            {isElectron && (
              <>
                <input
                  className="dl-page__scan-input"
                  placeholder="Folder to scan…"
                  value={scanFolder}
                  onChange={(e) => setScanFolder(e.target.value)}
                />
                <button
                  className="btn btn-secondary btn--sm"
                  onClick={async () => {
                    const folder = await window.electron.pickFolder();
                    if (folder) {
                      setScanFolder(folder);
                      storage.set("downloadPath", folder);
                    }
                  }}
                >
                  Browse
                </button>
                <button
                  className="btn btn-ghost btn--sm"
                  onClick={handleScanFolder}
                  disabled={scanning || !scanFolder}
                >
                  {scanning ? "Scanning…" : "⟳ Scan"}
                </button>
              </>
            )}
          </div>
        </div>

        {allLocalItems.length > 0 ? (
          <div className="dl-page__local-list">
            {allLocalItems.map((dl) => {
              const isHighlighted = dl.id === highlightId;
              const watchedKey =
                dl.mediaType === "movie"
                  ? `movie_${dl.tmdbId || dl.mediaId}`
                  : dl.mediaType === "tv" &&
                      dl.tmdbId &&
                      dl.season &&
                      dl.episode
                    ? `tv_${dl.tmdbId}_s${dl.season}e${dl.episode}`
                    : null;
              return (
                <LocalFileCard
                  key={dl.id}
                  dl={dl}
                  fileExists={dl.isLocalOnly ? true : fileExistsCache[dl.id]}
                  onWatch={(subtitlePaths) =>
                    subtitlePaths?.length > 0
                      ? window.electron.openPathAtTime(
                          dl.filePath,
                          0,
                          subtitlePaths,
                        )
                      : window.electron.openPath(dl.filePath)
                  }
                  onHistory={onHistory}
                  onShowFolder={() =>
                    window.electron?.showInFolder(dl.filePath)
                  }
                  onDelete={dl.isLocalOnly ? undefined : () => handleDelete(dl)}
                  isHighlighted={isHighlighted}
                  highlightRef={isHighlighted ? highlightRef : null}
                  watchedKey={watchedKey}
                  isWatched={watchedKey ? !!watched?.[watchedKey] : false}
                  onMarkWatched={
                    watchedKey ? () => onMarkWatched?.(watchedKey) : null
                  }
                  onMarkUnwatched={
                    watchedKey ? () => onMarkUnwatched?.(watchedKey) : null
                  }
                  onSelect={
                    dl.tmdbId && dl.mediaType
                      ? () =>
                          onSelect?.({
                            id: dl.tmdbId,
                            media_type: dl.mediaType,
                            title:
                              dl.mediaType === "movie" ? dl.name : undefined,
                            name: dl.mediaType === "tv" ? dl.name : undefined,
                            poster_path: dl.posterPath || null,
                            season:
                              dl.mediaType === "tv" && dl.season != null
                                ? Number(dl.season)
                                : undefined,
                          })
                      : null
                  }
                  onOpenSubtitleDownloader={
                    dl.tmdbId ? () => setSubtitleModalDl(dl) : null
                  }
                />
              );
            })}
          </div>
        ) : (
          <div className="dl-page__empty-text">
            {downloads.length === 0 && localFiles.length === 0
              ? "No local files yet. Scan a folder or start a download."
              : "No completed downloads or local files found."}
          </div>
        )}
      </div>

      {downloads.length === 0 &&
        localFiles.length === 0 &&
        active.length === 0 && (
          <div className="empty-state">
            <DownloadIcon />
            <h3>No downloads yet</h3>
            <p>
              Start a download from any movie or series page, or scan a folder
              to find local video files.
            </p>
          </div>
        )}
    </div>
  );
}

// ── Active download card ───────────────────────────────────────────────────────
function ActiveCard({ dl, onDelete, onSelect }) {
  const pct = dl.progress || 0;
  return (
    <div className="dl-card dl-card-active">
      <div className="dl-card__header">
        <Poster posterPath={dl.posterPath} size={42} />
        <div className="dl-card__info">
          <div
            className={`dl-card__name${onSelect ? " dl-card__title--clickable" : ""}`}
            onClick={onSelect || undefined}
            onMouseEnter={(e) => {
              if (onSelect) e.currentTarget.style.color = "var(--red)";
            }}
            onMouseLeave={(e) => {
              if (onSelect) e.currentTarget.style.color = "";
            }}
            title={onSelect ? `Open ${dl.name}` : undefined}
          >
            {dl.name}
          </div>
          <div className="dl-card__meta">
            {dl.speed && <span>↓ {dl.speed}</span>}
            {dl.size && <span>{dl.size}</span>}
            {dl.totalFragments > 0 && (
              <span>
                {dl.completedFragments || 0}/{dl.totalFragments} fragments
              </span>
            )}
            {dl.subtitles?.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "rgba(99,202,183,0.12)",
                  color: "#63cab7",
                  border: "1px solid rgba(99,202,183,0.25)",
                }}
                title={dl.subtitles
                  .map((s) => s.lang?.toUpperCase())
                  .join(", ")}
              >
                <SubtitlesIcon
                  size={11}
                  style={{ verticalAlign: "middle", marginRight: 3 }}
                />
                {dl.subtitles
                  .map((s) => (s.lang || "?").toUpperCase())
                  .join(" · ")}
              </span>
            )}
          </div>
        </div>
        <div className="dl-card__right">
          <div className="dl-card__pct">{pct.toFixed(1)}%</div>
          <button className="icon-btn" onClick={onDelete} title="Remove">
            <TrashIcon />
          </button>
        </div>
      </div>
      <div className="dl-card__bar-wrap">
        <div
          className={`dl-card__bar-fill${pct > 0 ? " dl-card__bar-fill--active" : ""}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {dl.lastMessage && <div className="dl-card__log">{dl.lastMessage}</div>}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function secsToHms(s) {
  if (!s || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}

function hmsToSecs(str) {
  const parts = str.trim().split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1 && parts[0] >= 0) return parts[0];
  return null;
}

const PROGRESS_TIME_PREFIX = "dlTime_";

// ── Local file / completed download card ──────────────────────────────────────
function LocalFileCard({
  dl,
  fileExists,
  onWatch,
  onShowFolder,
  onDelete,
  isHighlighted,
  highlightRef,
  isWatched,
  onMarkWatched,
  onMarkUnwatched,
  onSelect,
  watchedKey,
  onHistory,
  onOpenSubtitleDownloader,
}) {
  const isDownload = !dl.isLocalOnly;
  const canWatch = !!fileExists && !!dl.filePath;

  const storageKey = watchedKey ? PROGRESS_TIME_PREFIX + watchedKey : null;
  const [savedSecs, setSavedSecs] = useState(() =>
    storageKey ? (storage.get(storageKey) ?? null) : null,
  );
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const inputRef = useRef(null);

  // Re-sync from storage when key changes (picks up progress from online watching)
  useEffect(() => {
    if (!storageKey) return;
    setSavedSecs(storage.get(storageKey) ?? null);
  }, [storageKey]);

  const startEdit = useCallback(() => {
    setEditVal(secsToHms(savedSecs) ?? "");
    setEditing(true);
  }, [savedSecs]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commitEdit = useCallback(() => {
    const secs = hmsToSecs(editVal);
    if (secs !== null && storageKey) {
      storage.set(storageKey, secs);
      setSavedSecs(secs);
    }
    setEditing(false);
  }, [editVal, storageKey]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") commitEdit();
      if (e.key === "Escape") setEditing(false);
    },
    [commitEdit],
  );

  const handleWatch = useCallback(() => {
    if (!dl.filePath) return;
    // Update watch history when playing from downloads
    if (onHistory && dl.tmdbId && dl.mediaType) {
      onHistory({
        id: dl.tmdbId,
        title: dl.mediaType === "movie" ? dl.name : undefined,
        name: dl.mediaType === "tv" ? dl.name : undefined,
        poster_path: dl.posterPath || null,
        media_type: dl.mediaType,
        season: dl.season != null ? Number(dl.season) : null,
        episode: dl.episode != null ? Number(dl.episode) : null,
      });
    }
    if (savedSecs > 0 && window.electron?.openPathAtTime) {
      window.electron.openPathAtTime(dl.filePath, savedSecs, dl.subtitlePaths);
    } else {
      onWatch(dl.subtitlePaths);
    }
  }, [dl.filePath, savedSecs, onWatch, onHistory, dl]);

  const progressLabel = (() => {
    if (isWatched) return null;
    if (!storageKey) return null;
    if (!savedSecs) return "Not started";
    return secsToHms(savedSecs);
  })();

  return (
    <div
      ref={highlightRef}
      className={`dl-card${isHighlighted ? " dl-card-highlighted" : ""}`}
    >
      <div className="dl-card__row">
        <div
          className={`dl-card__poster-wrap${onSelect ? " dl-card__poster-wrap--clickable" : ""}`}
          onClick={onSelect || undefined}
          title={onSelect ? "Go to page" : undefined}
          onMouseEnter={(e) => {
            if (onSelect) e.currentTarget.style.opacity = "0.75";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
        >
          <Poster posterPath={dl.posterPath} size={40} />
        </div>

        <div className="dl-card__body">
          <div className="dl-card__title-row">
            <div
              className={`dl-card__title${onSelect ? " dl-card__title--clickable" : ""}`}
              onClick={onSelect || undefined}
              onMouseEnter={(e) => {
                if (onSelect) e.currentTarget.style.color = "var(--red)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "";
              }}
              title={onSelect ? `Open ${dl.name}` : undefined}
            >
              {dl.name}
            </div>
            {isWatched && (
              <span className="dl-card__watched-icon" title="Watched">
                <WatchedIcon size={14} />
              </span>
            )}
          </div>

          <div className="dl-card__meta">
            {isDownload && (
              <span className={`dl-status ${STATUS_CLASS[dl.status] || ""}`}>
                {STATUS_LABEL[dl.status]}
              </span>
            )}
            {!isDownload && (
              <span className="dl-status dl-status--local">Local</span>
            )}
            {dl.completedAt && <span>{timeAgo(dl.completedAt)}</span>}
            {dl.size && <span>{dl.size}</span>}
            {/* Subtitle info, always visible, clickable to open downloader */}
            {(() => {
              const hasSubs = (dl.subtitlePaths?.length ?? 0) > 0;
              const langs = hasSubs
                ? dl.subtitlePaths
                    .map((s) => (s.lang || "?").toUpperCase())
                    .join(" · ")
                : null;
              return (
                <span
                  title={
                    onOpenSubtitleDownloader
                      ? hasSubs
                        ? `Subtitles: ${langs}: click to manage`
                        : "No subtitles: click to download"
                      : hasSubs
                        ? `Subtitles: ${langs}`
                        : "No subtitles"
                  }
                  onClick={onOpenSubtitleDownloader || undefined}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: hasSubs
                      ? "rgba(99,202,183,0.12)"
                      : "rgba(255,255,255,0.04)",
                    color: hasSubs ? "#63cab7" : "var(--text3)",
                    border: hasSubs
                      ? "1px solid rgba(99,202,183,0.25)"
                      : "1px solid var(--border)",
                    cursor: onOpenSubtitleDownloader ? "pointer" : "default",
                    letterSpacing: "0.03em",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (onOpenSubtitleDownloader)
                      e.currentTarget.style.opacity = "0.75";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                >
                  <SubtitlesIcon
                    size={10}
                    style={{ verticalAlign: "middle" }}
                  />
                  {hasSubs ? langs : "No subtitles"}
                </span>
              );
            })()}
            {fileExists === false && (
              <span className="dl-status--missing">File missing</span>
            )}

            {progressLabel !== null && storageKey && (
              <span
                className={`dl-progress-pill${savedSecs ? " dl-progress-pill--active" : " dl-progress-pill--empty"}`}
              >
                {editing ? (
                  <input
                    ref={inputRef}
                    className="dl-progress-pill__input"
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={handleKeyDown}
                    placeholder="HH:MM:SS"
                  />
                ) : (
                  <span
                    className="dl-progress-pill__label"
                    onClick={startEdit}
                    title="Click to set resume position"
                  >
                    {progressLabel}
                  </span>
                )}
                {!editing && (
                  <span
                    className="dl-progress-pill__edit-icon"
                    onClick={startEdit}
                    title="Edit"
                  >
                    ✎
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="dl-card__actions">
          {onMarkWatched &&
            (isWatched ? (
              <button
                className="btn btn-ghost watched-btn dl-btn--sm"
                onClick={onMarkUnwatched}
                title="Mark as Unwatched"
              >
                <WatchedIcon size={13} /> Watched
              </button>
            ) : (
              <button
                className="btn btn-ghost dl-btn--sm"
                onClick={onMarkWatched}
                title="Mark as Watched"
              >
                ✓ Mark Watched
              </button>
            ))}
          {canWatch && (
            <button
              className="btn btn-primary dl-btn--sm-primary"
              onClick={handleWatch}
              title={
                savedSecs > 0 ? `Resume at ${secsToHms(savedSecs)}` : "Watch"
              }
            >
              <PlayIcon /> {savedSecs > 0 ? "Resume" : "Watch"}
            </button>
          )}
          {dl.filePath && (
            <button
              className="btn btn-ghost dl-btn--sm-icon"
              onClick={onShowFolder}
              title="Show in folder"
            >
              <FolderIcon />
            </button>
          )}
          {onDelete && (
            <button className="icon-btn" onClick={onDelete} title="Delete">
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Subtitle Downloader Modal (for retroactive subtitle download) ──────────────
function SubtitleDownloaderModal({
  dl,
  onClose,
  onSubtitlesSaved,
  onSubtitleDeleted,
}) {
  const defaultLang = storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "en";
  const [subdlApiKey, setSubdlApiKey] = useState("");
  useEffect(() => {
    secureStorage.get(STORAGE_KEYS.SUBDL_API_KEY).then((val) => {
      if (val) setSubdlApiKey(val);
    });
  }, []);

  const [langFilter, setLangFilter] = useState(defaultLang);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selectedSubs, setSelectedSubs] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState(null);
  const [done, setDone] = useState(false);
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
    doSearch(langFilter);
  }, []);

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
        setTimeout(() => {
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
