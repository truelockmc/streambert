import { tmdbFetch } from "./api";

// ── Advanced search: TMDB /discover + client-side filtering ──────────────────
const ANIMATION = 16; // same genre id for movies and TV on TMDB
const MAX_RESULTS = 60;
const DISCOVER_PAGES = [1, 2, 3];

// Known TMDB genre ids per media type
const MOVIE_GENRE_IDS = new Set([
  28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878,
  10770, 53, 10752, 37,
]);
const TV_GENRE_IDS = new Set([
  10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766,
  10767, 10768, 37,
]);
const GENRE_IDS = { movie: MOVIE_GENRE_IDS, tv: TV_GENRE_IDS };

// Movie <-> TV genre equivalents (TMDB uses combined genres for TV)
const GENRE_EQUIV = {
  28: [10759], // Action -> Action & Adventure
  12: [10759], // Adventure -> Action & Adventure
  878: [10765], // Science Fiction -> Sci-Fi & Fantasy
  14: [10765], // Fantasy -> Sci-Fi & Fantasy
  10752: [10768], // War -> War & Politics
  10759: [28, 12],
  10765: [878, 14],
  10768: [10752],
};

/** Genre ids (OR) that represent `id` for the given media type. */
export function genreIdsFor(type, id) {
  const n = Number(id);
  if (!n) return [];
  if (GENRE_IDS[type]?.has(n)) return [n];
  return (GENRE_EQUIV[n] || []).filter((g) => GENRE_IDS[type]?.has(g));
}

export const DEFAULT_FILTERS = {
  type: "all", // all | movie | tv
  category: "all", // see CATEGORIES
  genre: "", // TMDB genre id (mapped between movie/tv when needed)
  lang: "", // ISO 639-1 original language
  yearFrom: "",
  yearTo: "",
  minRating: "", // minimum TMDB score
  sort: "popularity", // see SORT_OPTIONS
};

export const TYPE_OPTIONS = [
  { value: "all", label: "Movies & Series" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "Series" },
];

const isAnimeResult = (r) =>
  r.original_language === "ja" || (r.origin_country || []).includes("JP");

const isDonghuaResult = (r) =>
  ["zh", "cn"].includes(r.original_language) ||
  (r.origin_country || []).some((c) => ["CN", "HK", "TW"].includes(c));

/**
 * Category definitions.
 * - types:    media types the category exists for
 * - animated: true = only animation, false = no animation
 * - genres:   per type, a list of ids where ANY must match
 * - langs:    allowed original languages (sent to TMDB as OR)
 * - match:    extra client-side check (replaces the language check)
 */
const CATEGORIES = {
  anime: { animated: true, langs: ["ja"], match: isAnimeResult },
  cartoon: {
    animated: true,
    match: (r) => !isAnimeResult(r) && !isDonghuaResult(r),
  },
  donghua: { animated: true, langs: ["zh", "cn"], match: isDonghuaResult },
  live: { animated: false },
  documentary: { genres: { movie: [99], tv: [99] } },
  kids: { genres: { movie: [10751], tv: [10762, 10751] } },
  reality: { types: ["tv"], genres: { tv: [10764, 10767] } },
  kdrama: { types: ["tv"], animated: false, langs: ["ko"] },
  indian: {
    animated: false,
    langs: ["hi", "ta", "te", "ml", "kn", "bn", "mr", "pa"],
  },
};

export const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "live", label: "Live action" },
  { value: "anime", label: "Anime" },
  { value: "cartoon", label: "Cartoon" },
  { value: "donghua", label: "Donghua (Chinese animation)" },
  { value: "documentary", label: "Documentary" },
  { value: "kids", label: "Kids & Family" },
  { value: "reality", label: "Reality & Talk shows" },
  { value: "kdrama", label: "K-Drama" },
  { value: "indian", label: "Indian cinema" },
];

/** Is a category available for a type filter? */
export const categoryFitsType = (category, type) => {
  const types = CATEGORIES[category]?.types;
  return !types || type === "all" || types.includes(type);
};

export const SORT_OPTIONS = [
  { value: "popularity", label: "Most popular" },
  { value: "rating", label: "Best rated" },
  { value: "votes", label: "Most votes" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "title", label: "Title A–Z" },
];

export const RATING_OPTIONS = [
  { value: "", label: "Any rating" },
  ...["5", "6", "7", "7.5", "8", "8.5"].map((n) => ({
    value: n,
    label: `★ ${n}+`,
  })),
];

