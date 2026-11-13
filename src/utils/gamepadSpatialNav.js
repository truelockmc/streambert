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
  ".episode-card",
  ".search-result",
  ".search-history-item",
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
  if (
    document.documentElement.dataset.tv === "1" &&
    (el.closest(".sidebar-saved") || el.closest(".sidebar-logo"))
  ) {
    return false;
  }
  // TV pages are long. Keep episodes and shelves focusable before they scroll in.
  const pad = document.documentElement.dataset.tv === "1" ? 20000 : 80;
  return rect.bottom > -pad && rect.top < window.innerHeight + pad;
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
  const keyboard = document.querySelector(".tv-keyboard");
  if (keyboard && isVisible(keyboard)) return keyboard;
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
    // The card itself is the target. Inner buttons (More, remove) stay out of the path.
    if (
      el.closest(".episode-card, .search-result, .search-history-item") &&
      !el.matches(".episode-card, .search-result, .search-history-item")
    ) {
      continue;
    }
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
  document.querySelectorAll(`.${FOCUS_CLASS}`).forEach((el) => {
    if (el !== currentEl) el.classList.remove(FOCUS_CLASS);
  });
}

export function setGamepadFocus(el, { scroll = true } = {}) {
  const page = document.querySelector(".main");
  const pageTop = page ? page.scrollTop : 0;
  clearHighlight();
  currentEl = el || null;
  if (!currentEl) return;
  currentEl.classList.add(FOCUS_CLASS);
  try {
    currentEl.focus?.({ preventScroll: true });
  } catch {}
  if (scroll) revealFocus(currentEl);
  else if (page && page.scrollTop !== pageTop) page.scrollTop = pageTop;
}

function revealFocus(el) {
  const page = el.closest(".main");
  let scrolledList = false;
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const scrolls =
      /(auto|scroll)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight + 8;
    if (scrolls && node !== page) {
      const elRect = el.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      if (elRect.top < box.top + 8 || elRect.bottom > box.bottom - 8) {
        node.scrollTop += elRect.top - box.top - 8;
      }
      scrolledList = true;
      break;
    }
    node = node.parentElement;
  }
  if (page && !scrolledList) {
    const elRect = el.getBoundingClientRect();
    const box = page.getBoundingClientRect();
    const hidden = elRect.top < box.top + 16 || elRect.bottom > box.bottom - 16;
      if (hidden) {
      page.scrollBy({
        top: elRect.top - box.top - box.height * 0.28,
        behavior: "auto",
      });
    }
  }
  const row = el.closest(".tv-shelf-row, .season-selector, .episodes-grid");
  if (row && row.scrollWidth > row.clientWidth + 8) {
    const elRect = el.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    if (elRect.left < box.left + 8 || elRect.right > box.right - 8) {
      row.scrollBy({
        left: elRect.left - box.left - 48,
        behavior: "auto",
      });
    }
  }
}

export function ensureFocusVisible() {
  if (currentEl && document.contains(currentEl)) revealFocus(currentEl);
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
  const eventInit = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent("mousedown", eventInit));
  el.dispatchEvent(new MouseEvent("mouseup", eventInit));
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
  if (document.documentElement.dataset.tv === "1") {
    const marked = candidates.find((el) => el.hasAttribute("data-tv-initial"));
    if (marked) return marked;
  }
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

function settingsPage() {
  if (document.documentElement.dataset.tv !== "1") return null;
  return document.querySelector(".settings-page");
}

/** Settings stays in its own column. Up and down never cross into the sidebar. */
function candidatesForMove(direction, from) {
  let candidates = getCandidates();
  const page = settingsPage();
  if (page) {
    if (!from) return candidates.filter((el) => page.contains(el));
    const inPage = page.contains(from);
    const inSidebar = !!from.closest(".sidebar");
    if (
      (inPage || inSidebar) &&
      (direction === "up" || direction === "down")
    ) {
      candidates = candidates.filter((el) =>
        inPage ? page.contains(el) : !!el.closest(".sidebar"),
      );
    }
  }
  return constrainEpisodeList(direction, from, candidates);
}

