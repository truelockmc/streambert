import { useState, useEffect, useMemo, useCallback } from "react";
import MediaCard from "../components/MediaCard";
import TrendingCarousel from "../components/TrendingCarousel";
import { PlayIcon, StarIcon } from "../components/Icons";
import { imgUrl, tmdbFetch } from "../utils/api";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";
import { storage } from "../utils/storage";
import { loadHomeLayout, loadHomeViewMode } from "../utils/homeLayout";

function getRecentHistoryItem(history) {
  if (!history || history.length === 0) return null;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = history.filter(
    (h) => h.watchedAt && h.watchedAt > sevenDaysAgo,
  );
  if (recent.length === 0) return null;
  return recent[Math.floor(Math.random() * recent.length)];
}

const MOVIE_GENRES = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 36, name: "History" },
  { id: 27, name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Science Fiction" },
  { id: 53, name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37, name: "Western" }
];

const TV_GENRES = [
  { id: 10759, name: "Action & Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 10762, name: "Kids" },
  { id: 9648, name: "Mystery" },
  { id: 10763, name: "News" },
  { id: 10764, name: "Reality" },
  { id: 10765, name: "Sci-Fi & Fantasy" },
  { id: 10766, name: "Soap" },
  { id: 10767, name: "Talk" },
  { id: 10768, name: "War & Politics" },
  { id: 37, name: "Western" }
];

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "hi", name: "Hindi" },
];

const YEARS = Array.from({ length: 50 }, (_, i) => new Date().getFullYear() - i);

