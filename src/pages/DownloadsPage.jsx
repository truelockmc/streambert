import { useState, useEffect, useRef, useCallback } from 'react'
import { DownloadIcon, TrashIcon, FolderIcon, PlayIcon, FilmIcon } from '../components/Icons'
import { storage } from '../utils/storage'

const IMG_BASE = 'https://image.tmdb.org/t/p/w154'

const STATUS_COLOR = {
  downloading: 'var(--red)',
  completed: '#4caf50',
  error: '#f44336',
  interrupted: '#ff9800',
}

const STATUS_LABEL = {
  downloading: 'Downloading',
  completed: 'Completed',
  error: 'Error',
  interrupted: 'Interrupted',
}

function timeAgo(ts) {
  if (!ts) return ''
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago'
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago'
  return Math.floor(sec / 86400) + 'd ago'
}

// Poster thumbnail — shows TMDB image or fallback icon
function Poster({ posterPath, size = 48 }) {
  const [errored, setErrored] = useState(false)
  if (posterPath && !errored) {
    return (
      <img
        src={`${IMG_BASE}${posterPath}`}
        alt=""
        onError={() => setErrored(true)}
        style={{
          width: size, height: size * 1.5,
          objectFit: 'cover', borderRadius: 6,
          flexShrink: 0, display: 'block',
          background: 'var(--surface3)',
        }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size * 1.5,
      borderRadius: 6, background: 'var(--surface3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text3)', flexShrink: 0,
    }}>
      <FilmIcon />
    </div>
  )
}

// Local video player modal
function LocalPlayer({ item, onClose, onHistory, onProgress, progress }) {
  const videoRef = useRef(null)
  // item can be a download entry or a scanned local file
  const filePath = item.filePath
  const fileUrl = 'localfile:///' + filePath.split('/').filter(Boolean).map(seg => encodeURIComponent(seg)).join('/')

  const progressKey = item.mediaType === 'movie'
    ? `movie_${item.mediaId}`
    : item.mediaId
      ? `tv_${item.mediaId}_s${item.season}e${item.episode}`
      : `local_${item.id || filePath}`

  useEffect(() => {
    if (onHistory && item.mediaId) {
      onHistory({
        id: item.mediaId,
        title: item.name,
        media_type: item.mediaType || 'movie',
        season: item.season,
        episode: item.episode,
        watchedAt: Date.now(),
      })
    }
  }, [])

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
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#000', display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: 'rgba(0,0,0,0.8)',
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        opacity: 0, transition: 'opacity 0.2s',
      }}
        onMouseEnter={e => e.currentTarget.style.opacity = 1}
        onMouseLeave={e => e.currentTarget.style.opacity = 0}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{item.name}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[25, 50, 75, 100].map(p => (
            <button key={p} className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: 11 }}
              onClick={() => onProgress(progressKey, p)}>{p}%</button>
          ))}
          <button className="icon-btn" onClick={onClose}
            style={{ fontSize: 22, lineHeight: 1, color: '#fff', marginLeft: 8 }}>✕</button>
        </div>
      </div>

      {/* Video — fills the whole screen */}
      <video
        ref={videoRef}
        src={fileUrl}
        controls
        autoPlay
        style={{ width: '100%', height: '100%', background: '#000', display: 'block' }}
      />
    </div>
  )
}

