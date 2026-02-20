import { useState, useEffect, useRef, useCallback } from 'react'
import { DownloadIcon, TrashIcon, FolderIcon, PlayIcon, FilmIcon, WatchedIcon } from '../components/Icons'
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


export default function DownloadsPage({ downloads, onDeleteDownload, onHistory, onSaveProgress, progress, watched, onMarkWatched, onMarkUnwatched, highlightId, onClearHighlight }) {
  const [fileExistsCache, setFileExistsCache] = useState({})
  const [localFiles, setLocalFiles] = useState(() => storage.get('localFiles') || [])
  const [scanning, setScanning] = useState(false)
  const [scanFolder, setScanFolder] = useState(() => storage.get('downloadPath') || '')
  const highlightRef = useRef(null)

  const isElectron = typeof window !== 'undefined' && !!window.electron

  const active = downloads.filter(d => d.status === 'downloading')
  const finished = downloads.filter(d => d.status !== 'downloading')
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))

  // Scroll to and highlight the targeted download item
  useEffect(() => {
    if (!highlightId || !highlightRef.current) return
    const el = highlightRef.current
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    // Clear the highlight after animation
    const t = setTimeout(() => onClearHighlight?.(), 3000)
    return () => clearTimeout(t)
  }, [highlightId])

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
            {allLocalItems.map(dl => {
              const isHighlighted = dl.id === highlightId
              // Build watched key from download metadata
              const watchedKey = dl.mediaType === 'movie'
                ? `movie_${dl.tmdbId || dl.mediaId}`
                : dl.mediaType === 'tv' && dl.tmdbId && dl.season && dl.episode
                  ? `tv_${dl.tmdbId}_s${dl.season}e${dl.episode}`
                  : null
              return (
                <LocalFileCard
                  key={dl.id}
                  dl={dl}
                  fileExists={dl.isLocalOnly ? true : fileExistsCache[dl.id]}
                  onWatch={() => window.electron.openPath(dl.filePath)}
                  onShowFolder={() => window.electron?.showInFolder(dl.filePath)}
                  onDelete={dl.isLocalOnly ? undefined : () => handleDelete(dl)}
                  isHighlighted={isHighlighted}
                  highlightRef={isHighlighted ? highlightRef : null}
                  watchedKey={watchedKey}
                  isWatched={watchedKey ? !!watched?.[watchedKey] : false}
                  onMarkWatched={watchedKey ? () => onMarkWatched?.(watchedKey) : null}
                  onMarkUnwatched={watchedKey ? () => onMarkUnwatched?.(watchedKey) : null}
                />
              )
            })}
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
function LocalFileCard({ dl, fileExists, onWatch, onShowFolder, onDelete, isHighlighted, highlightRef, isWatched, onMarkWatched, onMarkUnwatched }) {
  const isDownload = !dl.isLocalOnly
  const statusColor = STATUS_COLOR[dl.status] || 'var(--text3)'
  // Allow watching if file exists on disk (regardless of reported status)
  const canWatch = !!fileExists && !!dl.filePath

  return (
    <div
      ref={highlightRef}
      className={`dl-card${isHighlighted ? ' dl-card-highlighted' : ''}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Poster posterPath={dl.posterPath} size={40} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dl.name}
            </div>
            {isWatched && (
              <span title="Watched" style={{ color: '#4caf50', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <WatchedIcon size={14} />
              </span>
            )}
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

        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {/* Watched toggle */}
          {onMarkWatched && (
            isWatched
              ? (
                <button className="btn btn-ghost watched-btn" style={{ padding: '5px 10px', fontSize: 12, gap: 4 }} onClick={onMarkUnwatched} title="Mark as Unwatched">
                  <WatchedIcon size={13} /> Watched
                </button>
              )
              : (
                <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={onMarkWatched} title="Mark as Watched">
                  ✓ Mark Watched
                </button>
              )
          )}
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
