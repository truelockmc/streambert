import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal";
import WindowTitlebar from "./components/WindowTitlebar";
import { storage, secureStorage, STORAGE_KEYS } from "./utils/storage";
import {
  applyAccentColor,
  applyTheme,
  ACCENT_PRESETS,
} from "./utils/appearance";
import { collectBackupData } from "./utils/backup";
import { tmdbFetch, setApiErrorHandlers, imgUrl } from "./utils/api";
import { clearAppCaches } from "./utils/storage";
import {
  readDiscordRpcSettings,
  applyDiscordRpcEnabled,
  sendWatchingActivity,
  sendIdleActivity,
  clearActivity as clearDiscordActivity,
} from "./utils/discordPresence";

import Sidebar from "./components/Sidebar";
import SearchModal from "./components/SearchModal";
import SetupScreen from "./components/SetupScreen";
import CloseConfirmModal from "./components/CloseConfirmModal";
import UpdateModal from "./components/UpdateModal";

// Lazy-loaded pages: each chunk is only downloaded when the user first visits
const HomePage = lazy(() => import("./pages/HomePage"));
const MoviePage = lazy(() => import("./pages/MoviePage"));
const TVPage = lazy(() => import("./pages/TVPage"));
const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const DownloadsPage = lazy(() => import("./pages/DownloadsPage"));
import {
  checkForUpdatesWithFallback,
  DEFAULT_UPDATE_SOURCE,
} from "./utils/updates";

