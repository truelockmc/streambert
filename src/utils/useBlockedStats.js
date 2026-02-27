import { useState, useEffect, useRef } from "react";

/**
 * Tracks blocked request stats from the Electron main process.
 *
 * @param {string|number} resetKey - When this changes, session counters reset.
 *   Use item.id for movies, `${item.id}_s${season}e${ep}` for TV episodes.
 */
export function useBlockedStats(resetKey) {
  // Session: reset on media change
  const [sessionTotal, setSessionTotal] = useState(0);
  // Ref for domain map so we don't re-render on every batch —
  // only re-render when sessionTotal badge needs updating.
  const sessionDomainsRef = useRef({});

  // Alltime: persisted in main process, loaded once + incremented via IPC
  const [alltimeTotal, setAlltimeTotal] = useState(0);

  const [showModal, setShowModal] = useState(false);

  // Load alltime total from main process on mount
  useEffect(() => {
    if (!window.electron?.getBlockStats) return;
    window.electron.getBlockStats().then((stats) => {
      if (stats) setAlltimeTotal(stats.total || 0);
    });
  }, []);

  // Reset session counters when the media changes
  useEffect(() => {
    setSessionTotal(0);
    sessionDomainsRef.current = {};
  }, [resetKey]);

  // Listen for batched block updates from main process
  useEffect(() => {
    if (!window.electron?.onBlockedUpdate) return;
    const handler = window.electron.onBlockedUpdate((data) => {
      if (!data) return;
      // Increment alltime display counter
      setAlltimeTotal((prev) => prev + (data.total || 0));
      // Increment session counter + accumulate domain map
      setSessionTotal((prev) => prev + (data.total || 0));
      const map = sessionDomainsRef.current;
      for (const [domain, count] of Object.entries(data.domains || {})) {
        map[domain] = (map[domain] || 0) + count;
      }
    });
    return () => {
      if (window.electron?.offBlockedUpdate) window.electron.offBlockedUpdate(handler);
    };
  }, []);

  /**
   * Returns a snapshot of session domains sorted by count (desc).
   * Call this when opening the modal to get a fresh sorted list.
   * @returns {Array<[domain: string, count: number]>}
   */
  function getSessionDomains() {
    return Object.entries(sessionDomainsRef.current).sort(
      (a, b) => b[1] - a[1],
    );
  }

  return {
    sessionTotal,
    alltimeTotal,
    showModal,
    setShowModal,
    getSessionDomains,
  };
}
