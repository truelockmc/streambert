import { useState, useEffect, useCallback, useRef } from "react";
import MediaCard from "../components/MediaCard";
import { tmdbFetch } from "../utils/api";
import { EyeIcon } from "../components/Icons";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";

// "Classics" isn't a real TMDB genre — it's a synthetic category built from
// an older release-date cutoff plus rating/vote thresholds, so it cuts
// across genres instead of filtering by with_genres like the rest of the list.
const CLASSICS_CUTOFF = "1999-12-31";

// Genre catalogue: TMDB uses separate id spaces for /discover/movie and
// /discover/tv, and a few genres only exist on one side (e.g. Horror has no
// TV equivalent, Kids/Reality are TV-only). null means "not available for
// that media type".
const GENRES = [
  { label: "Classics", classics: true },
  { label: "Action", movieId: 28, tvId: 10759 },
  { label: "Adventure", movieId: 12, tvId: 10759 },
  { label: "Animation", movieId: 16, tvId: 16 },
  { label: "Comedy", movieId: 35, tvId: 35 },
  { label: "Crime", movieId: 80, tvId: 80 },
  { label: "Documentary", movieId: 99, tvId: 99 },
  { label: "Drama", movieId: 18, tvId: 18 },
  { label: "Family", movieId: 10751, tvId: 10751 },
  { label: "Fantasy", movieId: 14, tvId: 10765 },
  { label: "History", movieId: 36, tvId: null },
  { label: "Horror", movieId: 27, tvId: null },
  { label: "Kids", movieId: null, tvId: 10762 },
  { label: "Music", movieId: 10402, tvId: null },
  { label: "Mystery", movieId: 9648, tvId: 9648 },
  { label: "Reality", movieId: null, tvId: 10764 },
  { label: "Romance", movieId: 10749, tvId: null },
  { label: "Sci-Fi & Fantasy", movieId: 878, tvId: 10765 },
  { label: "Thriller", movieId: 53, tvId: null },
  { label: "War", movieId: 10752, tvId: 10768 },
  { label: "Western", movieId: 37, tvId: 37 },
];

const TYPE_FILTERS = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "tv", label: "Series" },
];

const SORT_OPTIONS = [
  { id: "popularity", label: "Popularity" },
  { id: "rating", label: "Top Rated" },
  { id: "newest", label: "Newest" },
];

// A genre chip is only clickable for a given type filter if it maps to at
// least one id on that side (or "all", which just needs either side).
// Classics isn't genre-id based, so it's always available for both.
function genreSupportsType(genre, typeFilter) {
  if (genre.classics) return true;
  if (typeFilter === "movie") return !!genre.movieId;
  if (typeFilter === "tv") return !!genre.tvId;
  return !!(genre.movieId || genre.tvId);
}

// Build the /discover query params for a given genre + sort option + media
// type. "Top Rated" requires a vote_count floor so a title with a single
// 10/10 vote doesn't outrank genuinely acclaimed titles. "Newest" excludes
// unreleased/undated titles so the list isn't dominated by festival-only or
// straight-to-video entries with no real release yet. "Classics" applies its
// own cutoff/rating thresholds up front, which the sort branches below only
// tighten, never loosen.
function buildDiscoverParams(genre, mediaType, sortId, pageNum) {
  const params = new URLSearchParams({ page: String(pageNum) });
  const dateField =
    mediaType === "tv" ? "first_air_date" : "primary_release_date";

  if (genre.classics) {
    params.set(`${dateField}.lte`, CLASSICS_CUTOFF);
    params.set("vote_count.gte", mediaType === "tv" ? "100" : "500");
    params.set("vote_average.gte", "7");
  } else {
    params.set("with_genres", String(mediaType === "tv" ? genre.tvId : genre.movieId));
  }

  if (sortId === "rating") {
    params.set("sort_by", "vote_average.desc");
    const floor = Number(params.get("vote_count.gte") || 0);
    if (floor < 200) params.set("vote_count.gte", "200");
  } else if (sortId === "newest") {
    params.set("sort_by", `${dateField}.desc`);
    if (!genre.classics) {
      params.set(`${dateField}.lte`, new Date().toISOString().slice(0, 10));
      if (!params.has("vote_count.gte")) params.set("vote_count.gte", "1");
    }
  } else {
    params.set("sort_by", "popularity.desc");
  }

  return params;
}

async function fetchGenrePage(genre, typeFilter, sortId, pageNum, apiKey) {
  const requests = [];
  if ((typeFilter === "all" || typeFilter === "movie") && (genre.movieId || genre.classics)) {
    const params = buildDiscoverParams(genre, "movie", sortId, pageNum);
    requests.push(
      tmdbFetch(`/discover/movie?${params.toString()}`, apiKey)
        .then((d) => ({
          results: (d.results || []).map((i) => ({
            ...i,
            media_type: "movie",
          })),
          totalPages: d.total_pages || 1,
        }))
        .catch(() => ({ results: [], totalPages: 0 })),
    );
  }
  if ((typeFilter === "all" || typeFilter === "tv") && (genre.tvId || genre.classics)) {
    const params = buildDiscoverParams(genre, "tv", sortId, pageNum);
    requests.push(
      tmdbFetch(`/discover/tv?${params.toString()}`, apiKey)
        .then((d) => ({
          results: (d.results || []).map((i) => ({ ...i, media_type: "tv" })),
          totalPages: d.total_pages || 1,
        }))
        .catch(() => ({ results: [], totalPages: 0 })),
    );
  }

  const arrays = await Promise.all(requests);

  // Interleave movie/tv results for variety instead of dumping all movies
  // then all series.
  const merged = [];
  const maxLen = Math.max(0, ...arrays.map((a) => a.results.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of arrays) {
      if (arr.results[i]) merged.push(arr.results[i]);
    }
  }

  const totalPages = Math.max(1, ...arrays.map((a) => a.totalPages));
  return { items: merged, totalPages };
}

