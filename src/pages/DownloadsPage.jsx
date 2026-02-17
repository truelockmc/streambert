import { useState, useEffect, useRef } from 'react'
import { DownloadIcon, TrashIcon, FolderIcon, PlayIcon, FilmIcon } from '../components/Icons'

const STATUS_COLOR = {
  downloading: 'var(--red)',
  completed:   '#4caf50',
  error:       '#f44336',
  interrupted: '#ff9800',
}

const STATUS_LABEL = {
  downloading: 'Downloading',
  completed:   'Completed',
  error:       'Error',
  interrupted: 'Interrupted',
}

function fmt(bytes) {
  if (!bytes || isNaN(bytes)) return ''
  const b = parseFloat(bytes)
  if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b > 1e3) return (b / 1e3).toFixed(1) + ' KB'
  return b + ' B'
}

function timeAgo(ts) {
  if (!ts) return ''
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago'
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago'
  return Math.floor(sec / 86400) + 'd ago'
}

// Local video player modal
function LocalPlayer({ download, onClose, onHistory, onProgress, progress }) {
  const videoRef = useRef(null)
  const fileUrl = `localfile://${download.filePath}`
  const progressKey = download.mediaType === 'movie'
    ? `movie_${download.mediaId}`
    : download.mediaId
      ? `tv_${download.mediaId}_s${download.season}e${download.episode}`
      : `local_${download.id}`

  // Add to history once
  useEffect(() => {
    if (onHistory) {
      onHistory({
        id: download.mediaId || download.id,
        title: download.name,
        media_type: download.mediaType || 'movie',
        season: download.season,
        episode: download.episode,
        watchedAt: Date.now(),
      })
    }
  }, [])

  // Restore saved position
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const savedPct = progress[progressKey]
    if (savedPct && savedPct > 0 && savedPct < 98) {
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = (savedPct / 100) * video.duration
      }, { once: true })
    }
  }, [])

  // Periodically save progress
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const interval = setInterval(() => {
      if (!video.paused && video.duration) {
        const pct = (video.currentTime / video.duration) * 100
        onProgress(progressKey, Math.floor(pct))
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        style={{ width: '90vw', maxWidth: 1100, background: '#000', borderRadius: 12, overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.9)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{download.name}</span>
          <button className="icon-btn" onClick={onClose} style={{ fontSize: 20, lineHeight: 1, color: 'var(--text2)' }}>✕</button>
        </div>
        <video
          ref={videoRef}
          src={fileUrl}
          controls
          autoPlay
          style={{ width: '100%', display: 'block', maxHeight: '80vh', background: '#000' }}
        />
        <div style={{ padding: '10px 16px', background: 'var(--surface)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)', marginRight: 8 }}>Mark progress:</span>
          {[25, 50, 75, 100].map(p => (
            <button key={p} className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }}
              onClick={() => onProgress(progressKey, p)}>{p}%</button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function DownloadsPage({ downloads, onDeleteDownload, onHistory, onSaveProgress, progress }) {
  const [watchItem, setWatchItem] = useState(null)
  const [fileExistsCache, setFileExistsCache] = useState({})

  const isElectron = typeof window !== 'undefined' && !!window.electron

  const active    = downloads.filter(d => d.status === 'downloading')
  const finished  = downloads.filter(d => d.status !== 'downloading').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))

  // Check file existence for completed downloads
  useEffect(() => {
    if (!isElectron) return
    finished.forEach(d => {
      if (d.filePath && fileExistsCache[d.id] === undefined) {
        window.electron.fileExists(d.filePath).then(exists => {
          setFileExistsCache(prev => ({ ...prev, [d.id]: exists }))
        })
      }
    })
  }, [finished.length])

  const handleDelete = async (dl) => {
    if (!confirm(`Delete "${dl.name}"${dl.filePath ? ' and its file' : ''}?`)) return
    await window.electron.deleteDownload({ id: dl.id, filePath: dl.filePath })
    onDeleteDownload(dl.id)
  }

  return (
    <div className="fade-in" style={{ padding: '48px 48px 80px' }}>
      {/* Header */}
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, letterSpacing: 1, marginBottom: 6 }}>
        DOWNLOADS
      </div>
      <div style={{ color: 'var(--text3)', fontSize: 14, marginBottom: 40 }}>
        {active.length > 0 ? `${active.length} active` : 'No active downloads'} · {finished.length} completed
      </div>

      {/* ── Active downloads ── */}
      {active.length > 0 && (
        <div style={{ marginBottom: 48 }}>
          <div className="settings-section-title" style={{ marginBottom: 16 }}>Active</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {active.map(dl => (
              <ActiveCard key={dl.id} dl={dl} onDelete={() => handleDelete(dl)} />
            ))}
          </div>
        </div>
      )}

      {/* ── Completed ── */}
      {finished.length > 0 && (
        <div>
          <div className="settings-section-title" style={{ marginBottom: 16 }}>History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {finished.map(dl => (
              <CompletedCard
                key={dl.id}
                dl={dl}
                fileExists={fileExistsCache[dl.id]}
                onWatch={() => setWatchItem(dl)}
                onShowFolder={() => window.electron?.showInFolder(dl.filePath)}
                onDelete={() => handleDelete(dl)}
              />
            ))}
          </div>
        </div>
      )}

      {downloads.length === 0 && (
        <div className="empty-state">
          <DownloadIcon />
          <h3>No downloads yet</h3>
          <p>Start a download from any movie or series page using the download button above the player.</p>
        </div>
      )}

      {watchItem && (
        <LocalPlayer
          download={watchItem}
          onClose={() => setWatchItem(null)}
          onHistory={onHistory}
          onProgress={onSaveProgress}
          progress={progress}
        />
      )}
    </div>
  )
}

// ── Active download card ───────────────────────────────────────────────────────
function ActiveCard({ dl, onDelete }) {
  const pct = dl.progress || 0
  return (
    <div className="dl-card dl-card-active">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dl.name}
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text3)', flexWrap: 'wrap' }}>
            {dl.speed && <span>↑ {dl.speed}</span>}
            {dl.size && <span>{dl.size}</span>}
            {dl.totalFragments > 0 && <span>{Math.round((pct / 100) * dl.totalFragments)}/{dl.totalFragments} fragments</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--red)', minWidth: 56, textAlign: 'right' }}>
            {pct.toFixed(1)}%
          </div>
          <button className="icon-btn" onClick={onDelete} title="Remove">
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`, height: '100%',
          background: 'var(--red)', borderRadius: 3,
          transition: 'width 0.4s ease',
          boxShadow: pct > 0 ? '0 0 8px rgba(229,9,20,0.6)' : 'none',
        }} />
      </div>

      {/* Last status */}
      {dl.lastMessage && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dl.lastMessage}
        </div>
      )}
    </div>
  )
}

// ── Completed download card ───────────────────────────────────────────────────
function CompletedCard({ dl, fileExists, onWatch, onShowFolder, onDelete }) {
  const statusColor = STATUS_COLOR[dl.status] || 'var(--text3)'
  const canWatch = dl.status === 'completed' && fileExists && dl.filePath

  return (
    <div className="dl-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', flexShrink: 0 }}>
          <FilmIcon />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
            {dl.name}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: statusColor, fontWeight: 600 }}>{STATUS_LABEL[dl.status]}</span>
            {dl.completedAt && <span>{timeAgo(dl.completedAt)}</span>}
            {dl.size && <span>{dl.size}</span>}
          </div>
          {dl.lastMessage && dl.status !== 'completed' && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dl.lastMessage}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {canWatch && (
            <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 12, gap: 5 }} onClick={onWatch}>
              <PlayIcon /> Watch
            </button>
          )}
          {dl.filePath && (
            <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onShowFolder} title="Show in folder">
              <FolderIcon />
            </button>
          )}
          <button className="icon-btn" onClick={onDelete} title="Delete">
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