const ALL_GENRES = Array.from(new Map([...MOVIE_GENRES, ...TV_GENRES].map(g => [g.id, g])).values()).sort((a,b) => a.name.localeCompare(b.name));

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
  const [topRatedItems, setTopRatedItems] = useState([]);

  // Filter state
  const [filterType, setFilterType] = useState("all");
  const [filterGenre, setFilterGenre] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterLanguage, setFilterLanguage] = useState("");
  const [filteredResults, setFilteredResults] = useState([]);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [loadingRandom, setLoadingRandom] = useState(false);
  const isActiveFilter = filterType !== "all" || filterGenre !== "" || filterYear !== "" || filterLanguage !== "";

  // Load layout config (order + visibility) once on mount
  const [layout] = useState(() => loadHomeLayout());
  const { order: rowOrder, visible: rowVisible } = layout;

  const [viewMode] = useState(() => loadHomeViewMode());

  // All items for batch ratings fetch
  const allItems = useMemo(
    () => [
      ...inProgress,
      ...trending.map((i) => ({ ...i, media_type: "movie" })),
      ...trendingTV.map((i) => ({ ...i, media_type: "tv" })),
      ...similarItems,
      ...topRatedItems,
      ...filteredResults,
    ],
    [inProgress, trending, trendingTV, similarItems, topRatedItems, filteredResults],
  );

  const { ratingsMap, ageLimitSetting } = useRatings(allItems);

  const handleRandomSuggestion = async () => {
    if (!apiKey || offline) return;
    setLoadingRandom(true);
    try {
      // Pick random page between 1 and 20 to ensure good quality results but decent variety
      const randomPage = Math.floor(Math.random() * 20) + 1;
      const type = filterType === "all" ? (Math.random() > 0.5 ? "movie" : "tv") : filterType;
      let endpoint = `/discover/${type}?sort_by=popularity.desc&page=${randomPage}`;
      if (filterGenre) endpoint += `&with_genres=${filterGenre}`;
      if (filterYear) {
        if (type === "movie") endpoint += `&primary_release_year=${filterYear}`;
        else endpoint += `&first_air_date_year=${filterYear}`;
      }
      if (filterLanguage) endpoint += `&with_original_language=${filterLanguage}`;

      const data = await tmdbFetch(endpoint, apiKey);
      if (data.results && data.results.length > 0) {
        const randomItem = data.results[Math.floor(Math.random() * data.results.length)];
        onSelect({ ...randomItem, media_type: type });
      } else {
         // If no results on random page, fallback to page 1
         const fallbackData = await tmdbFetch(endpoint.replace(`page=${randomPage}`, 'page=1'), apiKey);
         if (fallbackData.results && fallbackData.results.length > 0) {
            const randomItem = fallbackData.results[Math.floor(Math.random() * fallbackData.results.length)];
            onSelect({ ...randomItem, media_type: type });
         }
      }
    } catch (e) {
      console.error("Failed to fetch random suggestion", e);
    } finally {
      setLoadingRandom(false);
    }
  };

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) =>
      isRestricted(getRatingForItem(item, ratingsMap).minAge, ageLimitSetting),
    [ratingsMap, ageLimitSetting],
  );

  // Enrich ratingsMap with restricted flag for carousels
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
          .slice(0, 10)
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

  // Fetch top rated movies + TV, merge and shuffle
  useEffect(() => {
    if (!apiKey || offline) return;
    const controller = new AbortController();
    Promise.all([
      tmdbFetch("/movie/top_rated?page=1", apiKey, {
        signal: controller.signal,
      }),
      tmdbFetch("/tv/top_rated?page=1", apiKey, { signal: controller.signal }),
    ])
      .then(([moviesData, tvData]) => {
        const movies = (moviesData.results || [])
          .slice(0, 8)
          .map((i) => ({ ...i, media_type: "movie" }));
        const tv = (tvData.results || [])
          .slice(0, 8)
          .map((i) => ({ ...i, media_type: "tv" }));
        // Interleave movies and TV for variety
        const merged = [];
        const max = Math.max(movies.length, tv.length);
        for (let i = 0; i < max; i++) {
          if (movies[i]) merged.push(movies[i]);
          if (tv[i]) merged.push(tv[i]);
        }
        setTopRatedItems(merged);
      })
      .catch((e) => {
        if (e.name !== "AbortError") console.warn("Top rated fetch failed", e);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, offline]);

  // Fetch filtered results
  useEffect(() => {
    if (!apiKey || offline || !isActiveFilter) return;
    setLoadingFilters(true);

    const controller = new AbortController();

    const fetchType = async (type) => {
      let endpoint = `/discover/${type}?sort_by=popularity.desc&page=1`;
      if (filterGenre) endpoint += `&with_genres=${filterGenre}`;
      if (filterYear) {
        if (type === "movie") endpoint += `&primary_release_year=${filterYear}`;
        else endpoint += `&first_air_date_year=${filterYear}`;
      }
      if (filterLanguage) endpoint += `&with_original_language=${filterLanguage}`;

      const data = await tmdbFetch(endpoint, apiKey, { signal: controller.signal });
      return (data.results || []).map((i) => ({ ...i, media_type: type }));
    };

    if (filterType === "all") {
      Promise.all([fetchType("movie"), fetchType("tv")])
        .then(([movies, tvs]) => {
          const merged = [];
          const max = Math.max(movies.length, tvs.length);
          for (let i = 0; i < max; i++) {
            if (movies[i]) merged.push(movies[i]);
            if (tvs[i]) merged.push(tvs[i]);
          }
          setFilteredResults(merged);
          setLoadingFilters(false);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setLoadingFilters(false);
        });
    } else {
      fetchType(filterType)
        .then((res) => {
          setFilteredResults(res);
          setLoadingFilters(false);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setLoadingFilters(false);
        });
    }

    return () => controller.abort();
  }, [apiKey, offline, isActiveFilter, filterType, filterGenre, filterYear, filterLanguage]);

  // Stable pre-built item arrays for carousels, capped at 10
  const trendingMovieItems = useMemo(
    () => trending.slice(0, 10).map((i) => ({ ...i, media_type: "movie" })),
    [trending],
  );
  const trendingTVItems = useMemo(
    () => trendingTV.slice(0, 10).map((i) => ({ ...i, media_type: "tv" })),
    [trendingTV],
  );

  return (
    <div className="fade-in">
      {/* ── Offline ── */}
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

      {/* ── Hero (always first) ── */}
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

      {/* ── Filters ── */}
      {!loading && !offline && (
        <div className="section" style={{ paddingTop: 0 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 24 }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text3)" }}>Discover</span>
            
            <select className="filter-select" value={filterType} onChange={e => { setFilterType(e.target.value); setFilterGenre(""); }}>
              <option value="all">Movies & Series</option>
              <option value="movie">Movies</option>
              <option value="tv">Series</option>
            </select>

            <select className="filter-select" value={filterGenre} onChange={e => setFilterGenre(e.target.value)}>
              <option value="">All Genres</option>
              {(filterType === "movie" ? MOVIE_GENRES : filterType === "tv" ? TV_GENRES : ALL_GENRES).map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>

            <select className="filter-select" value={filterYear} onChange={e => setFilterYear(e.target.value)}>
              <option value="">All Years</option>
              {YEARS.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            <select className="filter-select" value={filterLanguage} onChange={e => setFilterLanguage(e.target.value)}>
              <option value="">All Languages</option>
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
            
            {isActiveFilter && (
               <button className="btn btn-secondary" onClick={() => {
                  setFilterType("all");
                  setFilterGenre("");
                  setFilterYear("");
                  setFilterLanguage("");
               }} style={{ padding: "6px 12px", fontSize: 12 }}>
                 Clear
               </button>
            )}

            <button 
              className="btn btn-primary" 
              onClick={handleRandomSuggestion} 
              disabled={loadingRandom}
              style={{ padding: "6px 12px", fontSize: 12, marginLeft: "auto" }}
            >
              {loadingRandom ? "Finding..." : "Surprise Me"}
            </button>
          </div>
          
          {isActiveFilter && (
            <div className="cards-grid" style={{ marginTop: -8 }}>
              {loadingFilters ? (
                <div style={{ color: "var(--text3)" }}>Loading...</div>
              ) : filteredResults.length > 0 ? (
                filteredResults.map(item => {
                  const rk = `${item.media_type}_${item.id}`;
                  const rd = enrichedRatingsMap[rk] || {};
                  return (
                    <MediaCard
                      key={`${item.media_type}_${item.id}`}
                      item={item}
                      onClick={() => onSelect(item)}
                      progress={0}
                      watched={watched}
                      onMarkWatched={onMarkWatched}
                      onMarkUnwatched={onMarkUnwatched}
                      ageRating={rd.cert}
                      restricted={rd.restricted}
                    />
                  );
                })
              ) : (
                <div style={{ color: "var(--text3)" }}>No results found for these filters.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Rows in user-configured order ── */}
      {!isActiveFilter && rowOrder.map((id) => {
        if (!rowVisible[id]) return null;

        if (id === "continue") {
          if (inProgress.length === 0) return null;
          return (
            <div key="continue" className="section">
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
          );
        }

        // Render a section as a flat cards-grid (list view)
        const renderList = (key, title, titleHighlight, items) => {
          if (!items || items.length === 0) return null;
          return (
            <div key={key} className="section">
              <div className="section-title">
                {titleHighlight ? (
                  <>
                    {title}&nbsp;
                    <span style={{ color: "var(--red)" }}>
                      {titleHighlight}
                    </span>
                  </>
                ) : (
                  title
                )}
              </div>
              <div className="cards-grid">
                {items.map((item) => {
                  const type = item.media_type === "tv" ? "tv" : "movie";
                  const rk = `${type}_${item.id}`;
                  const rd = enrichedRatingsMap[rk] || {};
                  return (
                    <MediaCard
                      key={`${item.media_type}_${item.id}`}
                      item={item}
                      onClick={() => onSelect(item)}
                      progress={0}
                      watched={watched}
                      onMarkWatched={onMarkWatched}
                      onMarkUnwatched={onMarkUnwatched}
                      ageRating={rd.cert}
                      restricted={rd.restricted}
                    />
                  );
                })}
              </div>
            </div>
          );
        };

        if (id === "similar") {
          if (!similarSource || similarItems.length === 0) return null;
          if (viewMode === "list")
            return renderList(
              "similar",
              "Similar to",
              similarSource.title || similarSource.name,
              similarItems,
            );
          return (
            <TrendingCarousel
              key="similar"
              items={similarItems}
              title="Similar to"
              titleHighlight={similarSource.title || similarSource.name}
              onSelect={onSelect}
              ratingsMap={enrichedRatingsMap}
            />
          );
        }

        if (id === "trendingMovies") {
          if (trendingMovieItems.length === 0) return null;
          if (viewMode === "list")
            return renderList(
              "trendingMovies",
              "Trending Movies",
              null,
              trendingMovieItems,
            );
          return (
            <TrendingCarousel
              key="trendingMovies"
              items={trendingMovieItems}
              title="Trending Movies"
              onSelect={onSelect}
              ratingsMap={enrichedRatingsMap}
            />
          );
        }

        if (id === "trendingTV") {
          if (trendingTVItems.length === 0) return null;
          if (viewMode === "list")
            return renderList(
              "trendingTV",
              "Trending Series",
              null,
              trendingTVItems,
            );
          return (
            <TrendingCarousel
              key="trendingTV"
              items={trendingTVItems}
              title="Trending Series"
              onSelect={onSelect}
              ratingsMap={enrichedRatingsMap}
            />
          );
        }

        if (id === "topRated") {
          if (topRatedItems.length === 0) return null;
          if (viewMode === "list")
            return renderList("topRated", "Top Rated", null, topRatedItems);
          return (
            <TrendingCarousel
              key="topRated"
              items={topRatedItems}
              title="Top Rated"
              onSelect={onSelect}
              ratingsMap={enrichedRatingsMap}
            />
          );
        }

        return null;
      })}
    </div>
  );
}
