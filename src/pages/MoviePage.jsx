import { useState, useEffect, useRef } from "react";
import {
  tmdbFetch,
  imgUrl,
  PLAYER_SOURCES,
  getSourceUrl,
  sourceSupportsProgress,
  sourceIsAsync,
  fetchAnilistData,
  cleanAnilistDescription,
  isAnimeContent,
  ANIME_DEFAULT_SOURCE,
  NON_ANIME_DEFAULT_SOURCE,
} from "../utils/api";
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
  SourceIcon,
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
  const [playerSource, setPlayerSource] = useState(
    () => storage.get("playerSource") || "videasy",
  );
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [anilistData, setAnilistData] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const sourceRef = useRef(null);
  // AllManga async URL resolution
  const [resolvedPlayerUrl, setResolvedPlayerUrl] = useState(null);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [resolveError, setResolveError] = useState(null);

  // Derived: detect anime before any effects so effects can use it
  const isAnime = isAnimeContent(item, details);
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

  // Reset m3u8 URL and source menu whenever the movie or source changes
  useEffect(() => {
    setM3u8Url(null);
    setShowSourceMenu(false);
    setAnilistData(null);
    setResolvedPlayerUrl(null);
    setResolvingUrl(false);
    setResolveError(null);
  }, [item.id, playerSource]);

  // Fetch AniList data + auto-set source for anime/non-anime
  useEffect(() => {
    if (isAnime) {
      fetchAnilistData(item.title || item.name, "ANIME", item.id).then(
        (data) => {
          if (data) setAnilistData(data);
        },
      );
      // Switch to anime source if current source is not an anime source
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (!currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(savedSrc?.tag ? saved : ANIME_DEFAULT_SOURCE);
      }
    } else {
      // Switch back to non-anime source if current source is anime-only
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(!savedSrc?.tag ? saved : NON_ANIME_DEFAULT_SOURCE);
      }
    }
  }, [item.id, isAnime]);

  // Resolve AllManga movie URL via main-process IPC
  useEffect(() => {
    if (!playing || !sourceIsAsync(playerSource)) return;
    if (resolvedPlayerUrl || resolvingUrl) return;
    setResolvingUrl(true);
    setResolveError(null);
    const startTime = storage.get("dlTime_" + progressKey) || 0;
    window.electron
      .resolveAllManga({
        title,
        seasonNumber: 1,
        episodeNumber: 1,
        isMovie: true,
      })
      .then((res) => {
        if (res?.ok && res.url) {
          if (res.isDirectMp4 !== undefined) {
            window.electron
              .setPlayerVideo({
                url: res.url,
                referer: res.referer || "https://allmanga.to",
                startTime,
              })
              .then((r) => {
                setResolvedPlayerUrl(r.playerUrl);
                setM3u8Url(res.url);
              })
              .catch(() => setResolveError("Failed to start local player"));
          } else {
            setResolvedPlayerUrl(res.url);
          }
        } else {
          setResolveError(res?.error || "Movie not found on AllManga");
        }
      })
      .catch((e) => setResolveError(e.message || "Error"))
      .finally(() => setResolvingUrl(false));
  }, [playing, playerSource]);

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
    if (!playing || !sourceSupportsProgress(playerSource)) return;
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
  }, [playing, progressKey, watchedThreshold, playerSource]);

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

  // Prefer AniList metadata for anime when available
  const displayOverview =
    isAnime && anilistData?.description
      ? cleanAnilistDescription(anilistData.description)
      : d.overview;
  const displayScore =
    isAnime && anilistData?.averageScore
      ? (anilistData.averageScore / 10).toFixed(1)
      : d.vote_average > 0
        ? d.vote_average.toFixed(1)
        : null;
  const displayGenres =
    isAnime && anilistData?.genres?.length
      ? anilistData.genres.map((g, i) => ({ id: i, name: g }))
      : d.genres || [];

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
              {displayGenres.map((g) => (
                <span key={g.id} className="genre-tag">
                  {g.name}
                </span>
              ))}
            </div>
            <div className="detail-meta">
              {displayScore && (
                <span className="detail-rating">
                  <StarIcon /> {displayScore}
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
            <p className="detail-overview">{displayOverview}</p>
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
            {/* AllManga: spinner while resolving */}
            {sourceIsAsync(playerSource) && resolvingUrl && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 10,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.85)",
                  gap: 14,
                  borderRadius: "inherit",
                }}
              >
                <div className="spinner" />
                <span style={{ fontSize: 14, color: "var(--text2)" }}>
                  Looking up movie on AllManga…
                </span>
              </div>
            )}
            {/* AllManga: error if lookup failed */}
            {sourceIsAsync(playerSource) && resolveError && !resolvingUrl && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 10,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.85)",
                  gap: 10,
                  borderRadius: "inherit",
                }}
              >
                <span style={{ fontSize: 28 }}>⚠️</span>
                <span style={{ fontSize: 14, color: "var(--text2)" }}>
                  Movie not found on AllManga
                </span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {resolveError}
                </span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  Try a different source.
                </span>
              </div>
            )}
            <webview
              src={
                sourceIsAsync(playerSource)
                  ? resolvedPlayerUrl || "about:blank"
                  : getSourceUrl(
                      playerSource,
                      "movie",
                      item.id,
                      null,
                      null,
                      title,
                    )
              }
              partition="persist:videasy"
              allowpopups="false"
              sandbox="allow-scripts allow-same-origin allow-forms"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: "none",
                visibility:
                  sourceIsAsync(playerSource) && !resolvedPlayerUrl
                    ? "hidden"
                    : "visible",
              }}
            />
            {/* Source button – left side overlay */}
            <button
              ref={sourceRef}
              className="player-overlay-btn"
              style={{ left: 12, right: "auto" }}
              onClick={() => {
                const rect = sourceRef.current?.getBoundingClientRect();
                if (rect) setMenuPos({ top: rect.bottom + 6, left: rect.left });
                setShowSourceMenu((v) => !v);
              }}
              title="Change source"
            >
              <SourceIcon />
              {PLAYER_SOURCES.find((s) => s.id === playerSource)?.label ??
                "Source"}
            </button>
            {showSourceMenu && menuPos && (
              <div
                className="source-dropdown source-dropdown--fixed"
                style={{ top: menuPos.top, left: menuPos.left }}
                onClick={(e) => e.stopPropagation()}
              >
                {PLAYER_SOURCES.map((src) => (
                  <button
                    key={src.id}
                    className={
                      "source-dropdown__item" +
                      (playerSource === src.id
                        ? " source-dropdown__item--active"
                        : "")
                    }
                    onClick={() => {
                      setPlayerSource(src.id);
                      storage.set("playerSource", src.id);
                      setShowSourceMenu(false);
                      setM3u8Url(null);
                      setResolvedPlayerUrl(null);
                      setResolvingUrl(false);
                      setResolveError(null);
                    }}
                  >
                    <span>{src.label}</span>
                    {src.tag && (
                      <span className="source-dropdown__tag">{src.tag}</span>
                    )}
                    {src.note && (
                      <span className="source-dropdown__note">{src.note}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              className="player-overlay-btn"
              onClick={() =>
                movieDownload
                  ? onGoToDownloads?.(movieDownload.id)
                  : (setShowSourceMenu(false), setShowDownload(true))
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
              {!sourceSupportsProgress(playerSource) && (
                <span
                  className="player-no-progress-hint"
                  title="No automatic progress tracking for this source"
                >
                  ⚠ no tracking
                </span>
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
