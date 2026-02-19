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
  .ytp-share-button, .ytp-watermark, .ytp-chrome-top
  .ytp-chrome-top-buttons,columns
  ytd-engagement-panel-section-list-renderer { display: none !important; }

  /* Page background */
  html, body { background: #000 !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important; }

  /* Collapse the top chrome */
  .ytp-chrome-top {
    height: 0 !important;
    overflow: hidden !important;
    opacity: 0 !important;
  }

  /* Hide end cards / endscreen recommendations */
  .ytp-endscreen-content,
  .ytp-ce-element,
  .ytp-videowall-still,
  .html5-endscreen { display: none !important; }

  /* Completely remove autoplay toggle + tooltip */
  .ytp-autonav-toggle-button-container,
  .ytp-autonav-toggle-button,
  .ytp-tooltip[data-tooltip-target-id="ytp-autonav-toggle-button"] {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
    width: 0 !important;
    height: 0 !important;
    overflow: hidden !important;
  }
`

const CONSENT_REJECT_JS = `
(function autoRejectConsent() {
  var REJECT_PATTERNS = [
    'reject', 'ablehnen', 'tout refuser', 'rifiuta', 'rechazar',
    'rejeitar', 'weiger', 'afvis', 'odmítnout', 'elutasít',
  ]
  var clicked = function() {
    var candidates = document.querySelectorAll(
      'button, [role="button"], .VfPpkd-LgbsSe, ytd-button-renderer'
    )
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i]
      var text = (el.innerText || el.textContent || '').trim().toLowerCase()
      if (REJECT_PATTERNS.some(function(p) { return text.includes(p) })) {
        el.click()
        return true
      }
    }
    var form = document.querySelector('form[action*="reject"], form[action*="refuse"]')
    if (form) { form.submit(); return true }
    return false
  }
  if (!clicked()) {
    [300, 800, 1800, 3500].forEach(function(ms) { setTimeout(clicked, ms) })
  }
})()
`

const PLAYER_SETUP_JS = `
(function setup() {
  if (window.__trailerSetupDone) return
  window.__trailerSetupDone = true

  var CONTAINERS = [
    '#player-container-outer', '#player-container',
    '#player-container-inner', '#player', 'ytd-player',
    'ytd-watch-flexy', 'ytd-watch-modern',
  ]

  var fixLayout = function() {
    window.scrollTo(0, 0)
    CONTAINERS.forEach(function(sel) {
      var el = document.querySelector(sel)
      if (!el) return
      el.style.setProperty('width', '100vw', 'important')
      el.style.setProperty('height', '100vh', 'important')
      el.style.setProperty('max-width', 'none', 'important')
      el.style.setProperty('margin', '0', 'important')
      el.style.setProperty('padding', '0', 'important')
      el.style.setProperty('position', 'fixed', 'important')
      el.style.setProperty('top', '0', 'important')
      el.style.setProperty('left', '0', 'important')
    })
  }
  fixLayout()
  setTimeout(fixLayout, 500)
  setTimeout(fixLayout, 1500)

  document.addEventListener('fullscreenchange', function() {
    if (!document.fullscreenElement) {
      [0, 50, 150, 300, 600, 1000].forEach(function(ms) { setTimeout(fixLayout, ms) })
    }
  })

  var styleObserver = new MutationObserver(function() { fixLayout() })
  var armObserver = function() {
    CONTAINERS.forEach(function(sel) {
      var el = document.querySelector(sel)
      if (el) styleObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class'] })
    })
  }
  armObserver(); setTimeout(armObserver, 2000)

  // ── Autoplay OFF ─────────────────────────────────────────────────────────────
  var forceAutoplayOff = function() {
    var btn = document.querySelector('.ytp-autonav-toggle-button')
    if (btn && btn.getAttribute('aria-checked') === 'true') btn.click()
    try {
      var player = document.getElementById('movie_player')
      if (player && player.setAutonavState) player.setAutonavState(false)
    } catch(e) {}
  }
  forceAutoplayOff()
  setTimeout(forceAutoplayOff, 1000)
  setTimeout(forceAutoplayOff, 3000)
  var autoplayObserver = new MutationObserver(forceAutoplayOff)
  var observeAutoplay = function() {
    var c = document.querySelector('.ytp-autonav-toggle-button-container')
    if (c) autoplayObserver.observe(c, { attributes: true, subtree: true })
  }
  observeAutoplay(); setTimeout(observeAutoplay, 2000)

  // ── Remove "More Videos" button + up-next panel from DOM, keep it gone ───────
  // Covers both the in-player button (.ytp-upnext-button) and the suggestion
  // overlay (.ytp-upnext, .ytp-upnext-autoplay) in normal and fullscreen mode
  var UPNEXT_SELECTORS = [
    '.ytp-upnext',
    '.ytp-upnext-autoplay',
    '.ytp-upnext-button',
    'ytd-compact-video-renderer',
    'ytd-compact-auto-generated-playlist-renderer',
  ]
  var removeUpNext = function() {
    UPNEXT_SELECTORS.forEach(function(sel) {
      document.querySelectorAll(sel).forEach(function(el) { el.remove() })
    })
  }
  removeUpNext()
  var upNextObserver = new MutationObserver(removeUpNext)
  var observeUpNext = function() {
    var player = document.getElementById('movie_player')
    var target = player || document.body
    upNextObserver.observe(target, { childList: true, subtree: true })
  }
  observeUpNext()
  setTimeout(removeUpNext, 1000)
  setTimeout(removeUpNext, 3000)

  // ── Block V-key ───────────────────────────────────────────────────────────────
  var blockV = function(e) {
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }
  document.addEventListener('keydown', blockV, true)

  // ── Detect video end ──────────────────────────────────────────────────────────
  var attachEndedListener = function() {
    var video = document.querySelector('video')
    if (!video) return false
    video.addEventListener('ended', function() { window.__trailerEnded = true })
    return true
  }
  if (!attachEndedListener()) {
    var waitObs = new MutationObserver(function() {
      if (attachEndedListener()) waitObs.disconnect()
    })
    waitObs.observe(document.body, { childList: true, subtree: true })
  }

  // ── Block outbound link clicks (endscreen cards etc.) ────────────────────────
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href]')
    if (!link) return
    var href = link.getAttribute('href') || ''
    if (href.startsWith('#')) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }, true)
})()
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

    const allowedUrl = `https://www.youtube.com/watch?v=${trailerKey}`

    const injectAll = () => {
      wv.insertCSS(HIDE_CSS).catch(() => { })
      wv.executeJavaScript(CONSENT_REJECT_JS).catch(() => { })
      wv.executeJavaScript(PLAYER_SETUP_JS).catch(() => { })
    }

    // Block navigation away from the video
    const onWillNavigate = (e) => {
      const target = e.url || ''
      const isAllowed =
        target.startsWith(allowedUrl) ||
        target.includes('consent.youtube.com') ||
        target.includes('accounts.google.com')
      if (!isAllowed) {
        e.preventDefault()
        if (target.includes('youtube.com/watch')) onClose()
      }
    }

    const endedPoll = setInterval(() => {
      wv.executeJavaScript('window.__trailerEnded === true')
        .then((ended) => { if (ended) { clearInterval(endedPoll); onClose() } })
        .catch(() => { })
    }, 500)

    const onNavigate = () => { wv.executeJavaScript(CONSENT_REJECT_JS).catch(() => { }) }
    const onLoad = () => { injectAll() }

    wv.addEventListener('will-navigate', onWillNavigate)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigate)
    wv.addEventListener('did-finish-load', onLoad)

    return () => {
      clearInterval(endedPoll)
      wv.removeEventListener('will-navigate', onWillNavigate)
      wv.removeEventListener('did-finish-load', onLoad)
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigate)
    }
  }, [onClose, trailerKey])

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
            allowpopups="false"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        </div>
      </div>
    </div>
  )
}
