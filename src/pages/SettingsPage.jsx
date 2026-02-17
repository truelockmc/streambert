import { useState } from 'react'
import { storage } from '../utils/storage'

export default function SettingsPage({ apiKey, onChangeApiKey }) {
  const [downloadPath, setDownloadPath] = useState(() => storage.get('downloadPath') || '')
  const [saved, setSaved] = useState(false)

  const pickFolder = async () => {
    if (!window.electron) return
    const folder = await window.electron.pickFolder()
    if (folder) {
      setDownloadPath(folder)
      storage.set('downloadPath', folder)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleSavePath = () => {
    storage.set('downloadPath', downloadPath)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="fade-in" style={{ padding: '48px' }}>
      <h1 className="library-title" style={{ marginBottom: 8 }}>Settings</h1>
      <p style={{ color: 'var(--text3)', fontSize: 14, marginBottom: 40 }}>
        App configuration for Streambert
      </p>

      {/* TMDB API Key */}
      <div className="settings-section">
        <div className="settings-section-title">TMDB API Key</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <code style={{ fontSize: 13, color: 'var(--text2)', background: 'var(--surface2)', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
            {apiKey ? apiKey.slice(0, 8) + '••••••••••••••••' : '(not set)'}
          </code>
          <button className="btn btn-ghost" onClick={onChangeApiKey}>
            Change API Key
          </button>
        </div>
      </div>

      <div className="settings-sep" />

      {/* Download path */}
      <div className="settings-section">
        <div className="settings-section-title">Download Folder</div>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16, lineHeight: 1.6 }}>
          Downloaded videos will be saved here.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="apikey-input"
            style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
            placeholder="/home/you/Movies"
            value={downloadPath}
            onChange={e => setDownloadPath(e.target.value)}
          />
          {window.electron && (
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
      </div>
    </div>
  )
}
