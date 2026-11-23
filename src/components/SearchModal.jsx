import { useState, useEffect, useRef, useCallback } from "react";
import { tmdbFetch, imgUrl } from "../utils/api";
import { SearchIcon, CloseIcon } from "./Icons";
import { storage } from "../utils/storage";
import {
  DEFAULT_FILTERS,
  TYPE_OPTIONS,
  CATEGORY_OPTIONS,
  SORT_OPTIONS,
  LANGUAGE_OPTIONS,
  RATING_OPTIONS,
  filtersActive,
  normalizeFilters,
  categoryFitsType,
  genreIdsFor,
  advancedSearch,
  fetchGenres,
} from "../utils/advancedSearch";

const HISTORY_KEY = "searchHistory";
const MAX_HISTORY = 12;
const FILTERS_KEY = "searchFilters";

function loadFilters() {
  return normalizeFilters(storage.get(FILTERS_KEY));
}

function YearInput({ value, onChange, placeholder, title }) {
  return (
    <input
      className="search-filter-select search-filter-year"
      type="number"
      min={1900}
      max={2100}
      placeholder={placeholder}
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value.slice(0, 4))}
    />
  );
}

function FilterSelect({ value, onChange, options, title, disabled }) {
  return (
    <select
      className="search-filter-select"
      value={value}
      title={title}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function loadHistory() {
  return storage.get(HISTORY_KEY) || [];
}

function saveHistory(history) {
  storage.set(HISTORY_KEY, history);
}

export default function SearchModal({ apiKey, onSelect, onClose, offline }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [filters, setFilters] = useState(loadFilters);
  const [showFilters, setShowFilters] = useState(() =>
    filtersActive(loadFilters()),
  );
  const [genres, setGenres] = useState([]);
  const inputRef = useRef();
  const active = filtersActive(filters);
  const filtersJson = JSON.stringify(filters);

  const updateFilter = useCallback((key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "type") {
        // Genre ids differ between movies and series -> map to equivalent
        if (prev.genre) {
          const ids = genreIdsFor(value === "all" ? "movie" : value, prev.genre);
          next.genre =
            value === "all" ? String(ids[0] || prev.genre) : String(ids[0] || "");
        }
        if (!categoryFitsType(prev.category, value)) next.category = "all";
      }
      storage.set(FILTERS_KEY, next);
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    storage.set(FILTERS_KEY, DEFAULT_FILTERS);
  }, []);

  // Genre list for the selected type (movie and TV genres differ on TMDB)
  useEffect(() => {
    let mounted = true;
    setGenres([]);
    fetchGenres(filters.type, apiKey)
      .then((g) => mounted && setGenres(g))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [filters.type, apiKey]);

  useEffect(() => {
    const tid = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(tid);
  }, []);

  useEffect(() => {
    if (!query.trim() && !active) {
      setResults([]);
      return;
    }
    let mounted = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        if (active) {
          // Advanced search: filters (+ optional text)
          const list = await advancedSearch(query, filters, apiKey);
          if (mounted) setResults(list);
        } else {
          const data = await tmdbFetch(
            `/search/multi?query=${encodeURIComponent(query)}&page=1`,
            apiKey,
          );
          if (mounted) {
            setResults(
              (data.results || [])
                .filter((r) => r.media_type !== "person")
                .slice(0, 12),
            );
          }
        }
      } catch {}
      if (mounted) setLoading(false);
    }, 380);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
    // filtersJson stands in for the filters object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, apiKey, filtersJson]);

  const addToHistory = useCallback((term) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(
        0,
        MAX_HISTORY,
      );
      saveHistory(next);
      return next;
    });
  }, []);

  const removeFromHistory = useCallback((e, term) => {
    e.stopPropagation();
    setHistory((prev) => {
      const next = prev.filter((h) => h !== term);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  const handleSelect = (r) => {
    const trimmed = query.trim();
    if (trimmed) {
      const next = [trimmed, ...history.filter((h) => h !== trimmed)].slice(
        0,
        MAX_HISTORY,
      );
      saveHistory(next);
      setHistory(next);
    }
    onSelect(r);
    onClose();
  };

  const handleHistoryClick = useCallback((term) => {
    setQuery(term);
    inputRef.current?.focus();
  }, []);

  const handleKey = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && query.trim()) addToHistory(query);
  };

  const showHistory = !query && !active && history.length > 0;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="search-box">
        <div className="search-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search movies and series..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          <button
            className={
              "btn btn-ghost search-filter-toggle" +
              (showFilters || active ? " search-filter-toggle--on" : "")
            }
            onClick={() => setShowFilters((v) => !v)}
            title="Advanced search"
          >
            Filters{active ? " •" : ""}
          </button>
          {query ? (
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setQuery("")}
            >
              <CloseIcon />
            </button>
          ) : (
            <button className="btn btn-ghost btn-icon" onClick={onClose}>
              <CloseIcon />
            </button>
          )}
        </div>

        {showFilters && (
          <div className="search-filters">
            <FilterSelect
              title="Type"
              value={filters.type}
              onChange={(v) => updateFilter("type", v)}
              options={TYPE_OPTIONS}
            />
            <FilterSelect
              title="Category"
              value={filters.category}
              onChange={(v) => updateFilter("category", v)}
              options={CATEGORY_OPTIONS.map((o) => ({
                ...o,
                disabled: !categoryFitsType(o.value, filters.type),
              }))}
            />
            <FilterSelect
              title="Genre"
              value={filters.genre}
              onChange={(v) => updateFilter("genre", v)}
              options={[
                { value: "", label: "Any genre" },
                ...genres.map((g) => ({ value: String(g.id), label: g.name })),
              ]}
            />
            <FilterSelect
              title="Original language"
              value={filters.lang}
              onChange={(v) => updateFilter("lang", v)}
              options={LANGUAGE_OPTIONS}
            />
            <YearInput
              placeholder="From"
              title="Released from year"
              value={filters.yearFrom}
              onChange={(v) => updateFilter("yearFrom", v)}
            />
            <YearInput
              placeholder="To"
              title="Released up to year"
              value={filters.yearTo}
              onChange={(v) => updateFilter("yearTo", v)}
            />
            <FilterSelect
              title="Minimum rating"
              value={filters.minRating}
              onChange={(v) => updateFilter("minRating", v)}
              options={RATING_OPTIONS}
            />
            <FilterSelect
              title="Sort by"
              value={filters.sort}
              onChange={(v) => updateFilter("sort", v)}
              options={SORT_OPTIONS}
            />
            {active && (
              <button className="search-filter-reset" onClick={resetFilters}>
                Reset
              </button>
            )}
          </div>
        )}

        <div className="search-results">
          {offline && (
            <div
              style={{
                padding: "12px 20px",
                background: "rgba(255,165,0,0.1)",
                borderBottom: "1px solid var(--border)",
                fontSize: 13,
                color: "#ff9800",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              🌐 No internet, search is unavailable offline.
            </div>
          )}

          {!offline && loading && (
            <div className="loader">
              <div className="spinner" />
            </div>
          )}

          {!loading && (query || active) && results.length === 0 && (
            <div className="search-empty">
              {query
                ? `No results for "${query}"${active ? " with these filters" : ""}`
                : "No titles match these filters"}
            </div>
          )}

          {!loading &&
            results.map((r) => (
              <div
                key={`${r.media_type}-${r.id}`}
                className="search-result"
                onClick={() => handleSelect(r)}
              >
                <img
                  src={
                    r.poster_path
                      ? imgUrl(r.poster_path, "w92")
                      : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='58'%3E%3Crect fill='%23222' width='40' height='58'/%3E%3C/svg%3E"
                  }
                  alt=""
                />
                <div className="search-result-info">
                  <div className="search-result-title">{r.title || r.name}</div>
                  <div className="search-result-meta">
                    {(r.release_date || r.first_air_date || "").slice(0, 4)}
                    {r.vote_average ? ` · ★ ${r.vote_average.toFixed(1)}` : ""}
                  </div>
                </div>
                <span
                  className={`search-result-type ${r.media_type === "tv" ? "type-tv" : "type-movie"}`}
                >
                  {r.media_type === "tv" ? "Series" : "Movie"}
                </span>
              </div>
            ))}

          {showHistory && (
            <div className="search-history">
              <div className="search-history-header">
                <span className="search-history-label">Recent searches</span>
                <button className="search-history-clear" onClick={clearHistory}>
                  Clear all
                </button>
              </div>
              {history.map((term) => (
                <div
                  key={term}
                  className="search-history-item"
                  onClick={() => handleHistoryClick(term)}
                >
                  <span className="search-history-icon">
                    <SearchIcon />
                  </span>
                  <span className="search-history-term">{term}</span>
                  <button
                    className="search-history-remove"
                    onClick={(e) => removeFromHistory(e, term)}
                    title="Remove"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}

          {!query && !active && history.length === 0 && (
            <div className="search-hint">
              Search for movies and series &nbsp;·&nbsp; <kbd>ESC</kbd> to close
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
