import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import {
  tmdbFetch,
  imgUrl,
  PLAYER_SOURCES,
  getSourceUrl,
  sourceSupportsProgress,
  sourceIsAsync,
  fetchAnilistData,
  buildAnilistSeasons,
  cleanAnilistDescription,
  isAnimeContent,
  ANIME_DEFAULT_SOURCE,
  NON_ANIME_DEFAULT_SOURCE,
  NEEDS_INTERCEPT,
} from "../utils/api";
import {
  BookmarkIcon,
  BookmarkFillIcon,
  BackIcon,
  StarIcon,
  PlayIcon,
  TVIcon,
  DownloadIcon,
  WatchedIcon,
  TrailerIcon,
  RatingShieldIcon,
  RatingLockIcon,
  SourceIcon,
  ShieldBlockIcon,
} from "../components/Icons";
import DownloadModal from "../components/DownloadModal";
import TrailerModal from "../components/TrailerModal";
import BlockedStatsModal from "../components/BlockedStatsModal";
import { useBlockedStats } from "../utils/useBlockedStats";
import { storage } from "../utils/storage";
import {
  fetchTVRating,
  isRestricted,
  getAgeLimitSetting,
  getRatingCountry,
} from "../utils/ageRating";

// Small context menu for episode cards
function EpisodeContextMenu({
  x,
  y,
  isWatched,
  onMarkWatched,
  onMarkUnwatched,
  onClose,
}) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const close = () => onCloseRef.current();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {isWatched ? (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkUnwatched();
            onCloseRef.current();
          }}
        >
          ↩ Mark as Unwatched
        </button>
      ) : (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkWatched();
            onCloseRef.current();
          }}
        >
          ✓ Mark as Watched
        </button>
      )}
    </div>
  );
}

// Small context menu for season buttons
function SeasonContextMenu({
  x,
  y,
  isWatched,
  onMarkWatched,
  onMarkUnwatched,
  onClose,
}) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const close = () => onCloseRef.current();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {isWatched ? (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkUnwatched();
            onCloseRef.current();
          }}
        >
          ↩ Mark Season as Unwatched
        </button>
      ) : (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkWatched();
            onCloseRef.current();
          }}
        >
          ✓ Mark Season as Watched
        </button>
      )}
    </div>
  );
}

