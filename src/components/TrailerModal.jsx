import { useEffect, useRef, useState, useCallback } from "react";
import { CloseIcon, ExternalLinkIcon } from "./Icons";
import { storage } from "../utils/storage";

export const DEFAULT_INVIDIOUS_BASE = "https://inv.nadeko.net";

const FALLBACK_INSTANCES = [
  "https://invidious.privacyredirect.com",
  "https://inv.tux.pizza",
  "https://yt.cdaut.de",
  "https://invidious.lunar.icu",
  "https://invidious.protokolla.fi",
  "https://invidious.nerdvpn.de",
  "https://iv.melmac.space",
  "https://invidious.perennialte.ch",
];

export function getInvidiousBase() {
  return (storage.get("invidiousBase") || DEFAULT_INVIDIOUS_BASE).replace(
    /\/$/,
    "",
  );
}

const DETECT_BOT_JS = `
(function() {
  var title = (document.title || '').toLowerCase()
  var body  = (document.body  && document.body.innerText || '').toLowerCase()
  var botKeywords = ['verifying', 'antibot', 'challenge', 'ddos', 'please wait', 'checking your browser', 'just a moment']
  var isBot = botKeywords.some(function(k) { return title.includes(k) || body.includes(k) })
  isBot
})()
`;

// Hide the built-in Invidious button, detect video end
const SETUP_JS = `
(function() {
  if (window.__trailerSetup) return
  window.__trailerSetup = true

  // Hide the "Watch on Invidious" button inside the player
  var style = document.createElement('style')
  style.textContent = '.player-container .invidious-link, a[href*="/watch"], .vjs-invidious-button { display: none !important; }'
  document.head.appendChild(style)

  // Detect video end and notify host
  var attachEnded = function() {
    var video = document.querySelector('video')
    if (!video) return false
    video.addEventListener('ended', function() {
      window.__trailerEnded = true
    })
    return true
  }
  if (!attachEnded()) {
    var obs = new MutationObserver(function() { if (attachEnded()) obs.disconnect() })
    obs.observe(document.body, { childList: true, subtree: true })
  }
})()
`;

export default function TrailerModal({ trailerKey, title, onClose }) {
  const webviewRef = useRef(null);
  const [currentSrc, setCurrentSrc] = useState(null);
  const [statusMsg, setStatusMsg] = useState("Loading trailer…");
  const [failed, setFailed] = useState(false);
  const instanceIndexRef = useRef(-1);

  const tryNextInstance = useCallback(() => {
    const preferred = getInvidiousBase();
    const list = [
      preferred,
      ...FALLBACK_INSTANCES.filter((i) => i !== preferred),
    ];
    instanceIndexRef.current += 1;
    const idx = instanceIndexRef.current;
    if (idx >= list.length) {
      setFailed(true);
      setStatusMsg(
        "All Invidious instances failed. Try setting a custom instance in Settings.",
      );
      return;
    }
    const instance = list[idx];
    const label = instance.replace(/^https?:\/\//, "");
    setStatusMsg(idx === 0 ? "Loading trailer…" : `Trying ${label}…`);
    setCurrentSrc(`${instance}/embed/${trailerKey}?autoplay=1&listen=0`);
  }, [trailerKey]);

  useEffect(() => {
    instanceIndexRef.current = -1;
    tryNextInstance();
  }, [tryNextInstance]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Open current video on Invidious in system browser
  const openInBrowser = () => {
    const preferred = getInvidiousBase();
    const url = `${preferred}/watch?v=${trailerKey}`;
    window.electron?.openExternal(url);
  };

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !currentSrc) return;

    const onLoad = () => {
      wv.executeJavaScript(DETECT_BOT_JS)
        .then((isBot) => {
          if (isBot) {
            tryNextInstance();
          } else {
            wv.executeJavaScript(SETUP_JS).catch(() => {});
            setStatusMsg(null);
          }
        })
        .catch(() => tryNextInstance());
    };

    const onFailLoad = () => {
      tryNextInstance();
    };

    const onWillNavigate = (e) => {
      const instanceBase = currentSrc.split("/embed/")[0];
      if (!e.url.startsWith(instanceBase)) {
        e.preventDefault();
        window.electron?.openExternal(e.url);
      }
    };

    const endedPoll = setInterval(() => {
      wv.executeJavaScript("!!window.__trailerEnded")
        .then((ended) => {
          if (ended) {
            clearInterval(endedPoll);
            setTimeout(onClose, 1200);
          }
        })
        .catch(() => {});
    }, 800);

    wv.addEventListener("did-finish-load", onLoad);
    wv.addEventListener("did-fail-load", onFailLoad);
    wv.addEventListener("will-navigate", onWillNavigate);
    return () => {
      clearInterval(endedPoll);
      wv.removeEventListener("did-finish-load", onLoad);
      wv.removeEventListener("did-fail-load", onFailLoad);
      wv.removeEventListener("will-navigate", onWillNavigate);
    };
  }, [currentSrc, tryNextInstance, onClose]);

  return (
    <div className="trailer-overlay" onClick={onClose}>
      <div className="trailer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trailer-modal-header">
          <span className="trailer-modal-title">
            🎬 {title} — Official Trailer
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={openInBrowser}
              title="Open in browser"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 6,
                color: "rgba(255,255,255,0.75)",
                cursor: "pointer",
                fontSize: 12,
                padding: "4px 10px",
                display: "flex",
                alignItems: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <ExternalLinkIcon size={13} />
              Open in Browser
            </button>
            <button
              className="trailer-close-btn"
              onClick={onClose}
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div
          className="trailer-embed-wrap"
          style={{ background: "#000", position: "relative" }}
        >
          {(statusMsg || failed) && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "#000",
                color: failed ? "#ff3860" : "rgba(255,255,255,0.6)",
                fontSize: 14,
                textAlign: "center",
                padding: "0 32px",
                gap: 10,
              }}
            >
              {failed ? (
                <>
                  <span style={{ fontSize: 28 }}>⚠</span>
                  <span>{statusMsg}</span>
                </>
              ) : (
                <>
                  <span style={{ opacity: 0.5 }}>⏳</span>
                  <span>{statusMsg}</span>
                </>
              )}
            </div>
          )}

          {currentSrc && (
            <webview
              ref={webviewRef}
              src={currentSrc}
              partition="persist:trailer"
              allowpopups="false"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: "none",
                opacity: statusMsg ? 0 : 1,
                transition: "opacity 0.2s",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
