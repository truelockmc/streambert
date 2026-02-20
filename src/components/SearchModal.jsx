import { useState, useEffect, useRef } from "react";
import { tmdbFetch, imgUrl } from "../utils/api";
import { SearchIcon, CloseIcon } from "./Icons";

export default function SearchModal({ apiKey, onSelect, onClose, offline }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef();

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await tmdbFetch(
          `/search/multi?query=${encodeURIComponent(query)}&page=1`,
          apiKey,
        );
        setResults(
          (data.results || [])
            .filter((r) => r.media_type !== "person")
            .slice(0, 12),
        );
      } catch {}
      setLoading(false);
    }, 380);
    return () => clearTimeout(timer);
  }, [query, apiKey]);

  const handleKey = (e) => {
    if (e.key === "Escape") onClose();
  };

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

          {!loading && query && results.length === 0 && (
            <div className="search-empty">No results for "{query}"</div>
          )}

          {!loading &&
            results.map((r) => (
              <div
                key={r.id}
                className="search-result"
                onClick={() => {
                  onSelect(r);
                  onClose();
                }}
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

          {!query && (
            <div className="search-hint">
              Search for movies and series &nbsp;·&nbsp; <kbd>ESC</kbd> to close
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