// Expandable episode description
function EpisodeDesc({ overview, episodeName }) {
  const [open, setOpen] = useState(false);
  if (!overview) return <div className="episode-desc" />;

  return (
    <>
      <div className="episode-desc-wrap">
        <div className="episode-desc">{overview}</div>
        <button
          className="episode-desc-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          More
        </button>
      </div>

      {open && (
        <div
          className="ep-desc-overlay"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div className="ep-desc-popup" onClick={(e) => e.stopPropagation()}>
            {episodeName && (
              <div className="ep-desc-popup-title">{episodeName}</div>
            )}
            <p className="ep-desc-popup-text">{overview}</p>
            <button
              className="ep-desc-popup-close"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Injected into the webview DOM
const INJECT_SKIP_CONTROLS = `
(function() {
  if (window.__skipControlsInjected) return;
  var style = document.createElement('style');
  style.innerHTML =
    '*:focus, *:focus-visible {' +
    'outline: none !important;' +
    'box-shadow: none !important;' +
    '}' +
    'video:focus, video:focus-visible {' +
    'outline: none !important;' +
    'box-shadow: none !important;' +
    '}';
  document.head.appendChild(style);
  window.__skipControlsInjected = true;

  var BACK_SVG = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"width:26px;height:26px\"><polyline points=\"1 4 1 10 7 10\"/><path d=\"M3.51 15a9 9 0 1 0 .49-4.53\"/><text x=\"13.5\" y=\"15.5\" text-anchor=\"middle\" font-size=\"6.5\" fill=\"currentColor\" stroke=\"none\" font-weight=\"800\" font-family=\"system-ui,sans-serif\">15</text></svg>';
  var FWD_SVG  = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"width:26px;height:26px\"><polyline points=\"23 4 23 10 17 10\"/><path d=\"M20.49 15a9 9 0 1 1-.49-4.53\"/><text x=\"10.5\" y=\"15.5\" text-anchor=\"middle\" font-size=\"6.5\" fill=\"currentColor\" stroke=\"none\" font-weight=\"800\" font-family=\"system-ui,sans-serif\">15</text></svg>';

  var wrap = document.createElement('div');
  wrap.id = '__skip-ui';
  wrap.style.cssText = [
    'position:fixed',
    'top:0','left:0','right:0','bottom:0',
    'pointer-events:none',
    'z-index:2147483647',
    'opacity:0',
    'transition:opacity 0.25s ease',
  ].join(';');

  function makeBtn(seconds, svg, label, side) {
    var btn = document.createElement('button');
    btn.innerHTML = svg + '<span style="font-size:11px;font-family:system-ui,sans-serif">' + label + '</span>';
    btn.setAttribute('tabindex', '-1');
    btn.title = label;
    btn.style.cssText = [
      'pointer-events:auto',
      'background:rgba(0,0,0,0.72)',
      'border:1px solid rgba(255,255,255,0.18)',
      'border-radius:8px',
      'color:white',
      'cursor:pointer',
      'padding:10px 18px',
      'display:flex',
      'align-items:center',
      'gap:7px',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'transition:background 0.15s',
      'font-size:12px',
    ].join(';');
    btn.style.position = 'absolute';
    btn.style.top = '50%';
    btn.style.transform = 'translateY(-50%)';

    if (side === 'left') {
      btn.style.left = '24px';
    } else {
      btn.style.right = '24px';
    }
    btn.onmouseenter = function() { btn.style.background = 'rgba(229,9,20,0.85)'; btn.style.borderColor = '#e5091466'; };
    btn.onmouseleave = function() { btn.style.background = 'rgba(0,0,0,0.72)'; btn.style.borderColor = 'rgba(255,255,255,0.18)'; };
    btn.onclick = function(e) {
      e.stopPropagation();
      var v = document.querySelector('video');
      if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds));
      show();
    };
    return btn;
  }

  wrap.appendChild(makeBtn(-15, BACK_SVG, '−15s', 'left'));
  wrap.appendChild(makeBtn(15,  FWD_SVG,  '+15s', 'right'));
  document.documentElement.appendChild(wrap);

  var idleTimer;
  function show() {
    wrap.style.opacity = '1';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function() { wrap.style.opacity = '0'; }, 2500);
  }
  document.addEventListener('mousemove', show, true);
  document.addEventListener('keydown', function(e) {
    const active = document.activeElement;

    // Keine Shortcuts wenn User tippt
    if (
      active &&
      active.matches('input, textarea, [contenteditable="true"]')
    ) {
      return;
    }

    // Key repeat blockieren (wenn Taste gehalten wird)
    if (e.repeat) return;

    const v = document.querySelector('video');
    if (!v) return;

    // Throttle (max 1 Aktion alle 250ms)
    const now = Date.now();
    if (window.__skipKeyCooldown && now < window.__skipKeyCooldown) return;
    window.__skipKeyCooldown = now + 250;

    if (e.code === 'Space') {
      e.preventDefault(); // verhindert Scrollen
      if (v.paused) v.play();
      else v.pause();
      show();
    }

    if (e.key === 'ArrowLeft') {
      v.currentTime = Math.max(0, v.currentTime - 10);
      show();
    }

    if (e.key === 'ArrowRight') {
      v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
      show();
    }
  }, true);
})();
`;

export default function TVPage({
  item,
  apiKey,
  onSave,
  isSaved,
  onHistory,
  progress,
  saveProgress,
  onBack,
  onSettings,
  onDownloadStarted,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  downloads,
  onGoToDownloads,
}) {
  const [details, setDetails] = useState(null);
  const [seasonData, setSeasonData] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [selectedEp, setSelectedEp] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [trailerKey, setTrailerKey] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [m3u8Url, setM3u8Url] = useState(null);
  const [interceptedSubs, setInterceptedSubs] = useState([]);
  const [playerSource, setPlayerSource] = useState(
    () => storage.get("playerSource") || "videasy",
  );
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  // Derived from playerSource, computed once per render instead of 5-6× inline
  const isAsync = useMemo(() => sourceIsAsync(playerSource), [playerSource]);
  const supportsProgress = useMemo(
    () => sourceSupportsProgress(playerSource),
    [playerSource],
  );
  const currentSourceLabel = useMemo(
    () => PLAYER_SOURCES.find((s) => s.id === playerSource)?.label ?? "Source",
    [playerSource],
  );
  const [dubMode, setDubMode] = useState(
    () => storage.get("allmangaDubMode") || "sub",
  );
  // 9anime async URL resolution
  const [resolvedPlayerUrl, setResolvedPlayerUrl] = useState(null);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const [anilistData, setAnilistData] = useState(null);
  const [anilistSeasons, setAnilistSeasons] = useState(null); // [{seasonNum, title, episodes, year}]
  // Webview loading overlay
  const [webviewLoading, setWebviewLoading] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const sourceRef = useRef(null);
  const playerWrapRef = useRef(null);
  const webviewRef = useRef(null);
  // Always-current refs for interval callbacks, avoids stale closures without restarting the interval
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  const onMarkWatchedRef = useRef(onMarkWatched);
  onMarkWatchedRef.current = onMarkWatched;

  // Derived: detect anime before any effects so effects can use it
  const isAnime = useMemo(
    () => isAnimeContent(item, details),
    [item.id, details],
  );
  const [downloaderFolder, setDownloaderFolder] = useState(
    () => storage.get("downloaderFolder") || "",
  );
  const [epMenu, setEpMenu] = useState(null); // { x, y, pk }

  // Blocked request stats, reset key includes season+episode so counter resets on each ep
  const blockedResetKey = `${item.id}_s${selectedSeason}_e${selectedEp?.episode_number ?? 0}`;
  const {
    sessionTotal: blockedSession,
    alltimeTotal: blockedAlltime,
    showModal: showBlockedModal,
    setShowModal: setShowBlockedModal,
    getSessionDomains: getBlockedDomains,
  } = useBlockedStats(blockedResetKey);

  // Age rating
  const [rating, setRating] = useState({ cert: null, minAge: null });
  const ageLimitSetting = useMemo(() => getAgeLimitSetting(storage), []);
  const ratingCountry = useMemo(() => getRatingCountry(storage), []);
  const restricted = isRestricted(rating.minAge, ageLimitSetting);
  const [seasonMenu, setSeasonMenu] = useState(null); // { x, y, seasonNum }

  // Read threshold from settings (default 20s), stable across renders
  const [watchedThreshold] = useState(
    () => storage.get("watchedThreshold") ?? 20,
  );
  const autoMarkedRef = useRef(false);
  const lastKnownTimeRef = useRef(0);
  const seekBackCooldownRef = useRef(0);

  useEffect(() => {
    setLoading(true);
    tmdbFetch(`/tv/${item.id}`, apiKey)
      .then((d) => {
        setDetails(d);
        const first =
          d.seasons?.find((s) => s.season_number > 0) || d.seasons?.[0];
        if (first) setSelectedSeason(first.season_number);
      })
      .catch(() => setDetails(item))
      .finally(() => setLoading(false));
  }, [item.id, apiKey]);

  useEffect(() => {
    tmdbFetch(`/tv/${item.id}/videos`, apiKey)
      .then((data) => {
        const videos = data.results || [];
        const trailer =
          videos.find((v) => v.type === "Trailer" && v.site === "YouTube") ||
          videos.find((v) => v.site === "YouTube");
        if (trailer) setTrailerKey(trailer.key);
      })
      .catch(() => {});
  }, [item.id, apiKey]);

  useEffect(() => {
    fetchTVRating(item.id, apiKey, ratingCountry).then(setRating);
  }, [item.id, apiKey, ratingCountry]);

  useEffect(() => {
    if (!apiKey || !item.id) return;
    setLoadingSeason(true);
    setSelectedEp(null);
    setPlaying(false);
    // When using AniList seasons on a TMDB single-season show, always fetch TMDB S1
    // (all episodes live there); slicing into virtual seasons is done client-side.
    const tmdbSeasonToFetch =
      isAnime && anilistSeasons?.length > 0 && tmdbSeasons.length <= 1
        ? 1
        : selectedSeason;
    tmdbFetch(`/tv/${item.id}/season/${tmdbSeasonToFetch}`, apiKey)
      .then(setSeasonData)
      .catch(() => {})
      .finally(() => setLoadingSeason(false));
  }, [item.id, selectedSeason, apiKey]);

  // Reset m3u8 URL, subtitle URL and source menu whenever the series, episode, or source changes
  useEffect(() => {
    setM3u8Url(null);
    setInterceptedSubs([]);
    setShowSourceMenu(false);
    setResolvedPlayerUrl(null);
    setResolvingUrl(false);
    setResolveError(null);
    setWebviewLoading(true); // instantly blank the player on every source/episode switch
  }, [
    item.id,
    selectedEp?.episode_number,
    selectedSeason,
    playerSource,
    dubMode,
  ]);

  // Fetch AniList metadata + auto-set anime source
  useEffect(() => {
    setAnilistData(null);
    setAnilistSeasons(null);
    if (isAnime) {
      fetchAnilistData(item.name || item.title, "ANIME", item.id).then(
        (data) => {
          if (data) {
            setAnilistData(data);
            const seasons = buildAnilistSeasons(data);
            if (seasons?.length) setAnilistSeasons(seasons);
          }
        },
      );
      // Switch to anime source if current source is not an anime source
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (!currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(savedSrc?.tag ? saved : ANIME_DEFAULT_SOURCE);
      }
    } else {
      // Switch back to non-anime source if current source is anime-only
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(!savedSrc?.tag ? saved : NON_ANIME_DEFAULT_SOURCE);
      }
    }
  }, [item.id, isAnime]);

  // Resolve allmanga episode URL via main-process IPC (GraphQL, no CORS)
  useEffect(() => {
    if (!playing || !selectedEp || !isAsync) return;
    if (resolvedPlayerUrl || resolvingUrl) return;
    setResolvingUrl(true);
    setResolveError(null);
    const epNum = selectedEp.episode_number;
    const progressKey = `tv_${item.id}_s${selectedSeason}e${epNum}`;
    const startTime = storage.get("dlTime_" + progressKey) || 0;
    window.electron
      .resolveAllManga({
        title,
        seasonNumber: selectedSeason,
        episodeNumber: epNum,
        translationType: dubMode,
      })
      .then((res) => {
        if (res?.ok && res.url) {
          if (res.isDirectMp4 !== undefined) {
            window.electron
              .setPlayerVideo({
                url: res.url,
                referer: res.referer || "https://allmanga.to",
                startTime,
              })
              .then((r) => {
                setResolvedPlayerUrl(r.playerUrl);
                // Also expose raw url so download button can use it
                setM3u8Url(res.url);
              })
              .catch(() => setResolveError("Failed to start local player"));
          } else {
            setResolvedPlayerUrl(res.url);
          }
        } else {
          setResolveError(res?.error || "Episode not found on AllManga");
        }
      })
      .catch((e) => setResolveError(e.message || "Error"))
      .finally(() => setResolvingUrl(false));
  }, [playing, selectedEp, playerSource, selectedSeason, dubMode]);

  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onM3u8Found((url) => {
      setM3u8Url((prev) => (prev !== url ? url : prev));
    });
    return () => window.electron.offM3u8Found(handler);
  }, []);

  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onSubtitleFound(({ url, lang }) => {
      if (!url || !url.toLowerCase().includes(".vtt")) return;
      setInterceptedSubs((prev) => {
        const filtered = prev.filter((s) => s.lang !== lang);
        return [...filtered, { url, lang: lang || "unknown" }];
      });
    });
    return () => window.electron.offSubtitleFound(handler);
  }, []);

  const d = details || item;
  const title = d.name || d.title;
  const year = (d.first_air_date || "").slice(0, 4);

  // ── Season list: prefer AniList structure for anime ───────────────────────
  const tmdbSeasons = useMemo(
    () => (d.seasons || []).filter((s) => s.season_number > 0),
    [d.seasons],
  );
  const useAnilistSeasons = useMemo(
    () =>
      isAnime &&
      anilistSeasons?.length > 0 &&
      (tmdbSeasons.length <= 1 || anilistSeasons.length > tmdbSeasons.length),
    [isAnime, anilistSeasons, tmdbSeasons],
  );

  const seasons = useMemo(
    () =>
      useAnilistSeasons
        ? anilistSeasons.map((s) => ({
            season_number: s.seasonNum,
            name: s.title || `Season ${s.seasonNum}`,
            episode_count: s.episodes || 0,
          }))
        : tmdbSeasons,
    [useAnilistSeasons, anilistSeasons, tmdbSeasons],
  );

  // ── Episode slice ──────────────────────────────────────────────────────────
  const getSeasonEpisodes = useCallback(
    (rawEpisodes) => {
      if (!useAnilistSeasons || !rawEpisodes) return rawEpisodes;
      if (tmdbSeasons.length > 1) return rawEpisodes;
      let offset = 0;
      for (const s of anilistSeasons) {
        if (s.seasonNum < selectedSeason) offset += s.episodes || 0;
      }
      const count =
        anilistSeasons.find((s) => s.seasonNum === selectedSeason)?.episodes ||
        rawEpisodes.length;
      return rawEpisodes.slice(offset, offset + count).map((ep, i) => ({
        ...ep,
        episode_number: i + 1,
        _tmdbAbsolute: ep.episode_number,
      }));
    },
    [useAnilistSeasons, tmdbSeasons.length, anilistSeasons, selectedSeason],
  );

  // ── Player episode mapping
  const playerEp = useMemo(() => {
    if (!selectedEp) return { season: selectedSeason, episode: undefined };
    return {
      season: selectedSeason,
      episode: selectedEp._tmdbAbsolute ?? selectedEp.episode_number,
    };
  }, [selectedEp, selectedSeason]);

  // ── Memoized current season episodes ──────────────────────────────────────
  const currentSeasonEpisodes = useMemo(
    () => getSeasonEpisodes(seasonData?.episodes) || [],
    [getSeasonEpisodes, seasonData],
  );

  // ── Downloads lookup map: O(1) per episode instead of O(n) ───────────────
  const downloadsByEpisodeKey = useMemo(() => {
    const map = new Map();
    for (const dl of downloads || []) {
      if (
        dl.mediaType === "tv" &&
        (dl.tmdbId === item.id || dl.mediaId === item.id) &&
        (dl.status === "completed" ||
          dl.status === "local" ||
          dl.status === "downloading")
      ) {
        map.set(`s${dl.season}e${dl.episode}`, dl);
      }
    }
    return map;
  }, [downloads, item.id]);

  // Prefer AniList metadata for anime when available
  const displayOverview = useMemo(
    () =>
      isAnime && anilistData?.description
        ? cleanAnilistDescription(anilistData.description)
        : d.overview,
    [isAnime, anilistData?.description, d.overview],
  );
  const displayScore = useMemo(
    () =>
      isAnime && anilistData?.averageScore
        ? (anilistData.averageScore / 10).toFixed(1)
        : d.vote_average > 0
          ? d.vote_average.toFixed(1)
          : null,
    [isAnime, anilistData?.averageScore, d.vote_average],
  );
  const displayGenres = useMemo(
    () =>
      isAnime && anilistData?.genres?.length
        ? anilistData.genres.map((g, i) => ({ id: i, name: g }))
        : d.genres || [],
    [isAnime, anilistData?.genres, d.genres],
  );

  // ── Season watched helpers ─────────────────────────────────────────────────
  // Memoized map: seasonNum → boolean. Recomputed only when watched/seasons change,
  // not on every render from the 5s progress interval.
  const seasonWatchedMap = useMemo(() => {
    const map = {};
    for (const s of seasons) {
      const num = s.season_number;
      const count =
        num === selectedSeason
          ? currentSeasonEpisodes.length || s.episode_count || 0
          : s.episode_count || 0;
      if (!count) {
        map[num] = false;
        continue;
      }
      let allWatched = true;
      for (let i = 1; i <= count; i++) {
        if (!watched?.[`tv_${item.id}_s${num}e${i}`]) {
          allWatched = false;
          break;
        }
      }
      map[num] = allWatched;
    }
    return map;
  }, [seasons, selectedSeason, currentSeasonEpisodes, watched, item.id]);

  const isSeasonWatched = useCallback(
    (seasonNum) => seasonWatchedMap[seasonNum] ?? false,
    [seasonWatchedMap],
  );

  const markSeasonWatched = useCallback(
    (seasonNum) => {
      const seasonInfo = seasons.find((s) => s.season_number === seasonNum);
      const episodes =
        seasonNum === selectedSeason ? currentSeasonEpisodes : null;
      const count = episodes?.length || seasonInfo?.episode_count || 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (let i = 1; i <= count; i++) {
        if (episodes) {
          const ep = episodes.find((e) => e.episode_number === i);
          if (ep?.air_date && new Date(ep.air_date) > today) continue;
        }
        onMarkWatched?.(`tv_${item.id}_s${seasonNum}e${i}`);
      }
    },
    [seasons, selectedSeason, currentSeasonEpisodes, item.id, onMarkWatched],
  );

  const markSeasonUnwatched = useCallback(
    (seasonNum) => {
      const seasonInfo = seasons.find((s) => s.season_number === seasonNum);
      const episodes =
        seasonNum === selectedSeason ? currentSeasonEpisodes : null;
      const count = episodes?.length || seasonInfo?.episode_count || 0;
      for (let i = 1; i <= count; i++) {
        onMarkUnwatched?.(`tv_${item.id}_s${seasonNum}e${i}`);
      }
    },
    [seasons, selectedSeason, currentSeasonEpisodes, item.id, onMarkUnwatched],
  );

  const currentProgressKey = selectedEp
    ? `tv_${item.id}_s${selectedSeason}e${selectedEp.episode_number}`
    : null;

  // Check if currently-playing episode is already downloaded or downloading
  const currentEpDownload = selectedEp
    ? (downloadsByEpisodeKey.get(
        `s${selectedSeason}e${selectedEp.episode_number}`,
      ) ?? null)
    : null;

  // Reset auto-mark guard when episode changes
  useEffect(() => {
    autoMarkedRef.current = false;
    lastKnownTimeRef.current = 0;
    seekBackCooldownRef.current = 0;
  }, [currentProgressKey]);

  // Show loader instantly when playback starts
  useEffect(() => {
    if (playing) setWebviewLoading(true);
  }, [playing]);

  // Attach webview load events so we know when the new source has painted
  useEffect(() => {
    if (!playing) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const done = () => setWebviewLoading(false);
    wv.addEventListener("did-finish-load", done);
    wv.addEventListener("did-fail-load", done);
    return () => {
      wv.removeEventListener("did-finish-load", done);
      wv.removeEventListener("did-fail-load", done);
    };
  }, [playing, playerSource, item.id, selectedEp?.episode_number]);

  // ── Auto-track progress + auto-watched every 5s ──────────────────────────
  useEffect(() => {
    if (!playing || !currentProgressKey) return;
    let interval = null;
    const timer = setTimeout(() => {
      interval = setInterval(async () => {
        try {
          const wv = webviewRef.current;
          if (!wv) return;
          const result = await wv.executeJavaScript(`
            (() => {
              const v = document.querySelector('video')
              if (!v || !v.duration || v.duration === Infinity || v.paused) return null
              // Re-attach seek tracker if video element was recreated (e.g. quality change)
              if (!v._seekTracked) {
                v._seekTracked = true
                v.addEventListener('seeked', () => {
                  v._lastUserSeek = Date.now()
                  v._lastUserSeekTo = v.currentTime
                })
              }
              return {
                currentTime: v.currentTime,
                duration: v.duration,
                recentUserSeek: v._lastUserSeek ? (Date.now() - v._lastUserSeek < 6000) : false,
                lastUserSeekTo: v._lastUserSeekTo ?? null,
              }
            })()
          `);
          if (result && result.duration > 0) {
            const ct = result.currentTime;

            // ── Resolution-change reset detection ──────────────────────────
            // Videasy resets to 0 on quality change. We only seek back if:
            // - ct is near zero (≤5s)
            // - we were well into the video (>30s)
            // - the user did NOT manually seek in the last 6s
            const now = Date.now();
            if (
              lastKnownTimeRef.current > 30 &&
              ct <= 5 &&
              !result.recentUserSeek
            ) {
              if (now > seekBackCooldownRef.current) {
                // First reset: seek back and start cooldown
                const seekTo = lastKnownTimeRef.current;
                seekBackCooldownRef.current = now + 8000;
                try {
                  await wv.executeJavaScript(`
                    (() => {
                      const v = document.querySelector('video')
                      if (v) v.currentTime = ${seekTo}
                    })()
                  `);
                } catch {}
              }
              // In both cases (first reset or cooldown): skip progress save with wrong position
              return;
            }

            // If user seeked, update ref to their chosen position immediately
            if (result.recentUserSeek && result.lastUserSeekTo !== null) {
              lastKnownTimeRef.current = result.lastUserSeekTo;
            } else {
              lastKnownTimeRef.current = ct;
            }
            const p = Math.floor((ct / result.duration) * 100);
            saveProgressRef.current(currentProgressKey, Math.min(p, 100));
            // Also persist actual seconds so DownloadsPage can show resume position
            storage.set("dlTime_" + currentProgressKey, Math.floor(ct));

            // Auto-mark watched when remaining time ≤ threshold
            const remaining = result.duration - ct;
            if (
              !autoMarkedRef.current &&
              remaining <= watchedThreshold &&
              remaining >= 0
            ) {
              autoMarkedRef.current = true;
              onMarkWatchedRef.current?.(currentProgressKey);
            }
          }
        } catch {}
      }, 5000);
    }, 3000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [playing, currentProgressKey, watchedThreshold, playerSource]);

  // Skip backward/forward by N seconds via webview JS injection
  const seekBy = useCallback(async (seconds) => {
    try {
      const wv = webviewRef.current;
      if (!wv) return;
      await wv.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + ${seconds}));
        })()
      `);
    } catch {}
  }, []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !playing || playerSource !== "allmanga") return;

    const inject = () => {
      wv.executeJavaScript(INJECT_SKIP_CONTROLS).catch(() => {});
    };

    wv.addEventListener("dom-ready", inject);

    try {
      inject();
    } catch {}

    return () => {
      wv.removeEventListener("dom-ready", inject);
      try {
        wv.executeJavaScript(`
          (() => {
            const el = document.getElementById('__skip-ui');
            if (el) el.remove();
            window.__skipControlsInjected = false;
          })()
        `);
      } catch {}
    };
  }, [playing, playerSource]);

  const playEpisode = useCallback(
    (ep) => {
      setM3u8Url(null);
      setInterceptedSubs([]);
      setResolvedPlayerUrl(null);
      setResolvingUrl(false);
      setResolveError(null);
      setSelectedEp(ep);
      setPlaying(true);
      onHistory({
        ...d,
        media_type: "tv",
        season: selectedSeason,
        episode: ep.episode_number,
        episodeName: ep.name,
      });
      // d and selectedSeason are stable within a season view; onHistory is useCallback in App
    },
    [d, selectedSeason, onHistory],
  );

  const handleSetDownloaderFolder = useCallback((folder) => {
    setDownloaderFolder(folder);
    storage.set("downloaderFolder", folder);
  }, []);

  // Intercept fullscreen requests from embedded players (vidsrc / 2embed use
  // the native Fullscreen API which would otherwise fullscreen the entire app).
  // Videasy and AllManga handle fullscreen internally via CSS, skip those.
  useEffect(() => {
    if (!playing) return;
    if (!NEEDS_INTERCEPT.includes(playerSource)) return;
    const enterH = window.electron?.onWebviewEnterFullscreen?.(() => {
      playerWrapRef.current?.requestFullscreen?.();
    });
    const leaveH = window.electron?.onWebviewLeaveFullscreen?.(() => {
      if (document.fullscreenElement) document.exitFullscreen?.();
    });
    return () => {
      if (enterH) window.electron?.offWebviewEnterFullscreen?.(enterH);
      if (leaveH) window.electron?.offWebviewLeaveFullscreen?.(leaveH);
    };
  }, [playing, playerSource]);

  const effectiveYear =
    year ||
    (isAnime && anilistData?.startDate?.year
      ? String(anilistData.startDate.year)
      : "");
  const mediaName = selectedEp
    ? `${title}${effectiveYear ? ` (${effectiveYear})` : ""} S${String(selectedSeason).padStart(2, "0")} E${String(selectedEp.episode_number).padStart(2, "0")}`
    : title;

  const currentEpWatched = currentProgressKey
    ? !!watched?.[currentProgressKey]
    : false;

  return (
    <div className="fade-in">
      {loading && (
        <div className="loader">
          <div className="spinner" />
        </div>
      )}
      {!loading && (
        <>
          <div className="detail-hero">
            <div
              className="detail-bg"
              style={{
                backgroundImage: `url(${imgUrl(d.backdrop_path, "original")})`,
              }}
            />
            <div className="detail-gradient" />
            <div className="detail-content">
              <div className="detail-poster">
                {d.poster_path ? (
                  <img src={imgUrl(d.poster_path)} alt={title} loading="lazy" />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text3)",
                    }}
                  >
                    <TVIcon />
                  </div>
                )}
              </div>
              <div className="detail-info">
                <div className="detail-type">Series</div>
                <div className="detail-title">{title}</div>
                <div className="genres">
                  {displayGenres.map((g) => (
                    <span key={g.id} className="genre-tag">
                      {g.name}
                    </span>
                  ))}
                </div>
                <div className="detail-meta">
                  {displayScore && (
                    <span className="detail-rating">
                      <StarIcon /> {displayScore}
                    </span>
                  )}
                  {year && <span>{year}</span>}
                  {d.number_of_seasons && (
                    <span>{d.number_of_seasons} Seasons</span>
                  )}
                  {d.number_of_episodes && (
                    <span>{d.number_of_episodes} Episodes</span>
                  )}
                </div>
                {rating.cert && (
                  <div
                    className={`age-rating-pill${restricted ? " age-rating-pill--restricted" : ""}`}
                  >
                    {restricted ? (
                      <RatingLockIcon size={13} />
                    ) : (
                      <RatingShieldIcon size={13} />
                    )}
                    <span className="age-rating-pill-cert">{rating.cert}</span>
                    {restricted && (
                      <span className="age-rating-pill-label">
                        Inappropriate for your age setting
                      </span>
                    )}
                  </div>
                )}
                <p className="detail-overview">{displayOverview}</p>
                <div className="detail-actions">
                  {trailerKey &&
                    (restricted ? (
                      <button
                        className="btn btn-secondary btn-restricted"
                        disabled
                        title="Inappropriate for your age rating setting"
                      >
                        🔒 Trailer
                      </button>
                    ) : (
                      <button
                        className="btn btn-secondary"
                        onClick={() => setShowTrailer(true)}
                      >
                        <TrailerIcon /> Trailer
                      </button>
                    ))}
                  <button className="btn btn-secondary" onClick={onSave}>
                    {isSaved ? <BookmarkFillIcon /> : <BookmarkIcon />}
                    {isSaved ? "Saved" : "Save"}
                  </button>
                  <button className="btn btn-ghost" onClick={onBack}>
                    <BackIcon /> Back
                  </button>
                </div>
              </div>
            </div>
          </div>

          {playing && selectedEp && (
            <div className="section">
              <div
                style={{
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span className="tag tag-red">
                  Season {selectedSeason} · E{selectedEp.episode_number}
                </span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>
                  {selectedEp.name}
                </span>
                {currentEpWatched ? (
                  <button
                    className="btn btn-ghost watched-btn"
                    style={{ marginLeft: "auto" }}
                    onClick={() => onMarkUnwatched?.(currentProgressKey)}
                  >
                    <WatchedIcon size={14} /> Watched
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost"
                    style={{ marginLeft: "auto" }}
                    onClick={() => onMarkWatched?.(currentProgressKey)}
                  >
                    ✓ Mark Watched
                  </button>
                )}
              </div>
              <div className="player-wrap" ref={playerWrapRef}>
                {/* Universal source-loading overlay – shown instantly on every source/episode switch */}
                {webviewLoading && !resolveError && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 10,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(0,0,0,0.92)",
                      gap: 14,
                      borderRadius: "inherit",
                    }}
                  >
                    <div className="spinner" />
                    <span style={{ fontSize: 14, color: "var(--text2)" }}>
                      {resolvingUrl
                        ? "Looking up episode on AllManga…"
                        : `Loading ${PLAYER_SOURCES.find((s) => s.id === playerSource)?.label ?? "source"}…`}
                    </span>
                  </div>
                )}
                {/* 9anime: error if lookup failed */}
                {isAsync && resolveError && !resolvingUrl && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 10,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(0,0,0,0.85)",
                      gap: 10,
                      borderRadius: "inherit",
                    }}
                  >
                    <span style={{ fontSize: 28 }}>⚠️</span>
                    <span style={{ fontSize: 14, color: "var(--text2)" }}>
                      Episode not found on AllManga
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>
                      {resolveError}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>
                      Try a different source, or switch sub/dub.
                    </span>
                  </div>
                )}
                <webview
                  ref={webviewRef}
                  src={
                    isAsync
                      ? resolvedPlayerUrl || "about:blank"
                      : getSourceUrl(
                          playerSource,
                          "tv",
                          item.id,
                          playerEp.season,
                          playerEp.episode,
                          title,
                        )
                  }
                  partition="persist:videasy"
                  allowpopups="false"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    border: "none",
                    outline: "none",
                    boxShadow: "none",
                    background: "black",
                    visibility:
                      webviewLoading || (isAsync && !resolvedPlayerUrl)
                        ? "hidden"
                        : "visible",
                  }}
                  tabIndex={-1}
                />
                {/* Left-side overlay button group, flex row, no fixed px offsets */}
                <div className="player-overlay-group">
                  <button
                    ref={sourceRef}
                    className="player-overlay-btn"
                    onClick={() => {
                      const rect = sourceRef.current?.getBoundingClientRect();
                      if (rect)
                        setMenuPos({ top: rect.bottom + 6, left: rect.left });
                      setShowSourceMenu((v) => !v);
                    }}
                    title="Change source"
                  >
                    <SourceIcon />
                    {PLAYER_SOURCES.find((s) => s.id === playerSource)?.label ??
                      "Source"}
                  </button>
                  {/* Sub/Dub toggle, only for AllManga */}
                  {playerSource === "allmanga" && (
                    <button
                      className="player-overlay-btn"
                      onClick={() => {
                        const next = dubMode === "sub" ? "dub" : "sub";
                        setDubMode(next);
                        storage.set("allmangaDubMode", next);
                        setM3u8Url(null);
                        setInterceptedSubs([]);
                        setResolvedPlayerUrl(null);
                        setResolvingUrl(false);
                        setResolveError(null);
                      }}
                      title="Toggle Sub/Dub"
                    >
                      {dubMode === "sub" ? "SUB" : "DUB"}
                    </button>
                  )}
                  {/* Blocked ads & trackers button */}
                  <button
                    className="player-overlay-btn"
                    onClick={() => setShowBlockedModal(true)}
                    title="Blocked ads & trackers"
                  >
                    <ShieldBlockIcon />
                    {blockedSession > 0 && (
                      <span className="player-blocked-badge">
                        {blockedSession}
                      </span>
                    )}
                  </button>
                </div>
                {showSourceMenu && menuPos && (
                  <div
                    className="source-dropdown source-dropdown--fixed"
                    style={{ top: menuPos.top, left: menuPos.left }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {PLAYER_SOURCES.map((src) => (
                      <button
                        key={src.id}
                        className={
                          "source-dropdown__item" +
                          (playerSource === src.id
                            ? " source-dropdown__item--active"
                            : "")
                        }
                        onClick={() => {
                          setPlayerSource(src.id);
                          storage.set("playerSource", src.id);
                          setShowSourceMenu(false);
                          setM3u8Url(null);
                          setInterceptedSubs([]);
                          setResolvedPlayerUrl(null);
                          setResolvingUrl(false);
                          setResolveError(null);
                        }}
                      >
                        <span>{src.label}</span>
                        {src.tag && (
                          <span className="source-dropdown__tag">
                            {src.tag}
                          </span>
                        )}
                        {src.note && (
                          <span className="source-dropdown__note">
                            {src.note}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="player-overlay-btn"
                  onClick={() =>
                    currentEpDownload
                      ? onGoToDownloads?.(currentEpDownload.id)
                      : (setShowSourceMenu(false), setShowDownload(true))
                  }
                  title={
                    currentEpDownload
                      ? currentEpDownload.status === "downloading"
                        ? "Downloading… - view in Downloads"
                        : "Already downloaded - view in Downloads"
                      : "Download"
                  }
                >
                  {currentEpDownload ? (
                    <span
                      className="player-downloaded-icon"
                      style={{
                        color:
                          currentEpDownload.status === "downloading"
                            ? "var(--red)"
                            : "#4caf50",
                      }}
                    >
                      {currentEpDownload.status === "downloading" ? "↓" : "✓"}
                    </span>
                  ) : (
                    <DownloadIcon />
                  )}
                  {!currentEpDownload && m3u8Url && (
                    <span className="player-overlay-dot" />
                  )}
                  {!supportsProgress && (
                    <span
                      className="player-no-progress-hint"
                      title="No automatic progress tracking for this source"
                    >
                      ⚠ no tracking
                    </span>
                  )}
                </button>

                {/* Skip controls are injected directly into the webview DOM*/}
              </div>

              {currentProgressKey &&
                (() => {
                  const epPct = progress[currentProgressKey] || 0;
                  return epPct > 0 ? (
                    <div className="progress-bar-row">
                      <div className="progress-bar-outer">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${Math.min(epPct, 100)}%` }}
                        />
                      </div>
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>
                        {epPct.toFixed(0)}% watched
                      </span>
                    </div>
                  ) : null;
                })()}
              {currentProgressKey && (
                <div className="progress-mark-row">
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text3)",
                      marginRight: 4,
                    }}
                  >
                    Mark progress:
                  </span>
                  {[25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      className="btn btn-ghost"
                      style={{ padding: "5px 14px", fontSize: 12 }}
                      onClick={() => saveProgress(currentProgressKey, p)}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="section">
            <div className="section-title">Episodes</div>
            {seasons.length > 0 && (
              <div className="season-selector">
                {seasons.map((s) => {
                  const sw = isSeasonWatched(s.season_number);
                  return (
                    <button
                      key={s.season_number}
                      className={`season-btn ${selectedSeason === s.season_number ? "active" : ""} ${sw ? "season-watched" : ""}`}
                      onClick={() => setSelectedSeason(s.season_number)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSeasonMenu({
                          x: e.clientX,
                          y: e.clientY,
                          seasonNum: s.season_number,
                        });
                      }}
                      title="Right-click to mark season as watched/unwatched"
                    >
                      {sw && <span className="season-watched-icon">✓</span>}
                      Season {s.season_number}
                    </button>
                  );
                })}
              </div>
            )}
            {loadingSeason && (
              <div className="loader">
                <div className="spinner" />
              </div>
            )}
            {!loadingSeason && seasonData?.episodes && (
              <div className="episodes-grid">
                {currentSeasonEpisodes.map((ep) => (
                  <EpisodeCard
                    key={ep.episode_number}
                    ep={ep}
                    itemId={item.id}
                    selectedSeason={selectedSeason}
                    progress={progress}
                    watched={watched}
                    playing={playing}
                    selectedEpNumber={selectedEp?.episode_number}
                    downloadsByEpisodeKey={downloadsByEpisodeKey}
                    restricted={restricted}
                    onPlay={playEpisode}
                    onContextMenu={setEpMenu}
                    onGoToDownloads={onGoToDownloads}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {showTrailer && trailerKey && (
        <TrailerModal
          trailerKey={trailerKey}
          title={title}
          onClose={() => setShowTrailer(false)}
        />
      )}

      {epMenu && (
        <EpisodeContextMenu
          x={epMenu.x}
          y={epMenu.y}
          isWatched={!!watched?.[epMenu.pk]}
          onMarkWatched={() => onMarkWatched?.(epMenu.pk)}
          onMarkUnwatched={() => onMarkUnwatched?.(epMenu.pk)}
          onClose={() => setEpMenu(null)}
        />
      )}

      {seasonMenu && (
        <SeasonContextMenu
          x={seasonMenu.x}
          y={seasonMenu.y}
          isWatched={isSeasonWatched(seasonMenu.seasonNum)}
          onMarkWatched={() => markSeasonWatched(seasonMenu.seasonNum)}
          onMarkUnwatched={() => markSeasonUnwatched(seasonMenu.seasonNum)}
          onClose={() => setSeasonMenu(null)}
        />
      )}

      {showBlockedModal && (
        <BlockedStatsModal
          sessionDomains={getBlockedDomains()}
          sessionTotal={blockedSession}
          alltimeTotal={blockedAlltime}
          onClose={() => setShowBlockedModal(false)}
        />
      )}

      {showDownload && (
        <DownloadModal
          onClose={() => setShowDownload(false)}
          m3u8Url={m3u8Url}
          subtitles={interceptedSubs}
          mediaName={mediaName}
          downloaderFolder={downloaderFolder}
          setDownloaderFolder={handleSetDownloaderFolder}
          onOpenSettings={onSettings}
          onDownloadStarted={onDownloadStarted}
          mediaId={item.id}
          mediaType="tv"
          season={selectedSeason}
          episode={selectedEp?.episode_number}
          posterPath={d.poster_path}
          tmdbId={item.id}
        />
      )}
    </div>
  );
}

// ── EpisodeCard ────────────────────────────────────────────────────────────
// Isolated memo'd component so progress-bar updates (every 5s) only re-render
// the one currently-playing card, not all 24+ cards in the grid.
const _todayForEpisodes = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

const EpisodeCard = memo(function EpisodeCard({
  ep,
  itemId,
  selectedSeason,
  progress,
  watched,
  playing,
  selectedEpNumber,
  downloadsByEpisodeKey,
  restricted,
  onPlay,
  onContextMenu,
  onGoToDownloads,
}) {
  const pk = `tv_${itemId}_s${selectedSeason}e${ep.episode_number}`;
  const epPct = progress[pk] || 0;
  const epWatched = !!watched?.[pk];
  const isPlaying = playing && selectedEpNumber === ep.episode_number;
  const epUnreleased = ep.air_date
    ? new Date(ep.air_date) > _todayForEpisodes
    : false;
  const epDownload =
    downloadsByEpisodeKey.get(`s${selectedSeason}e${ep.episode_number}`) ??
    null;

  return (
    <div
      className={`episode-card ${isPlaying ? "playing" : ""} ${epWatched ? "ep-watched" : ""} ${restricted ? "episode-card--restricted" : ""} ${epUnreleased ? "episode-card--unreleased" : ""}`}
      onClick={() => (restricted || epUnreleased ? null : onPlay(ep))}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!restricted && !epUnreleased)
          onContextMenu({ x: e.clientX, y: e.clientY, pk });
      }}
      style={epUnreleased ? { cursor: "default" } : undefined}
    >
      <div className="episode-thumb">
        {ep.still_path ? (
          <img
            src={imgUrl(ep.still_path, "w300")}
            alt={ep.name}
            loading="lazy"
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text3)",
            }}
          >
            <PlayIcon />
          </div>
        )}
        {restricted ? (
          <div className="episode-restricted-overlay">
            🔒<span>Inappropriate for your age</span>
          </div>
        ) : epUnreleased ? (
          <div className="episode-restricted-overlay">
            🔒<span>Unreleased</span>
          </div>
        ) : isPlaying ? (
          <div className="episode-playing-badge">
            <span className="episode-playing-dot" />
            Playing
          </div>
        ) : (
          <div className="episode-thumb-play">
            <PlayIcon />
          </div>
        )}
      </div>
      <div className="episode-info">
        <div
          className="episode-num"
          style={{ display: "flex", alignItems: "center", gap: 5 }}
        >
          E{ep.episode_number}
          {epWatched && <WatchedIcon size={14} />}
          {epDownload && (
            <span
              className="ep-downloaded-badge"
              title={
                epDownload.status === "downloading"
                  ? "Downloading… - click to view in Downloads"
                  : "Downloaded - click to view in Downloads"
              }
              style={{
                borderColor:
                  epDownload.status === "downloading"
                    ? "rgba(229,9,20,0.5)"
                    : "rgba(72,199,116,0.5)",
                color:
                  epDownload.status === "downloading"
                    ? "var(--red)"
                    : "#4caf50",
                background:
                  epDownload.status === "downloading"
                    ? "rgba(229,9,20,0.12)"
                    : "rgba(72,199,116,0.18)",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onGoToDownloads?.(epDownload.id);
              }}
            >
              ↓
            </span>
          )}
        </div>
        <div className="episode-name">{ep.name}</div>
        <EpisodeDesc overview={ep.overview} episodeName={ep.name} />
        {!epWatched && epPct > 0 && (
          <div className="episode-progress-bar">
            <div
              className="episode-progress-fill"
              style={{ width: `${Math.min(epPct, 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
});
