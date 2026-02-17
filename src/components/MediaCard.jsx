import { imgUrl } from '../utils/api'
import { PlayIcon, FilmIcon, TVIcon } from './Icons'

export default function MediaCard({ item, onClick, progress }) {
  const title = item.title || item.name
  const year = (item.release_date || item.first_air_date || '').slice(0, 4)
  const isTV = item.media_type === 'tv'

  return (
    <div className="card" onClick={onClick}>
      <div className="card-poster">
        {item.poster_path
          ? <img src={imgUrl(item.poster_path, 'w342')} alt={title} loading="lazy" />
          : (
            <div className="no-poster">
              {isTV ? <TVIcon /> : <FilmIcon />}
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>No Image</span>
            </div>
          )
        }
        <div className="card-overlay">
          <div className="card-play"><PlayIcon /></div>
        </div>
        {progress > 0 && (
          <div className="card-progress">
            <div className="card-progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        )}
      </div>
      <div className="card-info">
        <div className="card-title" title={title}>{title}</div>
        <div className="card-year">{year} · {isTV ? 'Series' : 'Movie'}</div>
      </div>
      <span className="card-badge">{isTV ? 'TV' : 'HD'}</span>
    </div>
  )
}
