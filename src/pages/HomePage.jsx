import MediaCard from '../components/MediaCard'
import { PlayIcon, StarIcon } from '../components/Icons'
import { imgUrl } from '../utils/api'

export default function HomePage({ trending, trendingTV, loading, onSelect, progress, inProgress }) {
  const hero = trending[0]

  return (
    <div className="fade-in">
      {loading && <div className="loader"><div className="spinner" /></div>}

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
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