export const LANGUAGE_OPTIONS = [
  { value: "", label: "Any language" },
  ...[
    ["ar", "Arabic"],
    ["bn", "Bengali"],
    ["cn", "Cantonese"],
    ["zh", "Chinese (Mandarin)"],
    ["cs", "Czech"],
    ["da", "Danish"],
    ["nl", "Dutch"],
    ["en", "English"],
    ["fi", "Finnish"],
    ["fr", "French"],
    ["de", "German"],
    ["el", "Greek"],
    ["he", "Hebrew"],
    ["hi", "Hindi"],
    ["hu", "Hungarian"],
    ["is", "Icelandic"],
    ["id", "Indonesian"],
    ["it", "Italian"],
    ["ja", "Japanese"],
    ["kn", "Kannada"],
    ["ko", "Korean"],
    ["ms", "Malay"],
    ["ml", "Malayalam"],
    ["mr", "Marathi"],
    ["no", "Norwegian"],
    ["fa", "Persian"],
    ["pl", "Polish"],
    ["pt", "Portuguese"],
    ["pa", "Punjabi"],
    ["ro", "Romanian"],
    ["ru", "Russian"],
    ["sr", "Serbian"],
    ["es", "Spanish"],
    ["sv", "Swedish"],
    ["tl", "Tagalog"],
    ["ta", "Tamil"],
    ["te", "Telugu"],
    ["th", "Thai"],
    ["tr", "Turkish"],
    ["uk", "Ukrainian"],
    ["vi", "Vietnamese"],
  ].map(([value, label]) => ({ value, label })),
];

export const filtersActive = (f) =>
  Object.keys(DEFAULT_FILTERS).some((k) => f[k] !== DEFAULT_FILTERS[k]);

/** Merge stored filters with defaults (migrates the old single `year`). */
export function normalizeFilters(stored) {
  const f = { ...DEFAULT_FILTERS };
  if (stored && typeof stored === "object") {
    for (const k of Object.keys(DEFAULT_FILTERS)) {
      if (typeof stored[k] === "string") f[k] = stored[k];
    }
    if (stored.year && !stored.yearFrom && !stored.yearTo) {
      f.yearFrom = f.yearTo = String(stored.year);
    }
  }
  if (f.category !== "all" && !CATEGORIES[f.category]) f.category = "all";
  if (!SORT_OPTIONS.some((o) => o.value === f.sort)) f.sort = "popularity";
  return f;
}

const dateOf = (r) => r.release_date || r.first_air_date || "";
const titleOf = (r) => r.title || r.name || "";
const validYear = (y) => (/^\d{4}$/.test(String(y)) ? Number(y) : null);

/** Year range, swapped if entered the wrong way round. */
function yearRange(f) {
  let from = validYear(f.yearFrom);
  let to = validYear(f.yearTo);
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

/** Languages to request: the category's, narrowed by the user's choice. */
function effectiveLangs(f) {
  const cat = CATEGORIES[f.category];
  if (f.lang) {
    if (cat?.langs && !cat.langs.includes(f.lang)) return null; // conflict
    return [f.lang];
  }
  return cat?.langs || [];
}

/** Genre groups (AND of ORs) that a result of `type` must satisfy. */
function genreGroups(type, f) {
  const groups = [];
  const cat = CATEGORIES[f.category];
  if (cat?.animated) groups.push([ANIMATION]);
  if (cat?.genres) groups.push(cat.genres[type] || []);
  if (f.genre) groups.push(genreIdsFor(type, f.genre));
  return groups;
}

/** Can the filters match anything of this media type at all? */
function typeAllowed(type, f) {
  if (f.type !== "all" && f.type !== type) return false;
  if (!categoryFitsType(f.category, type)) return false;
  if (effectiveLangs(f) === null) return false;
  return genreGroups(type, f).every((g) => g.length > 0);
}

/** Does a TMDB result (with media_type) match the filters? */
export function matchesFilters(r, f) {
  const type = r.media_type;
  if (type !== "movie" && type !== "tv") return false;
  if (!typeAllowed(type, f)) return false;

  const genres = r.genre_ids || [];
  const cat = CATEGORIES[f.category];
  if (cat?.animated === false && genres.includes(ANIMATION)) return false;
  if (!genreGroups(type, f).every((g) => g.some((id) => genres.includes(id))))
    return false;
  if (cat?.match && !cat.match(r)) return false;

  // Anime/Donghua use their own match (origin country counts too)
  const langs = effectiveLangs(f);
  if (langs.length && !cat?.match && !langs.includes(r.original_language))
    return false;
  if (f.lang && r.original_language !== f.lang) return false;

  const { from, to } = yearRange(f);
  if (from || to) {
    const y = Number(dateOf(r).slice(0, 4));
    if (!y || (from && y < from) || (to && y > to)) return false;
  }

  const min = Number(f.minRating);
  if (min && (r.vote_average || 0) < min) return false;
  return true;
}

function sortResults(list, sort) {
  const by = {
    popularity: (a, b) => (b.popularity || 0) - (a.popularity || 0),
    rating: (a, b) => (b.vote_average || 0) - (a.vote_average || 0),
    votes: (a, b) => (b.vote_count || 0) - (a.vote_count || 0),
    newest: (a, b) => dateOf(b).localeCompare(dateOf(a)),
    oldest: (a, b) => (dateOf(a) || "9999").localeCompare(dateOf(b) || "9999"),
    title: (a, b) =>
      titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: "base" }),
  }[sort];
  return by ? [...list].sort(by) : list;
}

