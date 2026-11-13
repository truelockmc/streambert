import { useState, useEffect, useRef, useCallback } from "react";
import { tmdbFetch, imgUrl } from "../utils/api";
import { SearchIcon, CloseIcon } from "./Icons";
import { storage } from "../utils/storage";
import { setGamepadFocus } from "../utils/gamepadSpatialNav";

const HISTORY_KEY = "searchHistory";
const MAX_HISTORY = 12;

function loadHistory() {
  return storage.get(HISTORY_KEY) || [];
}

function saveHistory(history) {
  storage.set(HISTORY_KEY, history);
}

export default function SearchModal({ apiKey, onSelect, onClose, offline }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const inputRef = useRef();
  const resultsRef = useRef(null);
  const pageJump = useRef(false);

  useEffect(() => {
    const tid = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(tid);
  }, []);

  const changeQuery = useCallback((value) => {
    setQuery(value);
    setPage(1);
    setTotalPages(0);
    setResults([]);
  }, []);

  const goToPage = useCallback((next) => {
    pageJump.current = true;
    setPage(next);
  }, []);

  useEffect(() => {
    if (!query.trim() || offline) {
      setResults([]);
      setTotalPages(0);
      return;
    }
    let mounted = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await tmdbFetch(
          `/search/multi?query=${encodeURIComponent(query)}&page=${page}`,
          apiKey,
        );
        if (!mounted) return;
        setResults(
          (data.results || []).filter((r) => r.media_type !== "person"),
        );
        setTotalPages(Math.min(data.total_pages || 1, 500));
      } catch {
        pageJump.current = false;
        if (mounted && page === 1) {
          setResults([]);
          setTotalPages(0);
        }
      }
      if (mounted) setLoading(false);
    }, pageJump.current ? 0 : 380);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [query, page, apiKey, offline]);

  useEffect(() => {
    const box = resultsRef.current;
    if (box) box.scrollTop = 0;
    if (!pageJump.current) return;
    pageJump.current = false;
    if (document.documentElement.dataset.tv !== "1") return;
    if (document.documentElement.dataset.tvKeyboard === "1") return;
    const first = box?.querySelector(".search-result");
    if (first instanceof HTMLElement) {
      requestAnimationFrame(() => setGamepadFocus(first));
    }
  }, [results]);

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
    changeQuery(term);
    inputRef.current?.focus();
  }, [changeQuery]);

  const handleKey = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && query.trim()) addToHistory(query);
  };

  const showHistory = !query && history.length > 0;

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
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          {query ? (
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => changeQuery("")}
            >
              <CloseIcon />
            </button>
          ) : (
            <button className="btn btn-ghost btn-icon" onClick={onClose}>
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="search-results" ref={resultsRef}>
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

          {!offline && loading && results.length === 0 && (
            <div className="loader">
              <div className="spinner" />
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="search-empty">No results for "{query}"</div>
          )}

          {loading && results.length > 0 && (
            <div className="search-page-label">Loading page {page}…</div>
          )}

          {results.map((r) => (
              <div
                key={`${r.media_type}-${r.id}`}
                className="search-result"
                tabIndex={-1}
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

          {query && totalPages > 1 && (
            <div className="search-pages">
              <div className="search-page-label">
                Page {page} of {totalPages}
              </div>
              {page < totalPages && (
                <button
                  type="button"
                  className="search-page-btn"
                  onClick={() => goToPage(page + 1)}
                  disabled={loading}
                >
                  Next page
                </button>
              )}
              {page > 1 && (
                <button
                  type="button"
                  className="search-page-btn"
                  onClick={() => goToPage(page - 1)}
                  disabled={loading}
                >
                  Previous page
                </button>
              )}
            </div>
          )}

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
                  tabIndex={-1}
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

          {!query && history.length === 0 && (
            <div className="search-hint">
              Search for movies and series &nbsp;·&nbsp; <kbd>ESC</kbd> to close
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
