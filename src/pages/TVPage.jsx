import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  memo,
} from "react";
import {
  EPISODE_GROUP_IDS,
  applyEpisodeMapping,
  buildEpisodeGroupMap,
} from "../utils/episodeMappings";
import {
  tmdbFetch,
  imgUrl,
  PLAYER_SOURCES,
  getSourceUrl,
  sourceSupportsProgress,
  sourceProgressViaFrames,
  sourceIsAsync,
  fetchAnilistData,
  fetchEpisodeGroup,
  buildAnilistSeasons,
  cleanAnilistDescription,
  isAnimeContent,
  ANIME_DEFAULT_SOURCE,
  NON_ANIME_DEFAULT_SOURCE,
  NEEDS_INTERCEPT,
  getNextNonAsyncSource,
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
  PopOutIcon,
} from "../components/Icons";
import DownloadModal from "../components/DownloadModal";
import TrailerModal from "../components/TrailerModal";
import BlockedStatsModal from "../components/BlockedStatsModal";
import { useBlockedStats } from "../utils/useBlockedStats";
import {
  storage,
  STORAGE_KEYS,
  getFailoverSource,
  setFailoverSource,
  clearFailoverSource,
} from "../utils/storage";
import { useAutoplay } from "../utils/useAutoplay";
import { fetchAniSkipTimings } from "../utils/aniSkip";
import {
  fetchTVRating,
  isRestricted,
  getAgeLimitSetting,
  getRatingCountry,
} from "../utils/ageRating";

// ── Partial-circle progress icon (cached per pct tier) ───────────────────────
// Uses a single SVG arc. Three instances (25/50/75)
function _makePartialCircle(pct) {
  const r = 5;
  const cx = 7;
  const cy = 7;
  const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2;
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);
  const large = pct > 50 ? 1 : 0;
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        marginRight: 4,
        flexShrink: 0,
      }}
    >
      {/* Background ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.25"
      />
      {/* Filled arc */}
      <path
        d={`M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(3)} ${y.toFixed(3)} L ${cx} ${cy} Z`}
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}
const _CIRCLE_25 = _makePartialCircle(25);
const _CIRCLE_50 = _makePartialCircle(50);
const _CIRCLE_75 = _makePartialCircle(75);
const _CIRCLE_MAP = { 25: _CIRCLE_25, 50: _CIRCLE_50, 75: _CIRCLE_75 };
function PartialCircleIcon({ pct }) {
  return _CIRCLE_MAP[pct] ?? null;
}