function discoverPath(type, f, page) {
  const p = new URLSearchParams({ include_adult: "false", page: String(page) });
  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
  let minVotes = 0;

  switch (f.sort) {
    case "rating":
      p.set("sort_by", "vote_average.desc");
      minVotes = type === "movie" ? 200 : 100;
      break;
    case "votes":
      p.set("sort_by", "vote_count.desc");
      break;
    case "newest":
      p.set("sort_by", `${dateField}.desc`);
      minVotes = 5; // skip empty placeholder entries
      break;
    case "oldest":
      p.set("sort_by", `${dateField}.asc`);
      minVotes = 5;
      break;
    case "title":
      p.set("sort_by", type === "movie" ? "title.asc" : "name.asc");
      minVotes = 50; // otherwise mostly obscure "!"/digit titles
      break;
    default:
      p.set("sort_by", "popularity.desc");
  }

  // Genres: TMDB takes "," = AND, "|" = OR (not both mixed).
  // Single-id groups go to the server; an OR group only if it is alone.
  // Everything is re-checked client-side in matchesFilters.
  const groups = genreGroups(type, f);
  const singles = [...new Set(groups.filter((g) => g.length === 1).flat())];
  const ors = groups.filter((g) => g.length > 1);
  if (singles.length) p.set("with_genres", singles.join(","));
  else if (ors.length) p.set("with_genres", ors[0].join("|"));
  if (CATEGORIES[f.category]?.animated === false) {
    p.set("without_genres", String(ANIMATION));
  }

  const langs = effectiveLangs(f) || [];
  if (langs.length) p.set("with_original_language", langs.join("|"));

  const { from, to } = yearRange(f);
  const today = new Date().toISOString().slice(0, 10);
  if (from) p.set(`${dateField}.gte`, `${from}-01-01`);
  let lte = to ? `${to}-12-31` : "";
  if (f.sort === "newest" && (!lte || lte > today)) lte = today;
  if (lte) p.set(`${dateField}.lte`, lte);

  const min = Number(f.minRating);
  if (min) {
    p.set("vote_average.gte", String(min));
    minVotes = Math.max(minVotes, 30); // a single 10/10 vote shouldn't count
  }
  if (minVotes) p.set("vote_count.gte", String(minVotes));

  return `/discover/${type}?${p.toString()}`;
}

async function fetchPages(paths, apiKey, mediaType) {
  const pages = await Promise.all(
    paths.map((path) => tmdbFetch(path, apiKey).catch(() => null)),
  );
  return pages.flatMap((d) =>
    (d?.results || []).map((r) =>
      mediaType ? { ...r, media_type: mediaType } : r,
    ),
  );
}

const dedupe = (list) => {
  const seen = new Set();
  return list.filter((r) => {
    const key = `${r.media_type}-${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Run a search with filters.
 * - With text: /search/multi (3 pages), filtered client-side.
 * - Without text: /discover for the applicable type(s) (3 pages each).
 */
export async function advancedSearch(query, f, apiKey) {
  const types = ["movie", "tv"].filter((t) => typeAllowed(t, f));
  if (!types.length) return [];

  let list;
  if (query.trim()) {
    const q = encodeURIComponent(query.trim());
    list = await fetchPages(
      [1, 2, 3].map((n) => `/search/multi?query=${q}&page=${n}`),
      apiKey,
    );
    list = list.filter((r) => matchesFilters(r, f));
    if (f.sort !== "popularity") list = sortResults(list, f.sort);
  } else {
    const perType = await Promise.all(
      types.map((t) =>
        fetchPages(DISCOVER_PAGES.map((n) => discoverPath(t, f, n)), apiKey, t),
      ),
    );
    list = sortResults(
      perType.flat().filter((r) => matchesFilters(r, f)),
      f.sort,
    );
  }
  return dedupe(list).slice(0, MAX_RESULTS);
}

/**
 * Genre list for a type filter (localized via tmdbFetch).
 * For "all", movie and TV genres are merged: TV-only combined genres
 * (e.g. "Action & Adventure") are covered by their movie equivalents.
 */
export async function fetchGenres(type, apiKey) {
  const load = async (t) =>
    ((await tmdbFetch(`/genre/${t}/list`, apiKey))?.genres || []).filter(
      (g) => g.id !== ANIMATION,
    );
  if (type === "movie" || type === "tv") return load(type);

  const [movie, tv] = await Promise.all([
    load("movie").catch(() => []),
    load("tv").catch(() => []),
  ]);
  const extra = tv.filter(
    (g) => !MOVIE_GENRE_IDS.has(g.id) && !GENRE_EQUIV[g.id],
  );
  return [...movie, ...extra].sort((a, b) => a.name.localeCompare(b.name));
}