export default function GenresPage({
  apiKey,
  offline,
  onSelect,
  watched,
  onMarkWatched,
  onMarkUnwatched,
}) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("popularity");
  const [selectedGenre, setSelectedGenre] = useState(GENRES[0]);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Guards against out-of-order responses when the user rapidly switches
  // genre/type filters.
  const requestIdRef = useRef(0);
  const seenKeysRef = useRef(new Set());

  const { ratingsMap, ageLimitSetting } = useRatings(items);
  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) =>
      isRestricted(getRating(item).minAge, ageLimitSetting),
    [getRating, ageLimitSetting],
  );

  // If the active type filter no longer supports the selected genre (e.g.
  // switching to "Series" while "Horror" is selected), fall back to the
  // first genre that does.
  useEffect(() => {
    if (genreSupportsType(selectedGenre, typeFilter)) return;
    const fallback = GENRES.find((g) => genreSupportsType(g, typeFilter));
    if (fallback) setSelectedGenre(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  useEffect(() => {
    if (!apiKey || offline) return;
    if (!genreSupportsType(selectedGenre, typeFilter)) return;

    const myId = ++requestIdRef.current;
    seenKeysRef.current = new Set();
    setLoading(true);
    setItems([]);
    setPage(1);

    fetchGenrePage(selectedGenre, typeFilter, sortBy, 1, apiKey)
      .then(({ items: newItems, totalPages: tp }) => {
        if (requestIdRef.current !== myId) return;
        for (const it of newItems) seenKeysRef.current.add(`${it.media_type}_${it.id}`);
        setItems(newItems);
        setTotalPages(tp);
        setLoading(false);
      })
      .catch(() => {
        if (requestIdRef.current !== myId) return;
        setLoading(false);
      });
  }, [selectedGenre, typeFilter, sortBy, apiKey, offline]);

  const loadMore = useCallback(() => {
    if (loadingMore || loading || page >= totalPages) return;
    const myId = requestIdRef.current;
    const nextPage = page + 1;
    setLoadingMore(true);

    fetchGenrePage(selectedGenre, typeFilter, sortBy, nextPage, apiKey)
      .then(({ items: newItems }) => {
        if (requestIdRef.current !== myId) return;
        const fresh = newItems.filter((it) => {
          const key = `${it.media_type}_${it.id}`;
          if (seenKeysRef.current.has(key)) return false;
          seenKeysRef.current.add(key);
          return true;
        });
        setItems((prev) => [...prev, ...fresh]);
        setPage(nextPage);
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }, [
    loadingMore,
    loading,
    page,
    totalPages,
    selectedGenre,
    typeFilter,
    sortBy,
    apiKey,
  ]);

  return (
    <div className="fade-in">
      <div className="library-header">
        <div className="library-title">Browse by Genre</div>
        <div className="library-sub">
          Discover movies and series by category
        </div>
      </div>

      <div className="genre-filter-bar">
        <div className="genre-filter-row">
          <div className="type-toggle">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t.id}
                className={`type-toggle-btn${typeFilter === t.id ? " type-toggle-btn--active" : ""}`}
                onClick={() => setTypeFilter(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="type-toggle">
            {SORT_OPTIONS.map((s) => (
              <button
                key={s.id}
                className={`type-toggle-btn${sortBy === s.id ? " type-toggle-btn--active" : ""}`}
                onClick={() => setSortBy(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="genre-chip-row">
          {GENRES.map((g) => {
            const supported = genreSupportsType(g, typeFilter);
            return (
              <button
                key={g.label}
                className={`genre-chip${selectedGenre.label === g.label ? " genre-chip--active" : ""}`}
                disabled={!supported}
                onClick={() => setSelectedGenre(g)}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      {offline && (
        <div className="empty-state">
          <EyeIcon />
          <h3>No internet connection</h3>
          <p>Browsing by genre requires an internet connection.</p>
        </div>
      )}

      {!offline && loading && (
        <div className="loader">
          <div className="spinner" />
        </div>
      )}

      {!offline && !loading && (
        <div className="library-section" style={{ paddingTop: 8 }}>
          {items.length === 0 ? (
            <div className="empty-state">
              <EyeIcon />
              <h3>No titles found</h3>
              <p>Nothing turned up for this genre right now.</p>
            </div>
          ) : (
            <>
              <div className="cards-grid">
                {items.map((item) => {
                  const r = getRating(item);
                  const restr = itemRestricted(item);
                  return (
                    <MediaCard
                      key={`${item.media_type}_${item.id}`}
                      item={item}
                      onClick={() => onSelect(item)}
                      watched={watched}
                      onMarkWatched={onMarkWatched}
                      onMarkUnwatched={onMarkUnwatched}
                      ageRating={r.cert}
                      restricted={restr}
                      overview={item.overview}
                    />
                  );
                })}
              </div>

              {page < totalPages && (
                <div className="genre-load-more">
                  <button
                    className="btn btn-secondary"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading…" : "Load More"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
