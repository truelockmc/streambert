import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAudioLangAttempt,
  audioLangLabel,
  ANIME_DEFAULT_SOURCE,
  NON_ANIME_DEFAULT_SOURCE,
} from "./api";
import { storage, STORAGE_KEYS } from "./storage";

// How long a language source gets to show a video before we fall back
const CHECK_TIMEOUT_MS = 25000;
const POLL_MS = 2000;
// m3u8 events from the previous source can still trickle in right after a switch
const M3U8_GRACE_MS = 1500;
const NOTICE_MS = 6000;
const CACHE_MAX = 300;

// ── Per-title availability cache: "<lang>:<playKey>" -> "ok" | "missing" ─────
const readCache = (key) =>
  (storage.get(STORAGE_KEYS.AUDIO_LANG_CACHE) || {})[key] ?? null;

const writeCache = (key, value) => {
  const cache = storage.get(STORAGE_KEYS.AUDIO_LANG_CACHE) || {};
  delete cache[key]; // re-insert -> newest last
  const keys = Object.keys(cache);
  if (keys.length >= CACHE_MAX) {
    keys.slice(0, keys.length - CACHE_MAX + 1).forEach((k) => delete cache[k]);
  }
  cache[key] = value;
  storage.set(STORAGE_KEYS.AUDIO_LANG_CACHE, cache);
};

const attemptActive = (attempt, source, dub) =>
  attempt.sourceId ? source === attempt.sourceId : dub === attempt.dubMode;

/**
 * Preferred audio (dub) language: when playback starts, switch to the source
 * (or anime dub mode) that serves the preferred language, verify a video
 * actually loads there, and fall back to the previous source otherwise.
 * Results are cached per title/episode; a manual source or sub/dub choice
 * disables the automatic switching for the rest of the title.
 *
 * @param {object} p
 * @param {string|null} p.lang         preferred language code (null = off)
 * @param {boolean} p.playing
 * @param {string} p.titleKey          e.g. "movie_123" / "tv_456"
 * @param {string|null} p.playKey      e.g. "movie_123" / "tv_456_s1_e2"
 * @param {"movie"|"tv"} p.type
 * @param {boolean} p.isAnime
 * @param {string} p.playerSource
 * @param {(id: string) => void} p.setPlayerSource
 * @param {"sub"|"dub"} p.dubMode
 * @param {(m: "sub"|"dub") => void} p.setDubMode
 * @param {React.RefObject} p.webviewRef
 * @param {string|null} p.sourceError  ID-resolution error of the current source
 * @returns {{ notice: string|null, markManual: () => void }}
 */
