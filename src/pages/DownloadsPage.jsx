import { useState, useEffect, useRef, useCallback, memo } from "react";
import {
  DownloadIcon,
  TrashIcon,
  FolderIcon,
  PlayIcon,
  FilmIcon,
  WatchedIcon,
  SubtitlesIcon,
} from "../components/Icons";
import { storage, STORAGE_KEYS, isElectron } from "../utils/storage";
import SubtitleDownloaderModal from "../components/SubtitleDownloaderModal";
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

const Poster = memo(function Poster({ posterPath, size = 48 }) {
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
});

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

  const active = downloads.filter((d) => d.status === "downloading");
  const finished = downloads
    .filter((d) => d.status !== "downloading")
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  useEffect(() => {
    if (!highlightId || !highlightRef.current) return;
    const el = highlightRef.current;
    const tScroll = setTimeout(
      () => el.scrollIntoView({ behavior: "smooth", block: "center" }),
      150,
    );
    const t = setTimeout(() => onClearHighlight?.(), 3000);
    return () => {
      clearTimeout(tScroll);
      clearTimeout(t);
    };
  }, [highlightId]);

  useEffect(() => {
    if (!isElectron) return;
    let mounted = true;
    finished.forEach((d) => {
      if (
        d.filePath &&
        d.status === "completed" &&
        fileExistsCache[d.id] === undefined
      ) {
        window.electron.fileExists(d.filePath).then((exists) => {
          if (!mounted) return;
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
          if (!mounted) return;
          if (res?.ok && res.subtitlePaths.length !== d.subtitlePaths.length) {
            onUpdateDownload?.(d.id, { subtitlePaths: res.subtitlePaths });
          }
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      mounted = false;
    };
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
                  onOpenLog={
                    dl.logPath && dl.status === "error"
                      ? () => window.electron.openPath(dl.logPath)
                      : null
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
const ActiveCard = memo(function ActiveCard({ dl, onDelete, onSelect }) {
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
});

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
const LocalFileCard = memo(function LocalFileCard({
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
  onOpenLog,
}) {
  const isDownload = !dl.isLocalOnly;
  const canWatch = !!fileExists && !!dl.filePath;

  const storageKey = watchedKey ? PROGRESS_TIME_PREFIX + watchedKey : null;
  const [savedSecs, setSavedSecs] = useState(() =>
    storageKey ? (storage.get(storageKey) ?? null) : null,
  );
  const [showPopover, setShowPopover] = useState(false);
  const [popoverSecs, setPopoverSecs] = useState(0);
  const [popoverHH, setPopoverHH] = useState("00");
  const [popoverMM, setPopoverMM] = useState("00");
  const [popoverSS, setPopoverSS] = useState("00");
  const [videoDuration, setVideoDuration] = useState(null);
  const [durationLoading, setDurationLoading] = useState(false);
  const popoverRef = useRef(null);
  const fetchingRef = useRef(false);
  const hhRef = useRef(null);
  const mmRef = useRef(null);
  const ssRef = useRef(null);

  // Re-sync from storage when key changes (picks up progress from online watching)
  useEffect(() => {
    if (!storageKey) return;
    setSavedSecs(storage.get(storageKey) ?? null);
  }, [storageKey]);

  // Fetch video duration once when popover first opens
  useEffect(() => {
    if (
      !showPopover ||
      !dl.filePath ||
      videoDuration !== null ||
      fetchingRef.current
    )
      return;
    if (!window.electron?.getVideoDuration) return;
    let mounted = true;
    fetchingRef.current = true;
    setDurationLoading(true);
    window.electron
      .getVideoDuration(dl.filePath)
      .then((res) => {
        if (mounted && res?.ok && res.duration > 0)
          setVideoDuration(res.duration);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) {
          setDurationLoading(false);
        }
        fetchingRef.current = false;
      });
    return () => {
      mounted = false;
    };
  }, [showPopover, dl.filePath, videoDuration]);

  // Close on outside click
  useEffect(() => {
    if (!showPopover) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target))
        setShowPopover(false);
    };
    const tid = setTimeout(
      () => document.addEventListener("mousedown", handler),
      0,
    );
    return () => {
      clearTimeout(tid);
      document.removeEventListener("mousedown", handler);
    };
  }, [showPopover]);

  const openPopover = useCallback(() => {
    const s = savedSecs ?? 0;
    setPopoverSecs(s);
    const hms = secsToHms(s) ?? "00:00:00";
    const [hh, mm, ss] = hms.split(":");
    setPopoverHH(hh ?? "00");
    setPopoverMM(mm ?? "00");
    setPopoverSS(ss ?? "00");
    setShowPopover(true);
  }, [savedSecs]);

  const handleSliderChange = useCallback((e) => {
    const s = Number(e.target.value);
    setPopoverSecs(s);
    const hms = secsToHms(s) ?? "00:00:00";
    const [hh, mm, ss] = hms.split(":");
    setPopoverHH(hh ?? "00");
    setPopoverMM(mm ?? "00");
    setPopoverSS(ss ?? "00");
  }, []);

  const makeSegmentHandler = useCallback(
    (setter, nextRef) => (e) => {
      const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
      setter(raw);
      if (raw.length === 2 && nextRef?.current) nextRef.current.focus();
      const hh = setter === setPopoverHH ? raw : popoverHH;
      const mm = setter === setPopoverMM ? raw : popoverMM;
      const ss = setter === setPopoverSS ? raw : popoverSS;
      const s = hmsToSecs(`${hh}:${mm}:${ss}`);
      if (s !== null) setPopoverSecs(s);
    },
    [popoverHH, popoverMM, popoverSS],
  );

  const commitPopover = useCallback(() => {
    const str = `${popoverHH}:${popoverMM}:${popoverSS}`;
    let s = hmsToSecs(str);
    if (s === null) s = popoverSecs;
    if (s !== null && storageKey) {
      const clamped = videoDuration
        ? Math.min(Math.max(0, s), videoDuration)
        : Math.max(0, s);
      storage.set(storageKey, clamped);
      setSavedSecs(clamped);
    }
    setShowPopover(false);
  }, [popoverHH, popoverMM, popoverSS, popoverSecs, storageKey, videoDuration]);

  const resetProgress = useCallback(() => {
    if (storageKey) {
      storage.set(storageKey, null);
      setSavedSecs(null);
    }
    setShowPopover(false);
  }, [storageKey]);

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
    return videoDuration
      ? `${secsToHms(savedSecs)} / ${secsToHms(videoDuration)}`
      : secsToHms(savedSecs);
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
              <span style={{ position: "relative", display: "inline-flex" }}>
                <span
                  className={`dl-progress-pill${savedSecs ? " dl-progress-pill--active" : " dl-progress-pill--empty"}`}
                  onClick={openPopover}
                  title="Set watch progress"
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  <span className="dl-progress-pill__label">
                    {progressLabel}
                  </span>
                  <span className="dl-progress-pill__edit-icon">✎</span>
                </span>

                {showPopover && (
                  <div
                    ref={popoverRef}
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 6px)",
                      left: 0,
                      zIndex: 9999,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "10px 12px 9px",
                      width: 240,
                      boxShadow: "0 6px 24px rgba(0,0,0,0.55)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                    }}
                  >
                    {/* Header: time display + close */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 16,
                            fontWeight: 700,
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--text)",
                          }}
                        >
                          {secsToHms(popoverSecs) ?? "00:00:00"}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text3)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {durationLoading
                            ? "/ …"
                            : videoDuration
                              ? `/ ${secsToHms(videoDuration)}`
                              : ""}
                        </span>
                      </div>
                      <button
                        className="icon-btn"
                        onClick={() => setShowPopover(false)}
                        style={{ fontSize: 12, padding: "0 3px" }}
                      >
                        ✕
                      </button>
                    </div>

                    {/* Slider (only when duration known) */}
                    {videoDuration && (
                      <div>
                        <input
                          type="range"
                          min={0}
                          max={Math.floor(videoDuration)}
                          step={1}
                          value={Math.min(
                            popoverSecs,
                            Math.floor(videoDuration),
                          )}
                          onChange={handleSliderChange}
                          style={{
                            width: "100%",
                            accentColor: "var(--red)",
                            cursor: "pointer",
                            height: 3,
                          }}
                        />
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 10,
                            color: "var(--text3)",
                            marginTop: 1,
                          }}
                        >
                          <span>0:00</span>
                          <span
                            style={{ fontWeight: 600, color: "var(--text2)" }}
                          >
                            {Math.round((popoverSecs / videoDuration) * 100)}%
                          </span>
                          <span>{secsToHms(videoDuration)}</span>
                        </div>
                      </div>
                    )}

                    {/* Text input + Reset + Save */}
                    <div style={{ display: "flex", gap: 5 }}>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: "flex",
                          alignItems: "center",
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "4px 8px",
                          gap: 2,
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = "var(--red)";
                        }}
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget))
                            e.currentTarget.style.borderColor = "var(--border)";
                        }}
                      >
                        {[
                          {
                            ref: hhRef,
                            value: popoverHH,
                            setter: setPopoverHH,
                            next: mmRef,
                            label: "HH",
                          },
                          {
                            ref: mmRef,
                            value: popoverMM,
                            setter: setPopoverMM,
                            next: ssRef,
                            label: "MM",
                          },
                          {
                            ref: ssRef,
                            value: popoverSS,
                            setter: setPopoverSS,
                            next: null,
                            label: "SS",
                          },
                        ].map(({ ref, value, setter, next, label }, i) => (
                          <span
                            key={label}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 2,
                            }}
                          >
                            {i > 0 && (
                              <span
                                style={{
                                  color: "var(--text3)",
                                  fontWeight: 700,
                                  fontSize: 13,
                                  userSelect: "none",
                                }}
                              >
                                :
                              </span>
                            )}
                            <input
                              ref={ref}
                              type="text"
                              inputMode="numeric"
                              maxLength={2}
                              value={value}
                              placeholder={label}
                              autoFocus={i === 0}
                              onChange={makeSegmentHandler(setter, next)}
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitPopover();
                                if (e.key === "Escape") setShowPopover(false);
                              }}
                              style={{
                                width: 26,
                                background: "transparent",
                                border: "none",
                                outline: "none",
                                color: "var(--text)",
                                fontSize: 12,
                                fontVariantNumeric: "tabular-nums",
                                fontWeight: 600,
                                textAlign: "center",
                                letterSpacing: "0.04em",
                                padding: 0,
                              }}
                            />
                          </span>
                        ))}
                      </div>
                      <button
                        className="btn btn-ghost btn--sm"
                        onClick={resetProgress}
                        style={{ fontSize: 11, padding: "4px 7px" }}
                        title="Reset"
                      >
                        ↺
                      </button>
                      <button
                        className="btn btn-primary btn--sm"
                        onClick={commitPopover}
                        style={{ fontSize: 11, padding: "4px 9px" }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
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
          {onOpenLog && dl.logPath && dl.status === "error" && (
            <button
              className="btn btn-ghost dl-btn--sm"
              onClick={onOpenLog}
              title="Open error log"
              style={{ color: "var(--red)", fontSize: 11 }}
            >
              View Log
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
