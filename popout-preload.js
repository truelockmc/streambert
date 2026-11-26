const { contextBridge, ipcRenderer } = require("electron");

// Expose controls to main (optional, for page scripts)
contextBridge.exposeInMainWorld("electronPopout", {
  minimize: () => ipcRenderer.invoke("popout-window-minimize"),
  close: () => ipcRenderer.invoke("popout-window-close"),
  toggleMaximize: () => ipcRenderer.invoke("popout-window-toggle-maximize"),
  isMaximized: () => ipcRenderer.invoke("popout-window-is-maximized"),
});

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const BAR_H = 32;

function css(el, styles) {
  Object.assign(el.style, styles);
}

const ICON_MINIMIZE =
  '<svg width="10" height="1" viewBox="0 0 10 1" fill="none">' +
  '<rect width="10" height="1" fill="currentColor"/></svg>';

const ICON_MAXIMIZE =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
  '<rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" stroke-width="1" fill="none"/></svg>';

const ICON_RESTORE =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
  '<rect x="2" y="0" width="8" height="8" rx="0.5" stroke="currentColor" stroke-width="1" fill="none"/>' +
  '<rect x="0" y="2" width="8" height="8" rx="0.5" stroke="currentColor" stroke-width="1" fill="none" style="fill:#0a0a0a"/></svg>';

const ICON_CLOSE =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
  '<line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/>' +
  '<line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>';

function makeTitlebarBtn(iconHtml, hoverBg, title, onClick) {
  const btn = document.createElement("button");
  css(btn, {
    width: "46px",
    height: "100%",
    background: "transparent",
    border: "none",
    cursor: "default",
    color: "rgba(255,255,255,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.15s, color 0.15s",
    flexShrink: "0",
    padding: "0",
    outline: "none",
  });
  btn.title = title;
  btn.innerHTML = iconHtml;
  btn.addEventListener("mouseenter", () => {
    btn.style.background = hoverBg;
    btn.style.color = "#fff";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "transparent";
    btn.style.color = "rgba(255,255,255,0.55)";
  });
  btn.addEventListener("click", onClick);
  return btn;
}

// ---------------------------------------------------------------------------
// Title bar injection
// ---------------------------------------------------------------------------

function injectTitlebar() {
  if (document.getElementById("__streambert_titlebar__")) return;

  // -- Bar -------------------------------------------------------------------
  const bar = document.createElement("div");
  bar.id = "__streambert_titlebar__";
  css(bar, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    height: BAR_H + "px",
    zIndex: "2147483647",
    background: "#0a0a0a",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    alignItems: "center",
    userSelect: "none",
    WebkitAppRegion: "drag",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    boxSizing: "border-box",
    opacity: "0",
    transform: "translateY(-100%)",
    transition: "opacity 0.2s, transform 0.2s",
    pointerEvents: "none",
  });

  // -- Label -----------------------------------------------------------------
  const label = document.createElement("div");
  css(label, {
    paddingLeft: "12px",
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "2px",
    color: "rgba(255,255,255,0.35)",
    flexGrow: "1",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  });
  label.textContent = "STREAMBERT";
  bar.appendChild(label);

  // -- Buttons ---------------------------------------------------------------
  const btns = document.createElement("div");
  css(btns, { display: "flex", height: "100%", WebkitAppRegion: "no-drag" });

  const minimizeBtn = makeTitlebarBtn(
    ICON_MINIMIZE,
    "rgba(255,255,255,0.08)",
    "Minimize",
    () => ipcRenderer.invoke("popout-window-minimize"),
  );
  const maximizeBtn = makeTitlebarBtn(
    ICON_MAXIMIZE,
    "rgba(255,255,255,0.08)",
    "Maximize",
    () => ipcRenderer.invoke("popout-window-toggle-maximize"),
  );
  const closeBtn = makeTitlebarBtn(
    ICON_CLOSE,
    "rgba(229,9,20,0.85)",
    "Close",
    () => ipcRenderer.invoke("popout-window-close"),
  );

  btns.appendChild(minimizeBtn);
  btns.appendChild(maximizeBtn);
  btns.appendChild(closeBtn);
  bar.appendChild(btns);

  // DOM writes only happen on actual state transitions.
  let visible = false;
  let hideTimer = null;

  const showBar = () => {
    clearTimeout(hideTimer);
    if (!visible) {
      visible = true;
      bar.style.opacity = "1";
      bar.style.transform = "translateY(0)";
      bar.style.pointerEvents = "auto";
      // Disable sensor while bar is visible so it doesn't block bar interactions
      sensor.style.pointerEvents = "none";
    }
    hideTimer = setTimeout(hideBar, 2500);
  };

  const hideBar = () => {
    if (visible) {
      visible = false;
      bar.style.opacity = "0";
      bar.style.transform = "translateY(-100%)";
      bar.style.pointerEvents = "none";
      // "Re-arm" sensor so the next entry is caught
      sensor.style.pointerEvents = "all";
    }
  };

  // Keep bar visible while cursor rests on it
  bar.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  bar.addEventListener("mouseleave", () => {
    hideTimer = setTimeout(hideBar, 2500);
  });

  // -- Trigger sensor --------------------------------------------------------
  // iframes swallow mousemove so document.mousemove is unreliable when the
  // cursor enters from outside the window. A fixed transparent strip with a
  // higher stacking context than the iframes catches the entry properly.
  const sensor = document.createElement("div");
  sensor.id = "__streambert_sensor__";
  css(sensor, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    height: BAR_H + "px",
    zIndex: "2147483646", // one below bar
    pointerEvents: "all",
    background: "transparent",
  });
  sensor.addEventListener("mouseenter", showBar);

  // Fallback: catch movement in the main frame (non-iframe areas)
  document.addEventListener("mousemove", showBar);

  // -- Mount -----------------------------------------------------------------
  if (document.body) {
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.appendChild(sensor);
  }

  // Show briefly on load
  showBar();

  ipcRenderer.invoke("popout-window-is-maximized").then((isMax) => {
    applyMaximizeIcon(maximizeBtn, isMax);
  });
  ipcRenderer.on("popout-window-maximized", (_, isMax) => {
    applyMaximizeIcon(maximizeBtn, isMax);
  });

  function applyMaximizeIcon(btn, isMax) {
    btn.title = isMax ? "Restore" : "Maximize";
    btn.innerHTML = isMax ? ICON_RESTORE : ICON_MAXIMIZE;
  }
}

// ---------------------------------------------------------------------------
// Boot & SPA navigation detection
// ---------------------------------------------------------------------------

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectTitlebar);
} else {
  injectTitlebar();
}

// Detect SPA navigations by patching history API
let _lastUrl = location.href;
const _onNav = () => {
  if (location.href !== _lastUrl) {
    _lastUrl = location.href;
    setTimeout(injectTitlebar, 50);
  }
};
const _origPush = history.pushState.bind(history);
const _origReplace = history.replaceState.bind(history);
history.pushState = (...a) => {
  _origPush(...a);
  _onNav();
};
history.replaceState = (...a) => {
  _origReplace(...a);
  _onNav();
};
window.addEventListener("popstate", _onNav);
