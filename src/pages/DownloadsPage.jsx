import { useState, useEffect, useRef, useCallback } from "react";
import {
  DownloadIcon,
  TrashIcon,
  FolderIcon,
  PlayIcon,
  FilmIcon,
  WatchedIcon,
} from "../components/Icons";
import { storage } from "../utils/storage";

const IMG_BASE = "https://image.tmdb.org/t/p/w154";

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
        src={`${IMG_BASE}${posterPath}`}
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
      if (d.filePath && fileExistsCache[d.id] === undefined) {
        window.electron.fileExists(d.filePath).then((exists) => {
          setFileExistsCache((prev) => ({ ...prev, [d.id]: exists }));
          // Auto-remove from registry if file was deleted externally
          if (!exists) {
            window.electron.deleteDownload({ id: d.id, filePath: null });
            onDeleteDownload(d.id);
          }
        });
      }
    });
  }, [finished.length]);

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
    } finally {
      setScanning(false);
    }
  }, [scanFolder, downloads]);

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
                  onWatch={() => window.electron.openPath(dl.filePath)}
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
                          })
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
function ActiveCard({ dl, onDelete }) {
  const pct = dl.progress || 0;
  return (
    <div className="dl-card dl-card-active">
      <div className="dl-card__header">
        <Poster posterPath={dl.posterPath} size={42} />
        <div className="dl-card__info">
          <div className="dl-card__name">{dl.name}</div>
          <div className="dl-card__meta">
            {dl.speed && <span>↓ {dl.speed}</span>}
            {dl.size && <span>{dl.size}</span>}
            {dl.totalFragments > 0 && (
              <span>
                {dl.completedFragments || 0}/{dl.totalFragments} fragments
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
      window.electron.openPathAtTime(dl.filePath, savedSecs);
    } else {
      onWatch();
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
