import { useEffect, useRef } from "react";
import {
  clearGamepadFocus,
  confirmGamepadFocus,
  dismissActiveOverlay,
  ensureInitialFocus,
  getGamepadFocus,
  moveGamepadFocus,
  setGamepadFocus,
  ensureFocusVisible,
} from "./gamepadSpatialNav";
import { isFireTv } from "./tvMode";
import {
  closeTvKeyboard,
  isTvKeyboardOpen,
  requestTvKeyboard,
} from "../components/TvKeyboard";

const ARROWS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const KEYBOARD_COMMANDS = {
  MediaRewind: "delete",
  MediaFastForward: "space",
  MediaPlayPause: "charset",
  ContextMenu: "caps",
};

function isTopKeyboardRow() {
  const focused = getGamepadFocus();
  const row = focused?.closest?.(".tv-keyboard__row");
  const first = document.querySelector(".tv-keyboard__row");
  return !!row && row === first;
}

function isTextField(target) {
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement) || target.disabled) return false;
  const type = (target.type || "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "radio",
    "range",
    "color",
    "file",
    "submit",
    "reset",
    "image",
    "hidden",
  ].includes(type);
}

function openEmbeddedKeyboard(field) {
  if (!isTextField(field)) return;
  field.setAttribute("inputmode", "none");
  field.setAttribute("autocomplete", "off");
  field.blur();
  requestTvKeyboard(field);
}

function isBackKey(event) {
  return (
    event.key === "Escape" ||
    event.key === "GoBack" ||
    event.key === "BrowserBack" ||
    event.key === "XF86Back" ||
    event.key === "Backspace" ||
    event.keyCode === 4 ||
    event.keyCode === 461
  );
}

function isPlayKey(event) {
  return (
    event.key === "MediaPlayPause" ||
    event.key === "MediaPlay" ||
    event.key === "MediaPause" ||
    event.keyCode === 179
  );
}

/**
 * Fire TV / keyboard remote for `?tv=1`.
 * Arrows move a focus ring, Enter activates it, Back closes the player,
 * then a modal, then the previous screen.
 */