export default function App() {
  // apiKey loaded async from secure storage (OS keychain)
  const [apiKey, setApiKey] = useState(null);
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState("checking"); // 'checking' | 'ok' | 'invalid_token' | 'unreachable'
  const [page, setPage] = useState(() => storage.get("startPage") || "home");
  const [selected, setSelected] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [dlSearchOpen, setDlSearchOpen] = useState(false);
  const [librarySort, setLibrarySort] = useState(
    () => storage.get(STORAGE_KEYS.LIBRARY_SORT) || "manual",
  );
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [platform, setPlatform] = useState(null);

  // Navigation history stack for Ctrl+Z back navigation
  const [navStack, setNavStack] = useState([]);

  const [saved, setSaved] = useState(() => storage.get("saved") || {});
  // Separate order array for drag-and-drop reordering
  const [savedOrder, setSavedOrder] = useState(
    () => storage.get("savedOrder") || null,
  );
  const [progress, setProgress] = useState(() => storage.get("progress") || {});
  const [history, setHistory] = useState(() => storage.get("history") || []);
  const [watched, setWatched] = useState(() => storage.get("watched") || {});
  const [toast, setToast] = useState(null);
  const [updateBanner, setUpdateBanner] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  // null | "checking" | { entries: object[] } | "none"
  const [episodeCheckStatus, setEpisodeCheckStatus] = useState(null);
  const episodeDismissTimerRef = useRef(null);

  const [trending, setTrending] = useState([]);
  const [trendingTV, setTrendingTV] = useState([]);
  const [loadingHome, setLoadingHome] = useState(false);
  const [offline, setOffline] = useState(() => !navigator.onLine);

  // ── Player accent + subtitle lang ─────────────────────────────────────────
  // Computed once here and passed as a prop to MoviePage / TVPage so neither
  // page needs to touch storage.  Refreshed via "streambert:player-settings-changed".
  const readPlayerSettings = () => {
    const accentId = storage.get(STORAGE_KEYS.ACCENT_COLOR) || "red";
    const inPlayer = storage.get(STORAGE_KEYS.ACCENT_IN_PLAYER) !== false; // default true
    const accentHex = inPlayer
      ? (ACCENT_PRESETS.find((p) => p.id === accentId)?.color ?? null)
      : null;
    const subtitleLang = storage.get(STORAGE_KEYS.SUBTITLE_LANG) || null;
    return { accentColor: accentHex, subtitleLang };
  };
  const [playerSettings, setPlayerSettings] = useState(readPlayerSettings);

  // ── Discord Rich Presence ──────────────────────────────────────────────────
  // Off by default. `watchingEpisode` is filled in by TVPage (season/episode
  // of whatever is currently open) via onEpisodeChange; MoviePage needs no
  // extra data since title/poster already live on `selected`.
  const [discordSettings, setDiscordSettings] = useState(
    readDiscordRpcSettings,
  );
  const [watchingEpisode, setWatchingEpisode] = useState(null);
  const watchStartRef = useRef(null);

  // ── Scheduled backup: run on startup if due ─────────────────────────────────
  useEffect(() => {
    if (!window.electron?.onScheduledBackupRequested) return;
    const handler = window.electron.onScheduledBackupRequested(async () => {
      try {
        const settings = await window.electron.getScheduledBackupSettings();
        if (!settings?.enabled || !settings?.path) return;
        const data = collectBackupData();
        await window.electron.performScheduledBackup({ data, settings });
      } catch {
        // silently ignore errors on scheduled backup
      }
    });
    return () => window.electron.offScheduledBackupRequested(handler);
  }, []);

  // ── Post-update cache flush ───────────────────────────────────────────────
  // On every start, compare the running version against the last-seen version.
  // If they differ the app was just updated -> clear all caches to prevent problems
  useEffect(() => {
    if (!window.electron?.getAppVersion) return;
    window.electron.getAppVersion().then((version) => {
      const lastVersion = localStorage.getItem("streambert_lastVersion");
      if (lastVersion && lastVersion !== version) {
        clearAppCaches();
      }
      localStorage.setItem("streambert_lastVersion", version);
    });
  }, []);

  // ── Startup update check ─────────────────────────────────────────────────
  useEffect(() => {
    if (!storage.get("autoCheckUpdates")) return;
    const source =
      storage.get(STORAGE_KEYS.UPDATE_SOURCE) || DEFAULT_UPDATE_SOURCE;
    checkForUpdatesWithFallback(source)
      .then((r) => {
        if (r.hasUpdate) setUpdateBanner(r);
      })
      .catch(() => {}); // silently ignore network errors on startup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Startup: new-episode notification check ──────────────────────────────
  // Only runs once the API key has been loaded from secure storage (i.e. the
  // app is fully started and past the setup screen). Shows an in-app status
  // pill while checking, then either a result card or a brief "nothing new" message.
  useEffect(() => {
    if (!apiKeyLoaded) return;
    const notifyPref = storage.get(STORAGE_KEYS.NOTIFY_NEW_EPISODE);
    if (notifyPref === false || notifyPref === 0) return;

    let cancelled = false;

    async function checkNewEpisodes() {
      // Small grace period so the UI has fully painted before start
      await new Promise((r) => setTimeout(r, 1200));
      if (cancelled) return;

      if (!apiKey || cancelled) return;

      const tvSeries = Object.values(saved).filter(
        (item) => item && item.media_type === "tv" && item.id,
      );
      if (!tvSeries.length) return;

      // Only re-check entries older than 12 h
      const cache = storage.get(STORAGE_KEYS.EPISODE_RELEASE_CACHE) || {};
      const now = Date.now();
      const CACHE_TTL = 12 * 60 * 60 * 1000;
      const toCheck = tvSeries.filter(
        (s) => !cache[s.id] || now - (cache[s.id].checkedAt || 0) > CACHE_TTL,
      );

      if (!toCheck.length) {
        setEpisodeCheckStatus("none");
        episodeDismissTimerRef.current = setTimeout(() => {
          if (!cancelled) setEpisodeCheckStatus(null);
        }, 2000);
        return;
      }

      // Only show loading pill when there's actually something to check
      setEpisodeCheckStatus("checking");

      const BATCH = 3;
      // Each entry: { title, season, id, seriesItem }
      const newEpisodeEntries = [];

      for (let i = 0; i < toCheck.length && !cancelled; i += BATCH) {
        const batch = toCheck.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (series) => {
            try {
              const data = await tmdbFetch(`/tv/${series.id}`, apiKey);
              if (cancelled) return;

              const prev = cache[series.id] || {};
              const lastEp = data.last_episode_to_air;
              const lastDate = lastEp?.air_date || null;
              const isFirstCheck = !prev.checkedAt;

              // Parse air_date strings as local midnight to avoid UTC offset issues
              const parseLocalDate = (d) => {
                if (!d) return null;
                const [y, m, day] = d.split("-").map(Number);
                return new Date(y, m - 1, day);
              };

              const todayLocal = new Date();
              todayLocal.setHours(0, 0, 0, 0);
              const sevenDaysAgo = new Date(todayLocal);
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

              if (isFirstCheck) {
                // First time: notify if latest episode aired in last 7 days
                const lastParsed = parseLocalDate(lastDate);
                if (lastParsed && lastParsed >= sevenDaysAgo) {
                  newEpisodeEntries.push({
                    title:
                      series.title ||
                      series.name ||
                      data.name ||
                      "Unknown series",
                    season: lastEp?.season_number ?? null,
                    id: series.id,
                    seriesItem: series,
                  });
                }
              } else {
                // Subsequent checks: notify when last_episode_to_air changed
                // (new episode aired) compared to what got cached.
                // Migration: old cache entries only have nextEpDate, not lastEpDate.
                // In that case treat as first check to avoid false positives.
                const prevLastDate = prev.lastEpDate ?? null;
                const isMigratingOldCache =
                  prev.checkedAt && prevLastDate === null;

                if (isMigratingOldCache) {
                  // Just update the cache with lastEpDat
                } else {
                  const lastParsed = parseLocalDate(lastDate);
                  const prevParsed = parseLocalDate(prevLastDate);

                  const isNewEpisode =
                    lastDate &&
                    lastDate !== prevLastDate &&
                    lastParsed &&
                    lastParsed >= sevenDaysAgo &&
                    (!prevParsed || lastParsed > prevParsed);

                  if (isNewEpisode) {
                    newEpisodeEntries.push({
                      title:
                        series.title ||
                        series.name ||
                        data.name ||
                        "Unknown series",
                      season: lastEp?.season_number ?? null,
                      id: series.id,
                      seriesItem: series,
                    });
                  }
                }
              }

              cache[series.id] = {
                lastEpDate: lastDate,
                // keep nextEpDate for reference but don't use it for detection
                nextEpDate: data.next_episode_to_air?.air_date || null,
                checkedAt: now,
              };
            } catch {}
          }),
        );
        if (i + BATCH < toCheck.length && !cancelled) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (cancelled) return;

      storage.set(STORAGE_KEYS.EPISODE_RELEASE_CACHE, cache);

      if (newEpisodeEntries.length === 0) {
        setEpisodeCheckStatus("none");
        // Auto-dismiss after 2 s
        episodeDismissTimerRef.current = setTimeout(() => {
          if (!cancelled) setEpisodeCheckStatus(null);
        }, 2000);
        return;
      }

      // Show in-app result card
      setEpisodeCheckStatus({ entries: newEpisodeEntries });

      // Also fire OS notification
      if (window.electron?.showNotification) {
        const names = newEpisodeEntries.map((e) => e.title);
        const body =
          names.length === 1
            ? `${names[0]} has a new episode.`
            : `${names.slice(0, 3).join(", ")}${
                names.length > 3 ? ` and ${names.length - 3} more` : ""
              } have new episodes.`;
        window.electron.showNotification({
          title: "New episodes available",
          body,
          silent: false,
        });
      }
    }

    checkNewEpisodes().catch(() => {
      if (!cancelled) setEpisodeCheckStatus(null);
    });
    return () => {
      cancelled = true;
      clearTimeout(episodeDismissTimerRef.current);
    };
  }, [apiKeyLoaded]);

  // ── Downloads state ──────────────────────────────────────────────────────
  const [downloads, setDownloads] = useState([]);
  const [highlightDownload, setHighlightDownload] = useState(null);
  const [closeConfirm, setCloseConfirm] = useState(null); // { count }

  // ── Load API key from secure storage on startup ──
  useEffect(() => {
    let mounted = true;
    secureStorage.get("apikey").then((val) => {
      if (!mounted) return;
      setApiKey(val || null);
      setApiKeyLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // ── Detect platform for Windows titlebar ──────────────────────────────────
  useEffect(() => {
    if (!window.electron?.getPlatform) return;
    let mounted = true;
    window.electron.getPlatform().then((p) => {
      if (!mounted) return;
      setPlatform(p);
      if (p === "win32" || p === "linux") {
        document.documentElement.setAttribute("data-win-titlebar", "1");
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Listen for close confirmation request from main process
  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onConfirmClose((data) =>
      setCloseConfirm(data),
    );
    return () => window.electron.offConfirmClose(handler);
  }, []);

  // ── Register global API error handlers ──────────────────────────────────
  // Fire on any tmdbFetch call that returns 401/403 or network failure
  useEffect(() => {
    setApiErrorHandlers(
      () => setApiKeyStatus("invalid_token"), // 401 / 403
      () => setApiKeyStatus("unreachable"), // network failure
    );
  }, []);

  // ── Validate stored API key on startup ───────────────────────────────────
  useEffect(() => {
    if (!apiKey) {
      setApiKeyStatus("ok");
      return;
    }
    setApiKeyStatus("checking");
    const controller = new AbortController();
    fetch("https://api.themoviedb.org/3/configuration", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403)
          setApiKeyStatus("invalid_token");
        else setApiKeyStatus("ok");
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setApiKeyStatus("unreachable");
      });
    return () => controller.abort();
  }, [apiKey]);

  // Load persisted downloads on startup + immediately prune missing files
  useEffect(() => {
    if (!window.electron) return;
    let mounted = true;
    window.electron.getDownloads().then(async (list) => {
      if (!mounted || !Array.isArray(list)) return;

      const pruned = [...list];
      const toRemove = new Set();

      await Promise.all(
        pruned.map(async (d) => {
          if (d.status !== "completed" || !d.filePath) return;
          const exists = await window.electron.fileExists(d.filePath);
          if (!exists) {
            // File gone, remove from registry silently
            window.electron.deleteDownload({ id: d.id, filePath: null });
            toRemove.add(d.id);
            return;
          }
          // Prune subtitle paths that no longer exist
          if (
            d.subtitlePaths?.length > 0 &&
            window.electron.pruneSubtitlePaths
          ) {
            const res = await window.electron.pruneSubtitlePaths(d.id);
            if (res?.ok) d.subtitlePaths = res.subtitlePaths;
          }
        }),
      );

      if (mounted) setDownloads(pruned.filter((d) => !toRemove.has(d.id)));
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Listen for live progress events from main process
  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onDownloadProgress((update) => {
      // ── Desktop notification ──────────────────────
      if (
        update.status === "completed" &&
        storage.get(STORAGE_KEYS.NOTIFY_DOWNLOAD_COMPLETE) !== false &&
        window.electron.showNotification
      ) {
        window.electron.showNotification({
          title: "Download complete",
          body: update.name || "Your download has finished.",
          silent: false,
        });
      }

      setDownloads((prev) => {
        const idx = prev.findIndex((d) => d.id === update.id);
        if (idx === -1) {
          // Unknown id: either the entry was deleted (stale event after SIGKILL)
          // or a genuine race on first event.
          if (!update.name) return prev;
          return [update, ...prev];
        }
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...update };
        return updated;
      });
    });
    return () => window.electron.offDownloadProgress(handler);
  }, []);

  const handleDownloadStarted = useCallback((newEntry) => {
    setDownloads((prev) => {
      // Guard: if a progress event already added this id (race), just update it
      const idx = prev.findIndex((d) => d.id === newEntry.id);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...newEntry };
        return updated;
      }
      return [newEntry, ...prev];
    });
  }, []);

  const handleDeleteDownload = useCallback((id) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  // Active download count for sidebar badge
  const activeDownloadCount = useMemo(
    () => downloads.filter((d) => d.status === "downloading").length,
    [downloads],
  );

  // ── Trending, single shared fetch fn avoids code duplication ────────────
  // Results are cached in localStorage for 30 min to avoid redundant API calls
  // and to keep trending data out of RAM between restarts.
  // The cache stores the active metadata language; if it differs from the
  // current setting the cache is treated as stale and data is re-fetched.
  const fetchTrending = useCallback(() => {
    if (!apiKey) return;
    const cached = storage.get("trendingCache");
    const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    const currentLang = storage.get(STORAGE_KEYS.TMDB_LANG) || "en-US";
    if (
      cached &&
      cached.ts &&
      cached.lang === currentLang &&
      Date.now() - cached.ts < CACHE_TTL
    ) {
      setTrending(cached.movies || []);
      setTrendingTV(cached.tv || []);
      return;
    }
    setLoadingHome(true);
    Promise.all([
      tmdbFetch("/trending/movie/week", apiKey),
      tmdbFetch("/trending/tv/week", apiKey),
    ])
      .then(([m, t]) => {
        const movies = m.results || [];
        const tv = t.results || [];
        setTrending(movies);
        setTrendingTV(tv);
        storage.set("trendingCache", {
          movies,
          tv,
          ts: Date.now(),
          lang: currentLang,
        });
      })
      .catch(() => {})
      .finally(() => setLoadingHome(false));
  }, [apiKey]);

  useEffect(() => {
    fetchTrending();
  }, [fetchTrending]);

  const retryHome = useCallback(() => {
    if (offline) return;
    fetchTrending();
  }, [offline, fetchTrending]);

  // ── Sync librarySort when changed from Settings ───────────────────────────
  useEffect(() => {
    const handler = (e) => setLibrarySort(e.detail);
    window.addEventListener("streambert:library-sort-changed", handler);
    return () =>
      window.removeEventListener("streambert:library-sort-changed", handler);
  }, []);

  // ── Re-fetch trending immediately when metadata language changes ──────────
  useEffect(() => {
    const handler = () => fetchTrending();
    window.addEventListener("streambert:tmdb-lang-changed", handler);
    return () =>
      window.removeEventListener("streambert:tmdb-lang-changed", handler);
  }, [fetchTrending]);

  // ── Refresh player settings (accent + subtitle lang) after save ───────────
  useEffect(() => {
    const handler = () => setPlayerSettings(readPlayerSettings());
    window.addEventListener("streambert:player-settings-changed", handler);
    return () =>
      window.removeEventListener("streambert:player-settings-changed", handler);
  }, []);

  // ── Discord Rich Presence: sync settings + connect/disconnect ─────────────
  useEffect(() => {
    applyDiscordRpcEnabled(discordSettings.enabled);
    if (!discordSettings.enabled) clearDiscordActivity();
  }, [discordSettings.enabled]);

  useEffect(() => {
    const handler = () => setDiscordSettings(readDiscordRpcSettings());
    window.addEventListener("streambert:discord-rpc-settings-changed", handler);
    return () =>
      window.removeEventListener(
        "streambert:discord-rpc-settings-changed",
        handler,
      );
  }, []);

  // Reset episode info + elapsed-time anchor whenever the open title changes
  useEffect(() => {
    setWatchingEpisode(null);
    watchStartRef.current = Date.now();
  }, [selected?.id, selected?.media_type]);

  // Push the current activity to Discord whenever what's on screen changes
  useEffect(() => {
    if (!discordSettings.enabled) return;
    if ((page === "movie" || page === "tv") && selected) {
      const title = selected.title || selected.name || "";
      let subtitle = page === "movie" ? "Movie" : "Series";
      if (page === "tv" && watchingEpisode) {
        subtitle = `S${watchingEpisode.season} · E${watchingEpisode.episode}`;
      }
      sendWatchingActivity(
        {
          title,
          subtitle,
          posterUrl: imgUrl(selected.poster_path, "w500"),
          startedAt: watchStartRef.current,
        },
        discordSettings,
      );
    } else {
      sendIdleActivity(discordSettings);
    }
  }, [page, selected, watchingEpisode, discordSettings]);
  useEffect(() => {
    // Accent colour
    const accent = storage.get(STORAGE_KEYS.ACCENT_COLOR) || "red";
    applyAccentColor(accent);
    // Theme
    const theme = storage.get(STORAGE_KEYS.THEME) || "dark";
    const customVars = storage.get(STORAGE_KEYS.CUSTOM_THEME_VARS) || null;
    applyTheme(theme, customVars);
    // Font size
    const font = storage.get(STORAGE_KEYS.FONT_SIZE) || "normal";
    const zoomMap = { sm: 0.85, normal: 1, lg: 1.15 };
    const factor = zoomMap[font] ?? 1;
    if (window.electron?.setZoomFactor) window.electron.setZoomFactor(factor);
    // Compact mode
    const compact = !!storage.get(STORAGE_KEYS.COMPACT_MODE);
    document.body.classList.toggle("compact-mode", compact);
    // Reduce animations
    const noAnim = !!storage.get(STORAGE_KEYS.REDUCE_ANIMATIONS);
    document.body.classList.toggle("no-anim", noAnim);
  }, []);
  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Navigation ────────────────────────────────────────────────────────────
  // Refs so navigate/navigateBack never need page/selected as deps
  const pageRef = useRef(page);
  const selectedRef = useRef(selected);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const navigateBack = useCallback(() => {
    setNavStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setPage(last.page);
      setSelected(last.selected);
      if (typeof gc === "function") {
        requestIdleCallback(() => gc(), { timeout: 2000 });
      }
      return prev.slice(0, -1);
    });
  }, []);

  const navigate = useCallback((pg, data = null) => {
    setNavStack((prev) => [
      ...prev,
      { page: pageRef.current, selected: selectedRef.current },
    ]);
    setSelected(data);
    setPage(pg);
    setShowSearch(false);
    // After navigating away, the previous page's component unmounts
    if (typeof gc === "function") {
      requestIdleCallback(() => gc(), { timeout: 2000 });
    }
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        if (pageRef.current === "downloads") {
          e.preventDefault();
          setDlSearchOpen(true);
        }
      }
      if (e.key === "Escape") {
        setShowSearch(false);
        setShowShortcuts(false);
      }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target?.tagName || "").toUpperCase();
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          setShowShortcuts((v) => !v);
        }
      }
      // Ctrl+Z / Cmd+Z → navigate back
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        navigateBack();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        window.location.reload();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigateBack]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const getMediaType = useCallback(
    (item) => item.media_type || (item.first_air_date ? "tv" : "movie"),
    [],
  );

  const handleSelectResult = useCallback(
    (item) => {
      navigate(item.media_type === "tv" ? "tv" : "movie", item);
    },
    [navigate],
  );

  const saveApiKey = useCallback((key) => {
    secureStorage.set("apikey", key);
    setApiKey(key);
  }, []);

  const changeApiKey = useCallback(() => {
    secureStorage.set("apikey", "");
    setApiKey(null);
    setApiKeyLoaded(true);
    setSkipped(false);
  }, []);

  // Ref so toggleSave never needs `saved` as a dep (avoids recreation on every save)
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  const toggleSave = useCallback(
    (item) => {
      const mt = getMediaType(item);
      const id = `${mt}_${item.id}`;
      const currentSaved = savedRef.current;
      const isRemoving = !!currentSaved[id];
      const next = { ...currentSaved };

      if (isRemoving) {
        delete next[id];
        showToast("Removed from watchlist");
        setSavedOrder((prev) => {
          const currentOrder = prev || Object.keys(currentSaved);
          const newOrder = currentOrder.filter((k) => k !== id);
          storage.set("savedOrder", newOrder);
          return newOrder;
        });
      } else {
        next[id] = {
          id: item.id,
          title: item.title || item.name,
          poster_path: item.poster_path,
          media_type: mt,
          vote_average: item.vote_average,
          year: (item.release_date || item.first_air_date || "").slice(0, 4),
        };
        showToast("Added to watchlist");
        setSavedOrder((prev) => {
          const currentOrder = prev || Object.keys(currentSaved);
          const newOrder = [...currentOrder, id];
          storage.set("savedOrder", newOrder);
          return newOrder;
        });
      }
      setSaved(next);
      storage.set("saved", next);
    },
    [showToast, getMediaType],
  );

  const isSaved = useCallback(
    (item) => {
      const id = `${getMediaType(item)}_${item.id}`;
      return !!saved[id];
    },
    [saved, getMediaType],
  );

  const addHistory = useCallback((item) => {
    // Respect the "disable watch history" setting
    const historyEnabled = storage.get(STORAGE_KEYS.HISTORY_ENABLED);
    if (historyEnabled === 0 || historyEnabled === false) return;
    const entry = {
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      media_type: getMediaType(item),
      watchedAt: Date.now(),
      // Store as numbers so the progress key always matches exactly
      season: item.season != null ? Number(item.season) : null,
      episode: item.episode != null ? Number(item.episode) : null,
      episodeName: item.episodeName || null,
    };
    // Functional update - never reads stale history from closure
    setHistory((prev) => {
      // For TV: dedupe per episode (same show+season+episode).
      // For movies: dedupe by id+media_type as before.
      const filtered = prev.filter((h) => {
        if (h.id !== entry.id || h.media_type !== entry.media_type) return true;
        if (entry.media_type === "tv") {
          return !(h.season === entry.season && h.episode === entry.episode);
        }
        return false;
      });
      const next = [entry, ...filtered].slice(0, 100);
      storage.set("history", next);
      return next;
    });
  }, []); // no deps needed

  const saveProgress = useCallback((key, pct) => {
    // Functional update - without this, TVPage's setInterval keeps spreading
    // the progress object from when the interval was created, overwriting
    // saves from other episodes (classic stale closure bug).
    setProgress((prev) => {
      if (prev[key] === pct) return prev; // no change - skip write
      const next = { ...prev, [key]: pct };
      storage.set("progress", next);
      return next;
    });
  }, []); // no deps needed

  const markWatched = useCallback((key) => {
    setWatched((prev) => {
      const next = { ...prev, [key]: true };
      storage.set("watched", next);
      return next;
    });
  }, []);

  const markUnwatched = useCallback((key) => {
    setWatched((prev) => {
      const next = { ...prev };
      delete next[key];
      storage.set("watched", next);
      return next;
    });
  }, []);

  const removeHistory = useCallback((item) => {
    setHistory((prev) => {
      const next = prev.filter((h) => {
        if (h.id !== item.id || h.media_type !== item.media_type) return true;
        if (item.media_type === "tv") {
          return !(h.season === item.season && h.episode === item.episode);
        }
        return false;
      });
      storage.set("history", next);
      return next;
    });
  }, []);

  // Memoized, avoids re-filtering on every download-progress event
  // Pre-compute progress keys for history items once; only re-runs when history changes.
  const historyWithKeys = useMemo(
    () =>
      history
        .filter((h) => {
          if (h.media_type === "tv" && (h.season == null || h.episode == null))
            return false;
          return true;
        })
        .map((h) => ({
          ...h,
          _pk:
            h.media_type === "movie"
              ? `movie_${h.id}`
              : `tv_${h.id}_s${h.season}e${h.episode}`,
        })),
    [history],
  );

  // Filter by progress/watched
  const inProgress = useMemo(
    () =>
      historyWithKeys.filter((h) => {
        if (watched[h._pk]) return false;
        const pct = progress[h._pk];
        return pct != null && pct > 2 && pct < 98;
      }),
    [historyWithKeys, progress, watched],
  );

  // Memoized, avoids re-mapping on every download-progress event
  const savedList = useMemo(() => {
    const orderedKeys = savedOrder
      ? savedOrder.filter((k) => saved[k])
      : Object.keys(saved);
    const list = orderedKeys.map((k) => saved[k]).filter(Boolean);
    if (librarySort === "title")
      return [...list].sort((a, b) =>
        (a.title || "").localeCompare(b.title || ""),
      );
    if (librarySort === "rating")
      return [...list].sort(
        (a, b) => (b.vote_average || 0) - (a.vote_average || 0),
      );
    if (librarySort === "year")
      return [...list].sort((a, b) =>
        (b.year || "").localeCompare(a.year || ""),
      );
    return list;
  }, [saved, savedOrder, librarySort]);

  const handleReorderSaved = useCallback((newOrder) => {
    setSavedOrder(newOrder);
    storage.set("savedOrder", newOrder);
  }, []);

  // Stable handler
  const handleGoToDownloads = useCallback(
    (id) => {
      setHighlightDownload(id || null);
      navigate("downloads");
    },
    [navigate],
  );

  if (!apiKeyLoaded) return null; // wait for secure storage to resolve
  if (!apiKey && !skipped)
    return <SetupScreen onSave={saveApiKey} onSkip={() => setSkipped(true)} />;

  const hasCustomTitlebar = platform === "win32" || platform === "linux";

  return (
    <ErrorBoundary>
      {hasCustomTitlebar && <WindowTitlebar />}
      <div>
        <Sidebar
          page={page}
          onNavigate={navigate}
          onSearch={() => setShowSearch(true)}
          savedList={savedList}
          activeDownloads={activeDownloadCount}
          onReorderSaved={handleReorderSaved}
          onRemoveSaved={toggleSave}
          canGoBack={navStack.length > 0}
          onBack={navigateBack}
          onShowShortcuts={() => setShowShortcuts(true)}
        />

        <div className="main">
          {/* ── API key status banner ── */}
          {/* Suspense boundary: lazy page chunks are fetched on first visit */}
          {apiKeyStatus === "invalid_token" && (
            <div className="api-status-banner api-status-error">
              <span>
                ⚠ Your TMDB token is invalid, not set or has been revoked.
                Movies and shows won't load.
              </span>
              <button className="api-status-btn" onClick={changeApiKey}>
                Update Token
              </button>
            </div>
          )}
          {apiKeyStatus === "unreachable" && (
            <div className="api-status-banner api-status-warn">
              <span>
                ⚠ Cannot reach TMDB, check your internet connection. Content may
                not load.
              </span>
              <button
                className="api-status-btn"
                onClick={() =>
                  setApiKeyStatus("checking") || window.location.reload()
                }
              >
                Retry
              </button>
            </div>
          )}
          <Suspense
            fallback={
              <div
                style={{
                  color: "var(--text2)",
                  padding: 48,
                  textAlign: "center",
                  fontSize: 15,
                }}
              >
                Laden…
              </div>
            }
          >
            {page === "home" && (
              <HomePage
                trending={trending}
                trendingTV={trendingTV}
                loading={loadingHome}
                onSelect={handleSelectResult}
                progress={progress}
                inProgress={inProgress}
                offline={offline}
                onRetry={retryHome}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                history={history}
                apiKey={apiKey}
              />
            )}
            {page === "movie" && selected && (
              <MoviePage
                item={selected}
                apiKey={apiKey}
                playerSettings={playerSettings}
                onSave={() => toggleSave(selected)}
                isSaved={isSaved(selected)}
                onHistory={addHistory}
                progress={progress}
                saveProgress={saveProgress}
                onBack={() => navigate("home")}
                onSettings={(section) =>
                  navigate("settings", { section: section || null })
                }
                onDownloadStarted={handleDownloadStarted}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                downloads={downloads}
                onGoToDownloads={handleGoToDownloads}
                onSelect={handleSelectResult}
              />
            )}
            {page === "tv" && selected && (
              <TVPage
                item={selected}
                apiKey={apiKey}
                playerSettings={playerSettings}
                onSave={() => toggleSave(selected)}
                isSaved={isSaved(selected)}
                onHistory={addHistory}
                progress={progress}
                saveProgress={saveProgress}
                onBack={() => navigate("home")}
                onSettings={(section) =>
                  navigate("settings", { section: section || null })
                }
                onDownloadStarted={handleDownloadStarted}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                downloads={downloads}
                onGoToDownloads={handleGoToDownloads}
                onEpisodeChange={setWatchingEpisode}
              />
            )}
            {page === "history" && (
              <LibraryPage
                history={history}
                inProgress={inProgress}
                saved={savedList}
                progress={progress}
                onSelect={handleSelectResult}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                onRemoveHistory={removeHistory}
              />
            )}
            {page === "settings" && (
              <SettingsPage
                apiKey={apiKey}
                onChangeApiKey={changeApiKey}
                initialSection={selected?.section}
              />
            )}
            {page === "downloads" && (
              <DownloadsPage
                downloads={downloads}
                onDeleteDownload={handleDeleteDownload}
                onHistory={addHistory}
                onSaveProgress={saveProgress}
                progress={progress}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                highlightId={highlightDownload}
                onClearHighlight={() => setHighlightDownload(null)}
                onSelect={handleSelectResult}
                searchOpen={dlSearchOpen}
                onSearchClose={() => setDlSearchOpen(false)}
                onSettings={(section) =>
                  navigate("settings", { section: section || null })
                }
                onUpdateDownload={(id, updates) =>
                  setDownloads((prev) =>
                    prev.map((d) => (d.id === id ? { ...d, ...updates } : d)),
                  )
                }
              />
            )}
          </Suspense>
        </div>

        {showSearch && (
          <SearchModal
            apiKey={apiKey}
            onSelect={handleSelectResult}
            onClose={() => setShowSearch(false)}
            offline={offline}
          />
        )}
        {updateBanner && (
          <div
            style={{
              position: "fixed",
              top: hasCustomTitlebar ? 32 : 0,
              left: 0,
              right: 0,
              zIndex: 9999,
              background: "rgba(229,9,20,0.92)",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              padding: "10px 24px",
              boxShadow: "0 2px 16px rgba(0,0,0,0.4)",
              fontSize: 14,
              fontWeight: 500,
              color: "#fff",
            }}
          >
            <span>🎉 Streambert v{updateBanner.latest} is available!</span>
            <button
              onClick={() => setShowUpdateModal(true)}
              style={{
                color: "#fff",
                fontWeight: 700,
                background: "rgba(255,255,255,0.18)",
                border: "1px solid rgba(255,255,255,0.4)",
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Install Update
            </button>
            <button
              onClick={() => setUpdateBanner(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: "0 4px",
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        {showUpdateModal && updateBanner && (
          <UpdateModal
            updateInfo={updateBanner}
            activeDownloads={activeDownloadCount}
            onClose={() => setShowUpdateModal(false)}
          />
        )}
        {toast && <div className="toast">{toast}</div>}

        {/* ── Episode check status pill / result card ── */}
        {episodeCheckStatus && (
          <div
            style={{
              position: "fixed",
              bottom: 24,
              left: "calc(var(--sidebar) + 24px)",
              zIndex: 500,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              animation: "slideUp 0.3s ease",
              minWidth: 260,
              maxWidth: 400,
            }}
          >
            {episodeCheckStatus === "checking" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 18px",
                  fontSize: 14,
                  color: "var(--text2)",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 14,
                    height: 14,
                    border: "2px solid var(--text3)",
                    borderTopColor: "var(--red)",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                    flexShrink: 0,
                  }}
                />
                Checking for new episodes…
              </div>
            )}

            {episodeCheckStatus === "none" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 18px",
                  fontSize: 14,
                  color: "var(--text3)",
                }}
              >
                <span style={{ fontSize: 16 }}>✓</span>
                No new episodes found
              </div>
            )}

            {episodeCheckStatus?.entries && (
              <div style={{ padding: "14px 18px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--text)",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                    }}
                  >
                    <span style={{ color: "var(--red)", fontSize: 15 }}>
                      🎬
                    </span>
                    New episode
                    {episodeCheckStatus.entries.length > 1 ? "s" : ""} available
                  </div>
                  <button
                    onClick={() => {
                      clearTimeout(episodeDismissTimerRef.current);
                      setEpisodeCheckStatus(null);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text3)",
                      cursor: "pointer",
                      fontSize: 18,
                      lineHeight: 1,
                      padding: "0 2px",
                    }}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {episodeCheckStatus.entries.slice(0, 5).map((entry) => (
                    <li
                      key={entry.id}
                      className="episode-check-item"
                      onClick={() => {
                        clearTimeout(episodeDismissTimerRef.current);
                        navigate("tv", {
                          ...entry.seriesItem,
                          season: entry.season ?? 1,
                        });
                        setEpisodeCheckStatus(null);
                      }}
                      style={{
                        fontSize: 13,
                        color: "var(--text2)",
                        padding: "5px 0",
                        paddingBottom: 7,
                        borderBottom: "1px solid var(--border)",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        borderRadius: 4,
                        transition: "color 0.15s",
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.title}
                      </span>
                      {entry.season != null && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text3)",
                            background: "var(--surface3)",
                            borderRadius: 4,
                            padding: "1px 6px",
                            flexShrink: 0,
                          }}
                        >
                          Season {entry.season}
                        </span>
                      )}
                    </li>
                  ))}
                  {episodeCheckStatus.entries.length > 5 && (
                    <li
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        paddingTop: 2,
                      }}
                    >
                      +{episodeCheckStatus.entries.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
        {closeConfirm && (
          <CloseConfirmModal
            count={closeConfirm.count}
            onConfirm={() => {
              setCloseConfirm(null);
              window.electron.respondClose(true);
            }}
            onCancel={() => {
              setCloseConfirm(null);
              window.electron.respondClose(false);
            }}
          />
        )}
        {showShortcuts && (
          <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
        )}
      </div>
    </ErrorBoundary>
  );
}