// Generic context menu (used for both episode and season actions)
function ContextMenu({
  x,
  y,
  isWatched,
  hasProgress,
  watchedLabel,
  unwatchedLabel,
  onMarkWatched,
  onMarkUnwatched,
  onMarkNotStarted,
  onClose,
}) {
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
          ↩ {unwatchedLabel}
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
          ✓ {watchedLabel}
        </button>
      )}
      {onMarkNotStarted && !isWatched && hasProgress && (
        <button
          className="context-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onMarkNotStarted();
            onCloseRef.current();
          }}
        >
          ⊘ Mark as Not Started
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
  playerSettings,
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
  const [failedSeasons, setFailedSeasons] = useState(() => new Set()); // season numbers which give 404 on TMDB
  const [selectedSeason, setSelectedSeason] = useState(() =>
    item.season != null ? Number(item.season) : 1,
  );
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
    () => storage.get("playerSource") || NON_ANIME_DEFAULT_SOURCE,
  );
  // Accent colour + subtitle lang come from App-level state (via props),
  // so they are always fresh after Settings save without any extra storage reads.
  const playerAccentColor = playerSettings?.accentColor ?? null;
  const playerSubLang = playerSettings?.subtitleLang ?? null;
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  // Derived from playerSource, computed once per render instead of 5-6× inline
  const isAsync = useMemo(() => sourceIsAsync(playerSource), [playerSource]);
  const supportsProgress = useMemo(
    () => sourceSupportsProgress(playerSource),
    [playerSource],
  );
  const progressViaFrames = useMemo(
    () => sourceProgressViaFrames(playerSource),
    [playerSource],
  );
  const [dubMode, setDubMode] = useState(
    () => storage.get(STORAGE_KEYS.ALLMANGA_DUB_MODE) || "sub",
  );
  // async URL resolution
  const [resolvedPlayerUrl, setResolvedPlayerUrl] = useState(null);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  // Refs mirror the above so the resolve-effect can guard without stale closures
  const resolvingUrlRef = useRef(false);
  const resolvedPlayerUrlRef = useRef(null);
  const [anilistData, setAnilistData] = useState(null);
  const [anilistSeasons, setAnilistSeasons] = useState(null); // [{seasonNum, title, episodes, year}]
  const [anilistLoading, setAnilistLoading] = useState(false);
  const [episodeGroupData, setEpisodeGroupData] = useState(null); // Raw TMDB episode group response
  const [episodeGroupMap, setEpisodeGroupMap] = useState(null); // Map built from TMDB episode group
  // Webview loading overlay
  const [webviewLoading, setWebviewLoading] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [pipOpen, setPipOpen] = useState(false);
  const pipUrlRef = useRef(null);
  const pipWebContentsIdRef = useRef(null); // cached WebContents ID of the pop-out window
  const [menuPos, setMenuPos] = useState(null);
  // AniSkip
  const [skipTimings, setSkipTimings] = useState(null); // { intro?, outro? }
  const [skipPrompt, setSkipPrompt] = useState(null); // "intro" | "outro" | null
  const [introSkipMode] = useState(
    () => storage.get(STORAGE_KEYS.INTRO_SKIP_MODE) || "off",
  );
  const sourceRef = useRef(null);
  const playerWrapRef = useRef(null);
  const webviewRef = useRef(null);
  // Always-current refs for interval callbacks, avoids stale closures without restarting the interval
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  const onMarkWatchedRef = useRef(onMarkWatched);
  onMarkWatchedRef.current = onMarkWatched;
  const watchedRef = useRef(watched);
  watchedRef.current = watched;

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

  const resetAutoplayRef = useRef(() => {});
  const triggerAutoplayRef = useRef(() => {});
  const setCountdownStartedRef = useRef(() => {});
  const localCountdownStartedRef = useRef(false);

  // Read threshold from settings (default 20s), stable across renders
  const [watchedThreshold] = useState(
    () => storage.get("watchedThreshold") ?? 20,
  );
  const autoMarkedRef = useRef(false);
  const lastKnownTimeRef = useRef(0);
  const durationRef = useRef(0); // tracked for AniSkip progress bar markers
  const seekBackCooldownRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    tmdbFetch(`/tv/${item.id}`, apiKey)
      .then((d) => {
        if (!mounted) return;
        setDetails(d);
        // Only fall back when no specific season was requested
        if (item.season == null) {
          const validSeasons = (d.seasons || []).filter(
            (s) => s.season_number > 0,
          );
          // Find the lowest season that isn't fully watched
          const incomplete = validSeasons.find((s) => {
            const count = s.episode_count || 0;
            if (!count) return false;
            for (let i = 1; i <= count; i++) {
              if (
                !watchedRef.current?.[`tv_${item.id}_s${s.season_number}e${i}`]
              )
                return true;
            }
            return false;
          });
          const target = incomplete || validSeasons[0] || d.seasons?.[0];
          if (target) setSelectedSeason(target.season_number);
        }
      })
      .catch(() => {
        if (mounted) setDetails(item);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);

  // ── Fetch episode group mapping if this show has one ─────────────────────
  useEffect(() => {
    const groupId = EPISODE_GROUP_IDS[Number(item.id)];
    if (!groupId || !apiKey) {
      setEpisodeGroupData(null);
      setEpisodeGroupMap(null);
      return;
    }
    let mounted = true;
    fetchEpisodeGroup(groupId, apiKey)
      .then((data) => {
        if (!mounted) return;
        setEpisodeGroupData(data);
        setEpisodeGroupMap(buildEpisodeGroupMap(data));
      })
      .catch(() => {
        if (mounted) {
          setEpisodeGroupData(null);
          setEpisodeGroupMap(null);
        }
      });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);

  useEffect(() => {
    let mounted = true;
    tmdbFetch(`/tv/${item.id}/videos`, apiKey)
      .then((data) => {
        if (!mounted) return;
        const videos = data.results || [];
        const trailer =
          videos.find((v) => v.type === "Trailer" && v.site === "YouTube") ||
          videos.find((v) => v.site === "YouTube");
        if (trailer) setTrailerKey(trailer.key);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);

  useEffect(() => {
    let mounted = true;
    fetchTVRating(item.id, apiKey, ratingCountry).then((r) => {
      if (mounted) setRating(r);
    });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey, ratingCountry]);

  useEffect(() => {
    if (!apiKey || !item.id) return;
    // Episode group data already contains all episodes -> no TMDB season fetch
    if (episodeGroupData) {
      setSelectedEp(null);
      setPlaying(false);
      setSeasonData(null);
      setLoadingSeason(false);
      return;
    }
    setLoadingSeason(true);
    setSelectedEp(null);
    setPlaying(false);
    setSeasonData(null); // clear stale episodes immediately
    // AniList virtual seasons on a single-season show: always fetch TMDB S1.
    const tmdbSeasonToFetch =
      isAnime && anilistSeasons?.length > 0 && tmdbSeasons.length <= 1
        ? 1
        : selectedSeason;
    let mounted = true;
    tmdbFetch(`/tv/${item.id}/season/${tmdbSeasonToFetch}`, apiKey)
      .then((d) => {
        if (mounted) setSeasonData(d);
      })
      .catch(() => {
        if (mounted) {
          setSeasonData(null);
          // Record this season as unavailable (e.g. TMDB has no episode data for it)
          if (selectedSeason === 0) {
            setFailedSeasons((prev) => new Set([...prev, selectedSeason]));
          }
        }
      })
      .finally(() => {
        if (mounted) setLoadingSeason(false);
      });
    return () => {
      mounted = false;
    };
  }, [item.id, selectedSeason, apiKey, anilistSeasons]);

  // Reset m3u8 URL, subtitle URL and source menu whenever the series, episode, or source changes
  useEffect(() => {
    setM3u8Url(null);
    setInterceptedSubs([]);
    setShowSourceMenu(false);
    resolvedPlayerUrlRef.current = null;
    setResolvedPlayerUrl(null);
    resolvingUrlRef.current = false;
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
    let mounted = true;
    setAnilistData(null);
    setAnilistSeasons(null);
    if (isAnime) {
      setAnilistLoading(true);
      fetchAnilistData(item.name || item.title, "ANIME", item.id)
        .then((data) => {
          if (!mounted) return;
          if (data) {
            setAnilistData(data);
            const seasons = buildAnilistSeasons(data);
            if (seasons?.length) setAnilistSeasons(seasons);
          }
          if (mounted) setAnilistLoading(false);
        })
        .catch(() => {
          if (mounted) setAnilistLoading(false);
        });
      // Switch to anime source if current source is not an anime source
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (!currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(savedSrc?.tag ? saved : ANIME_DEFAULT_SOURCE);
      }
    } else {
      setAnilistLoading(false);
      // Switch back to non-anime source if current source is anime-only
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(!savedSrc?.tag ? saved : NON_ANIME_DEFAULT_SOURCE);
      }
    }
    return () => {
      mounted = false;
    };
  }, [item.id, isAnime]);

  // Resolve allmanga episode URL via main-process IPC (GraphQL, no CORS)
  useEffect(() => {
    if (!playing || !selectedEp) return;
    const epNum = selectedEp.episode_number;
    const epKey = `tv_${item.id}_s${selectedSeason}_e${epNum}_${dubMode}`;

    // Auto-failover: if a previous attempt taught us AllManga doesn't have
    // this episode, skip straight to the cached fallback source.
    if (isAsync) {
      const cached = getFailoverSource(epKey);
      if (cached && cached !== playerSource) {
        setM3u8Url(null);
        setInterceptedSubs([]);
        resolvedPlayerUrlRef.current = null;
        setResolvedPlayerUrl(null);
        resolvingUrlRef.current = false;
        setResolvingUrl(false);
        setResolveError(null);
        setPlayerSource(cached);
        return;
      }
    }

    if (!isAsync) return;
    // Use refs as guards
    if (resolvedPlayerUrlRef.current || resolvingUrlRef.current) return;
    resolvingUrlRef.current = true;
    setResolvingUrl(true);
    setResolveError(null);
    const progressKey = `tv_${item.id}_s${selectedSeason}e${epNum}`;
    const startTime = storage.get("dlTime_" + progressKey) || 0;
    let mounted = true;
    window.electron
      .resolveAllManga({
        title,
        seasonNumber: selectedSeason,
        episodeNumber: epNum,
        translationType: dubMode,
      })
      .then((res) => {
        if (!mounted) return;
        if (res?.ok && res.url) {
          clearFailoverSource(epKey);
          if (res.isDirectMp4 !== undefined) {
            window.electron
              .setPlayerVideo({
                url: res.url,
                referer: res.referer || "https://allmanga.to",
                startTime,
              })
              .then((r) => {
                if (!mounted) return;
                resolvedPlayerUrlRef.current = r.playerUrl;
                setResolvedPlayerUrl(r.playerUrl);
                // Also expose raw url so download button can use it
                setM3u8Url(res.url);
              })
              .catch(() => {
                if (mounted) setResolveError("Failed to start local player");
              });
          } else {
            resolvedPlayerUrlRef.current = res.url;
            setResolvedPlayerUrl(res.url);
          }
        } else {
          // AllManga doesn't have this episode → switch to the next source
          // automatically and remember the choice for next time.
          const next = getNextNonAsyncSource(playerSource);
          if (next) {
            setFailoverSource(epKey, next);
            setM3u8Url(null);
            setInterceptedSubs([]);
            resolvedPlayerUrlRef.current = null;
            setResolvedPlayerUrl(null);
            setResolveError(null);
            setPlayerSource(next);
          } else {
            setResolveError(res?.error || "Episode not found on AllManga");
          }
        }
      })
      .catch((e) => {
        if (mounted) setResolveError(e.message || "Error");
      })
      .finally(() => {
        if (mounted) {
          resolvingUrlRef.current = false;
          setResolvingUrl(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [playing, selectedEp, playerSource, selectedSeason, dubMode]);

  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onM3u8Found((url) => {
      setM3u8Url((prev) => (prev !== url ? url : prev));
    });
    return () => window.electron.offM3u8Found(handler);
  }, []);

  // Close source dropdown on scroll or click-outside
  useEffect(() => {
    if (!showSourceMenu) return;
    const close = () => setShowSourceMenu(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    const handleClick = (e) => {
      if (
        sourceRef.current?.contains(e.target) ||
        e.target.closest(".source-dropdown")
      )
        return;
      close();
    };
    document.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      document.removeEventListener("mousedown", handleClick);
    };
  }, [showSourceMenu]);

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

  // ── Season list: prefer episode-group > AniList > TMDB ──────────────────
  // tmdbSeasons excludes specials (season 0) (only for AniList)
  const tmdbSeasons = useMemo(
    () => (d.seasons || []).filter((s) => s.season_number > 0),
    [d.seasons],
  );
  // tmdbSeasonsWithSpecials includes season 0 for display purposes.
  // Excluded for anime: AllManga
  const tmdbSeasonsWithSpecials = useMemo(() => {
    if (isAnime) return tmdbSeasons;
    if (failedSeasons.has(0)) return tmdbSeasons;
    const specials = (d.seasons || []).filter((s) => s.season_number === 0);
    return [...tmdbSeasons, ...specials];
  }, [d.seasons, tmdbSeasons, isAnime, failedSeasons]);
  const useAnilistSeasons = useMemo(
    () =>
      isAnime &&
      anilistSeasons?.length > 0 &&
      (tmdbSeasons.length <= 1 || anilistSeasons.length > tmdbSeasons.length),
    [isAnime, anilistSeasons, tmdbSeasons],
  );

  // Episode-group virtual seasons (highest priority, e.g. Netflix order)
  const episodeGroupSeasons = useMemo(() => {
    if (!episodeGroupData?.groups) return null;
    return [...episodeGroupData.groups]
      .sort((a, b) => a.order - b.order)
      .map((g, i) => ({
        season_number: i + 1,
        name: g.name || `Season ${i + 1}`,
        episode_count: (g.episodes || []).length,
      }));
  }, [episodeGroupData]);

  const seasons = useMemo(() => {
    if (episodeGroupSeasons) return episodeGroupSeasons;
    if (useAnilistSeasons)
      return anilistSeasons.map((s) => ({
        season_number: s.seasonNum,
        name: s.title || `Season ${s.seasonNum}`,
        episode_count: s.episodes || 0,
      }));
    return tmdbSeasonsWithSpecials;
  }, [
    episodeGroupSeasons,
    useAnilistSeasons,
    anilistSeasons,
    tmdbSeasonsWithSpecials,
  ]);

  // Episodes for the currently selected season from episode group
  const episodeGroupCurrentEpisodes = useMemo(() => {
    if (!episodeGroupData?.groups) return null;
    const sortedGroups = [...episodeGroupData.groups].sort(
      (a, b) => a.order - b.order,
    );
    const group = sortedGroups[selectedSeason - 1];
    if (!group) return null;
    return [...(group.episodes || [])]
      .sort((a, b) => a.order - b.order)
      .map((ep, i) => ({
        ...ep,
        episode_number: i + 1, // display number within this group-season
        _tmdbSeason: ep.season_number, // real TMDB season for player mapping
        _tmdbAbsolute: ep.episode_number, // real TMDB episode for player mapping
      }));
  }, [episodeGroupData, selectedSeason]);

  // ── Episode slice (AniList virtual seasons only) ───────────────────────────
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
    // In episode-group mode: use the real TMDB season/episode stored on the ep
    const rawSeason = selectedEp._tmdbSeason ?? selectedSeason;
    const rawEpisode = selectedEp._tmdbAbsolute ?? selectedEp.episode_number;
    return applyEpisodeMapping(item.id, rawSeason, rawEpisode, episodeGroupMap);
  }, [selectedEp, selectedSeason, item.id, episodeGroupMap]);

  // ── Memoized current season episodes ──────────────────────────────────────
  // While episode group or AniList data is still loading, return [] to prevent
  // a flash of wrong TMDB episodes before the correct data arrives.
  const episodeGroupPending = useMemo(
    () => !!EPISODE_GROUP_IDS[Number(item.id)] && !episodeGroupData,
    [item.id, episodeGroupData],
  );
  const currentSeasonEpisodes = useMemo(() => {
    if (episodeGroupPending) return [];
    if (anilistLoading) return [];
    return (
      episodeGroupCurrentEpisodes ||
      getSeasonEpisodes(seasonData?.episodes) ||
      []
    );
  }, [
    episodeGroupPending,
    anilistLoading,
    episodeGroupCurrentEpisodes,
    getSeasonEpisodes,
    seasonData,
  ]);

  // Auto-select specific episode when navigating from "Continue Watching" / history.
  // Key includes item.id + item.episode so the ref resets whenever the target changes.
  const autoSelectKeyRef = useRef(null);
  useEffect(() => {
    if (!item.episode || currentSeasonEpisodes.length === 0) return;
    const key = `${item.id}_e${item.episode}`;
    if (autoSelectKeyRef.current === key) return; // already handled this target
    const target = Number(item.episode);
    const ep = currentSeasonEpisodes.find((e) => e.episode_number === target);
    if (ep) {
      autoSelectKeyRef.current = key;
      setSelectedEp(ep);
    }
  }, [item.id, item.episode, currentSeasonEpisodes]);

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
  const displaySeasonCount = useMemo(
    () => (anilistLoading ? null : seasons.length || d.number_of_seasons || 0),
    [anilistLoading, seasons, d.number_of_seasons],
  );
  const displayEpisodeCount = useMemo(
    () =>
      anilistLoading
        ? null
        : useAnilistSeasons
          ? anilistSeasons.reduce((sum, s) => sum + (s.episodes || 0), 0)
          : d.number_of_episodes || 0,
    [anilistLoading, useAnilistSeasons, anilistSeasons, d.number_of_episodes],
  );

  const displayOverview = useMemo(
    () =>
      anilistLoading
        ? null
        : isAnime && anilistData?.description
          ? cleanAnilistDescription(anilistData.description)
          : d.overview,
    [anilistLoading, isAnime, anilistData?.description, d.overview],
  );
  const displayScore = useMemo(
    () =>
      anilistLoading
        ? null
        : isAnime && anilistData?.averageScore
          ? (anilistData.averageScore / 10).toFixed(1)
          : d.vote_average > 0
            ? d.vote_average.toFixed(1)
            : null,
    [anilistLoading, isAnime, anilistData?.averageScore, d.vote_average],
  );
  const displayGenres = useMemo(
    () =>
      anilistLoading
        ? []
        : isAnime && anilistData?.genres?.length
          ? anilistData.genres.map((g, i) => ({ id: i, name: g }))
          : d.genres || [],
    [anilistLoading, isAnime, anilistData?.genres, d.genres],
  );

  // ── Season watched helpers ─────────────────────────────────────────────────
  // Memoized map: seasonNum → "all" | "some" | "none"
  // Recomputed only when watched/seasons change, not on every render.
  const seasonWatchedMap = useMemo(() => {
    const map = {};
    for (const s of seasons) {
      const num = s.season_number;
      const count =
        num === selectedSeason
          ? currentSeasonEpisodes.length || s.episode_count || 0
          : s.episode_count || 0;
      if (!count) {
        map[num] = "none";
        continue;
      }
      let watchedCount = 0;
      for (let i = 1; i <= count; i++) {
        if (watched?.[`tv_${item.id}_s${num}e${i}`]) watchedCount++;
      }
      if (watchedCount === 0) {
        map[num] = "none";
      } else if (watchedCount === count) {
        map[num] = "all";
      } else {
        const pct = watchedCount / count;
        map[num] = pct < 0.375 ? "some25" : pct < 0.625 ? "some50" : "some75";
      }
    }
    return map;
  }, [seasons, selectedSeason, currentSeasonEpisodes, watched, item.id]);

  const isSeasonWatched = useCallback(
    (seasonNum) => seasonWatchedMap[seasonNum] === "all",
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

  // Reset auto-mark guard and autoplay when episode changes
  useEffect(() => {
    autoMarkedRef.current = false;
    lastKnownTimeRef.current = 0;
    seekBackCooldownRef.current = 0;
    durationRef.current = 0;
    localCountdownStartedRef.current = false;
    resetAutoplayRef.current?.();
  }, [currentProgressKey]);

  // Show loader instantly when playback starts
  useEffect(() => {
    if (playing) setWebviewLoading(true);
  }, [playing]);

  // ── Webview memory cleanup ────────────────────────────────────────────────
  // useLayoutEffect fires synchronously BEFORE React mutates the DOM, so the
  // webview is still attached when we navigate it to about:blank.
  // This lets Chromium unload the streaming page.
  useLayoutEffect(() => {
    if (playing) return; // only act when playing stops
    const wv = webviewRef.current;
    if (wv) {
      try {
        wv.src = "about:blank";
      } catch {}
    }
  }, [playing]);

  // On unmount: signal main process to destroy the player WebContents and flush session cahce
  useEffect(() => {
    return () => {
      window.electron?.playerStopped?.();
    };
  }, []);

  // Attach webview load events so we know when the new source has painted.
  // Also poll for video duration so AniSkip markers appear without waiting for the 5s progress tick.
  useEffect(() => {
    if (!playing) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const done = () => setWebviewLoading(false);
    wv.addEventListener("did-finish-load", done);
    wv.addEventListener("did-fail-load", done);

    // Poll up to 30s for video duration (metadata may load after buffering starts)
    let attempts = 0;
    const pollDuration = setInterval(async () => {
      if (durationRef.current > 0 || attempts++ > 30) {
        clearInterval(pollDuration);
        return;
      }
      try {
        const dur = await wv.executeJavaScript(
          `(() => { const v = document.querySelector('video'); return (v && v.duration > 0 && isFinite(v.duration)) ? v.duration : null; })()`,
        );
        if (dur) {
          durationRef.current = dur;
          // let markers re-render
          setSkipTimings((t) => (t ? { ...t } : t));
          clearInterval(pollDuration);
        }
      } catch {}
    }, 1000);

    return () => {
      wv.removeEventListener("did-finish-load", done);
      wv.removeEventListener("did-fail-load", done);
      clearInterval(pollDuration);
    };
  }, [playing, playerSource, item.id, selectedEp?.episode_number]);

  // ── AniSkip: fetch timings when episode changes ───────────────────────────
  useEffect(() => {
    setSkipTimings(null);
    setSkipPrompt(null);
    if (introSkipMode === "off" || !isAsync || !isAnime) return;
    const anilistId = anilistData?.idMal;
    const epNum = selectedEp?.episode_number;
    if (!anilistId || !epNum) return;

    let cancelled = false;
    fetchAniSkipTimings(anilistId, epNum).then((timings) => {
      if (!cancelled) setSkipTimings(timings);
    });
    return () => {
      cancelled = true;
    };
  }, [
    anilistData?.idMal,
    selectedEp?.episode_number,
    playerSource,
    isAnime,
    introSkipMode,
  ]);

  // ── AniSkip: auto-skip or show manual prompt ─────────────────
  // ── AniSkip: manual skip handler ─────────────────────────────────────────
  const handleManualSkip = useCallback(async () => {
    if (!skipPrompt || !skipTimings?.[skipPrompt]) return;
    const rawEnd = skipTimings[skipPrompt].endTime;
    const endTime = Number(rawEnd);
    if (!Number.isFinite(endTime)) return;
    const wv = webviewRef.current;
    if (!wv) return;
    try {
      await wv.executeJavaScript(
        `(() => { const v = document.querySelector('video'); if (v) v.currentTime = ${endTime}; })()`,
      );
    } catch {}
    setSkipPrompt(null);
  }, [skipPrompt, skipTimings]);

  // Use webview before-input-event so Enter reaches main-ui before the webview
  // handles it (avoids the webview's Space/Enter play-pause intercepting it).
  useEffect(() => {
    if (!skipPrompt) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const handler = (e) => {
      if (e.key === "Return" && e.type === "keyDown") {
        handleManualSkip();
      }
    };
    wv.addEventListener("before-input-event", handler);
    return () => wv.removeEventListener("before-input-event", handler);
  }, [skipPrompt, handleManualSkip]);

  // Unified progress/skip timing tick for Allmanga and other sources.
  // Skip detection runs every tick, progress is saved every 5th tick (5s).
  useEffect(() => {
    const aniSkipActive =
      introSkipMode !== "off" && playing && !!skipTimings && isAsync;

    if (!aniSkipActive) setSkipPrompt(null);
    if (!playing || !currentProgressKey) return;

    const TICK = aniSkipActive ? 1000 : 5000;
    let tickCount = 0;
    let interval = null;

    const timer = setTimeout(() => {
      interval = setInterval(async () => {
        try {
          const wv = webviewRef.current;
          if (!wv) return;

          let result;
          // When the pop-out window is open the main webview shows about:blank
          // -> query the pip window's webContents directly.
          if (
            pipWebContentsIdRef.current != null &&
            window.electron?.queryVideoProgress
          ) {
            result = await window.electron.queryVideoProgress(
              pipWebContentsIdRef.current,
            );
          } else if (progressViaFrames && window.electron?.queryVideoProgress) {
            result = await window.electron.queryVideoProgress(
              wv.getWebContentsId(),
            );
          } else {
            result = await wv.executeJavaScript(`
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
          }

          // ── AniSkip logic: runs every tick (only when aniSkipActive) ────
          if (aniSkipActive && result?.currentTime != null) {
            const ct = result.currentTime;
            const { intro, outro } = skipTimings;
            const inIntro =
              intro && ct >= intro.startTime && ct < intro.endTime - 1;
            const inOutro =
              outro && ct >= outro.startTime && ct < outro.endTime - 1;
            const activeSegment = inIntro ? "intro" : inOutro ? "outro" : null;
            if (!activeSegment) {
              setSkipPrompt(null);
            } else if (introSkipMode === "auto") {
              setSkipPrompt(null);
              const endTime = Number(skipTimings[activeSegment].endTime);
              if (Number.isFinite(endTime)) {
                try {
                  await wv.executeJavaScript(
                    `(() => { const v = document.querySelector('video'); if (v) v.currentTime = ${endTime}; })()`,
                  );
                } catch {}
              }
            } else {
              setSkipPrompt(activeSegment);
            }
          }

          // ── Progress logic: every 5s regardless of tick rate ────────────
          tickCount++;
          if (aniSkipActive && tickCount % 5 !== 0) return;

          if (result && result.duration > 0) {
            durationRef.current = result.duration;
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

            // Autoplay trigger
            if (
              remaining <= watchedThreshold &&
              !localCountdownStartedRef.current
            ) {
              localCountdownStartedRef.current = true;
              setCountdownStartedRef.current?.(true);
              triggerAutoplayRef.current?.();
            }
          }
        } catch {}
      }, TICK);
    }, 3000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      setSkipPrompt(null);
    };
  }, [
    playing,
    skipTimings,
    playerSource,
    introSkipMode,
    currentProgressKey,
    watchedThreshold,
    progressViaFrames,
  ]);

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
    if (!wv || !playing || !isAsync) return;

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
      resolvedPlayerUrlRef.current = null;
      setResolvedPlayerUrl(null);
      resolvingUrlRef.current = false;
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

  const nextEp = useMemo(() => {
    if (!selectedEp || !currentSeasonEpisodes) return null;
    const idx = currentSeasonEpisodes.findIndex(
      (e) => e.episode_number === selectedEp.episode_number,
    );
    if (idx >= 0 && idx < currentSeasonEpisodes.length - 1) {
      return currentSeasonEpisodes[idx + 1];
    }
    return null;
  }, [selectedEp, currentSeasonEpisodes]);

  const {
    autoplayCountdown,
    countdownStarted,
    setCountdownStarted,
    triggerAutoplay,
    cancelAutoplay,
    playNow,
    resetAutoplay,
  } = useAutoplay({ nextEp, playEpisode, restricted });

  useEffect(() => {
    resetAutoplayRef.current = resetAutoplay;
    triggerAutoplayRef.current = triggerAutoplay;
    setCountdownStartedRef.current = setCountdownStarted;
  }, [resetAutoplay, triggerAutoplay, setCountdownStarted]);

  useEffect(() => {
    localCountdownStartedRef.current = countdownStarted;
  }, [countdownStarted]);

  const autoplayNextLayout =
    storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_LAYOUT) || "right";

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
      // requestFullscreen() is rejected when Electron is already in fullscreen -> use css overlay
      setPlayerFullscreen(true);
      document.documentElement.setAttribute("data-player-fullscreen", "1");
    });
    const leaveH = window.electron?.onWebviewLeaveFullscreen?.(() => {
      setPlayerFullscreen(false);
      document.documentElement.removeAttribute("data-player-fullscreen");
      if (document.fullscreenElement) document.exitFullscreen?.();
    });
    return () => {
      if (enterH) window.electron?.offWebviewEnterFullscreen?.(enterH);
      if (leaveH) window.electron?.offWebviewLeaveFullscreen?.(leaveH);
      // Clean up attribute if component unmounts while fullscreen
      document.documentElement.removeAttribute("data-player-fullscreen");
    };
  }, [playing, playerSource]);

  // ── PiP pop-out: navigate main webview away so only one stream is active ──
  useEffect(() => {
    if (!playing) return;
    const openH = window.electron?.onPipOpened?.(async () => {
      setPipOpen(true);
      pipWebContentsIdRef.current =
        (await window.electron.getPipWebContentsId?.()) ?? null;
    });
    const closeH = window.electron?.onPipClosed?.(() => {
      pipUrlRef.current = null;
      pipWebContentsIdRef.current = null;
      setPipOpen(false);
    });
    return () => {
      if (openH) window.electron?.offPipOpened?.(openH);
      if (closeH) window.electron?.offPipClosed?.(closeH);
    };
  }, [playing]);

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
                backgroundImage: `url(${imgUrl(d.backdrop_path, "w1280")})`,
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
                  {displaySeasonCount > 0 && (
                    <span>
                      {displaySeasonCount} Season
                      {displaySeasonCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {displayEpisodeCount > 0 && (
                    <span>
                      {displayEpisodeCount} Episode
                      {displayEpisodeCount !== 1 ? "s" : ""}
                    </span>
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
              <div
                className={`player-wrap${playerFullscreen ? " player-wrap--fullscreen" : ""}`}
                ref={playerWrapRef}
              >
                {/* Universal source-loading overlay, shown instantly on every source/episode switch */}
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
                {/* error if lookup failed */}
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
                {/* Pop-out active: main stream paused, pop-out has real player */}
                {pipOpen && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 20,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(0,0,0,0.92)",
                      gap: 16,
                      borderRadius: "inherit",
                    }}
                  >
                    <PopOutIcon size={36} />
                    <span
                      style={{
                        fontSize: 15,
                        color: "var(--text1)",
                        fontWeight: 600,
                      }}
                    >
                      Playing in pop-out window
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text2)",
                        textAlign: "center",
                        maxWidth: 260,
                      }}
                    >
                      Closing the pop-out will reload the player here.
                    </span>
                    <button
                      className="player-overlay-btn"
                      onClick={() => window.electron?.closePipWindow?.()}
                      style={{ marginTop: 4 }}
                    >
                      Close pop-out &amp; return
                    </button>
                  </div>
                )}
                {autoplayCountdown !== null && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 30,
                      display: "flex",
                      justifyContent:
                        autoplayNextLayout === "left"
                          ? "flex-start"
                          : "flex-end",
                      background: "rgba(0,0,0,0.88)",
                      borderRadius: "inherit",
                      backdropFilter: "blur(6px)",
                      animation: "fadeIn 0.4s ease",
                    }}
                  >
                    <div
                      style={{
                        width: "40%",
                        minWidth: "320px",
                        maxWidth: "480px",
                        height: "100%",
                        background:
                          autoplayNextLayout === "left"
                            ? "linear-gradient(90deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 60%, rgba(0,0,0,0) 100%)"
                            : "linear-gradient(270deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 60%, rgba(0,0,0,0) 100%)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        padding: "40px",
                        boxSizing: "border-box",
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "11px",
                          fontWeight: "700",
                          letterSpacing: "1.5px",
                          textTransform: "uppercase",
                          color: "var(--red)",
                          marginBottom: "8px",
                        }}
                      >
                        Up Next
                      </div>

                      {/* Cover Still */}
                      <div
                        style={{
                          width: "100%",
                          aspectRatio: "16/9",
                          borderRadius: "8px",
                          overflow: "hidden",
                          border: "1px solid rgba(255,255,255,0.1)",
                          marginBottom: "18px",
                          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                          background: "var(--surface3)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {nextEp?.still_path ? (
                          <img
                            src={imgUrl(nextEp.still_path, "w300")}
                            alt={nextEp?.name}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              width: 32,
                              height: 32,
                              color: "var(--text3)",
                            }}
                          >
                            <PlayIcon />
                          </span>
                        )}
                      </div>

                      {/* Episode Meta */}
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: "600",
                          color: "var(--text2)",
                          marginBottom: "4px",
                        }}
                      >
                        Season {selectedSeason} · Episode{" "}
                        {nextEp?.episode_number}
                      </div>
                      <div
                        style={{
                          fontSize: "20px",
                          fontWeight: "700",
                          color: "white",
                          marginBottom: "8px",
                          lineHeight: "1.3",
                          wordBreak: "break-word",
                        }}
                      >
                        {nextEp?.name}
                      </div>

                      {/* Countdown */}
                      {autoplayCountdown > 0 ? (
                        <div
                          style={{
                            fontSize: "14px",
                            color: "var(--text3)",
                            marginBottom: "20px",
                          }}
                        >
                          Starting in{" "}
                          <span style={{ color: "white", fontWeight: "600" }}>
                            {autoplayCountdown}
                          </span>
                          s...
                        </div>
                      ) : (
                        <div style={{ height: "20px", marginBottom: "20px" }} />
                      )}

                      {/* Buttons */}
                      <div
                        style={{
                          display: "flex",
                          gap: "12px",
                          marginTop: "4px",
                        }}
                      >
                        <button
                          className="btn btn-primary"
                          style={{
                            padding: "10px 22px",
                            fontSize: "14px",
                            fontWeight: "600",
                            background: "var(--red)",
                            borderColor: "var(--red)",
                            boxShadow: "var(--red-glow)",
                          }}
                          onClick={playNow}
                        >
                          Play Now
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{
                            padding: "10px 22px",
                            fontSize: "14px",
                            fontWeight: "600",
                            background: "rgba(255,255,255,0.05)",
                          }}
                          onClick={cancelAutoplay}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <webview
                  ref={webviewRef}
                  src={
                    pipOpen
                      ? "about:blank"
                      : isAsync
                        ? resolvedPlayerUrl || "about:blank"
                        : getSourceUrl(
                            playerSource,
                            "tv",
                            item.id,
                            playerEp.season,
                            playerEp.episode,
                            {},
                            playerAccentColor,
                            playerSubLang,
                          )
                  }
                  partition="persist:player"
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
                  {isAsync && (
                    <button
                      className="player-overlay-btn"
                      onClick={() => {
                        const next = dubMode === "sub" ? "dub" : "sub";
                        setDubMode(next);
                        storage.set(STORAGE_KEYS.ALLMANGA_DUB_MODE, next);
                        setM3u8Url(null);
                        setInterceptedSubs([]);
                        resolvedPlayerUrlRef.current = null;
                        setResolvedPlayerUrl(null);
                        resolvingUrlRef.current = false;
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
                    onClick={() => {
                      setShowSourceMenu(false);
                      setShowBlockedModal(true);
                    }}
                    title="Blocked ads & trackers"
                  >
                    <ShieldBlockIcon />
                    {blockedSession > 0 && (
                      <span className="player-blocked-badge">
                        {blockedSession}
                      </span>
                    )}
                  </button>
                  {/* Pop-out button */}
                  <button
                    className="player-overlay-btn"
                    onClick={() => {
                      if (pipOpen) {
                        window.electron?.closePipWindow?.();
                        return;
                      }
                      const url = isAsync
                        ? resolvedPlayerUrl
                        : getSourceUrl(
                            playerSource,
                            "tv",
                            item.id,
                            playerEp.season,
                            playerEp.episode,
                            {},
                            playerAccentColor,
                            playerSubLang,
                          );
                      if (!url) return;
                      pipUrlRef.current = url;
                      window.electron?.openPipWindow?.(
                        url,
                        item.name ?? item.title,
                      );
                    }}
                    title={pipOpen ? "Close pop-out" : "Pop out player"}
                    disabled={
                      !pipOpen &&
                      (webviewLoading || !!(isAsync && !resolvedPlayerUrl))
                    }
                    style={pipOpen ? { color: "var(--red)" } : undefined}
                  >
                    <PopOutIcon />
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
                          setShowSourceMenu(false);
                          if (src.id === playerSource) return;
                          // Manual selection wins over auto-failover
                          if (selectedEp) {
                            clearFailoverSource(
                              `tv_${item.id}_s${selectedSeason}_e${selectedEp.episode_number}_${dubMode}`,
                            );
                          }
                          setPlayerSource(src.id);
                          storage.set(STORAGE_KEYS.PLAYER_SOURCE, src.id);
                          setM3u8Url(null);
                          setInterceptedSubs([]);
                          resolvedPlayerUrlRef.current = null;
                          setResolvedPlayerUrl(null);
                          resolvingUrlRef.current = false;
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

                {/* AniSkip manual prompt, rendered in streambert UI, outside webview */}
                {skipPrompt && (
                  <button
                    onClick={handleManualSkip}
                    style={{
                      position: "absolute",
                      bottom: 24,
                      right: 24,
                      zIndex: 50,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 1,
                      background: "rgba(0,0,0,0.72)",
                      border: "1px solid rgba(255,255,255,0.18)",
                      borderRadius: 8,
                      color: "white",
                      cursor: "pointer",
                      padding: "9px 18px",
                      backdropFilter: "blur(6px)",
                      WebkitBackdropFilter: "blur(6px)",
                      transition: "background 0.15s, border-color 0.15s",
                      fontFamily: "var(--font-body)",
                      animation: "slideDown 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(229,9,20,0.85)";
                      e.currentTarget.style.borderColor = "rgba(229,9,20,0.5)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(0,0,0,0.72)";
                      e.currentTarget.style.borderColor =
                        "rgba(255,255,255,0.18)";
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 1,
                      }}
                    >
                      SKIP
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "rgba(255,255,255,0.7)",
                        letterSpacing: 1,
                      }}
                    >
                      {skipPrompt === "intro" ? "INTRO" : "OUTRO"}
                    </span>
                  </button>
                )}
              </div>

              {currentProgressKey &&
                (() => {
                  const epPct = progress[currentProgressKey] || 0;
                  const dur = durationRef.current;
                  const hasMarkers =
                    dur > 0 && (skipTimings?.intro || skipTimings?.outro);
                  return epPct > 0 || hasMarkers ? (
                    <div className="progress-bar-row">
                      <div
                        className="progress-bar-outer"
                        style={{ position: "relative" }}
                      >
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${Math.min(epPct, 100)}%` }}
                        />
                        {/* AniSkip intro/outro markers */}
                        {dur > 0 && skipTimings?.intro && (
                          <div
                            title="Intro"
                            style={{
                              position: "absolute",
                              top: 0,
                              left: `${(skipTimings.intro.startTime / dur) * 100}%`,
                              width: `${((skipTimings.intro.endTime - skipTimings.intro.startTime) / dur) * 100}%`,
                              height: "100%",
                              background: "rgba(251,191,36,0.75)",
                              borderRadius: 2,
                              pointerEvents: "none",
                            }}
                          />
                        )}
                        {dur > 0 && skipTimings?.outro && (
                          <div
                            title="Outro"
                            style={{
                              position: "absolute",
                              top: 0,
                              left: `${(skipTimings.outro.startTime / dur) * 100}%`,
                              width: `${((skipTimings.outro.endTime - skipTimings.outro.startTime) / dur) * 100}%`,
                              height: "100%",
                              background: "rgba(251,191,36,0.75)",
                              borderRadius: 2,
                              pointerEvents: "none",
                            }}
                          />
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>
                        {epPct > 0 ? `${epPct.toFixed(0)}% watched` : ""}
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
                  const sw = seasonWatchedMap[s.season_number] ?? "none";
                  return (
                    <button
                      key={s.season_number}
                      className={`season-btn ${selectedSeason === s.season_number ? "active" : ""} ${sw === "all" ? "season-watched" : sw.startsWith("some") ? "season-partial" : ""}`}
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
                      {sw === "all" && (
                        <span className="season-watched-icon">✓</span>
                      )}
                      {sw === "some25" && <PartialCircleIcon pct={25} />}
                      {sw === "some50" && <PartialCircleIcon pct={50} />}
                      {sw === "some75" && <PartialCircleIcon pct={75} />}
                      {s.season_number === 0
                        ? "Specials"
                        : `Season ${s.season_number}`}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedSeason === 0 && !loadingSeason && (
              <div
                style={{
                  margin: "8px 0",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(255,200,50,0.08)",
                  border: "1px solid rgba(255,200,50,0.2)",
                  fontSize: 12,
                  color: "var(--text3)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>⚠️</span>
                <span>
                  Specials support varies by provider. If the wrong episode
                  plays, try switching to a different source. But it can't be
                  guaranteed that the correct Episode will be available.
                </span>
              </div>
            )}
            {loadingSeason && (
              <div className="loader">
                <div className="spinner" />
              </div>
            )}
            {!loadingSeason &&
              (seasonData?.episodes || episodeGroupCurrentEpisodes?.length) && (
                <div className="episodes-grid">
                  {currentSeasonEpisodes.map((ep) => {
                    const pk = `tv_${item.id}_s${selectedSeason}e${ep.episode_number}`;
                    return (
                      <EpisodeCard
                        key={ep.episode_number}
                        ep={ep}
                        itemId={item.id}
                        selectedSeason={selectedSeason}
                        epPct={progress[pk] || 0}
                        epWatched={!!watched?.[pk]}
                        playing={playing}
                        selectedEpNumber={selectedEp?.episode_number}
                        downloadsByEpisodeKey={downloadsByEpisodeKey}
                        restricted={restricted}
                        onPlay={playEpisode}
                        onContextMenu={setEpMenu}
                        onGoToDownloads={onGoToDownloads}
                      />
                    );
                  })}
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
        <ContextMenu
          x={epMenu.x}
          y={epMenu.y}
          isWatched={!!watched?.[epMenu.pk]}
          hasProgress={(progress?.[epMenu.pk] ?? 0) > 0}
          watchedLabel="Mark as Watched"
          unwatchedLabel="Mark as Unwatched"
          onMarkWatched={() => onMarkWatched?.(epMenu.pk)}
          onMarkUnwatched={() => onMarkUnwatched?.(epMenu.pk)}
          onMarkNotStarted={() => {
            onMarkUnwatched?.(epMenu.pk);
            saveProgress?.(epMenu.pk, 0);
            storage.set("dlTime_" + epMenu.pk, null);
          }}
          onClose={() => setEpMenu(null)}
        />
      )}

      {seasonMenu && (
        <ContextMenu
          x={seasonMenu.x}
          y={seasonMenu.y}
          isWatched={isSeasonWatched(seasonMenu.seasonNum)}
          watchedLabel="Mark Season as Watched"
          unwatchedLabel="Mark Season as Unwatched"
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
  epPct,
  epWatched,
  playing,
  selectedEpNumber,
  downloadsByEpisodeKey,
  restricted,
  onPlay,
  onContextMenu,
  onGoToDownloads,
}) {
  const pk = `tv_${itemId}_s${selectedSeason}e${ep.episode_number}`;
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
