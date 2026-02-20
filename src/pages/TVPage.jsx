import { useState, useEffect, useRef } from "react";
import { tmdbFetch, imgUrl, videasyTVUrl } from "../utils/api";
import {
  BookmarkIcon,
  BookmarkFillIcon,
  BackIcon,
  StarIcon,
  PlayIcon,
  TVIcon,
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
  fetchTVRating,
  isRestricted,
  getAgeLimitSetting,
  getRatingCountry,
} from "../utils/ageRating";

// Small context menu for episode cards
function EpisodeContextMenu({
  x,
  y,
  isWatched,
  onMarkWatched,
  onMarkUnwatched,
  onClose,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {isWatched ? (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkUnwatched();
            onClose();
          }}
        >
          ↩ Mark as Unwatched
        </button>
      ) : (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkWatched();
            onClose();
          }}
        >
          ✓ Mark as Watched
        </button>
      )}
    </div>
  );
}

// Small context menu for season buttons
function SeasonContextMenu({
  x,
  y,
  isWatched,
  onMarkWatched,
  onMarkUnwatched,
  onClose,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {isWatched ? (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkUnwatched();
            onClose();
          }}
        >
          ↩ Mark Season as Unwatched
        </button>
      ) : (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkWatched();
            onClose();
          }}
        >
          ✓ Mark Season as Watched
        </button>
      )}
    </div>
  );
}

