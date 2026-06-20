import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldBlockIcon } from "./Icons";

const DEFAULT_UNLOCK_MS = 15000;

export function useWebPlayerGuard(
  resetKey,
  { enabled = true, unlockMs = DEFAULT_UNLOCK_MS } = {},
) {
  const [unlocked, setUnlocked] = useState(false);
  const timerRef = useRef(null);

  const clearUnlockTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const lock = useCallback(() => {
    clearUnlockTimer();
    setUnlocked(false);
  }, [clearUnlockTimer]);

  const unlock = useCallback(() => {
    if (!enabled) return;
    clearUnlockTimer();
    setUnlocked(true);
    timerRef.current = setTimeout(() => setUnlocked(false), unlockMs);
  }, [clearUnlockTimer, enabled, unlockMs]);

  useEffect(() => {
    lock();
  }, [enabled, lock, resetKey]);

  useEffect(() => () => clearUnlockTimer(), [clearUnlockTimer]);

  return {
    enabled,
    unlocked: enabled && unlocked,
    lock,
    unlock,
  };
}

export default function WebPlayerGuard({ hidden, unlocked, onUnlock, onLock }) {
  if (hidden) return null;

  return (
    <div
      className={`web-player-guard${unlocked ? " web-player-guard--unlocked" : ""}`}
    >
      <button
        type="button"
        className="player-overlay-btn player-overlay-btn--static web-player-guard__button"
        onClick={unlocked ? onLock : onUnlock}
        aria-label={unlocked ? "Lock player controls" : "Enable player controls"}
      >
        <ShieldBlockIcon />
        {unlocked ? "Lock player" : "Enable controls"}
      </button>
    </div>
  );
}
