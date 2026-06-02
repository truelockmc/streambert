// TMDB film fetcher for the Discover page.
// Fetches popular + top_rated movies (10 pages each), dedupes by id,
// caches to localStorage for 24h.

const TMDB_BASE = 'https://api.themoviedb.org/3';
const CACHE_KEY = 'streambert_discoverFilms';
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function fetchDiscoverFilms(apiKey, onProgress) {
  // Check cache
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const { films, expiresAt } = JSON.parse(raw);
      if (Date.now() < expiresAt && films?.length > 100) return films;
    }
  } catch {}

  const headers = { Authorization: `Bearer ${apiKey}` };
  const seen = new Set();
  const films = [];

  const fetchPage = async (endpoint, page) => {
    const res = await fetch(
      `${TMDB_BASE}${endpoint}?page=${page}&language=en-US`,
      { headers }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  };

  const endpoints = [
    '/movie/popular',
    '/movie/top_rated',
    '/movie/now_playing',
    '/trending/movie/week',
  ];

  let done = 0;
  const total = endpoints.length * 10;

  for (const endpoint of endpoints) {
    for (let page = 1; page <= 10; page++) {
      const results = await fetchPage(endpoint, page);
      for (const m of results) {
        if (!seen.has(m.id) && m.poster_path) {
          seen.add(m.id);
          films.push({
            id: m.id,
            title: m.title,
            release_date: m.release_date || '',
            poster_path: m.poster_path,
            backdrop_path: m.backdrop_path || null,
            vote_average: m.vote_average || 0,
            vote_count: m.vote_count || 0,
            genre_ids: m.genre_ids || [],
            overview: m.overview || '',
            media_type: 'movie',
            popularity: m.popularity || 0,
          });
        }
      }
      done++;
      onProgress?.(Math.round((done / total) * 100));
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 50));
    }
  }

  // Sort by popularity descending
  films.sort((a, b) => b.popularity - a.popularity);

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      films,
      expiresAt: Date.now() + CACHE_TTL,
    }));
  } catch {}

  return films;
}

export function clearDiscoverCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

// TMDB genre id → name map
export const GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie',
  53: 'Thriller', 10752: 'War', 37: 'Western',
};