// Expandable episode description
function EpisodeDesc({ overview, episodeName }) {
  const [open, setOpen] = useState(false);
  if (!overview) return <div className="episode-desc" />;

  return (
    <>
      <div className="episode-desc-wrap">
        <div className="episode-desc">{overview}</div>
        <button
          className="episode-desc-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          More
        </button>
      </div>

      {open && (
        <div
          className="ep-desc-overlay"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div className="ep-desc-popup" onClick={(e) => e.stopPropagation()}>
            {episodeName && (
              <div className="ep-desc-popup-title">{episodeName}</div>
            )}
            <p className="ep-desc-popup-text">{overview}</p>
            <button
              className="ep-desc-popup-close"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default function TVPage({
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
  const [seasonData, setSeasonData] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [selectedEp, setSelectedEp] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [trailerKey, setTrailerKey] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [m3u8Url, setM3u8Url] = useState(null);
  const [downloaderFolder, setDownloaderFolder] = useState(
    () => storage.get("downloaderFolder") || "",
  );
  const [epMenu, setEpMenu] = useState(null); // { x, y, pk }

  // Age rating
  const [rating, setRating] = useState({ cert: null, minAge: null });
  const [ageLimitSetting] = useState(() => getAgeLimitSetting(storage));
  const [ratingCountry] = useState(() => getRatingCountry(storage));
  const restricted = isRestricted(rating.minAge, ageLimitSetting);
  const [seasonMenu, setSeasonMenu] = useState(null); // { x, y, seasonNum }

  // Check if all episodes of a season are watched
  const isSeasonWatched = (seasonNum) => {
    const seasonInfo = seasons.find((s) => s.season_number === seasonNum);
    const count =
      seasonNum === selectedSeason
        ? seasonData?.episodes?.length || seasonInfo?.episode_count || 0
        : seasonInfo?.episode_count || 0;
    if (!count) return false;
    for (let i = 1; i <= count; i++) {
      if (!watched?.[`tv_${item.id}_s${seasonNum}e${i}`]) return false;
    }
    return true;
  };

  const markSeasonWatched = (seasonNum) => {
    const seasonInfo = seasons.find((s) => s.season_number === seasonNum);
    const episodes = seasonNum === selectedSeason ? seasonData?.episodes : null;
    const count = episodes?.length || seasonInfo?.episode_count || 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 1; i <= count; i++) {
      // Skip unreleased episodes (only when we have episode data with air_date)
      if (episodes) {
        const ep = episodes.find((e) => e.episode_number === i);
        if (ep?.air_date && new Date(ep.air_date) > today) continue;
      }
      onMarkWatched?.(`tv_${item.id}_s${seasonNum}e${i}`);
    }
  };

  const markSeasonUnwatched = (seasonNum) => {
    const seasonInfo = seasons.find((s) => s.season_number === seasonNum);
    const episodes = seasonNum === selectedSeason ? seasonData?.episodes : null;
    const count = episodes?.length || seasonInfo?.episode_count || 0;
    for (let i = 1; i <= count; i++) {
      onMarkUnwatched?.(`tv_${item.id}_s${seasonNum}e${i}`);
    }
  };

  // Read threshold from settings (default 20s)
  const watchedThreshold = storage.get("watchedThreshold") ?? 20;
  const autoMarkedRef = useRef(false);
  const lastKnownTimeRef = useRef(0);
  const seekBackCooldownRef = useRef(0);

  useEffect(() => {
    setLoading(true);
    tmdbFetch(`/tv/${item.id}`, apiKey)
      .then((d) => {
        setDetails(d);
        const first =
          d.seasons?.find((s) => s.season_number > 0) || d.seasons?.[0];
        if (first) setSelectedSeason(first.season_number);
      })
      .catch(() => setDetails(item))
      .finally(() => setLoading(false));
  }, [item.id, apiKey]);

  useEffect(() => {
    tmdbFetch(`/tv/${item.id}/videos`, apiKey)
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
    fetchTVRating(item.id, apiKey, ratingCountry).then(setRating);
  }, [item.id, apiKey, ratingCountry]);

  useEffect(() => {
    if (!apiKey || !item.id) return;
    setLoadingSeason(true);
    setSelectedEp(null);
    setPlaying(false);
    tmdbFetch(`/tv/${item.id}/season/${selectedSeason}`, apiKey)
      .then(setSeasonData)
      .catch(() => {})
      .finally(() => setLoadingSeason(false));
  }, [item.id, selectedSeason, apiKey]);

  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onM3u8Found((url) => {
      setM3u8Url((prev) => prev || url);
    });
    return () => window.electron.offM3u8Found(handler);
  }, []);

  const d = details || item;
  const title = d.name || d.title;
  const year = (d.first_air_date || "").slice(0, 4);
  const seasons = (d.seasons || []).filter((s) => s.season_number > 0);

  const currentProgressKey = selectedEp
    ? `tv_${item.id}_s${selectedSeason}e${selectedEp.episode_number}`
    : null;

  // Check if currently-playing episode is already downloaded or downloading
  const currentEpDownload = selectedEp
    ? (downloads || []).find(
        (dl) =>
          dl.mediaType === "tv" &&
          (dl.tmdbId === item.id || dl.mediaId === item.id) &&
          dl.season === selectedSeason &&
          dl.episode === selectedEp.episode_number &&
          (dl.status === "completed" ||
            dl.status === "local" ||
            dl.status === "downloading"),
      )
    : null;

  // Reset auto-mark guard when episode changes
  useEffect(() => {
    autoMarkedRef.current = false;
    lastKnownTimeRef.current = 0;
    seekBackCooldownRef.current = 0;
  }, [currentProgressKey]);

  // ── Auto-track progress + auto-watched every 5s ──────────────────────────
  useEffect(() => {
    if (!playing || !currentProgressKey) return;
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
            saveProgress(currentProgressKey, Math.min(p, 100));
            // Also persist actual seconds so DownloadsPage can show resume position
            storage.set("dlTime_" + currentProgressKey, Math.floor(ct));

            // Auto-mark watched when remaining time ≤ threshold
            const remaining = result.duration - ct;
            if (
              !autoMarkedRef.current &&
              remaining <= watchedThreshold &&
              remaining >= 0
            ) {
              autoMarkedRef.current = true;
              onMarkWatched?.(currentProgressKey);
            }
          }
        } catch {}
      }, 5000);
    }, 3000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [playing, currentProgressKey, watchedThreshold]);

  const playEpisode = (ep) => {
    setM3u8Url(null);
    setSelectedEp(ep);
    setPlaying(true);
    onHistory({
      ...d,
      media_type: "tv",
      season: selectedSeason,
      episode: ep.episode_number,
      episodeName: ep.name,
    });
  };

  const handleSetDownloaderFolder = (folder) => {
    setDownloaderFolder(folder);
    storage.set("downloaderFolder", folder);
  };

  const mediaName = selectedEp
    ? `${title} (${year}) S${String(selectedSeason).padStart(2, "0")} E${String(selectedEp.episode_number).padStart(2, "0")}`
    : title;

  const currentEpWatched = currentProgressKey
    ? !!watched?.[currentProgressKey]
    : false;

  return (
    <div className="fade-in">
      {loading && (
        <div className="loader">
          <div className="spinner" />
        </div>
      )}
      {!loading && (
        <>
          <div className="detail-hero">
            <div
              className="detail-bg"
              style={{
                backgroundImage: `url(${imgUrl(d.backdrop_path, "original")})`,
              }}
            />
            <div className="detail-gradient" />
            <div className="detail-content">
              <div className="detail-poster">
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
                    <TVIcon />
                  </div>
                )}
              </div>
              <div className="detail-info">
                <div className="detail-type">Series</div>
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
                  {d.number_of_seasons && (
                    <span>{d.number_of_seasons} Seasons</span>
                  )}
                  {d.number_of_episodes && (
                    <span>{d.number_of_episodes} Episodes</span>
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
                  <button className="btn btn-ghost" onClick={onBack}>
                    <BackIcon /> Back
                  </button>
                </div>
              </div>
            </div>
          </div>

          {playing && selectedEp && (
            <div className="section">
              <div
                style={{
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span className="tag tag-red">
                  Season {selectedSeason} · E{selectedEp.episode_number}
                </span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>
                  {selectedEp.name}
                </span>
                {currentEpWatched ? (
                  <button
                    className="btn btn-ghost watched-btn"
                    style={{ marginLeft: "auto" }}
                    onClick={() => onMarkUnwatched?.(currentProgressKey)}
                  >
                    <WatchedIcon size={14} /> Watched
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost"
                    style={{ marginLeft: "auto" }}
                    onClick={() => onMarkWatched?.(currentProgressKey)}
                  >
                    ✓ Mark Watched
                  </button>
                )}
              </div>
              <div className="player-wrap">
                <webview
                  src={videasyTVUrl(
                    item.id,
                    selectedSeason,
                    selectedEp.episode_number,
                  )}
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
                    currentEpDownload
                      ? onGoToDownloads?.(currentEpDownload.id)
                      : setShowDownload(true)
                  }
                  title={
                    currentEpDownload
                      ? currentEpDownload.status === "downloading"
                        ? "Downloading… – view in Downloads"
                        : "Already downloaded – view in Downloads"
                      : "Download"
                  }
                >
                  {currentEpDownload ? (
                    <span
                      className="player-downloaded-icon"
                      style={{
                        color:
                          currentEpDownload.status === "downloading"
                            ? "var(--red)"
                            : "#4caf50",
                      }}
                    >
                      {currentEpDownload.status === "downloading" ? "↓" : "✓"}
                    </span>
                  ) : (
                    <DownloadIcon />
                  )}
                  {!currentEpDownload && m3u8Url && (
                    <span className="player-overlay-dot" />
                  )}
                </button>
              </div>
              {currentProgressKey && (
                <div className="progress-mark-row">
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text3)",
                      marginRight: 4,
                    }}
                  >
                    Mark progress:
                  </span>
                  {[25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      className="btn btn-ghost"
                      style={{ padding: "5px 14px", fontSize: 12 }}
                      onClick={() => saveProgress(currentProgressKey, p)}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="section">
            <div className="section-title">Episodes</div>
            {seasons.length > 0 && (
              <div className="season-selector">
                {seasons.map((s) => {
                  const sw = isSeasonWatched(s.season_number);
                  return (
                    <button
                      key={s.season_number}
                      className={`season-btn ${selectedSeason === s.season_number ? "active" : ""} ${sw ? "season-watched" : ""}`}
                      onClick={() => setSelectedSeason(s.season_number)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSeasonMenu({
                          x: e.clientX,
                          y: e.clientY,
                          seasonNum: s.season_number,
                        });
                      }}
                      title="Right-click to mark season as watched/unwatched"
                    >
                      {sw && <span className="season-watched-icon">✓</span>}
                      Season {s.season_number}
                    </button>
                  );
                })}
              </div>
            )}
            {loadingSeason && (
              <div className="loader">
                <div className="spinner" />
              </div>
            )}
            {!loadingSeason && seasonData?.episodes && (
              <div className="episodes-grid">
                {(() => {
                  // Compute today once, outside the per-episode loop
                  const todayEp = new Date();
                  todayEp.setHours(0, 0, 0, 0);
                  return seasonData.episodes.map((ep) => {
                    const pk = `tv_${item.id}_s${selectedSeason}e${ep.episode_number}`;
                    const epPct = progress[pk] || 0;
                    const epWatched = !!watched?.[pk];
                    const isPlaying =
                      playing &&
                      selectedEp?.episode_number === ep.episode_number;

                    // Unreleased: only if air_date exists and is strictly in the future
                    const epUnreleased = ep.air_date
                      ? new Date(ep.air_date) > todayEp
                      : false;
                    const epDownload = (downloads || []).find(
                      (dl) =>
                        dl.mediaType === "tv" &&
                        (dl.tmdbId === item.id || dl.mediaId === item.id) &&
                        dl.season === selectedSeason &&
                        dl.episode === ep.episode_number &&
                        (dl.status === "completed" ||
                          dl.status === "local" ||
                          dl.status === "downloading"),
                    );
                    return (
                      <div
                        key={ep.episode_number}
                        className={`episode-card ${isPlaying ? "playing" : ""} ${epWatched ? "ep-watched" : ""} ${restricted ? "episode-card--restricted" : ""} ${epUnreleased ? "episode-card--unreleased" : ""}`}
                        onClick={() =>
                          restricted || epUnreleased ? null : playEpisode(ep)
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!restricted && !epUnreleased)
                            setEpMenu({ x: e.clientX, y: e.clientY, pk });
                        }}
                        style={epUnreleased ? { cursor: "default" } : undefined}
                      >
                        <div className="episode-thumb">
                          {ep.still_path ? (
                            <img
                              src={imgUrl(ep.still_path, "w300")}
                              alt={ep.name}
                              loading="lazy"
                            />
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
                              <PlayIcon />
                            </div>
                          )}
                          {restricted ? (
                            <div className="episode-restricted-overlay">
                              🔒<span>Inappropriate for your age</span>
                            </div>
                          ) : epUnreleased ? (
                            <div className="episode-restricted-overlay">
                              🔒<span>Unreleased</span>
                            </div>
                          ) : isPlaying ? (
                            <div className="episode-playing-badge">
                              <span className="episode-playing-dot" />
                              Playing
                            </div>
                          ) : (
                            <div className="episode-thumb-play">
                              <PlayIcon />
                            </div>
                          )}
                        </div>
                        <div className="episode-info">
                          <div
                            className="episode-num"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                            }}
                          >
                            E{ep.episode_number}
                            {epWatched && <WatchedIcon size={14} />}
                            {epDownload && (
                              <span
                                className="ep-downloaded-badge"
                                title={
                                  epDownload.status === "downloading"
                                    ? "Downloading… – click to view in Downloads"
                                    : "Downloaded – click to view in Downloads"
                                }
                                style={{
                                  borderColor:
                                    epDownload.status === "downloading"
                                      ? "rgba(229,9,20,0.5)"
                                      : "rgba(72,199,116,0.5)",
                                  color:
                                    epDownload.status === "downloading"
                                      ? "var(--red)"
                                      : "#4caf50",
                                  background:
                                    epDownload.status === "downloading"
                                      ? "rgba(229,9,20,0.12)"
                                      : "rgba(72,199,116,0.18)",
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onGoToDownloads?.(epDownload.id);
                                }}
                              >
                                {epDownload.status === "downloading"
                                  ? "↓"
                                  : "↓"}
                              </span>
                            )}
                          </div>
                          <div className="episode-name">{ep.name}</div>
                          <EpisodeDesc
                            overview={ep.overview}
                            episodeName={ep.name}
                          />
                          {!epWatched && epPct > 0 && (
                            <div className="episode-progress-bar">
                              <div
                                className="episode-progress-fill"
                                style={{ width: `${Math.min(epPct, 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </>
      )}

      {showTrailer && trailerKey && (
        <TrailerModal
          trailerKey={trailerKey}
          title={title}
          onClose={() => setShowTrailer(false)}
        />
      )}

      {epMenu && (
        <EpisodeContextMenu
          x={epMenu.x}
          y={epMenu.y}
          isWatched={!!watched?.[epMenu.pk]}
          onMarkWatched={() => onMarkWatched?.(epMenu.pk)}
          onMarkUnwatched={() => onMarkUnwatched?.(epMenu.pk)}
          onClose={() => setEpMenu(null)}
        />
      )}

      {seasonMenu && (
        <SeasonContextMenu
          x={seasonMenu.x}
          y={seasonMenu.y}
          isWatched={isSeasonWatched(seasonMenu.seasonNum)}
          onMarkWatched={() => markSeasonWatched(seasonMenu.seasonNum)}
          onMarkUnwatched={() => markSeasonUnwatched(seasonMenu.seasonNum)}
          onClose={() => setSeasonMenu(null)}
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
          mediaType="tv"
          season={selectedSeason}
          episode={selectedEp?.episode_number}
          posterPath={d.poster_path}
          tmdbId={item.id}
        />
      )}
    </div>
  );
}
