import { useState, useEffect } from 'react'
import { tmdbFetch, imgUrl, videasyMovieUrl } from '../utils/api'
import {
  PlayIcon, BookmarkIcon, BookmarkFillIcon, BackIcon,
  StarIcon, FilmIcon, DownloadIcon,
} from '../components/Icons'
import DownloadModal from '../components/DownloadModal'
import { storage } from '../utils/storage'

export default function MoviePage({
  item, apiKey, onSave, isSaved, onHistory, progress, saveProgress, onBack, onSettings,
}) {
  const [details, setDetails]           = useState(null)
  const [playing, setPlaying]           = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const [m3u8Url, setM3u8Url]           = useState(null)
  const [downloaderFolder, setDownloaderFolder] = useState(
    () => storage.get('downloaderFolder') || ''
  )

  const progressKey = `movie_${item.id}`
  const pct = progress[progressKey] || 0

  useEffect(() => {
    tmdbFetch(`/movie/${item.id}`, apiKey)
      .then(setDetails)
      .catch(() => setDetails(item))
  }, [item.id, apiKey])

  useEffect(() => {
    if (!window.electron) return
    const handler = window.electron.onM3u8Found((url) => {
      setM3u8Url(prev => prev || url)
    })
    return () => window.electron.offM3u8Found(handler)
  }, [])

  const handlePlay = () => {
    setM3u8Url(null)
    setPlaying(true)
    onHistory({ ...d, media_type: 'movie' })
  }

  const handleSetDownloaderFolder = (folder) => {
    setDownloaderFolder(folder)
    storage.set('downloaderFolder', folder)
  }

  const d = details || item
  const title = d.title || d.name
  const year = (d.release_date || '').slice(0, 4)
  const mediaName = `${title}${year ? ' (' + year + ')' : ''}`

  return (
    <div className="fade-in">
      <div className="detail-hero">
        <div className="detail-bg" style={{ backgroundImage: `url(${imgUrl(d.backdrop_path, 'original')})` }} />
        <div className="detail-gradient" />
        <div className="detail-content">
          <div className="detail-poster">
            {d.poster_path
              ? <img src={imgUrl(d.poster_path)} alt={title} />
              : <div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text3)' }}><FilmIcon /></div>
            }
          </div>
          <div className="detail-info">
            <div className="detail-type">Movie</div>
            <div className="detail-title">{title}</div>
            <div className="genres">
              {(d.genres || []).map(g => <span key={g.id} className="genre-tag">{g.name}</span>)}
            </div>
            <div className="detail-meta">
              {d.vote_average > 0 && <span className="detail-rating"><StarIcon /> {d.vote_average?.toFixed(1)}</span>}
              {year && <span>{year}</span>}
              {d.runtime && <span>{d.runtime} min</span>}
              {d.original_language && <span>{d.original_language?.toUpperCase()}</span>}
            </div>
            <p className="detail-overview">{d.overview}</p>
            <div className="detail-actions">
              <button className="btn btn-primary" onClick={handlePlay}>
                <PlayIcon /> {playing ? 'Restart' : 'Play'}
              </button>
              <button className="btn btn-secondary" onClick={onSave}>
                {isSaved ? <BookmarkFillIcon /> : <BookmarkIcon />}
                {isSaved ? 'Saved' : 'Save'}
              </button>
              <button className="btn btn-ghost" onClick={onBack}>
                <BackIcon /> Back
              </button>
            </div>
          </div>
        </div>
      </div>

      {playing && (
        <div className="section">
          <div className="player-wrap">
            <webview
              src={videasyMovieUrl(item.id)}
              partition="persist:videasy"
              allowpopups="true"
              style={{ position:'absolute',inset:0,width:'100%',height:'100%',border:'none' }}
            />
            <button className="player-overlay-btn" onClick={() => setShowDownload(true)} title="Download">
              <DownloadIcon />
              {m3u8Url && <span className="player-overlay-dot" />}
            </button>
          </div>

          {pct > 0 && (
            <div className="progress-bar-row">
              <div className="progress-bar-outer">
                <div className="progress-bar-fill" style={{ width: `${Math.min(pct,100)}%` }} />
              </div>
              <span style={{ fontSize:12,color:'var(--text3)' }}>{pct.toFixed(0)}% watched</span>
            </div>
          )}
          <div className="progress-mark-row">
            <span style={{ fontSize:12,color:'var(--text3)',marginRight:4 }}>Mark progress:</span>
            {[25,50,75,100].map(p => (
              <button key={p} className="btn btn-ghost" style={{ padding:'5px 14px',fontSize:12 }}
                onClick={() => saveProgress(progressKey, p)}>{p}%</button>
            ))}
          </div>
        </div>
      )}

      {showDownload && (
        <DownloadModal
          onClose={() => setShowDownload(false)}
          m3u8Url={m3u8Url}
          mediaName={mediaName}
          downloaderFolder={downloaderFolder}
          setDownloaderFolder={handleSetDownloaderFolder}
          onOpenSettings={onSettings}
        />
      )}
    </div>
  )
}
