// -- Media Session API integration -------------------------------------------
// Registers StreamBert as an active media player with the OS so that
// Bluetooth earbuds, keyboard media keys, Windows media flyout (FluentFlyout),
// and lock-screen overlays can control playback.
//
// ── Why we inject into the webview ──────────────────────────────────────────
// The actual <video> element lives inside a sandboxed <webview>, which runs in
// a completely separate Chromium renderer process with its own isolated
// navigator.mediaSession. The OS reads media metadata from THAT process —
// specifically from whichever renderer owns the playing <video>. Any metadata
// we set in the main React renderer (this process) is in a different process
// and gets silently ignored or overridden by the embed page's own metadata
// (e.g. "vidsrc.to/embed/tv/...").
//
// Fix: we use webview.executeJavaScript() to inject a MediaMetadata override
// directly into the webview's renderer context. We re-inject on every
// dom-ready and did-finish-load event (with a 600ms delay to beat any
// async metadata set by the embed page itself).
//
// The main renderer's navigator.mediaSession calls are kept as a secondary
// layer — some Electron versions / OS combinations may pick them up.

const SUPPORTED = "mediaSession" in navigator;

// TMDB image base — same constant used across the app.
const IMG_BASE = "https://image.tmdb.org/t/p";

/**
 * Build an array of MediaImage objects from a TMDB poster path.
 * Provides multiple sizes so the OS picks the most appropriate one.
 *
 * @param {string|null} posterPath  e.g. "/abc123.jpg"
 * @returns {MediaImage[]}
 */
function buildArtwork(posterPath) {
  if (!posterPath) return [];
  const sizes = [
    { size: "w92",  wh: "92x138"   },
    { size: "w185", wh: "185x278"  },
    { size: "w342", wh: "342x513"  },
    { size: "w500", wh: "500x750"  },
    { size: "w780", wh: "780x1170" },
  ];
  return sizes.map(({ size, wh }) => ({
    src: `${IMG_BASE}/${size}${posterPath}`,
    sizes: wh,
    type: "image/jpeg",
  }));
}

/**
 * Build a self-contained JavaScript string that, when executed inside a
 * webview via executeJavaScript(), overrides the page's Media Session metadata
 * with our human-readable StreamBert values.
 *
 * We inject at two points:
 *   1. Immediately on dom-ready / did-finish-load
 *   2. After a 600 ms delay — to override any async metadata set by the embed
 *      page after the initial page load (most embed players set metadata once
 *      the video starts buffering, which can be several hundred ms after load).
 *
 * @param {object}      opts
 * @param {string}      opts.title
 * @param {string}      [opts.artist]
 * @param {string}      [opts.album]
 * @param {string|null} [opts.posterPath]  TMDB poster path, e.g. "/abc123.jpg"
 * @returns {string}  JavaScript to execute in the webview context
 */
export function buildWebviewMetadataScript({ title, artist, album, posterPath }) {
  const artwork = buildArtwork(posterPath ?? null);

  // Serialize values safely for embedding inside the script string.
  const t  = JSON.stringify(title  || "StreamBert");
  const ar = JSON.stringify(artist || "StreamBert");
  const al = JSON.stringify(album  || "");
  const aw = JSON.stringify(artwork);

  // 1. Lock metadata so the embed page cannot override it.
  // 2. Set action handlers for play/pause inside each frame so the OS keys control the local video.
  // 3. Inject spacebar listener to toggle video play/pause when focused inside the frame.
  return `
(function() {
  if (!('mediaSession' in navigator)) return;
  
  // Set metadata
  try {
    var _meta = new MediaMetadata({
      title:   ${t},
      artist:  ${ar},
      album:   ${al},
      artwork: ${aw}
    });
    Object.defineProperty(navigator.mediaSession, 'metadata', {
      get: function()  { return _meta; },
      set: function()  { /* swallow */ },
      configurable: true,
      enumerable:   true
    });
  } catch(e) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: ${t}, artist: ${ar}, album: ${al}, artwork: ${aw}
      });
    } catch {}
  }

  // Set action handlers directly inside the frame
  try {
    navigator.mediaSession.setActionHandler("play", function() {
      try {
        var v = document.querySelector("video");
        if (v) v.play();
      } catch(e) {}
    });
    navigator.mediaSession.setActionHandler("pause", function() {
      try {
        var v = document.querySelector("video");
        if (v) v.pause();
      } catch(e) {}
    });
  } catch(e) {}

  // Spacebar hotkey listener in capture phase
  if (!window.__streambertSpacebarInjected) {
    window.__streambertSpacebarInjected = true;
    window.addEventListener("keydown", function(e) {
      if (e.key === " " || e.code === "Space") {
        var active = document.activeElement;
        if (active && (
          active.tagName === "INPUT" || 
          active.tagName === "TEXTAREA" || 
          active.isContentEditable
        )) {
          return;
        }
        var v = document.querySelector("video");
        if (v) {
          e.preventDefault();
          e.stopPropagation();
          if (v.paused) {
            v.play();
          } else {
            v.pause();
          }
        }
      }
    }, true);
  }
})();
`.trim();
}

/**
 * Set the Media Session metadata in the MAIN renderer.
 * Called as a secondary layer alongside the webview injection.
 *
 * @param {object} opts
 * @param {string}      opts.title
 * @param {string}      [opts.artist]
 * @param {string}      [opts.album]
 * @param {string|null} [opts.posterPath]
 */
export function setMediaSessionMetadata({ title, artist, album, posterPath }) {
  if (!SUPPORTED) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title:   title  || "StreamBert",
      artist:  artist || "StreamBert",
      album:   album  || "",
      artwork: buildArtwork(posterPath ?? null),
    });
  } catch (e) {
    console.warn("[MediaSession] setMetadata failed:", e);
  }
}

/**
 * Register play/pause action handlers that delegate into the webview.
 *
 * @param {() => Promise<void>} onPlay   Async fn that resumes the video
 * @param {() => Promise<void>} onPause  Async fn that pauses the video
 */
export function registerMediaSessionHandlers(onPlay, onPause) {
  if (!SUPPORTED) return;
  try {
    navigator.mediaSession.setActionHandler("play",  () => { onPlay?.().catch(() => {}); });
    navigator.mediaSession.setActionHandler("pause", () => { onPause?.().catch(() => {}); });
  } catch (e) {
    console.warn("[MediaSession] registerHandlers failed:", e);
  }
}

/**
 * Unregister all action handlers and clear metadata.
 * Call this when the player is stopped or unmounted.
 */
export function clearMediaSession() {
  if (!SUPPORTED) return;
  try {
    navigator.mediaSession.setActionHandler("play",  null);
    navigator.mediaSession.setActionHandler("pause", null);
    navigator.mediaSession.playbackState = "none";
    navigator.mediaSession.metadata = null;
  } catch (e) {
    console.warn("[MediaSession] clear failed:", e);
  }
}

/**
 * Sync the OS playback state indicator.
 * Call this from the existing 5-second progress-polling interval so the
 * Windows media flyout shows the correct play/pause icon.
 *
 * @param {"playing"|"paused"|"none"} state
 */
export function syncPlaybackState(state) {
  if (!SUPPORTED) return;
  try {
    if (navigator.mediaSession.playbackState !== state) {
      navigator.mediaSession.playbackState = state;
    }
  } catch (e) {
    // Ignore – non-critical.
  }
}
