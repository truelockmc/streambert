// ── Person Credits Utilities ────────────────────────────────────────────────
// Parsing, sorting, and computing derived data from TMDB person credits.

/**
 * Parse combined_credits into separate movie and TV arrays.
 * Each entry is normalized to: { id, title, poster_path, date, vote_average, character, media_type, popularity }
 */
export function parseCombinedCredits(credits) {
  if (!credits) return { movies: [], tv: [] };

  const movies = (credits.cast || [])
    .filter((c) => c.media_type === "movie")
    .map((c) => ({
      id: c.id,
      title: c.title || c.original_title || "Unknown",
      poster_path: c.poster_path || null,
      date: c.release_date || "",
      year: (c.release_date || "").slice(0, 4),
      vote_average: c.vote_average || 0,
      character: c.character || "",
      media_type: "movie",
      popularity: c.popularity || 0,
      order: c.order ?? 999,
    }));

  const tv = (credits.cast || [])
    .filter((c) => c.media_type === "tv")
    .map((c) => ({
      id: c.id,
      title: c.name || c.original_name || "Unknown",
      poster_path: c.poster_path || null,
      date: c.first_air_date || "",
      year: (c.first_air_date || "").slice(0, 4),
      vote_average: c.vote_average || 0,
      character: c.character || "",
      media_type: "tv",
      popularity: c.popularity || 0,
      order: c.order ?? 999,
    }));

  return { movies, tv };
}

/**
 * Sort credits by the given key.
 * "popularity" (default) | "year" | "rating" | "alpha"
 */
export function sortCredits(items, sortKey) {
  const sorted = [...items];
  switch (sortKey) {
    case "year":
      return sorted.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      });
    case "rating":
      return sorted.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    case "alpha":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case "popularity":
    default:
      return sorted.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  }
}

/**
 * Compute "known for" items — top N works by (vote_average * log(popularity + 1)).
 * This gives a balanced score that rewards both quality and popularity.
 */
export function computeKnownFor(movies, tv, limit = 8) {
  const all = [...movies, ...tv];
  const scored = all.map((item) => {
    const popScore = Math.log((item.popularity || 0) + 1);
    const voteScore = item.vote_average || 0;
    return { ...item, _score: voteScore * popScore };
  });
  scored.sort((a, b) => b._score - a._score);
  // Deduplicate by id
  const seen = new Set();
  const result = [];
  for (const item of scored) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
      if (result.length >= limit) break;
    }
  }
  return result;
}

/**
 * Compute frequent co-stars from combined credits.
 * For each work the person was in, we look at the top cast members.
 * Since combined_credits only has the person's roles (not full cast),
 * we return an empty array here — co-stars are computed client-side
 * from the person's works' individual credits if needed.
 * For now, this is a placeholder that returns [].
 */
export function computeFrequentCoStars(credits) {
  // TMDB combined_credits doesn't include co-star data.
  // Co-star computation would require fetching /movie/{id}/credits
  // for each work, which is too expensive for a single page load.
  // Return empty — the co-stars section will be omitted.
  return [];
}

/**
 * Format a birth/death date string.
 */
export function formatLifespan(birthday, deathday) {
  if (!birthday) return null;
  const birthYear = parseInt(birthday.slice(0, 4), 10);
  if (deathday) {
    const deathYear = parseInt(deathday.slice(0, 4), 10);
    const age = deathYear - birthYear;
    return `Died ${deathday} (age ${age})`;
  }
  const now = new Date().getFullYear();
  const age = now - birthYear;
  return `Born ${birthday} (age ${age})`;
}

/**
 * Truncate biography to N sentences.
 */
export function truncateBio(bio, maxSentences = 4) {
  if (!bio) return "";
  const sentences = bio.match(/[^.!?]+[.!?]+/g) || [bio];
  if (sentences.length <= maxSentences) return bio;
  return sentences.slice(0, maxSentences).join("").trim();
}

/**
 * Get the best backdrop path from a list of credits.
 * Picks the highest-rated movie's backdrop.
 */
export function getBestBackdropFromCredits(movies) {
  if (!movies || movies.length === 0) return null;
  const sorted = [...movies].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  // We don't have backdrop_path in credits data, so return null.
  // The PersonPage will use the person's profile image as the hero instead.
  return null;
}