export default function DownloadsPage({ downloads, onDeleteDownload, onHistory, onSaveProgress, progress }) {
  const [watchItem, setWatchItem] = useState(null)
  const [fileExistsCache, setFileExistsCache] = useState({})
  const [localFiles, setLocalFiles] = useState(() => storage.get('localFiles') || [])
  const [scanning, setScanning] = useState(false)
  const [scanFolder, setScanFolder] = useState(() => storage.get('downloadPath') || '')

  const isElectron = typeof window !== 'undefined' && !!window.electron

  const active = downloads.filter(d => d.status === 'downloading')
  const finished = downloads.filter(d => d.status !== 'downloading')
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))

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

  const handleScanFolder = useCallback(async () => {
    if (!isElectron || !scanFolder) return
    setScanning(true)
    try {
      const files = await window.electron.scanDirectory(scanFolder)
      // Deduplicate against known downloads by filePath
      const knownPaths = new Set(downloads.map(d => d.filePath).filter(Boolean))
      const unique = (files || []).filter(f => !knownPaths.has(f.filePath))
      setLocalFiles(unique)
      storage.set('localFiles', unique)
    } finally {
      setScanning(false)
    }
  }, [scanFolder, downloads])

  const handleDelete = async (dl) => {
    if (!confirm(`Delete "${dl.name}"${dl.filePath ? ' and its file' : ''}?`)) return
    await window.electron.deleteDownload({ id: dl.id, filePath: dl.filePath })
    onDeleteDownload(dl.id)
  }

  // Combine finished downloads + scanned local files into one "Local Files" list
  const localFileItems = localFiles.map(f => ({
    id: f.filePath,
    name: f.name,
    filePath: f.filePath,
    size: f.size,
    status: 'local',
    isLocalOnly: true,
  }))

  const allLocalItems = [
    ...finished.filter(d => fileExistsCache[d.id] !== false),
    ...localFileItems.filter(lf => !finished.some(d => d.filePath === lf.filePath)),
  ]

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

      {/* ── Local Files ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div className="settings-section-title" style={{ marginBottom: 0 }}>Local Files</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isElectron && (
              <>
                <input
                  style={{
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '5px 10px', fontSize: 12,
                    color: 'var(--text)', width: 220,
                  }}
                  placeholder="Folder to scan…"
                  value={scanFolder}
                  onChange={e => setScanFolder(e.target.value)}
                />
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={async () => {
                    const folder = await window.electron.pickFolder()
                    if (folder) { setScanFolder(folder); storage.set('downloadPath', folder) }
                  }}
                >
                  Browse
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={handleScanFolder}
                  disabled={scanning || !scanFolder}
                >
                  {scanning ? 'Scanning…' : '⟳ Scan'}
                </button>
              </>
            )}
          </div>
        </div>

        {allLocalItems.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {allLocalItems.map(dl => (
              <LocalFileCard
                key={dl.id}
                dl={dl}
                fileExists={dl.isLocalOnly ? true : fileExistsCache[dl.id]}
                onWatch={() => setWatchItem(dl)}
                onShowFolder={() => window.electron?.showInFolder(dl.filePath)}
                onDelete={dl.isLocalOnly ? undefined : () => handleDelete(dl)}
              />
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--text3)', fontSize: 14, padding: '16px 0' }}>
            {downloads.length === 0 && localFiles.length === 0
              ? 'No local files yet. Scan a folder or start a download.'
              : 'No completed downloads or local files found.'}
          </div>
        )}
      </div>

      {downloads.length === 0 && localFiles.length === 0 && active.length === 0 && (
        <div className="empty-state">
          <DownloadIcon />
          <h3>No downloads yet</h3>
          <p>Start a download from any movie or series page, or scan a folder to find local video files.</p>
        </div>
      )}

      {watchItem && (
        <LocalPlayer
          item={watchItem}
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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <Poster posterPath={dl.posterPath} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dl.name}
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text3)', flexWrap: 'wrap' }}>
            {dl.speed && <span>↓ {dl.speed}</span>}
            {dl.size && <span>{dl.size}</span>}
            {dl.totalFragments > 0 && (
              <span>{dl.completedFragments || 0}/{dl.totalFragments} fragments</span>
            )}
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
          background: pct > 0 ? 'var(--red)' : 'var(--surface3)',
          borderRadius: 3,
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

// ── Local file / completed download card ──────────────────────────────────────
function LocalFileCard({ dl, fileExists, onWatch, onShowFolder, onDelete }) {
  const isDownload = !dl.isLocalOnly
  const statusColor = STATUS_COLOR[dl.status] || 'var(--text3)'
  // Allow watching if file exists on disk (regardless of reported status)
  const canWatch = !!fileExists && !!dl.filePath

  return (
    <div className="dl-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Poster posterPath={dl.posterPath} size={40} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
            {dl.name}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text3)', alignItems: 'center', flexWrap: 'wrap' }}>
            {isDownload && (
              <span style={{ color: statusColor, fontWeight: 600 }}>{STATUS_LABEL[dl.status]}</span>
            )}
            {!isDownload && <span style={{ color: '#4caf50', fontWeight: 600 }}>Local</span>}
            {dl.completedAt && <span>{timeAgo(dl.completedAt)}</span>}
            {dl.size && <span>{dl.size}</span>}
            {fileExists === false && <span style={{ color: '#f44336' }}>File missing</span>}
          </div>
          {dl.lastMessage && dl.status === 'error' && (
            <div style={{ fontSize: 11, color: '#f44336', marginTop: 2, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          {onDelete && (
            <button className="icon-btn" onClick={onDelete} title="Delete">
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
