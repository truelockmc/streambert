const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

// ── TMDB metadata language ────────────────────────────────────────────────────
// Read lazily from localStorage so it always reflects the current setting.
// Falls back to "en-US".
function getTmdbLanguage() {
  try {
    const raw = localStorage.getItem("streambert_tmdbLang");
    return raw ? JSON.parse(raw) : "en-US";
  } catch {
    return "en-US";
  }
}

// Append the language query param to a TMDB path.
function withLanguage(path) {
  const lang = getTmdbLanguage();
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}language=${lang}`;
}

export const imgUrl = (path, size = "w500") =>
  path ? `${IMG_BASE}/${size}${path}` : null;

// Global auth-error callback, registered by App on mount
let _onAuthError = null;
let _onUnreachable = null;
export const setApiErrorHandlers = (onAuth, onUnreachable) => {
  _onAuthError = onAuth;
  _onUnreachable = onUnreachable;
};

// ── In-memory TMDB response cache (session-scoped, cleared on page reload) ───
// Avoids redundant network calls when navigating back to the same show.
// TTL: 5 minutes
const _tmdbCache = new Map(); // key → { data, expiresAt }
const TMDB_CACHE_TTL = 5 * 60 * 1000;

/** Clears the in-memory TMDB cache and the persisted trending cache.
 * Calling this when the metadata language changes. */
export function clearTmdbCache() {
  _tmdbCache.clear();
  try {
    localStorage.removeItem("streambert_trendingCache");
  } catch {}
}

// ── Request queue (max 4 concurrent TMDB fetches) ────────────────────────────
// Prevents bursts of 10-20 parallel requests from carousel/similar-rows rapid
// navigation from hammering the API and triggering rate-limit responses.
let _inflight = 0;
const MAX_INFLIGHT = 4;
const _waiters = [];

function _acquireSlot() {
  if (_inflight < MAX_INFLIGHT) {
    _inflight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => _waiters.push(resolve));
}

function _releaseSlot() {
  _inflight--;
  if (_waiters.length > 0) {
    _inflight++;
    _waiters.shift()();
  }
}

export const tmdbFetch = async (path, apiKey) => {
  const localizedPath = withLanguage(path);
  const cacheKey = `${apiKey}|${localizedPath}`;
  const cached = _tmdbCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  await _acquireSlot();

  let res;
  try {
    res = await fetch(`${TMDB_BASE}${localizedPath}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    _releaseSlot();
    _onUnreachable?.();
    throw new Error("TMDB unreachable");
  } finally {
    // releaseSlot is called in the catch above for network errors;
    // for successful responses it is called immediately below, before
    // parsing, so the slot is held only during the actual in-flight
    // request, not during res.json().
  }

  _releaseSlot();

  if (res.status === 401 || res.status === 403) {
    _onAuthError?.();
    throw new Error(`TMDB ${res.status}`);
  }

  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  const data = await res.json();
  _tmdbCache.set(cacheKey, { data, expiresAt: Date.now() + TMDB_CACHE_TTL });

  // Evict stale entries to prevent unbounded memory growth
  if (_tmdbCache.size > 80) {
    const now = Date.now();
    for (const [k, v] of _tmdbCache) {
      if (now >= v.expiresAt) _tmdbCache.delete(k);
    }
  }

  return data;
};

// Documentation:
// https://www.videasy.net/docs
// https://vsembed.su/api/
// https://www.vidking.net/#documentation

