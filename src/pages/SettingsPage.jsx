import { useState } from 'react'
import { storage } from '../utils/storage'

export default function SettingsPage({ apiKey, onChangeApiKey }) {
  const [downloadPath, setDownloadPath] = useState(() => storage.get('downloadPath') || '')
  const [saved, setSaved] = useState(false)

  const isElectron = typeof window !== 'undefined' && !!window.electron

  const pickFolder = async () => {
    if (!isElectron) return
    const folder = await window.electron.pickFolder()
    if (folder) {
      setDownloadPath(folder)
      storage.set('downloadPath', folder)
      flash()
    }
  }

  const handleSavePath = () => {
    storage.set('downloadPath', downloadPath)
    flash()
  }

  const flash = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="fade-in" style={{ padding: '48px 48px 80px' }}>

      {/* Title */}
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
          <button className="btn btn-ghost" onClick={onChangeApiKey}>
            Change API Key
          </button>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--border)', marginBottom: 40 }} />

      {/* ── Download folder ── */}
      <div>
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
            <button className="btn btn-secondary" onClick={pickFolder}>
              Browse …
            </button>
          )}
          <button className="btn btn-primary" onClick={handleSavePath}>
            Save
          </button>
        </div>
        {saved && (
          <div style={{ marginTop: 10, fontSize: 13, color: '#4caf50' }}>✓ Saved</div>
        )}
        {!downloadPath && (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>
            ⚠ No download folder set — videos cannot be downloaded until you set one.
          </div>
        )}
      </div>
    </div>
  )
}
