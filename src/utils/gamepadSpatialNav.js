// Generic spatial navigation over whatever's currently in the DOM. Works
// without touching individual pages/components. It just looks at real
// interactive elements (cards, buttons, links, inputs) and moves a virtual
// "gamepad focus" between them based on on-screen geometry.
//
// Add `data-gamepad-ignore` to any container to exclude it (and everything
// inside it) from navigation. Add `data-gamepad-close` to a modal's
// close/cancel button so the B button can find it reliably.

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  '[role="button"]:not([aria-disabled="true"])',
  ".card",
  ".sidebar-btn",
  '[tabindex]:not([tabindex="-1"])',
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
].join(",");

const FOCUS_CLASS = "gamepad-focused";

let currentEl = null;

function isVisible(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.closest("[data-gamepad-ignore]")) return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (el.offsetParent === null && style.position !== "fixed") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  // Allow a little overscroll so off-screen-but-scrollable items still count.
  return rect.bottom > -80 && rect.top < window.innerHeight + 80;
}

const CLICKABLE_CURSORS = new Set(["pointer", "grab"]);

function collectPointerRoots(root) {
  const nodes = root.querySelectorAll(
    "div, span, li, article, section, figure",
  );
  const out = [];
  for (const el of nodes) {
    if (!CLICKABLE_CURSORS.has(getComputedStyle(el).cursor)) continue;
    const parent = el.parentElement;
    if (parent && CLICKABLE_CURSORS.has(getComputedStyle(parent).cursor))
      continue;
    if (!isVisible(el)) continue;
    out.push(el);
  }
  return out;
}

function isModalRoot(el) {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  if (style.position !== "fixed") return false;
  const rect = el.getBoundingClientRect();
  // Must cover (most of) the viewport, not just be a small fixed element.
  return rect.width >= window.innerWidth * 0.6 &&
    rect.height >= window.innerHeight * 0.6;
}

function getScopeRoot() {
  const overlays = Array.from(
    document.querySelectorAll('[class*="overlay"]'),
  ).filter((el) => isVisible(el) && isModalRoot(el));
  if (overlays.length === 0) return document;
  return overlays[overlays.length - 1];
}

function getCandidates() {
  const root = getScopeRoot();
  const semantic = root.querySelectorAll(FOCUSABLE_SELECTOR);
  const pointerRoots = collectPointerRoots(root);
  const seen = new Set();
  const out = [];
  for (const el of semantic) {
    if (!isVisible(el) || seen.has(el)) continue;
    seen.add(el);
    out.push(el);
  }
  for (const el of pointerRoots) {
    if (seen.has(el)) continue;
    seen.add(el);
    out.push(el);
  }
  return out;
}

function clearHighlight() {
  currentEl?.classList.remove(FOCUS_CLASS);
}

export function setGamepadFocus(el, { scroll = true } = {}) {
  clearHighlight();
  currentEl = el || null;
  if (!currentEl) return;
  currentEl.classList.add(FOCUS_CLASS);
  try {
    currentEl.focus?.({ preventScroll: true });
  } catch {}
  if (scroll) {
    currentEl.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }
}

export function getGamepadFocus() {
  return currentEl && document.contains(currentEl) ? currentEl : null;
}

export function clearGamepadFocus() {
  clearHighlight();
  currentEl = null;
}

export function confirmGamepadFocus() {
  const el = getGamepadFocus();
  if (!el) return false;
  el.click();
  return true;
}

// Best-effort dismiss for the B button while a modal is open. Returns false
// if there's nothing to dismiss, so the caller can fall back to page-back.
export function dismissActiveOverlay() {
  const root = getScopeRoot();
  if (root === document) return false;
  const closeBtn = root.querySelector(
    '[data-gamepad-close], [aria-label="Close" i], .modal-close, .close-btn',
  );
  if (closeBtn instanceof HTMLElement) {
    closeBtn.click();
    return true;
  }
  if (root instanceof HTMLElement) {
    // Most overlays here close on a click of the backdrop itself (the inner
    // panel stops propagation), so clicking the root is a safe fallback.
    root.click();
    return true;
  }
  return false;
}

function pickInitial(candidates) {
  if (candidates.length === 0) return null;
  let best = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const score = Math.max(0, r.top) * 2 + Math.max(0, r.left);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

const DIR_VECTOR = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export function moveGamepadFocus(direction) {
  const candidates = getCandidates();
  if (candidates.length === 0) return;

  const from = getGamepadFocus();
  if (!from || !candidates.includes(from)) {
    setGamepadFocus(pickInitial(candidates));
    return;
  }

  const fromRect = from.getBoundingClientRect();
  const fromCenter = {
    x: fromRect.left + fromRect.width / 2,
    y: fromRect.top + fromRect.height / 2,
  };
  const [dx, dy] = DIR_VECTOR[direction];

  let best = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    if (el === from) continue;
    const r = el.getBoundingClientRect();
    const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const vx = center.x - fromCenter.x;
    const vy = center.y - fromCenter.y;
    // Candidate must lie (at least a bit) in the pressed direction.
    const primary = vx * dx + vy * dy;
    if (primary <= 0) continue;
    // Penalise perpendicular drift so rows/columns feel straight rather
    // than jumping diagonally to the nearest raw-distance element.
    const perpendicular = Math.abs(vx * dy - vy * dx);
    const score = primary + perpendicular * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (best) setGamepadFocus(best);
}

export function ensureInitialFocus() {
  if (getGamepadFocus()) return;
  setGamepadFocus(pickInitial(getCandidates()));
}
