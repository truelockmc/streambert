import { useState, useEffect, useMemo } from "react";
import {
  fetchMovieRating,
  fetchTVRating,
  getAgeLimitSetting,
  getRatingCountry,
} from "./ageRating";
import { storage, getApiKey } from "./storage";
import { fetchImdbId } from "./api";

const CACHE_KEY = "ratingsCache";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

// Read the whole cache once and return it, caller holds reference
function readCache() {
  try {
    return storage.get(CACHE_KEY) || {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    storage.set(CACHE_KEY, cache);
  } catch {}
}

// Evict entries older than TTL and return the cleaned cache
function evictStale(cache) {
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(cache)) {
    if (now - cache[key].ts > CACHE_TTL) {
      delete cache[key];
      changed = true;
    }
  }
  return cache; // mutated in-place; caller uses return value as signal via changed flag
}

/**
 * Hook that fetches + caches age ratings for an array of items.
 */
export function useRatings(items) {
  const [ratingsMap, setRatingsMap] = useState({});
  // Read stable settings once — these only change when user visits Settings,
  // which unmounts/remounts affected pages anyway, so useState(init) is correct.
  const [ageLimitSetting] = useState(() => getAgeLimitSetting(storage));
  const [ratingCountry] = useState(() => getRatingCountry(storage));
  const [apiKey] = useState(() => getApiKey());

  const itemsKey = useMemo(() => {
    if (!items?.length) return "";
    return items
      .map((i) => `${i.media_type === "tv" ? "tv" : "movie"}_${i.id}`)
      .sort()
      .join(",");
  }, [items]);

  useEffect(() => {
    if (!itemsKey || !apiKey) return;

    // Read cache once for the whole effect run
    const cache = evictStale(readCache());
    let cacheModified = false;

    // Seed from cache immediately (no flash)
    const initial = {};
    const missing = [];
    for (const item of items) {
      const type = item.media_type === "tv" ? "tv" : "movie";
      const cacheKey = `${type}_${item.id}_${ratingCountry}`;
      const entry = cache[cacheKey];
      const isValid = entry && Date.now() - entry.ts <= CACHE_TTL;
      if (isValid) {
        initial[`${type}_${item.id}`] = {
          cert: entry.cert,
          minAge: entry.minAge,
        };
      } else {
        missing.push(item);
      }
    }

    if (Object.keys(initial).length) {
      setRatingsMap((prev) => ({ ...prev, ...initial }));
    }

    if (!missing.length) return;

    let cancelled = false;
    (async () => {
      for (let i = 0; i < missing.length; i++) {
        if (cancelled) break;
        const item = missing[i];
        const type = item.media_type === "tv" ? "tv" : "movie";
        const mapKey = `${type}_${item.id}`;
        const cacheKey = `${type}_${item.id}_${ratingCountry}`;
        try {
          const result =
            type === "tv"
              ? await fetchTVRating(item.id, apiKey, ratingCountry)
              : await fetchMovieRating(item.id, apiKey, ratingCountry);
          if (!cancelled) {
            cache[cacheKey] = {
              cert: result.cert,
              minAge: result.minAge,
              ts: Date.now(),
            };
            cacheModified = true;
            setRatingsMap((prev) => ({ ...prev, [mapKey]: result }));
          }
        } catch {}
        // Avoid "hammering" TMDB
        if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 80));
      }
      // Write cache once at the end instead of after each item
      if (cacheModified && !cancelled) writeCache(cache);
    })();

    return () => {
      cancelled = true;
    };
  }, [itemsKey, apiKey, ratingCountry]);

  return { ratingsMap, ageLimitSetting, ratingCountry };
}

export function getRatingForItem(item, ratingsMap) {
  const type = item.media_type === "tv" ? "tv" : "movie";
  return ratingsMap[`${type}_${item.id}`] || { cert: null, minAge: null };
}

const IMDB_CACHE_KEY = "imdbRatingsCache";
const IMDB_CACHE_TTL = 1000 * 60 * 60 * 24 * 7;

/** Fetch and locally cache IMDb ratings for a set of TMDB movie/TV items. */
export function useImdbRatings(items, apiKeyOverride) {
  const [ratings, setRatings] = useState({});
  const [storedApiKey] = useState(() => getApiKey());
  const apiKey = apiKeyOverride || storedApiKey;
  const itemsKey = useMemo(
    () =>
      (items || [])
        .filter((item) => item?.id != null)
        .map((item) => `${item.media_type === "tv" ? "tv" : "movie"}_${item.id}`)
        .sort()
        .join(","),
    [items],
  );

  useEffect(() => {
    if (!itemsKey || !apiKey || !window.electron?.getImdbRating) return;
    let cancelled = false;
    const unique = new Map();
    for (const item of items || []) {
      if (item?.id == null) continue;
      const type = item.media_type === "tv" ? "tv" : "movie";
      unique.set(`${type}_${item.id}`, { item, type });
    }

    (async () => {
      let cache = {};
      try {
        cache = storage.get(IMDB_CACHE_KEY) || {};
      } catch {}
      const now = Date.now();
      const missing = [];
      const initial = {};
      for (const [mapKey, value] of unique) {
        const entry = cache[mapKey];
        if (entry && now - entry.ts <= IMDB_CACHE_TTL) initial[mapKey] = entry.rating;
        else missing.push([mapKey, value]);
      }
      if (Object.keys(initial).length) setRatings((prev) => ({ ...prev, ...initial }));
      if (!missing.length) return;

      try {
        const configured = await window.electron.hasImdbApiKey();
        if (!configured || cancelled) return;
      } catch {
        return;
      }

      for (let i = 0; i < missing.length; i++) {
        if (cancelled) return;
        const [mapKey, { item, type }] = missing[i];
        try {
          const imdbId = await fetchImdbId(type, item.id, apiKey);
          const result = await window.electron.getImdbRating(imdbId);
          if (!result?.configured) return;
          if (result.cacheable === false) return;
          if (cancelled) return;
          cache[mapKey] = { rating: result.rating, ts: Date.now() };
          setRatings((prev) => ({ ...prev, [mapKey]: result.rating }));
        } catch {
          // Missing IMDb IDs and transient provider errors are left uncached.
        }
        if (i < missing.length - 1) await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (!cancelled) {
        try {
          const cutoff = Date.now() - IMDB_CACHE_TTL;
          for (const [key, entry] of Object.entries(cache)) {
            if (entry?.ts < cutoff) delete cache[key];
          }
          storage.set(IMDB_CACHE_KEY, cache);
        } catch {}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemsKey, apiKey]);

  return ratings;
}

export function getImdbRatingForItem(item, ratings) {
  const type = item.media_type === "tv" ? "tv" : "movie";
  return ratings[`${type}_${item.id}`] ?? null;
}
