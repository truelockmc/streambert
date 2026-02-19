import { useState } from 'react'
import { storage } from '../utils/storage'

// ── Confirmation Dialog ───────────────────────────────────────────────────────
function ResetConfirmDialog({ onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '36px 40px',
        maxWidth: 460,
        width: '90%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        {/* Warning icon */}
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'rgba(229,9,20,0.12)',
          border: '1px solid rgba(229,9,20,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: 1, marginBottom: 10 }}>
          RESET STREAMBERT?
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 28 }}>
          This will permanently delete all your settings, watch history, saved titles,
          progress data, and cached data. Your downloaded video files will{' '}
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>not</span> be deleted.
          <br /><br />
          <span style={{ color: 'var(--red)' }}>This action cannot be undone.</span>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn"
            style={{ flex: 1, background: 'var(--red)', color: '#fff', border: 'none', fontWeight: 600 }}
            onClick={onConfirm}
          >
            Yes, Reset Everything
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (!status) return null
  const isError = status.startsWith('✕')
  return (
    <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: isError ? 'var(--red)' : '#48c774' }}>
      {status}
    </div>
  )
}

// ── Clean Row ─────────────────────────────────────────────────────────────────
function CleanRow({ title, description, buttonLabel, onAction, danger }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  const handle = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await onAction()
      setStatus(result?.msg || '✓ Done')
    } catch (e) {
      setStatus('✕ ' + (e.message || 'Something went wrong'))
    } finally {
      setBusy(false)
      setTimeout(() => setStatus(null), 4000)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.6 }}>
          {description}
        </div>
        <StatusBadge status={status} />
      </div>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={handle}
          style={danger ? {
            color: 'var(--red)',
            borderColor: 'rgba(229,9,20,0.35)',
            opacity: busy ? 0.5 : 1,
          } : { opacity: busy ? 0.5 : 1 }}
        >
          {busy ? 'Working…' : buttonLabel}
        </button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SettingsPage({ apiKey, onChangeApiKey }) {
  const [downloadPath, setDownloadPath] = useState(() => storage.get('downloadPath') || '')
  const [watchedThreshold, setWatchedThreshold] = useState(() => storage.get('watchedThreshold') ?? 20)
  const [saved, setSaved] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const isElectron = typeof window !== 'undefined' && !!window.electron

  const pickFolder = async () => {
    if (!isElectron) return
    const folder = await window.electron.pickFolder()
    if (folder) { setDownloadPath(folder); storage.set('downloadPath', folder); flash() }
  }

  const handleSavePath = () => { storage.set('downloadPath', downloadPath); flash() }

  const handleSaveThreshold = () => {
    const val = Math.max(1, Math.min(300, Number(watchedThreshold) || 20))
    setWatchedThreshold(val); storage.set('watchedThreshold', val); flash()
  }

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }

  // ── Clean handlers ─────────────────────────────────────────────────────────

  const handleClearCache = async () => {
    if (isElectron) await window.electron.clearAppCache()
    return { msg: '✓ Cache cleared successfully' }
  }

  const handleClearWatchProgress = async () => {
    storage.remove('progress')
    storage.remove('history')
    storage.remove('watched')
    if (isElectron) await window.electron.clearWatchData()
    setTimeout(() => window.location.reload(), 800)
    return { msg: '✓ Watch data cleared' }
  }

  const handleDeleteAllDownloads = async () => {
    let msg = '✓ All downloads removed'
    if (isElectron) {
      const res = await window.electron.deleteAllDownloads()
      if (res?.deleted != null) {
        msg = `✓ Removed ${res.deleted} file${res.deleted !== 1 ? 's' : ''}`
        if (res.errors > 0) msg += ` (${res.errors} could not be deleted)`
      }
    } else {
      storage.remove('localFiles')
    }
    return { msg }
  }

  const handleResetApp = async () => {
    setShowResetConfirm(false)
    if (isElectron) await window.electron.resetApp()
    const keys = Object.keys(localStorage).filter(k => k.startsWith('streambert_'))
    keys.forEach(k => localStorage.removeItem(k))
    window.location.reload()
  }

  return (
    <>
      {showResetConfirm && (
        <ResetConfirmDialog onConfirm={handleResetApp} onCancel={() => setShowResetConfirm(false)} />
      )}

      <div className="fade-in" style={{ padding: '48px 48px 80px' }}>

        {/* Page title */}
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, letterSpacing: 1, marginBottom: 6 }}>
          SETTINGS
        </div>
        <div style={{ color: 'var(--text3)', fontSize: 14, marginBottom: 48 }}>
          App configuration for Streambert
        </div>

        {/* ── TMDB API Key ── */}
        <div style={{ marginBottom: 40 }}>
          <div className="settings-section-title">TMDB API Key</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{
              fontSize: 13, color: 'var(--text2)',
              background: 'var(--surface2)', padding: '6px 14px',
              borderRadius: 6, border: '1px solid var(--border)',
            }}>
              {apiKey ? apiKey.slice(0, 8) + '••••••••••••••••' : '(not set)'}
            </code>
            <button className="btn btn-ghost" onClick={onChangeApiKey}>Change API Key</button>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border)', marginBottom: 40 }} />

        {/* ── Auto-Watched Threshold ── */}
        <div style={{ marginBottom: 40 }}>
          <div className="settings-section-title">Auto-Watched Threshold</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16, lineHeight: 1.6 }}>
            A movie or episode is automatically marked as{' '}
            <span style={{ color: '#48c774', fontWeight: 600 }}>Watched ✓</span> when
            the remaining time drops to this value or below. Set between 1 and 300 seconds.
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number" min={1} max={300}
                className="apikey-input"
                style={{ width: 90, marginBottom: 0 }}
                value={watchedThreshold}
                onChange={e => setWatchedThreshold(e.target.value)}
              />
              <span style={{ fontSize: 14, color: 'var(--text2)' }}>seconds</span>
            </div>
            <button className="btn btn-primary" onClick={handleSaveThreshold}>Save</button>
          </div>
          {saved && <div style={{ marginTop: 10, fontSize: 13, color: '#48c774' }}>✓ Saved</div>}
        </div>

        <div style={{ height: 1, background: 'var(--border)', marginBottom: 40 }} />

        {/* ── Download Folder ── */}
        <div style={{ marginBottom: 56 }}>
          <div className="settings-section-title">Download Folder</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16, lineHeight: 1.6 }}>
            Downloaded videos will be saved here.
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="apikey-input"
              style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
              placeholder="/home/you/Movies"
              value={downloadPath}
              onChange={e => setDownloadPath(e.target.value)}
            />
            {isElectron && (
              <button className="btn btn-secondary" onClick={pickFolder}>Browse …</button>
            )}
            <button className="btn btn-primary" onClick={handleSavePath}>Save</button>
          </div>
          {saved && <div style={{ marginTop: 10, fontSize: 13, color: '#4caf50' }}>✓ Saved</div>}
          {!downloadPath && (
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>
              ⚠ No download folder set — videos cannot be downloaded until you set one.
            </div>
          )}
        </div>

        {/* ══ STORAGE & DATA ══════════════════════════════════════════════════ */}
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: 1, marginBottom: 6 }}>
          STORAGE & DATA
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 28 }}>
          Manage cached data, watch history, and app storage
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}>

          {/* Cache */}
          <div style={{ padding: '22px 24px' }}>
            <CleanRow
              title="Clear Cache"
              description="Removes temporary browser cache, shader cache, and service worker data from all internal sessions (main, video player, trailer). Does not affect your personal data or settings."
              buttonLabel="Clear Cache"
              onAction={handleClearCache}
            />
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* Watch Progress */}
          <div style={{ padding: '22px 24px' }}>
            <CleanRow
              title="Clear Watch Progress"
              description="Resets all watch history, continue-watching progress, and watched / completed markings for movies and series. Also clears internal video player session data."
              buttonLabel="Clear Progress"
              onAction={handleClearWatchProgress}
            />
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* Delete Downloads */}
          <div style={{ padding: '22px 24px' }}>
            <CleanRow
              title="Delete All Downloads"
              description="Permanently deletes all video files that were downloaded through Streambert and removes them from the download list. Only files downloaded trough the app will be deleted, nothing else in your folder is touched."
              buttonLabel="Delete All"
              onAction={handleDeleteAllDownloads}
              danger
            />
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* Full Reset */}
          <div style={{ padding: '22px 24px', background: 'rgba(229,9,20,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 15, fontWeight: 600, color: 'var(--text)',
                  marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  Reset App
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 1,
                    color: 'var(--red)', background: 'rgba(229,9,20,0.12)',
                    border: '1px solid rgba(229,9,20,0.25)',
                    padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase',
                  }}>
                    Irreversible
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.6 }}>
                  Completely resets Streambert to factory defaults, clears all settings, API key,
                  saved library, watch history/progress, and all cached data. Your downloaded
                  video files will not be touched.
                </div>
              </div>
              <div style={{ flexShrink: 0, paddingTop: 2 }}>
                <button
                  className="btn"
                  onClick={() => setShowResetConfirm(true)}
                  style={{
                    color: 'var(--red)',
                    background: 'rgba(229,9,20,0.08)',
                    border: '1px solid rgba(229,9,20,0.3)',
                  }}
                >
                  Reset App
                </button>
              </div>
            </div>
          </div>

        </div>

      </div>
    </>
  )
}
