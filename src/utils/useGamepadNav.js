import { useEffect, useRef, useState } from "react";
import { BTN, useGamepadLoop } from "./gamepad";
import {
  moveGamepadFocus,
  confirmGamepadFocus,
  dismissActiveOverlay,
  ensureInitialFocus,
  clearGamepadFocus,
} from "./gamepadSpatialNav";
import { isPlayerGamepadActive } from "./gamepadPlayerState";

/**
 * App-wide gamepad → UI navigation. Mount once near the root (App.jsx).
 *
 *  D-pad / left stick  → move focus between cards, buttons, links
 *  A (Xbox) / Cross    → activate the focused element
 *  B (Xbox) / Circle   → close the open modal, else navigate back
 *  Start                → open search
 *
 * Automatically no-ops whenever a video is playing, since the webview
 * takes over gamepad input for playback controls at that point. When
 * `enabled` is false (the "controller support" setting is off), no
 * requestAnimationFrame poll loop runs at all.
 */
export function useGamepadNav({ enabled, onBack, onOpenSearch }) {
  const [connected, setConnected] = useState(false);

  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const onOpenSearchRef = useRef(onOpenSearch);
  onOpenSearchRef.current = onOpenSearch;

  useGamepadLoop(
    {
      onConnectionChange: setConnected,
      onDirection: (dir) => {
        ensureInitialFocus();
        moveGamepadFocus(dir);
      },
      onButtonDown: (i) => {
        if (i === BTN.A) {
          ensureInitialFocus();
          confirmGamepadFocus();
        } else if (i === BTN.B) {
          if (!dismissActiveOverlay()) onBackRef.current?.();
        } else if (i === BTN.START) {
          onOpenSearchRef.current?.();
        }
      },
    },
    () => !isPlayerGamepadActive(),
    enabled, // gate the whole requestAnimationFrame poll loop, not just dispatch
  );

  useEffect(() => {
    if (!enabled) {
      clearGamepadFocus();
      setConnected(false);
    }
  }, [enabled]);

  return { connected };
}