/**
 * A season row is horizontal, and episode cards are wide. Plain geometry
 * treats Down as "whatever center is lower", so Down from Season 1 lands on
 * Season 10 or the sidebar. Keep vertical moves inside the season the
 * screen is showing.
 */
function constrainEpisodeList(direction, from, candidates) {
  if (document.documentElement.dataset.tv !== "1" || !from) return candidates;
  const episodes = from.closest(".tv-episodes");
  if (!episodes) return candidates;
  const onSeason = !!from.closest(".season-btn");
  const onEpisode = !!from.closest(".episode-card");

  if (onSeason && (direction === "left" || direction === "right")) {
    return candidates.filter((el) => el.classList.contains("season-btn"));
  }
  if (onSeason && direction === "down") {
    return candidates.filter((el) => el.classList.contains("episode-card"));
  }
  if (onSeason && direction === "up") {
    return candidates.filter(
      (el) => !el.closest(".sidebar") && !el.closest(".tv-episodes"),
    );
  }
  if (onEpisode && direction === "down") {
    return candidates.filter((el) => el.classList.contains("episode-card"));
  }
  if (onEpisode && direction === "up") {
    const cards = candidates.filter((el) => el.classList.contains("episode-card"));
    const active = episodes.querySelector(".season-btn.active");
    if (active instanceof HTMLElement) cards.push(active);
    return cards;
  }
  if (direction === "up" || direction === "down") {
    return candidates.filter((el) => !el.closest(".sidebar"));
  }
  return candidates;
}

function pickInDirection(from, candidates, direction) {
  const fromRect = from.getBoundingClientRect();
  const fromCenter = {
    x: fromRect.left + fromRect.width / 2,
    y: fromRect.top + fromRect.height / 2,
  };
  const [dx, dy] = DIR_VECTOR[direction];
  const overlap = 16;
  const isPastEdge = (rect) => {
    if (direction === "down") return rect.top >= fromRect.bottom - overlap;
    if (direction === "up") return rect.bottom <= fromRect.top + overlap;
    if (direction === "right") return rect.left >= fromRect.right - overlap;
    if (direction === "left") return rect.right <= fromRect.left + overlap;
    return false;
  };

  let best = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    if (el === from) continue;
    const r = el.getBoundingClientRect();
    if (!isPastEdge(r)) continue;
    const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const vx = center.x - fromCenter.x;
    const vy = center.y - fromCenter.y;
    const primary = vx * dx + vy * dy;
    if (primary <= 0) continue;
    const perpendicular = Math.abs(vx * dy - vy * dx);
    const score = primary + perpendicular * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export function moveGamepadFocus(direction) {
  const from = getGamepadFocus();
  const candidates = candidatesForMove(direction, from);
  if (!from) {
    if (candidates.length === 0) return false;
    setGamepadFocus(pickInitial(candidates));
    return true;
  }
  if (candidates.length === 0) return false;

  let best = pickInDirection(from, candidates, direction);
  // The row above the seasons is Trailer, Cast, Favorite, Save. Geometry
  // would carry that button's column down onto Season 3. Down enters the
  // season that is already selected.
  if (
    direction === "down" &&
    best?.classList.contains("season-btn") &&
    !from.closest(".season-selector")
  ) {
    const active = document.querySelector(".tv-episodes .season-btn.active");
    if (active instanceof HTMLElement) best = active;
  }
  if (best) {
    setGamepadFocus(best);
    return true;
  }
  // Left from the first season or the episode list steps out to the sidebar.
  if (
    direction === "left" &&
    from.closest(".season-btn, .episode-card")
  ) {
    const side = pickInDirection(
      from,
      getCandidates().filter((el) => el.closest(".sidebar")),
      direction,
    );
    if (side) {
      setGamepadFocus(side);
      return true;
    }
  }
  return false;
}

export function ensureInitialFocus() {
  if (getGamepadFocus()) return;
  setGamepadFocus(pickInitial(getCandidates()));
}