// ── Player Sources ────────────────────────────────────────────────────────────
// supportsProgress: true = executeJavaScript tracking works for this source
export const PLAYER_SOURCES = [
  {
    id: "videasy",
    label: "Videasy",
    tag: null,
    note: null,
    supportsProgress: true,
    colorParam: "color", // hex without # → e.g. "e50914"
    langParam: null, // no subtitle lang param
    params: {
      overlay: "true",
    },
    movieUrl: (id) => `https://player.videasy.net/movie/${id}`,
    tvUrl: (id, season, ep) =>
      `https://player.videasy.net/tv/${id}/${season}/${ep}`,
  },
  {
    id: "vidsrc",
    label: "VidSrc",
    tag: null,
    note: null,
    supportsProgress: true,
    progressViaFrames: true, // video is in a nested iframe, needs main-process frame query
    colorParam: null, // vidsrc doesn't support color param
    langParam: "ds_lang", // ISO 639-1 language code
    params: {},
    movieUrl: (id) => `https://vsembed.su/embed/movie/${id}`,
    tvUrl: (id, season, ep) =>
      `https://vsembed.su/embed/tv/${id}/${season}/${ep}`,
  },
  {
    id: "vidking",
    label: "Vidking",
    tag: null,
    note: null,
    supportsProgress: true,
    colorParam: "color", // hex without # → e.g. "e50914"
    langParam: null,
    params: {
      autoPlay: "true",
    },
    movieUrl: (id) => `https://www.vidking.net/embed/movie/${id}`,
    tvUrl: (id, season, ep) =>
      `https://www.vidking.net/embed/tv/${id}/${season}/${ep}`,
  },
  {
    id: "allmanga",
    label: "AllManga",
    tag: "ANIME",
    note: null,
    supportsProgress: true,
    async: true,
    params: {},
    movieUrl: (_id) => "https://allmanga.to",
    tvUrl: (_id, _season, _ep) => "https://allmanga.to",
  },
];
export const getSourceUrl = (
  sourceId,
  type,
  id,
  season,
  ep,
  extraParams = {},
  // Optional: accent hex (with or without #) and subtitle ISO lang code
  accentColor = null,
  subtitleLang = null,
) => {
  const src =
    PLAYER_SOURCES.find((s) => s.id === sourceId) ?? PLAYER_SOURCES[0];
  const baseUrl =
    type === "movie" ? src.movieUrl(id) : src.tvUrl(id, season, ep);
  const url = new URL(baseUrl);

  Object.entries(src.params || {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  // Inject accent color into the player if the source supports it
  if (accentColor && src.colorParam) {
    url.searchParams.set(src.colorParam, accentColor.replace(/^#/, ""));
  }

  if (subtitleLang && src.langParam) {
    url.searchParams.set(src.langParam, subtitleLang);
  }

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value != null) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
};

export const sourceSupportsProgress = (sourceId) =>
  PLAYER_SOURCES.find((s) => s.id === sourceId)?.supportsProgress ?? false;

export const sourceProgressViaFrames = (sourceId) =>
  PLAYER_SOURCES.find((s) => s.id === sourceId)?.progressViaFrames ?? false;

export const sourceIsAsync = (sourceId) =>
  PLAYER_SOURCES.find((s) => s.id === sourceId)?.async ?? false;

// Return the next non-async source after `currentId` in PLAYER_SOURCES order
export const getNextNonAsyncSource = (currentId) => {
  const nonAsync = PLAYER_SOURCES.filter((s) => !s.async);
  if (nonAsync.length === 0) return null;
  const idx = nonAsync.findIndex((s) => s.id === currentId);
  // If currentId is itself non-async, return the next one (wrap around).
  // If currentId is async (e.g. AllManga), just return the first non-async.
  if (idx < 0) return nonAsync[0].id;
  return nonAsync[(idx + 1) % nonAsync.length].id;
};

// Sources that require a transparent webRequest intercept to load properly
export const NEEDS_INTERCEPT = ["vidsrc"];

// ── AniList API (anime metadata) ──────────────────────────────────────────────
const ANILIST_API = "https://graphql.anilist.co";

// Strip "(Source: ...)", "Note: ..." and similar attribution lines from AniList descriptions
export const cleanAnilistDescription = (desc) => {
  if (!desc) return desc;
  // Remove HTML by stripping all < and > characters and anything between them.
  // Splitting on < and dropping the tag portion of each chunk is immune to
  // unclosed/malformed tags and avoids any regex that starts with "<" (which
  // static analysers flag as potentially incomplete).
  let clean = desc
    .split("<")
    .map((chunk, i) => (i === 0 ? chunk : chunk.slice(chunk.indexOf(">") + 1)))
    .join("")
    .replace(/>/g, "");
  // Remove everything from "(Source:" onwards (including multi-line variants)
  clean = clean.replace(/\(Source:[^)]*\)/gi, "");
  // Remove "Note: ..." sentences/paragraphs at the end
  clean = clean.replace(/\bNote:[^\n]*/gi, "");
  // Remove trailing whitespace, newlines, punctuation left over
  clean = clean.replace(/[\s\n]+$/, "").trim();
  return clean;
};

const ANILIST_QUERY = `
query ($search: String, $type: MediaType) {
  Media(search: $search, type: $type, sort: SEARCH_MATCH) {
    id
    idMal
    title { romaji english native }
    description(asHtml: false)
    coverImage { extraLarge large }
    bannerImage
    genres
    averageScore
    episodes
    status
    season
    seasonYear
    studios(isMain: true) { nodes { name } }
    startDate { year month }
    relations {
      edges {
        relationType
        node {
          id
          type
          format
          title { romaji english }
          episodes
          startDate { year month }
          seasonYear
        }
      }
    }
  }
}`;

// ── AniList cache (localStorage + in-memory) ──────────────────────────────────
const ANILIST_CACHE_KEY = "streambert_anilistCache";
const ANILIST_CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

// loaded once on first use, flushed to localStorage on write.
let _anilistCache = null;

function getAnilistCache() {
  if (_anilistCache) return _anilistCache;
  try {
    const raw = localStorage.getItem(ANILIST_CACHE_KEY);
    _anilistCache = raw ? JSON.parse(raw) : {};
  } catch {
    _anilistCache = {};
  }
  // Evict stale entries once on load
  const now = Date.now();
  for (const key of Object.keys(_anilistCache)) {
    if (now - _anilistCache[key].ts > ANILIST_CACHE_TTL) {
      delete _anilistCache[key];
    }
  }
  return _anilistCache;
}

let _anilistFlushTimer = null;
function flushAnilistCache() {
  if (_anilistFlushTimer) clearTimeout(_anilistFlushTimer);
  _anilistFlushTimer = setTimeout(() => {
    _anilistFlushTimer = null;
    try {
      localStorage.setItem(ANILIST_CACHE_KEY, JSON.stringify(_anilistCache));
    } catch {}
  }, 500);
}

// tmdbId is used as the cache key (unique per show) while title is used for the AniList search query.
export const fetchAnilistData = async (
  title,
  type = "ANIME",
  tmdbId = null,
) => {
  const cacheKey = tmdbId
    ? `${type}__tmdb_${tmdbId}`
    : `${type}__${title.toLowerCase().trim()}`;

  const cache = getAnilistCache();
  const entry = cache[cacheKey];
  if (entry && Date.now() - entry.ts <= ANILIST_CACHE_TTL) {
    // Sanity-check: make sure cached data actually belongs to this title.
    const cachedTitles = [
      entry.data?.title?.romaji,
      entry.data?.title?.english,
      entry.data?.title?.native,
    ]
      .filter(Boolean)
      .map((t) => t.toLowerCase());
    const searchTitle = title.toLowerCase();
    const isMismatch =
      entry.data !== null &&
      cachedTitles.length > 0 &&
      !cachedTitles.some(
        (t) => t.includes(searchTitle) || searchTitle.includes(t),
      );
    if (!isMismatch) return entry.data;
    // Mismatch detected
    delete cache[cacheKey];
    flushAnilistCache();
  }

  try {
    const res = await fetch(ANILIST_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: ANILIST_QUERY,
        variables: { search: title, type },
      }),
    });
    const json = await res.json();
    const data = json?.data?.Media || null;

    cache[cacheKey] = { data, ts: Date.now() };
    flushAnilistCache();

    return data;
  } catch {
    if (entry) return entry.data;
    return null;
  }
};

