import { useState, useEffect, useRef, useCallback } from "react";
import { storage, STORAGE_KEYS } from "./storage";

const _todayForEpisodes = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

export function useAutoplay({ nextEp, playEpisode, restricted }) {
  const [autoplayCountdown, setAutoplayCountdown] = useState(null);
  const countdownIntervalRef = useRef(null);
  const countdownStartedRef = useRef(false);

  // Keep references to nextEp and playEpisode up-to-date
  const nextEpRef = useRef(nextEp);
  useEffect(() => {
    nextEpRef.current = nextEp;
  }, [nextEp]);

  const playEpisodeRef = useRef(playEpisode);
  useEffect(() => {
    playEpisodeRef.current = playEpisode;
  }, [playEpisode]);

  const cancelAutoplay = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoplayCountdown(null);
  }, []);

  const triggerAutoplay = useCallback(() => {
    // Read fresh setting from storage
    const isEnabled = storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_ENABLED) ?? true;
    if (!isEnabled) return;

    const currentNextEp = nextEpRef.current;
    if (!currentNextEp) return;

    const epUnreleased = currentNextEp.air_date
      ? new Date(currentNextEp.air_date) > _todayForEpisodes
      : false;
    if (restricted || epUnreleased) return;

    const duration = storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_DURATION) ?? 5;

    cancelAutoplay(); // Clear any existing active timer

    if (duration === 0) {
      // 0 means manual only: show the overlay, but do not play automatically
      setAutoplayCountdown(0);
    } else {
      setAutoplayCountdown(duration);
      countdownIntervalRef.current = setInterval(() => {
        setAutoplayCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
            if (playEpisodeRef.current && nextEpRef.current) {
              playEpisodeRef.current(nextEpRef.current);
            }
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    }
  }, [restricted, cancelAutoplay]);

  const playNow = useCallback(() => {
    cancelAutoplay();
    if (playEpisodeRef.current && nextEpRef.current) {
      playEpisodeRef.current(nextEpRef.current);
    }
  }, [cancelAutoplay]);

  const resetAutoplay = useCallback(() => {
    cancelAutoplay();
    countdownStartedRef.current = false;
  }, [cancelAutoplay]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  return {
    autoplayCountdown,
    countdownStarted: countdownStartedRef.current,
    setCountdownStarted: (val) => {
      countdownStartedRef.current = val;
    },
    triggerAutoplay,
    cancelAutoplay,
    playNow,
    resetAutoplay,
  };
}
