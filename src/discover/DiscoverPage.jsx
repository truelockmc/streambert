import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchDiscoverFilms, GENRE_MAP } from '../utils/discover.js';
import { DiscoverEngine } from './engine.js';

const STAR = '★';

function PreviewCard({ hovered }) {
  if (!hovered) return null;
  const { film, screenX, screenY } = hovered;
  const year = (film.release_date || '').slice(0, 4);
  const genres = (film.genre_ids || []).slice(0, 3).map(id => GENRE_MAP[id]).filter(Boolean);
  const rating = film.vote_average ? film.vote_average.toFixed(1) : null;

  // Keep card on screen
  const cardW = 220;
  const cardH = 160;
  let left = screenX + 16;
  let top = screenY - 20;
  if (left + cardW > window.innerWidth - 10) left = screenX - cardW - 16;
  if (top + cardH > window.innerHeight - 10) top = window.innerHeight - cardH - 10;
  if (top < 10) top = 10;

  return (
    <div
      className="discover-preview"
      style={{ left, top }}
    >
      <div className="discover-preview__title">{film.title}</div>
      <div className="discover-preview__meta">
        {year && <span>{year}</span>}
        {rating && <span>{STAR} {rating}</span>}
      </div>
      {genres.length > 0 && (
        <div className="discover-preview__genres">
          {genres.map(g => <span key={g} className="discover-preview__genre">{g}</span>)}
        </div>
      )}
      {film.overview && (
        <p className="discover-preview__overview">
          {film.overview.slice(0, 120)}{film.overview.length > 120 ? '…' : ''}
        </p>
      )}
    </div>
  );
}

export default function DiscoverPage({ apiKey, onSelect }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [filmCount, setFilmCount] = useState(0);

  const handleHover = useCallback((info) => setHovered(info), []);

  const handleSelect = useCallback((film) => {
    onSelect?.({ ...film, media_type: 'movie' });
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;

    fetchDiscoverFilms(apiKey, (pct) => {
      if (!cancelled) setProgress(pct);
    })
      .then((films) => {
        if (cancelled) return;
        setFilmCount(films.length);
        setLoading(false);

        // Mount engine on next frame so canvas is sized
        requestAnimationFrame(() => {
          if (cancelled || !canvasRef.current) return;
          engineRef.current = new DiscoverEngine(canvasRef.current, films, {
            onHover: handleHover,
            onSelect: handleSelect,
          });
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [apiKey, handleHover, handleSelect]);

  // Resize handler
  useEffect(() => {
    const onResize = () => engineRef.current?.handleResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="discover-page">
      {loading && (
        <div className="discover-loading">
          <div className="discover-loading__label">
            {progress > 0 ? `Loading films… ${progress}%` : 'Fetching films…'}
          </div>
          <div className="discover-loading__bar">
            <div
              className="discover-loading__fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {error && (
        <div className="discover-error">Failed to load: {error}</div>
      )}
      {!loading && !error && (
        <div className="discover-hint">
          {filmCount} films · scroll to zoom · drag to pan · click to open
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="discover-canvas"
        style={{ display: loading || error ? 'none' : 'block' }}
      />
      <PreviewCard hovered={hovered} />
    </div>
  );
}
