const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

export const imgUrl = (path, size = "w500") =>
  path ? `${IMG_BASE}/${size}${path}` : null;

// Global auth-error callback, registered by App on mount
let _onAuthError = null;
let _onUnreachable = null;
export const setApiErrorHandlers = (onAuth, onUnreachable) => {
  _onAuthError = onAuth;
  _onUnreachable = onUnreachable;
};

export const tmdbFetch = async (path, apiKey) => {
  let res;
  try {
    res = await fetch(`${TMDB_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Network failure
    _onUnreachable?.();
    throw new Error("TMDB unreachable");
  }

  if (res.status === 401 || res.status === 403) {
    _onAuthError?.();
    throw new Error(`TMDB ${res.status}`);
  }

  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
};

export const videasyMovieUrl = (id) => `https://player.videasy.net/movie/${id}`;
export const videasyTVUrl = (id, season, episode) =>
  `https://player.videasy.net/tv/${id}/${season}/${episode}`;

// ── Player Sources ────────────────────────────────────────────────────────────
// supportsProgress: true = executeJavaScript tracking works for this source
export const PLAYER_SOURCES = [
  {
    id: "videasy",
    label: "Videasy",
    tag: null,
    note: null,
    supportsProgress: true,
    movieUrl: (id) => `https://player.videasy.net/movie/${id}`,
    tvUrl: (id, season, ep) =>
      `https://player.videasy.net/tv/${id}/${season}/${ep}`,
  },
  {
    id: "vidsrc",
    label: "VidSrc",
    tag: null,
    note: null,
    supportsProgress: false,
    movieUrl: (id) => `https://vidsrc.to/embed/movie/${id}`,
    tvUrl: (id, season, ep) =>
      `https://vidsrc.to/embed/tv/${id}/${season}/${ep}`,
  },
  {
    id: "2embed",
    label: "2Embed",
    tag: null,
    note: null,
    supportsProgress: false,
    movieUrl: (id) => `https://www.2embed.cc/embed/${id}`,
    tvUrl: (id, season, ep) =>
      `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${ep}`,
  },
  {
    id: "allmanga",
    label: "AllManga",
    tag: "ANIME",
    note: null,
    supportsProgress: true,
    async: true,
    movieUrl: (_id) => "https://allmanga.to",
    tvUrl: (_id, _season, _ep) => "https://allmanga.to",
  },
];

export const getSourceUrl = (sourceId, type, id, season, ep, _title) => {
  const src =
    PLAYER_SOURCES.find((s) => s.id === sourceId) ?? PLAYER_SOURCES[0];
  return type === "movie" ? src.movieUrl(id) : src.tvUrl(id, season, ep);
};

export const sourceSupportsProgress = (sourceId) =>
  PLAYER_SOURCES.find((s) => s.id === sourceId)?.supportsProgress ?? false;

export const sourceIsAsync = (sourceId) =>
  PLAYER_SOURCES.find((s) => s.id === sourceId)?.async ?? false;

// ── AniList API (anime metadata) ──────────────────────────────────────────────
const ANILIST_API = "https://graphql.anilist.co";

// Strip "(Source: ...)", "Note: ..." and similar attribution lines from AniList descriptions
export const cleanAnilistDescription = (desc) => {
  if (!desc) return desc;
  // Remove HTML tags first
  let clean = desc.replace(/<[^>]+>/g, "");
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

// ── AniList cache (localStorage) ─────────────────────────────────────────────
const ANILIST_CACHE_KEY = "streambert_anilistCache";
const ANILIST_CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

function readAnilistCache() {
  try {
    const raw = localStorage.getItem(ANILIST_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAnilistCache(cache) {
  try {
    localStorage.setItem(ANILIST_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function evictStaleAnilist(cache) {
  const now = Date.now();
  for (const key of Object.keys(cache)) {
    if (now - cache[key].ts > ANILIST_CACHE_TTL) {
      delete cache[key];
    }
  }
  return cache;
}

export const fetchAnilistData = async (title, type = "ANIME") => {
  const cacheKey = `${type}__${title.toLowerCase().trim()}`;

  // Return cached data if still fresh (also works offline)
  const cache = evictStaleAnilist(readAnilistCache());
  const entry = cache[cacheKey];
  if (entry && Date.now() - entry.ts <= ANILIST_CACHE_TTL) {
    return entry.data;
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

    // Persist to cache (even null results, so we don't hammer the API)
    cache[cacheKey] = { data, ts: Date.now() };
    writeAnilistCache(cache);

    return data;
  } catch {
    // Offline or network error – return stale cache entry if available
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

// TMDB genre ID 16 = Animation. We treat it as anime when origin_country includes JP or language is jp
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
export const NON_ANIME_DEFAULT_SOURCE = "videasy";
