const STORAGE_KEY = "streambert_tv";

/** Fire TV Stick / Fire TV Silk. The remote drives a cursor, not arrow keys. */
export function isFireTv() {
  const ua = navigator.userAgent || "";
  return /AFT[A-Z0-9]+/.test(ua) || (/Silk\//.test(ua) && /Android/.test(ua));
}

/** Turn TV mode on from `?tv=1`, off from `?tv=0`, and remember the choice. */
export function bootTvMode() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("tv");
  const fire = isFireTv();
  document.documentElement.dataset.fire = fire ? "1" : "0";
  let on;
  if (query === "1") on = true;
  else if (query === "0") on = false;
  else if (fire) on = true;
  else {
    try {
      on = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      on = false;
    }
  }
  try {
    if (on && (query === "1" || fire)) localStorage.setItem(STORAGE_KEY, "1");
    else if (query === "0") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
  document.documentElement.dataset.tv = on ? "1" : "0";
  fitTvViewport();
  return on;
}

// Locked from the first reading. Applying the viewport changes innerWidth,
// and on some WebViews it also changes devicePixelRatio, which would loop.
let firePixelRatio = 0;

function viewportTag() {
  return document.querySelector('meta[name="viewport"]');
}

function setViewport(content) {
  const tag = viewportTag();
  if (!tag || tag.content === content) return;
  tag.setAttribute("content", content);
}

/**
 * The Fire TV WebView lays the app out in density pixels (960×540 on a 1080p
 * Stick) and stretches that to the panel, so every control is about 2× too big.
 * Lay the UI out just above the panel's real pixels so type stays readable
 * from the couch. The video is a second WebView and is not part of this
 * page, so playback stays full screen.
 */
const FIRE_UI_SCALE = 1.15;

function fitFireResolution(root) {
  if (!firePixelRatio) firePixelRatio = window.devicePixelRatio || 1;
  const screenH = window.screen.height || window.innerHeight || 0;
  root.dataset.tvRes = String(Math.round(screenH * firePixelRatio));
  root.style.zoom = "";
  // Search stays at the pre-scale size. 1 CSS px used to be `dpr` physical
  // pixels; the rest of the UI is now `FIRE_UI_SCALE` physical pixels.
  root.style.setProperty(
    "--tv-restore",
    (firePixelRatio / FIRE_UI_SCALE).toFixed(3),
  );
  if (firePixelRatio <= 1.05) {
    root.style.setProperty("--tv-restore", "1");
    setViewport("width=device-width, initial-scale=1");
    return;
  }
  const scale = Math.min(1, FIRE_UI_SCALE / firePixelRatio).toFixed(3);
  setViewport(
    `width=device-width, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, user-scalable=no`,
  );
}

/** Scale the 1080p layout to the panel. 720p shrinks a little, 4K grows a little. */
export function fitTvViewport() {
  const root = document.documentElement;
  if (root.dataset.tv !== "1") {
    root.style.zoom = "";
    root.style.removeProperty("--tv-restore");
    delete root.dataset.tvRes;
    firePixelRatio = 0;
    setViewport("width=device-width, initial-scale=1.0");
    return;
  }
  if (root.dataset.fire === "1") {
    fitFireResolution(root);
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const cssH = window.innerHeight || 0;
  const screenH = window.screen.height || cssH;
  const physicalH = screenH > cssH * 1.25 ? screenH : Math.round(screenH * dpr);
  const scale = Math.min(1.25, Math.max(0.85, physicalH / 1080));
  root.dataset.tvRes = String(physicalH);
  root.style.zoom = Math.abs(scale - 1) < 0.02 ? "" : scale.toFixed(3);
}

export function isTvMode() {
  return document.documentElement.dataset.tv === "1";
}
