import { useState, useEffect } from "react";
import {
  fetchMovieRating,
  fetchTVRating,
  isRestricted,
  getAgeLimitSetting,
  getRatingCountry,
} from "./ageRating";
import { storage, getApiKey } from "./storage";

const CACHE_KEY = "ratingsCache";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

function getCache() {
  try {
    return storage.get(CACHE_KEY) || {};
  } catch {
    return {};
  }
}
function setCache(cache) {
  try {
    storage.set(CACHE_KEY, cache);
  } catch {}
}

function getCached(id, type, country) {
  const cache = getCache();
  const entry = cache[`${type}_${id}_${country}`];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) return null;
  return entry;
}

function setCached(id, type, country, cert, minAge) {
  const cache = getCache();
  cache[`${type}_${id}_${country}`] = { cert, minAge, ts: Date.now() };
  setCache(cache);
}

/**
 * Hook that fetches + caches age ratings for an array of items.
 */
export function useRatings(items) {
  const [ratingsMap, setRatingsMap] = useState({});
  const ageLimitSetting = getAgeLimitSetting(storage);
  const ratingCountry = getRatingCountry(storage);
  const apiKey = getApiKey();

  useEffect(() => {
    if (!items?.length || !apiKey) return;

    // Seed from cache immediately (no flash)
    const initial = {};
    for (const item of items) {
      const type = item.media_type === "tv" ? "tv" : "movie";
      const cached = getCached(item.id, type, ratingCountry);
      if (cached)
        initial[`${type}_${item.id}`] = {
          cert: cached.cert,
          minAge: cached.minAge,
        };
    }
    if (Object.keys(initial).length)
      setRatingsMap((prev) => ({ ...prev, ...initial }));

    // Fetch missing ones with small stagger
    const missing = items.filter((item) => {
      const type = item.media_type === "tv" ? "tv" : "movie";
      return !getCached(item.id, type, ratingCountry);
    });

    let cancelled = false;
    (async () => {
      for (let i = 0; i < missing.length; i++) {
        if (cancelled) break;
        const item = missing[i];
        const type = item.media_type === "tv" ? "tv" : "movie";
        const mapKey = `${type}_${item.id}`;
        try {
          const result =
            type === "tv"
              ? await fetchTVRating(item.id, apiKey, ratingCountry)
              : await fetchMovieRating(item.id, apiKey, ratingCountry);
          if (!cancelled) {
            setCached(item.id, type, ratingCountry, result.cert, result.minAge);
            setRatingsMap((prev) => ({ ...prev, [mapKey]: result }));
          }
        } catch {}
        if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 80));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items?.length, apiKey, ratingCountry]);

  return { ratingsMap, ageLimitSetting, ratingCountry };
}

export function getRatingForItem(item, ratingsMap) {
  const type = item.media_type === "tv" ? "tv" : "movie";
  return ratingsMap[`${type}_${item.id}`] || { cert: null, minAge: null };
}