export function useTvRemote({ enabled, onBack, navStackRef }) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const lastBackAt = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    const performBack = () => {
      const now = Date.now();
      if (now - lastBackAt.current < 450) return;
      lastBackAt.current = now;
      if (closeTvKeyboard()) return;
      if (dismissActiveOverlay()) return;
      const playerEvent = new CustomEvent("streambert:tv-back", {
        cancelable: true,
      });
      window.dispatchEvent(playerEvent);
      if (playerEvent.defaultPrevented) return;
      onBackRef.current?.();
    };

    const pointerMode = isFireTv() && !window.StreambertTv;
    let syntheticClick = false;
    let anchor = null;
    let lastNavAt = 0;

    const stepFocus = (direction) => {
      const now = Date.now();
      if (now - lastNavAt < 160) return null;
      lastNavAt = now;
      ensureInitialFocus();
      const moved = moveGamepadFocus(direction) === true;
      window.dispatchEvent(new Event("streambert:tv-moved"));
      return moved;
    };

    const activateFocused = () => {
      syntheticClick = true;
      try {
        ensureInitialFocus();
        confirmGamepadFocus();
        window.dispatchEvent(new Event("streambert:tv-moved"));
      } finally {
        syntheticClick = false;
      }
    };

    // Silk moves a mouse cursor with the D-pad instead of sending arrow keys.
    const onMouseMove = (event) => {
      if (!pointerMode) return;
      if (anchor == null) {
        anchor = { x: event.clientX, y: event.clientY };
        return;
      }
      const dx = event.clientX - anchor.x;
      const dy = event.clientY - anchor.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 320) {
        anchor = { x: event.clientX, y: event.clientY };
        return;
      }
      if (distance < 28) return;
      const direction =
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? "right"
            : "left"
          : dy > 0
            ? "down"
            : "up";
      if (stepFocus(direction)) anchor = { x: event.clientX, y: event.clientY };
    };

    const onClick = (event) => {
      if (isTextField(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        openEmbeddedKeyboard(event.target);
        return;
      }
      if (!pointerMode || syntheticClick) return;
      const focused = getGamepadFocus();
      if (
        focused &&
        (focused === event.target || focused.contains(event.target))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activateFocused();
    };

    const onKeyDown = (event) => {
      const field = isTextField(event.target)
        ? event.target
        : isTextField(getGamepadFocus())
          ? getGamepadFocus()
          : null;
      const direction = ARROWS[event.key];

      if (isTvKeyboardOpen()) {
        if (direction === "up" && isTopKeyboardRow()) {
          event.preventDefault();
          event.stopPropagation();
          const option = document.querySelector(
            ".search-result, .search-history-item",
          );
          closeTvKeyboard(option instanceof HTMLElement ? option : undefined);
          return;
        }
        if (direction) {
          event.preventDefault();
          event.stopPropagation();
          stepFocus(direction);
          return;
        }
        const command = KEYBOARD_COMMANDS[event.key];
        if (command) {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("streambert:keyboard-command", { detail: command }),
          );
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          activateFocused();
        } else if (isBackKey(event)) {
          event.preventDefault();
          event.stopPropagation();
          closeTvKeyboard();
        }
        return;
      }

      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        stepFocus(direction);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (field) openEmbeddedKeyboard(field);
        else activateFocused();
        return;
      }

      if (isPlayKey(event)) {
        event.preventDefault();
        const play = document.querySelector("[data-tv-play], [data-tv-initial]");
        if (play instanceof HTMLElement) play.click();
        return;
      }

      if (isBackKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        performBack();
      }
    };

    const onPopState = () => {
      performBack();
      const stillInside =
        (navStackRef?.current?.length || 0) > 0 ||
        !!document.querySelector(".player-wrap");
      if (stillInside) history.pushState({ streambertTv: 1 }, "");
    };

    window.StreambertTv?.setTextFieldFocused?.(false);
    window.StreambertTv?.hideKeyboard?.();

    if (history.state?.streambertTv !== 1) {
      history.pushState({ streambertTv: 1 }, "");
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    const onFocusIn = (event) => {
      if (!isTextField(event.target)) return;
      event.target.setAttribute("inputmode", "none");
      window.StreambertTv?.setTextFieldFocused?.(false);
      window.StreambertTv?.hideKeyboard?.();
    };
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("focusin", onFocusIn);
      closeTvKeyboard();
      window.StreambertTv?.hideKeyboard?.();
    };
  }, [enabled, navStackRef]);

  useEffect(() => {
    if (!enabled) {
      clearGamepadFocus();
      return undefined;
    }

    let lockedTo = null;
    let timer;
    const place = () => {
      if (isTvKeyboardOpen()) return;
      const modalInput = document.querySelector(
        ".modal-overlay input, .modal-overlay textarea",
      );
      if (modalInput instanceof HTMLElement) {
        const focused = getGamepadFocus();
        if (!focused?.closest(".modal-overlay")) {
          lockedTo = modalInput;
          setGamepadFocus(modalInput, { scroll: false });
          modalInput.focus();
        }
        return;
      }
      const marked = document.querySelector("[data-tv-initial]");
      if (marked instanceof HTMLElement) {
        const previousGone = !lockedTo || !document.contains(lockedTo);
        if (marked !== lockedTo && previousGone) {
          lockedTo = marked;
          setGamepadFocus(marked, { scroll: true });
        }
        ensureFocusVisible();
        return;
      }
      if (!getGamepadFocus()) ensureInitialFocus();
      ensureFocusVisible();
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(place, 50);
    };
    const onMoved = () => {
      lockedTo = getGamepadFocus();
    };

    schedule();
    const root = document.getElementById("root") || document.body;
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener("streambert:tv-moved", onMoved);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("streambert:tv-moved", onMoved);
      clearGamepadFocus();
    };
  }, [enabled]);
}
