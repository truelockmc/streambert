import MediaCard from '../components/MediaCard'
import { imgUrl } from '../utils/api'
import { EyeIcon } from '../components/Icons'

export default function LibraryPage({ history, inProgress, saved, progress, onSelect }) {
  return (
    <div className="fade-in">
      <div className="library-header">
        <div className="library-title">My Library</div>
        <div className="library-sub">Watch history, progress, and saved titles</div>
      </div>

      {inProgress.length > 0 && (
        <div className="library-section">
          <div className="library-section-title">Continue Watching</div>
          <div className="cards-grid">
            {inProgress.map((item, i) => {
              const pk = item.media_type === 'movie'
                ? `movie_${item.id}`
                : `tv_${item.id}_s${item.season}e${item.episode}`
              return (
                <MediaCard
                  key={i}
                  item={item}
                  onClick={() => onSelect(item)}
                  progress={progress[pk] || 0}
                />
              )
            })}
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="library-section">
          <div className="library-section-title">Watchlist ({saved.length})</div>
          <div className="cards-grid">
            {saved.map(item => (
              <MediaCard
                key={`${item.media_type}_${item.id}`}
                item={item}
                onClick={() => onSelect(item)}
              />
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="library-section">
          <div className="library-section-title">Watch History</div>
          <div className="history-rows">
            {history.map((item, i) => (
              <div key={i} className="history-row" onClick={() => onSelect(item)}>
                <div className="history-thumb">
                  {item.poster_path && (
                    <img src={imgUrl(item.poster_path, 'w92')} alt="" />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                    {item.media_type === 'tv' && item.season && `S${item.season}E${item.episode} · `}
                    {new Date(item.watchedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <span className={`search-result-type ${item.media_type === 'tv' ? 'type-tv' : 'type-movie'}`}>
                  {item.media_type === 'tv' ? 'Series' : 'Movie'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length === 0 && saved.length === 0 && (
        <div className="empty-state">
          <EyeIcon />
          <h3>Nothing here yet</h3>
          <p>Start watching a movie or series and your history will appear here.</p>
        </div>
      )}
    </div>
  )
}
