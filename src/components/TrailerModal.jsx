import { useEffect, useRef } from 'react'
import { CloseIcon } from './Icons'

const HIDE_CSS = `
  /* Hide everything except the video player */
  ytd-app > * { display: none !important; }
  #content, ytd-page-manager { display: block !important; }
  ytd-watch-flexy, ytd-watch-modern { display: block !important; background: #000 !important; }

  /* Hide all non-player columns */
  #secondary, #below, #comments, ytd-watch-metadata,
  #masthead-container, tp-yt-app-drawer, ytd-mini-guide-renderer,
  #chat, #panels, ytd-merch-shelf-renderer,
  .ytp-chrome-top .ytp-share-button,
  .ytp-chrome-top-buttons, .ytp-watermark,
  ytd-engagement-panel-section-list-renderer { display: none !important; }

  /* Make player fill entire viewport */
  html, body { background: #000 !important; overflow: hidden !important; margin: 0 !important; }
  #player-container, #player-container-inner,
  #player-container-outer, #player, ytd-player,
  #movie_player, .html5-video-container,
  .html5-main-video { width: 100vw !important; height: 100vh !important; max-width: unset !important; }
  video { width: 100vw !important; height: 100vh !important; }

  /* Hide top bar inside player */
  .ytp-chrome-top { display: none !important; }
`

export default function TrailerModal({ trailerKey, title, onClose }) {
  const webviewRef = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onLoad = () => {
      wv.insertCSS(HIDE_CSS).catch(() => { })
      // Disable autoplay-next toggle
      wv.executeJavaScript(`
        const disableAutoplay = () => {
          // Click the autoplay toggle if it's on
          const btn = document.querySelector('.ytp-autonav-toggle-button')
          if (btn && btn.getAttribute('aria-checked') === 'true') btn.click()
          // Also set the preference via YouTube's internals
          try {
            const player = document.getElementById('movie_player')
            if (player && player.setAutonavState) player.setAutonavState(false)
          } catch {}
        }
        disableAutoplay()
        setTimeout(disableAutoplay, 1000)
        setTimeout(disableAutoplay, 3000)
      `).catch(() => { })
    }
    wv.addEventListener('did-finish-load', onLoad)
    return () => wv.removeEventListener('did-finish-load', onLoad)
  }, [])

  return (
    <div className="trailer-overlay" onClick={onClose}>
      <div className="trailer-modal" onClick={e => e.stopPropagation()}>
        <div className="trailer-modal-header">
          <span className="trailer-modal-title">🎬 {title} — Official Trailer</span>
          <button className="trailer-close-btn" onClick={onClose} title="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="trailer-embed-wrap">
          <webview
            ref={webviewRef}
            src={`https://www.youtube.com/watch?v=${trailerKey}`}
            partition="persist:trailer"
            allowpopups="true"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        </div>
      </div>
    </div>
  )
}
