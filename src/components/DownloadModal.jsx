import { useState, useEffect } from 'react'
import { CloseIcon, DownloadIcon } from './Icons'

export default function DownloadModal({
  onClose,
  m3u8Url,
  mediaName,
  downloadPath,
  downloaderFolder,
  setDownloaderFolder,
}) {
  const [downloader, setDownloader] = useState(null)
  const [checking, setChecking] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState(null)

  const isElectron = !!window.electron

  const ua = navigator.userAgent.toLowerCase()
  const isWin = ua.includes('win')
  const isMac = ua.includes('mac')
  const binaryHint = isWin
    ? 'Video Downloader.exe  (Windows)'
    : isMac
    ? 'Video Downloader  (macOS)'
    : 'Video Downloader  (Linux)'

  const releaseUrl = 'https://github.com/truelockmc/video-downloader/releases/latest'

  useEffect(() => {
    if (!downloaderFolder || !isElectron) return
    setChecking(true)
    window.electron.checkDownloader(downloaderFolder).then(result => {
      setDownloader(result)
      setChecking(false)
    })
  }, [downloaderFolder])

  const pickFolder = async () => {
    const folder = await window.electron.pickFolder()
    if (folder) setDownloaderFolder(folder)
  }

  const handleDownload = async () => {
    if (!downloader?.binaryPath || !downloadPath || !m3u8Url) return
    setDownloadStatus('starting')
    const result = await window.electron.runDownload({
      binaryPath: downloader.binaryPath,
      m3u8Url,
      name: mediaName,
      downloadPath,
    })
    setDownloadStatus(result.ok ? 'ok' : result.error)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="download-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="download-modal-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DownloadIcon /> Download
          </span>
          <button className="icon-btn" onClick={onClose}><CloseIcon /></button>
        </div>

        {/* No m3u8 yet */}
        {!m3u8Url && (
          <div className="download-waiting">
            <div className="spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
            Waiting for stream URL … (start the video first)
          </div>
        )}

        {/* m3u8 found */}
        {m3u8Url && (
          <>
            <div className="download-url-block">
              <div className="download-url-label">Stream URL found</div>
              <code className="download-url-code">{m3u8Url}</code>
            </div>

            {/* Step 1 — downloader not present yet */}
            {!downloader?.exists && (
              <div className="download-instructions">
                <p className="download-instructions-title">Set up Video Downloader</p>
                <ol className="download-steps">
                  <li>
                    Download the latest release from{' '}
                    <a
                      className="download-link"
                      href="#"
                      onClick={e => { e.preventDefault(); window.electron?.openExternal(releaseUrl) }}
                    >
                      github.com/truelockmc/video-downloader
                    </a>
                    {' '}— for your OS: <code>{binaryHint}</code>
                  </li>
                  <li>Extract the release into a folder of your choice</li>
                  <li>Select that folder below (it must contain a <code>_internal</code> folder and the binary)</li>
                </ol>

                <div className="download-folder-row">
                  <button className="btn btn-secondary" onClick={pickFolder}>
                    Choose folder …
                  </button>
                  {downloaderFolder && (
                    <span className="download-folder-path">{downloaderFolder}</span>
                  )}
                </div>

                {checking && (
                  <div className="download-checking">
                    <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                    Checking …
                  </div>
                )}

                {!checking && downloader && !downloader.exists && downloaderFolder && (
                  <div className="download-error">
                    No Video Downloader binary found in that folder. Make sure the <code>_internal</code> folder and the binary are both present inside the chosen folder.
                  </div>
                )}
              </div>
            )}

            {/* Step 2 — downloader found */}
            {downloader?.exists && (
              <div className="download-ready">
                <div className="download-found-badge">✓ Video Downloader found</div>

                {!downloadPath && (
                  <div className="download-error" style={{ marginBottom: 12 }}>
                    No download folder configured. Please set one in Settings.
                  </div>
                )}

                {downloadPath && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                    Destination: <code>{downloadPath}</code>
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  onClick={handleDownload}
                  disabled={!downloadPath || downloadStatus === 'starting'}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <DownloadIcon />
                  {downloadStatus === 'starting' ? 'Starting …' : 'Start Download'}
                </button>

                {downloadStatus === 'ok' && (
                  <div className="download-success">Download started successfully!</div>
                )}
                {downloadStatus && downloadStatus !== 'ok' && downloadStatus !== 'starting' && (
                  <div className="download-error">{downloadStatus}</div>
                )}

                <div className="download-folder-row" style={{ marginTop: 16 }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>Change binary folder:</span>
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={pickFolder}>
                    Change
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
