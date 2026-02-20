import { useState, useEffect, useRef } from "react";
import { tmdbFetch, imgUrl, videasyMovieUrl } from "../utils/api";
import {
  PlayIcon,
  BookmarkIcon,
  BookmarkFillIcon,
  BackIcon,
  StarIcon,
  FilmIcon,
  DownloadIcon,
  WatchedIcon,
  TrailerIcon,
  RatingShieldIcon,
  RatingLockIcon,
} from "../components/Icons";
import DownloadModal from "../components/DownloadModal";
import TrailerModal from "../components/TrailerModal";
import { storage } from "../utils/storage";
import {
  fetchMovieRating,
  isRestricted,
  getAgeLimitSetting,
  getRatingCountry,
} from "../utils/ageRating";

export default function MoviePage({
  item,
  apiKey,
  onSave,
  isSaved,
  onHistory,
  progress,
  saveProgress,
  onBack,
  onSettings,
  onDownloadStarted,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  downloads,
  onGoToDownloads,
}) {
  const [details, setDetails] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [trailerKey, setTrailerKey] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [m3u8Url, setM3u8Url] = useState(null);
  const [downloaderFolder, setDownloaderFolder] = useState(
    () => storage.get("downloaderFolder") || "",
  );

  // Age rating
  const [rating, setRating] = useState({ cert: null, minAge: null });
  const [ageLimitSetting] = useState(() => getAgeLimitSetting(storage));
  const [ratingCountry] = useState(() => getRatingCountry(storage));
  const restricted = isRestricted(rating.minAge, ageLimitSetting);

  const progressKey = `movie_${item.id}`;
  const pct = progress[progressKey] || 0;
  const isWatched = !!watched?.[progressKey];

  // Read threshold from settings (default 20s)
  const watchedThreshold = storage.get("watchedThreshold") ?? 20;

  // Ref to prevent double-marking
  const autoMarkedRef = useRef(false);
  // Tracks last known playback position — used to detect resolution-change resets
  const lastKnownTimeRef = useRef(0);
  // Timestamp until which we ignore reset detection (post-seekback cooldown)
  const seekBackCooldownRef = useRef(0);

  useEffect(() => {
    tmdbFetch(`/movie/${item.id}`, apiKey)
      .then(setDetails)
      .catch(() => setDetails(item));
  }, [item.id, apiKey]);

  useEffect(() => {
    fetchMovieRating(item.id, apiKey, ratingCountry).then(setRating);
  }, [item.id, apiKey, ratingCountry]);

  useEffect(() => {
    tmdbFetch(`/movie/${item.id}/videos`, apiKey)
      .then((data) => {
        const videos = data.results || [];
        const trailer =
          videos.find((v) => v.type === "Trailer" && v.site === "YouTube") ||
          videos.find((v) => v.site === "YouTube");
        if (trailer) setTrailerKey(trailer.key);
      })
      .catch(() => {});
  }, [item.id, apiKey]);

  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onM3u8Found((url) => {
      setM3u8Url((prev) => prev || url);
    });
    return () => window.electron.offM3u8Found(handler);
  }, []);

  // Reset auto-mark guard when a new movie loads or watched state resets
  useEffect(() => {
    autoMarkedRef.current = false;
    lastKnownTimeRef.current = 0;
    seekBackCooldownRef.current = 0;
  }, [item.id, isWatched]);

  // ── Auto-track progress + auto-watched every 5s ──────────────────────────
  useEffect(() => {
    if (!playing) return;
    let interval = null;
    const timer = setTimeout(() => {
      interval = setInterval(async () => {
        try {
          const wv = document.querySelector("webview");
          if (!wv) return;
          const result = await wv.executeJavaScript(`
            (() => {
              const v = document.querySelector('video')
              if (!v || !v.duration || v.duration === Infinity || v.paused) return null
              // Re-attach seek tracker if video element was recreated (e.g. quality change)
              if (!v._seekTracked) {
                v._seekTracked = true
                v.addEventListener('seeked', () => {
                  v._lastUserSeek = Date.now()
                  v._lastUserSeekTo = v.currentTime
                })
              }
              return {
                currentTime: v.currentTime,
                duration: v.duration,
                recentUserSeek: v._lastUserSeek ? (Date.now() - v._lastUserSeek < 6000) : false,
                lastUserSeekTo: v._lastUserSeekTo ?? null,
              }
            })()
          `);
          if (result && result.duration > 0) {
            const ct = result.currentTime;

            // ── Resolution-change reset detection ──────────────────────────
            // Videasy resets to 0 on quality change. We only seek back if:
            // - ct is near zero (≤5s)
            // - we were well into the video (>30s)
            // - the user did NOT manually seek in the last 6s
            const now = Date.now();
            if (
              lastKnownTimeRef.current > 30 &&
              ct <= 5 &&
              !result.recentUserSeek
            ) {
              if (now > seekBackCooldownRef.current) {
                // First reset: seek back and start cooldown
                const seekTo = lastKnownTimeRef.current;
                seekBackCooldownRef.current = now + 8000;
                try {
                  await wv.executeJavaScript(`
                    (() => {
                      const v = document.querySelector('video')
                      if (v) v.currentTime = ${seekTo}
                    })()
                  `);
                } catch {}
              }
              // In both cases (first reset or cooldown): skip progress save with wrong position
              return;
            }

            // If user seeked, update ref to their chosen position immediately
            if (result.recentUserSeek && result.lastUserSeekTo !== null) {
              lastKnownTimeRef.current = result.lastUserSeekTo;
            } else {
              lastKnownTimeRef.current = ct;
            }
            const p = Math.floor((ct / result.duration) * 100);
            saveProgress(progressKey, Math.min(p, 100));
            // Also persist actual seconds so DownloadsPage can show resume position
            storage.set("dlTime_" + progressKey, Math.floor(ct));

            // Auto-mark watched when remaining time ≤ threshold
            const remaining = result.duration - ct;
            if (
              !autoMarkedRef.current &&
              remaining <= watchedThreshold &&
              remaining >= 0
            ) {
              autoMarkedRef.current = true;
              onMarkWatched?.(progressKey);
            }
          }
        } catch {}
      }, 5000);
    }, 3000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [playing, progressKey, watchedThreshold]);

  const handlePlay = () => {
    setM3u8Url(null);
    setPlaying(true);
    onHistory({ ...d, media_type: "movie" });
  };

  const handleSetDownloaderFolder = (folder) => {
    setDownloaderFolder(folder);
    storage.set("downloaderFolder", folder);
  };

  const d = details || item;
  const title = d.title || d.name;
  const year = (d.release_date || "").slice(0, 4);
  const mediaName = `${title}${year ? " (" + year + ")" : ""}`;

  // Unreleased detection
  const todayMovie = new Date();
  todayMovie.setHours(0, 0, 0, 0);
  const isUnreleased = d.release_date
    ? new Date(d.release_date) > todayMovie
    : false;

  // Check if this movie is already downloaded or currently downloading
  const movieDownload = (downloads || []).find(
    (dl) =>
      dl.mediaType === "movie" &&
      (dl.tmdbId === item.id || dl.mediaId === item.id) &&
      (dl.status === "completed" ||
        dl.status === "local" ||
        dl.status === "downloading"),
  );

  return (
    <div className="fade-in">
      <div className="detail-hero">
        <div
          className="detail-bg"
          style={{
            backgroundImage: `url(${imgUrl(d.backdrop_path, "original")})`,
          }}
        />
        <div className="detail-gradient" />
        <div className="detail-content">
          <div className="detail-poster" style={{ position: "relative" }}>
            {d.poster_path ? (
              <img src={imgUrl(d.poster_path)} alt={title} loading="lazy" />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text3)",
                }}
              >
                <FilmIcon />
              </div>
            )}
            {isWatched && (
              <div className="detail-watched-badge">
                <WatchedIcon size={36} />
              </div>
            )}
          </div>
          <div className="detail-info">
            <div
              className="detail-type"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              Movie
              {isWatched && (
                <span className="watched-label">
                  <WatchedIcon size={14} /> Watched
                </span>
              )}
            </div>
            <div className="detail-title">{title}</div>
            <div className="genres">
              {(d.genres || []).map((g) => (
                <span key={g.id} className="genre-tag">
                  {g.name}
                </span>
              ))}
            </div>
            <div className="detail-meta">
              {d.vote_average > 0 && (
                <span className="detail-rating">
                  <StarIcon /> {d.vote_average?.toFixed(1)}
                </span>
              )}
              {year && <span>{year}</span>}
              {d.runtime && <span>{d.runtime} min</span>}
              {d.original_language && (
                <span>{d.original_language?.toUpperCase()}</span>
              )}
            </div>
            {rating.cert && (
              <div
                className={`age-rating-pill${restricted ? " age-rating-pill--restricted" : ""}`}
              >
                {restricted ? (
                  <RatingLockIcon size={13} />
                ) : (
                  <RatingShieldIcon size={13} />
                )}
                <span className="age-rating-pill-cert">{rating.cert}</span>
                {restricted && (
                  <span className="age-rating-pill-label">
                    Inappropriate for your age setting
                  </span>
                )}
              </div>
            )}
            <p className="detail-overview">{d.overview}</p>
            <div className="detail-actions">
              {isUnreleased ? (
                <button
                  className="btn btn-primary btn-restricted"
                  disabled
                  title="This movie has not been released yet"
                >
                  🔒 Unreleased
                </button>
              ) : restricted ? (
                <button
                  className="btn btn-primary btn-restricted"
                  disabled
                  title="Inappropriate for your age rating setting"
                >
                  🔒 Restricted
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handlePlay}>
                  <PlayIcon /> {playing ? "Restart" : "Play"}
                </button>
              )}
              {trailerKey &&
                (restricted ? (
                  <button
                    className="btn btn-secondary btn-restricted"
                    disabled
                    title="Inappropriate for your age rating setting"
                  >
                    🔒 Trailer
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowTrailer(true)}
                  >
                    <TrailerIcon /> Trailer
                  </button>
                ))}
              <button className="btn btn-secondary" onClick={onSave}>
                {isSaved ? <BookmarkFillIcon /> : <BookmarkIcon />}
                {isSaved ? "Saved" : "Save"}
              </button>
              {!isUnreleased &&
                (isWatched ? (
                  <button
                    className="btn btn-ghost watched-btn"
                    onClick={() => onMarkUnwatched?.(progressKey)}
                  >
                    <WatchedIcon size={16} /> Watched
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost"
                    onClick={() => onMarkWatched?.(progressKey)}
                  >
                    ✓ Mark Watched
                  </button>
                ))}
              <button className="btn btn-ghost" onClick={onBack}>
                <BackIcon /> Back
              </button>
            </div>
          </div>
        </div>
      </div>

      {playing && !restricted && !isUnreleased && (
        <div className="section">
          <div className="player-wrap">
            <webview
              src={videasyMovieUrl(item.id)}
              partition="persist:videasy"
              allowpopups="false"
              sandbox="allow-scripts allow-same-origin allow-forms"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: "none",
              }}
            />
            <button
              className="player-overlay-btn"
              onClick={() =>
                movieDownload
                  ? onGoToDownloads?.(movieDownload.id)
                  : setShowDownload(true)
              }
              title={
                movieDownload
                  ? movieDownload.status === "downloading"
                    ? "Downloading… – view in Downloads"
                    : "Already downloaded – view in Downloads"
                  : "Download"
              }
            >
              {movieDownload ? (
                <span
                  className="player-downloaded-icon"
                  style={{
                    color:
                      movieDownload.status === "downloading"
                        ? "var(--red)"
                        : "#4caf50",
                  }}
                >
                  {movieDownload.status === "downloading" ? "↓" : "✓"}
                </span>
              ) : (
                <DownloadIcon />
              )}
              {!movieDownload && m3u8Url && (
                <span className="player-overlay-dot" />
              )}
            </button>
          </div>

          {pct > 0 && (
            <div className="progress-bar-row">
              <div className="progress-bar-outer">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>
                {pct.toFixed(0)}% watched
              </span>
            </div>
          )}
          <div className="progress-mark-row">
            <span
              style={{ fontSize: 12, color: "var(--text3)", marginRight: 4 }}
            >
              Mark progress:
            </span>
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                style={{ padding: "5px 14px", fontSize: 12 }}
                onClick={() => saveProgress(progressKey, p)}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>
      )}

      {showTrailer && trailerKey && (
        <TrailerModal
          trailerKey={trailerKey}
          title={title}
          onClose={() => setShowTrailer(false)}
        />
      )}

      {showDownload && (
        <DownloadModal
          onClose={() => setShowDownload(false)}
          m3u8Url={m3u8Url}
          mediaName={mediaName}
          downloaderFolder={downloaderFolder}
          setDownloaderFolder={handleSetDownloaderFolder}
          onOpenSettings={onSettings}
          onDownloadStarted={onDownloadStarted}
          mediaId={item.id}
          mediaType="movie"
          posterPath={d.poster_path}
          tmdbId={item.id}
        />
      )}
    </div>
  );
}
