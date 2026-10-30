// <tv-webview>: stand-in for Electron's <webview> tag (the JSX is retargeted
// in vite.config.mjs).
//
// Embedded players are never rendered inline. When the element gets a real
// src, the URL is handed to the native fullscreen player WebView; load events
// and executeJavaScript are forwarded between the two. BACK on the remote
// closes the native player and leaves this element as a "resume" tile, so the
// page's own overlay buttons (source picker etc.) stay reachable.
import { setGamepadFocus } from "../../src/utils/gamepadSpatialNav.js";

const bridge = window.AndroidTV || null;
const live = new Map(); // element id -> element
const pending = new Map(); // executeJavaScript call id -> resolve
let nextId = 1;
let nextCall = 1;

// Called from MainActivity / PlayerController via evaluateJavascript
window.__tvPlayer = {
  event(id, type, detail) {
    live.get(id)?._emit(type, detail || {});
  },
  result(callId, value) {
    const resolve = pending.get(callId);
    if (!resolve) return;
    pending.delete(callId);
    resolve(value ?? null);
  },
  closed(id) {
    live.get(id)?._closedByUser();
  },
  progress() {
    if (!bridge) return null;
    try {
      return JSON.parse(bridge.progress());
    } catch {
      return null;
    }
  },
};

const isBlank = (url) => !url || url === "about:blank";

class TvWebview extends HTMLElement {
  static get observedAttributes() {
    return ["src"];
  }

  constructor() {
    super();
    this._id = nextId++;
    this._src = "about:blank";
    this._currentUrl = "about:blank";
    this._openUrl = null; // URL the native player is showing for us
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display: block; background: #000; color: #ddd; }
        .tile { height: 100%; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 10px;
          font: 600 18px system-ui, sans-serif; }
        .play { font-size: 48px; line-height: 1; }
        small { font-weight: 400; opacity: .7; }
      </style>
      <div class="tile">
        <div class="play">&#9654;</div>
        <div>Press OK to resume the player</div>
        <small>BACK leaves this page</small>
      </div>`;
    this.addEventListener("click", () => this._open(true));
  }

  connectedCallback() {
    live.set(this._id, this);
    // Reachable by the D-pad spatial navigation
    if (!this.hasAttribute("tabindex")) this.setAttribute("tabindex", "0");
    this._sync();
  }

  disconnectedCallback() {
    live.delete(this._id);
    this._close();
  }

  attributeChangedCallback(_name, _old, value) {
    this._src = value || "about:blank";
    this._sync();
  }

  get src() {
    return this._src;
  }
  set src(value) {
    this.setAttribute("src", value || "about:blank");
  }

  _sync() {
    if (!this.isConnected) return;
    if (isBlank(this._src)) this._close();
    else this._open(false);
  }

  _open(force) {
    if (!bridge || isBlank(this._src)) return;
    if (!force && this._openUrl === this._src) return;
    this._openUrl = this._src;
    this._currentUrl = this._src;
    bridge.openPlayer(this._id, this._src, this.getAttribute("useragent") || "");
  }

  _close() {
    if (this._openUrl === null) return;
    this._openUrl = null;
    bridge?.closePlayer(this._id);
  }

  _closedByUser() {
    // Keep _openUrl so a re-render with the same src doesn't reopen it; OK
    // on the tile (click) forces a reopen.
    setGamepadFocus(this);
  }

  _emit(type, detail) {
    if (detail.url) this._currentUrl = detail.url;
    const ev = new Event(type);
    Object.assign(ev, detail);
    this.dispatchEvent(ev);
  }

  executeJavaScript(code) {
    code = String(code);
    // The desktop gamepad script polls the Gamepad API inside the guest; the
    // native player already maps the remote, so skip it.
    if (code.includes("__gamepad")) return Promise.resolve(null);
    // Progress queries only see the top frame; the native side tracks videos
    // in every frame, including cross-origin player iframes.
    if (code.includes("_seekTracked"))
      return Promise.resolve(window.__tvPlayer.progress());
    if (!bridge || this._openUrl === null) return Promise.resolve(null);
    return new Promise((resolve) => {
      const callId = nextCall++;
      pending.set(callId, resolve);
      bridge.exec(this._id, callId, code);
      setTimeout(() => {
        if (pending.delete(callId)) resolve(null);
      }, 8000);
    });
  }

  getWebContentsId() {
    return this._id;
  }
  getURL() {
    return this._currentUrl;
  }
  getTitle() {
    return "";
  }
  loadURL(url) {
    this.src = url;
    return Promise.resolve();
  }
  reload() {
    this._open(true);
  }
  isLoading() {
    return false;
  }
  canGoBack() {
    return false;
  }
  goBack() {}
  stop() {}
  focus() {
    HTMLElement.prototype.focus.call(this);
  }
  insertCSS() {
    return Promise.resolve("");
  }
  setAudioMuted() {}
  isAudioMuted() {
    return false;
  }
  setZoomFactor() {}
  send() {}
}

customElements.define("tv-webview", TvWebview);
