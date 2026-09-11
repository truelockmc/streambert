// Used by:
//  - useGamepadNav.js        → app-wide D-pad/stick menu navigation
//  - the gamepad script injected into the <webview> player (see
//    playerGamepadScript.js) which polls navigator.getGamepads() inside the
//    guest document the same way, just without React.
//
// Standard Gamepad mapping button indices. Covers Xbox, PlayStation and any
// generic controller Chromium reports as "standard".
import { useEffect, useRef } from "react";

export const BTN = {
  A: 0, // Xbox A / PS Cross
  B: 1, // Xbox B / PS Circle
  X: 2, // Xbox X / PS Square
  Y: 3, // Xbox Y / PS Triangle
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8, // Xbox "View" / PS Share
  START: 9, // Xbox "Menu" / PS Options
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  HOME: 16,
};

const AXIS_DEADZONE = 0.45;
const DIR_REPEAT_DELAY = 420; // ms a direction must be held before it repeats
const DIR_REPEAT_RATE = 140; // ms between repeats while held

function readFirstPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected !== false) return p;
  return null;
}

/**
 * Starts a requestAnimationFrame poll loop for the first connected gamepad.
 * Returns a `stop()` function to tear the loop down.
 *
 * @param {object} handlers
 *   onButtonDown(buttonIndex)
 *   onButtonUp(buttonIndex)
 *   onDirection('up'|'down'|'left'|'right')  fires on press + auto-repeat
 *   onConnectionChange(connected)
 * @param {() => boolean} [isActive] gate re-checked every frame; button/dir
 *   edges are only dispatched while it returns true (connection state is
 *   still tracked regardless, so a UI can show "controller connected").
 */
export function startGamepadLoop(handlers, isActive) {
  const { onButtonDown, onButtonUp, onDirection, onConnectionChange } =
    handlers;
  let raf = null;
  let prevButtons = [];
  let wasConnected = false;
  let dirState = null; // { dir, next }

  const markConnected = (v) => {
    if (wasConnected === v) return;
    wasConnected = v;
    onConnectionChange?.(v);
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const pad = readFirstPad();

    if (!pad) {
      markConnected(false);
      prevButtons = [];
      dirState = null;
      return;
    }
    markConnected(true);

    const active = isActive ? isActive() : true;

    // ── Buttons ──────────────────────────────────────────────────────────
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      const pressed = !!b?.pressed || (b?.value || 0) > 0.5;
      const wasPressed = !!prevButtons[i];
      if (active && pressed && !wasPressed) onButtonDown?.(i);
      if (active && !pressed && wasPressed) onButtonUp?.(i);
      prevButtons[i] = pressed;
    }

    // ── D-pad + left stick → direction, with delay + repeat while held ────
    const lx = pad.axes[0] || 0;
    const ly = pad.axes[1] || 0;
    let dir = null;
    if (pad.buttons[BTN.UP]?.pressed || ly < -AXIS_DEADZONE) dir = "up";
    else if (pad.buttons[BTN.DOWN]?.pressed || ly > AXIS_DEADZONE)
      dir = "down";
    else if (pad.buttons[BTN.LEFT]?.pressed || lx < -AXIS_DEADZONE)
      dir = "left";
    else if (pad.buttons[BTN.RIGHT]?.pressed || lx > AXIS_DEADZONE)
      dir = "right";

    const now = performance.now();
    if (dir) {
      if (!dirState || dirState.dir !== dir) {
        dirState = { dir, next: now + DIR_REPEAT_DELAY };
        if (active) onDirection?.(dir);
      } else if (now >= dirState.next) {
        dirState.next = now + DIR_REPEAT_RATE;
        if (active) onDirection?.(dir);
      }
    } else {
      dirState = null;
    }
  };

  raf = requestAnimationFrame(tick);

  return function stop() {
    if (raf) cancelAnimationFrame(raf);
  };
}

/**
 * React hook wrapper around startGamepadLoop. Handlers/isActive are read
 * from refs each frame so callers don't need to memoize them.
 *
 * @param {boolean} [enabled=true]
 */
export function useGamepadLoop(handlers, isActive, enabled = true) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  useEffect(() => {
    if (!enabled) return;
    const stop = startGamepadLoop(
      {
        onButtonDown: (i) => handlersRef.current.onButtonDown?.(i),
        onButtonUp: (i) => handlersRef.current.onButtonUp?.(i),
        onDirection: (d) => handlersRef.current.onDirection?.(d),
        onConnectionChange: (c) =>
          handlersRef.current.onConnectionChange?.(c),
      },
      () => (isActiveRef.current ? isActiveRef.current() : true),
    );
    return stop;
  }, [enabled]);
}
