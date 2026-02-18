import MediaCard from '../components/MediaCard'
import { PlayIcon, StarIcon } from '../components/Icons'
import { imgUrl } from '../utils/api'

export default function HomePage({ trending, trendingTV, loading, onSelect, progress, inProgress, offline, onRetry, watched, onMarkWatched, onMarkUnwatched }) {
  const hero = trending[0]

  return (
    <div className="fade-in">
      {offline && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '60vh', gap: 16, color: 'var(--text2)',
        }}>
          <div style={{ fontSize: 48 }}>📡</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>No internet connection</div>
          <div style={{ fontSize: 14, color: 'var(--text3)' }}>
            Trending and search require an internet connection. Your downloads and library still work offline.
          </div>
          <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {!offline && loading && <div className="loader"><div className="spinner" /></div>}

      {!loading && hero && (
        <div className="hero">
          <div
            className="hero-bg"
            style={{ backgroundImage: `url(${imgUrl(hero.backdrop_path, 'original')})` }}
          />
          <div className="hero-gradient" />
          <div className="hero-content">
            <div className="hero-type">Trending · Movie</div>
            <div className="hero-title">{hero.title || hero.name}</div>
            <div className="hero-meta">
              <span className="hero-rating"><StarIcon /> {hero.vote_average?.toFixed(1)}</span>
              <span>{hero.release_date?.slice(0, 4)}</span>
            </div>
            <div className="hero-overview">{hero.overview}</div>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => onSelect(hero)}>
                <PlayIcon /> Watch Now
              </button>
              <button className="btn btn-secondary" onClick={() => onSelect(hero)}>
                More Info
              </button>
            </div>
          </div>
        </div>
      )}

      {inProgress.length > 0 && (
        <div className="section">
          <div className="section-title">Continue Watching</div>
          <div className="cards-grid">
            {inProgress.map(item => {
              const pk = item.media_type === 'movie'
                ? `movie_${item.id}`
                : `tv_${item.id}_s${item.season}e${item.episode}`
              return (
                <MediaCard
                  key={`${item.media_type}_${item.id}`}
                  item={item}
                  onClick={() => onSelect(item)}
                  progress={progress[pk] || 0}
                  watched={watched}
                  onMarkWatched={onMarkWatched}
                  onMarkUnwatched={onMarkUnwatched}
                />
              )
            })}
          </div>
        </div>
      )}

      {trending.length > 0 && (
        <div className="section">
          <div className="section-title">Trending Movies</div>
          <div className="scroll-row">
            {trending.map(item => (
              <MediaCard
                key={item.id}
                item={{ ...item, media_type: 'movie' }}
                onClick={() => onSelect({ ...item, media_type: 'movie' })}
                watched={watched}
                onMarkWatched={onMarkWatched}
                onMarkUnwatched={onMarkUnwatched}
              />
            ))}
          </div>
        </div>
      )}

      {trendingTV.length > 0 && (
        <div className="section">
          <div className="section-title">Trending Series</div>
          <div className="scroll-row">
            {trendingTV.map(item => (
              <MediaCard
                key={item.id}
                item={{ ...item, media_type: 'tv' }}
                onClick={() => onSelect({ ...item, media_type: 'tv' })}
                watched={watched}
                onMarkWatched={onMarkWatched}
                onMarkUnwatched={onMarkUnwatched}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