export function useAudioLangPreference({
  lang,
  playing,
  titleKey,
  playKey,
  type,
  isAnime,
  playerSource,
  setPlayerSource,
  dubMode,
  setDubMode,
  webviewRef,
  sourceError,
}) {
  const attempt = useMemo(
    () => getAudioLangAttempt(lang, type, isAnime),
    [lang, type, isAnime],
  );
  const label = lang ? audioLangLabel(lang) : "";

  // status: idle | checking | ok | fallback
  const [state, setState] = useState({ status: "idle", key: null });
  const [notice, setNotice] = useState(null);

  // Latest values for effects that must not re-run on every change
  const sourceRef = useRef(playerSource);
  sourceRef.current = playerSource;
  const dubRef = useRef(dubMode);
  dubRef.current = dubMode;
  const manualRef = useRef(null); // titleKey the user took manual control of
  const fallbackRef = useRef(null); // { titleKey, source, dubMode }
  const noticeTimerRef = useRef(null);

  const showNotice = useCallback((text, ms = NOTICE_MS) => {
    clearTimeout(noticeTimerRef.current);
    setNotice(text);
    if (ms) {
      noticeTimerRef.current = setTimeout(() => setNotice(null), ms);
    }
  }, []);
  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  // Go back to where we were before switching to the language source
  const revert = useCallback(() => {
    if (!attempt) return;
    const fb = fallbackRef.current?.titleKey === titleKey
      ? fallbackRef.current
      : null;
    if (attempt.sourceId) {
      let target = fb?.source;
      if (!target || target === attempt.sourceId) {
        target = isAnime ? ANIME_DEFAULT_SOURCE : NON_ANIME_DEFAULT_SOURCE;
      }
      if (sourceRef.current === attempt.sourceId) setPlayerSource(target);
    } else if (attempt.dubMode) {
      const target =
        fb && fb.dubMode !== attempt.dubMode ? fb.dubMode : "sub";
      if (dubRef.current === attempt.dubMode) setDubMode(target);
    }
  }, [attempt, titleKey, isAnime, setPlayerSource, setDubMode]);

  // New title -> forget manual override and fallback
  useEffect(() => {
    manualRef.current = null;
    fallbackRef.current = null;
    showNotice(null, 0);
    setState({ status: "idle", key: null });
  }, [titleKey, showNotice]);

  // ── Apply the preferred language when playback (or the episode) starts ────
  useEffect(() => {
    if (!playing || !playKey || !attempt || manualRef.current === titleKey) {
      setState({ status: "idle", key: null });
      return;
    }
    const cacheKey = `${lang}:${playKey}`;
    const cached = readCache(cacheKey);

    // Remember where we came from (once per title, before the first switch)
    if (
      fallbackRef.current?.titleKey !== titleKey &&
      !attemptActive(attempt, sourceRef.current, dubRef.current)
    ) {
      fallbackRef.current = {
        titleKey,
        source: sourceRef.current,
        dubMode: dubRef.current,
      };
    }

    if (cached === "missing") {
      revert();
      setState({ status: "fallback", key: cacheKey });
      showNotice(`${label} not available, using another source`);
      return;
    }

    if (attempt.sourceId && sourceRef.current !== attempt.sourceId) {
      setPlayerSource(attempt.sourceId);
    } else if (attempt.dubMode && dubRef.current !== attempt.dubMode) {
      setDubMode(attempt.dubMode);
    }
    if (cached === "ok") {
      setState({ status: "ok", key: cacheKey });
      showNotice(`${label} audio`, 3000);
      return;
    }
    setState({ status: "checking", key: cacheKey });
    showNotice(`Looking for ${label} audio…`, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, playKey, attempt, lang, titleKey]);

  // ── Availability check for the language source ───────────────────────────
  const active =
    state.status === "checking" &&
    !!attempt &&
    attemptActive(attempt, playerSource, dubMode);

  useEffect(() => {
    if (!active) return undefined;
    const cacheKey = state.key;
    const startedAt = Date.now();
    let finished = false;

    const succeed = () => {
      if (finished) return;
      finished = true;
      writeCache(cacheKey, "ok");
      setState({ status: "ok", key: cacheKey });
      showNotice(`${label} audio`, 3000);
    };
    const fail = () => {
      if (finished) return;
      finished = true;
      writeCache(cacheKey, "missing");
      setState({ status: "fallback", key: cacheKey });
      revert();
      showNotice(`${label} not available, using another source`);
    };

    // Source couldn't even build its URL (e.g. no IMDb / Kinopoisk id)
    if (sourceError) {
      fail();
      return undefined;
    }

    const m3u8Handler = window.electron?.onM3u8Found?.(() => {
      if (Date.now() - startedAt >= M3U8_GRACE_MS) succeed();
    });

    const poll = setInterval(async () => {
      if (finished) return;
      if (Date.now() - startedAt > CHECK_TIMEOUT_MS) {
        fail();
        return;
      }
      try {
        const wv = webviewRef.current;
        if (!wv || !window.electron?.queryVideoAvailable) return;
        const ok = await window.electron.queryVideoAvailable(
          wv.getWebContentsId(),
        );
        if (ok) succeed();
      } catch {
        // webview not attached yet -> next tick
      }
    }, POLL_MS);

    return () => {
      finished = true;
      clearInterval(poll);
      if (m3u8Handler) window.electron?.offM3u8Found?.(m3u8Handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state.key, sourceError]);

  /** Call when the user picks a source or sub/dub by hand. */
  const markManual = useCallback(() => {
    manualRef.current = titleKey;
    setState({ status: "idle", key: null });
    showNotice(null, 0);
  }, [titleKey, showNotice]);

  return { notice, markManual };
}