/**
 * Build an ordered list of seasons from AniList data.
 * AniList represents each season of a series as a separate Media entry
 * linked by SEQUEL/PREQUEL relations. This function walks the SEQUEL chain
 * starting from the fetched entry and returns seasons sorted by air date.
 *
 * Returns: [{ seasonNum, title, episodes, year, month }]
 */
export const buildAnilistSeasons = (anilistData) => {
  if (!anilistData) return null;

  const main = {
    id: anilistData.id,
    title:
      anilistData.title?.english ||
      anilistData.title?.romaji ||
      anilistData.title?.native,
    episodes: anilistData.episodes || null,
    year: anilistData.startDate?.year || anilistData.seasonYear || 9999,
    month: anilistData.startDate?.month || 0,
  };

  // Collect direct TV-format sequels from relations
  const sequels = (anilistData.relations?.edges || [])
    .filter(
      (e) =>
        e.relationType === "SEQUEL" &&
        e.node.type === "ANIME" &&
        (e.node.format === "TV" || e.node.format === "TV_SHORT"),
    )
    .map((e) => ({
      id: e.node.id,
      title: e.node.title?.english || e.node.title?.romaji,
      episodes: e.node.episodes || null,
      year: e.node.startDate?.year || e.node.seasonYear || 9999,
      month: e.node.startDate?.month || 0,
    }));

  const all = [main, ...sequels].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );

  return all.map((s, i) => ({ seasonNum: i + 1, ...s }));
};

