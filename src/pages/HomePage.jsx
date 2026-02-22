import { useState, useEffect, useMemo, useCallback } from "react";
import MediaCard from "../components/MediaCard";
import TrendingCarousel from "../components/TrendingCarousel";
import { PlayIcon, StarIcon } from "../components/Icons";
import { imgUrl, tmdbFetch } from "../utils/api";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";

function getRecentHistoryItem(history) {
  if (!history || history.length === 0) return null;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = history.filter(
    (h) => h.watchedAt && h.watchedAt > sevenDaysAgo,
  );
  if (recent.length === 0) return null;
  return recent[Math.floor(Math.random() * recent.length)];
}

export default function HomePage({
  trending,
  trendingTV,
  loading,
  onSelect,
  progress,
  inProgress,
  offline,
  onRetry,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  history,
  apiKey,
}) {
  const hero = trending[0];

  const [similarItems, setSimilarItems] = useState([]);
  const [similarSource, setSimilarSource] = useState(null);

  // Memoised so useRatings doesn't re-fire on every render
  const allItems = useMemo(
    () => [
      ...inProgress,
      ...trending.map((i) => ({ ...i, media_type: "movie" })),
      ...trendingTV.map((i) => ({ ...i, media_type: "tv" })),
      ...similarItems,
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [
      inProgress.length,
      trending.length,
      trendingTV.length,
      similarItems.length,
    ],
  );

  const { ratingsMap, ageLimitSetting } = useRatings(allItems);

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) =>
      isRestricted(getRatingForItem(item, ratingsMap).minAge, ageLimitSetting),
    [ratingsMap, ageLimitSetting],
  );

  // Enrich ratingsMap with `restricted` flag so the carousel can use it directly
  const enrichedRatingsMap = useMemo(() => {
    const out = {};
    for (const [k, v] of Object.entries(ratingsMap)) {
      out[k] = { ...v, restricted: isRestricted(v.minAge, ageLimitSetting) };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratingsMap, ageLimitSetting]);

  // Fetch similar items based on recent watch history
  useEffect(() => {
    if (!apiKey || offline || !history || history.length === 0) return;
    const source = getRecentHistoryItem(history);
    if (!source) return;
    setSimilarSource(source);
    const type = source.media_type === "tv" ? "tv" : "movie";

    const tryFetch = (endpoint) =>
      tmdbFetch(`/${type}/${source.id}/${endpoint}`, apiKey).then((data) =>
        (data.results || [])
          .slice(0, 20)
          .map((item) => ({ ...item, media_type: type })),
      );

    tryFetch("similar")
      .then((results) => {
        if (results.length > 0) {
          setSimilarItems(results);
          return;
        }
        return tryFetch("recommendations").then(setSimilarItems);
      })
      .catch(() =>
        tryFetch("recommendations")
          .then(setSimilarItems)
          .catch(() => {}),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, offline, history?.length]);

  // Pre-built item arrays for carousels (stable references via useMemo)
  const trendingMovieItems = useMemo(
    () => trending.map((i) => ({ ...i, media_type: "movie" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trending.length],
  );
  const trendingTVItems = useMemo(
    () => trendingTV.map((i) => ({ ...i, media_type: "tv" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trendingTV.length],
  );

  return (
    <div className="fade-in">
      {/* ── Offline state ── */}
      {offline && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "60vh",
            gap: 16,
            color: "var(--text2)",
          }}
        >
          <div style={{ fontSize: 48 }}>📡</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--text)" }}>
            No internet connection
          </div>
          <div style={{ fontSize: 14, color: "var(--text3)" }}>
            Trending and search require an internet connection. Your downloads
            and library still work offline.
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 8 }}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      )}

      {!offline && loading && (
        <div className="loader">
          <div className="spinner" />
        </div>
      )}

      {/* ── Hero ── */}
      {!loading && hero && (
        <div className="hero">
          <div
            className="hero-bg"
            style={{
              backgroundImage: `url(${imgUrl(hero.backdrop_path, "original")})`,
            }}
          />
          <div className="hero-gradient" />
          <div className="hero-content">
            <div className="hero-type">Trending · Movie</div>
            <div className="hero-title">{hero.title || hero.name}</div>
            <div className="hero-meta">
              <span className="hero-rating">
                <StarIcon /> {hero.vote_average?.toFixed(1)}
              </span>
              <span>{hero.release_date?.slice(0, 4)}</span>
            </div>
            <div className="hero-overview">{hero.overview}</div>
            <div className="hero-actions">
              <button
                className="btn btn-primary"
                onClick={() => onSelect(hero)}
              >
                <PlayIcon /> Watch Now
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => onSelect(hero)}
              >
                More Info
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Continue Watching ── */}
      {inProgress.length > 0 && (
        <div className="section">
          <div className="section-title">Continue Watching</div>
          <div className="cards-grid">
            {inProgress.map((item) => {
              const pk =
                item.media_type === "movie"
                  ? `movie_${item.id}`
                  : `tv_${item.id}_s${item.season}e${item.episode}`;
              const r = getRating(item);
              const restr = itemRestricted(item);
              return (
                <MediaCard
                  key={`${item.media_type}_${item.id}`}
                  item={item}
                  onClick={() => onSelect(item)}
                  progress={progress[pk] || 0}
                  watched={watched}
                  onMarkWatched={onMarkWatched}
                  onMarkUnwatched={onMarkUnwatched}
                  ageRating={r.cert}
                  restricted={restr}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Similar to [recent watch] — carousel ── */}
      {similarSource && similarItems.length > 0 && (
        <TrendingCarousel
          items={similarItems}
          title="Similar to"
          titleHighlight={similarSource.title || similarSource.name}
          onSelect={onSelect}
          ratingsMap={enrichedRatingsMap}
        />
      )}

      {/* ── Trending Movies — carousel ── */}
      {trendingMovieItems.length > 0 && (
        <TrendingCarousel
          items={trendingMovieItems}
          title="Trending Movies"
          onSelect={onSelect}
          ratingsMap={enrichedRatingsMap}
        />
      )}

      {/* ── Trending Series — carousel ── */}
      {trendingTVItems.length > 0 && (
        <TrendingCarousel
          items={trendingTVItems}
          title="Trending Series"
          onSelect={onSelect}
          ratingsMap={enrichedRatingsMap}
        />
      )}
    </div>
  );
}
