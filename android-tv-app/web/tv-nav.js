// TV remote navigation. Reuses the desktop app's gamepad spatial navigation
// (src/utils/gamepadSpatialNav.js) for the D-pad.
//
//   Arrows   move the focus ring between cards/buttons/inputs
//   OK       MainActivity calls window.__tvOk(): click, or open the keyboard
//            on a text field
//   BACK     MainActivity calls window.__tvBack(): close keyboard/modal,
//            else navigate back (App.jsx binds Ctrl+Z to navigateBack)
import {
  moveGamepadFocus,
  dismissActiveOverlay,
  ensureInitialFocus,
  getGamepadFocus,
  setGamepadFocus,
} from "../../src/utils/gamepadSpatialNav.js";

const bridge = window.AndroidTV || null;
const DIRS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "range",
  "button",
  "submit",
  "reset",
  "color",
  "file",
]);

function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && !NON_TEXT_INPUTS.has(el.type);
}

// Let Left/Right move the caret until it reaches the edge of the text
function caretCanMove(el, dir) {
  if (dir !== "left" && dir !== "right") return false;
  let start;
  let end;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    return false;
  }
  if (start == null) return false;
  return dir === "left" ? start > 0 : end < (el.value || "").length;
}

function scrollParent(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (/(auto|scroll)/.test(overflowY) && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

const inSidebar = (el) => !!el?.closest(".sidebar");

// Pagination dots and similar pixel-sized controls win the nav's distance
// scoring but are useless (and nearly invisible) from the couch.
function ignoreTinyTargets() {
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    if (el.hasAttribute("data-gamepad-ignore")) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.width < 12 && r.height < 12)
      el.setAttribute("data-gamepad-ignore", "");
  }
}

// Move from `from` while the sidebar is excluded; returns the new focus or null
function moveWithinContent(from, dir) {
  const sidebar = document.querySelector(".sidebar");
  sidebar?.setAttribute("data-gamepad-ignore", "");
  try {
    setGamepadFocus(from, { scroll: false });
    moveGamepadFocus(dir);
  } finally {
    sidebar?.removeAttribute("data-gamepad-ignore");
  }
  const next = getGamepadFocus();
  return next && next !== from ? next : null;
}

// Up/Down within the content shouldn't jump into the sidebar: the nav's
// scoring prefers its nearby buttons over the next row of a wide carousel,
// and it only considers elements within ~80px of the viewport. Retry without
// the sidebar, then after scrolling toward the pressed direction.
function moveVertical(dir) {
  const from = getGamepadFocus();
  moveGamepadFocus(dir);
  const to = getGamepadFocus();
  if (!from || inSidebar(from) || (to !== from && !inSidebar(to))) return;
  if (moveWithinContent(from, dir)) return;
  const scroller = scrollParent(from);
  if (!scroller) {
    setGamepadFocus(to);
    return;
  }

  const r = from.getBoundingClientRect();
  const h = scroller.clientHeight;
  // Scroll up to most of a screen, keeping `from` within the nav's 80px
  // off-screen allowance so it can still be navigated from
  const delta =
    dir === "down"
      ? Math.min(h * 0.9, r.bottom + 40)
      : -Math.min(h * 0.9, h - r.top + 40);
  const before = scroller.scrollTop;
  scroller.scrollBy({ top: delta, behavior: "instant" });
  const next = scroller.scrollTop !== before && moveWithinContent(from, dir);
  if (next) {
    setGamepadFocus(next);
  } else {
    // Nothing further that way: undo the scroll, keep the sidebar move
    scroller.scrollTop = before;
    setGamepadFocus(to);
  }
}

function activate(el) {
  if (isTextField(el)) {
    el.focus();
    bridge?.showKeyboard();
  } else {
    el.click();
  }
}

window.addEventListener(
  "keydown",
  (e) => {
    const active = document.activeElement;
    const dir = DIRS[e.key];
    if (dir) {
      if (isTextField(active) && caretCanMove(active, dir)) return;
      e.preventDefault();
      e.stopPropagation();
      ignoreTinyTargets();
      if (dir === "up" || dir === "down") moveVertical(dir);
      else moveGamepadFocus(dir);
      const focused = getGamepadFocus();
      if (active && active !== focused && isTextField(active)) active.blur();
      return;
    }
    // Hardware keyboard Enter; the remote's OK button arrives via __tvOk
    if (e.key === "Enter" && !isTextField(active)) {
      const el = getGamepadFocus();
      if (el) {
        e.preventDefault();
        activate(el);
      }
    }
  },
  true,
);

window.__tvOk = () => {
  const el = getGamepadFocus();
  if (el) activate(el);
  else ensureInitialFocus();
};

// Returns true if something handled the press, false when there was nothing
// left to go back to (MainActivity then offers to exit).
window.__tvBack = () => {
  const active = document.activeElement;
  if (isTextField(active)) {
    active.blur();
    const el = getGamepadFocus();
    if (el) setGamepadFocus(el, { scroll: false });
    return true;
  }
  if (dismissActiveOverlay()) return true;
  const root = document.getElementById("root");
  const before = root ? root.innerHTML.length : 0;
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
  );
  return new Promise((resolve) =>
    setTimeout(() => {
      const after = root ? root.innerHTML.length : 0;
      const handled = after !== before;
      if (!handled) bridge?.backUnhandled();
      resolve(handled);
    }, 250),
  );
};