// TMDB genre ID 16 = Animation. Treat it as anime when origin_country includes JP or language is jp
export const isAnimeContent = (item, details) => {
  const d = details || item;
  const lang = d.original_language;
  const countries = d.origin_country || [];
  const genreIds = d.genre_ids || (d.genres || []).map((g) => g.id);
  const hasAnimation = genreIds.includes(16);
  return hasAnimation && (lang === "ja" || countries.includes("JP"));
};

// Default sources
export const ANIME_DEFAULT_SOURCE = "allmanga";
export const NON_ANIME_DEFAULT_SOURCE = "vidking";

// ── Episode Group fetch (localStorage + in-memory cache, 7-day TTL) ─────────
// Episode groups almost never change -> cache aggressively across sessions.
const EG_CACHE_KEY = "streambert_episodeGroupCache";
const EG_CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

let _egCache = null;

function getEgCache() {
  if (_egCache) return _egCache;
  try {
    const raw = localStorage.getItem(EG_CACHE_KEY);
    _egCache = raw ? JSON.parse(raw) : {};
  } catch {
    _egCache = {};
  }
  // Evict stale entries once on load
  const now = Date.now();
  for (const key of Object.keys(_egCache)) {
    if (now - _egCache[key].ts > EG_CACHE_TTL) delete _egCache[key];
  }
  return _egCache;
}

let _egFlushTimer = null;
function flushEgCache() {
  if (_egFlushTimer) clearTimeout(_egFlushTimer);
  _egFlushTimer = setTimeout(() => {
    _egFlushTimer = null;
    try {
      localStorage.setItem(EG_CACHE_KEY, JSON.stringify(_egCache));
    } catch {}
  }, 500);
}

export const fetchEpisodeGroup = async (groupId, apiKey) => {
  const cache = getEgCache();
  const entry = cache[groupId];
  if (entry && Date.now() - entry.ts <= EG_CACHE_TTL) return entry.data;

  const data = await tmdbFetch(`/tv/episode_group/${groupId}`, apiKey);
  cache[groupId] = { data, ts: Date.now() };
  flushEgCache();
  return data;
};
