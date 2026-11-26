import { useState, useEffect, useMemo } from "react";
import { fetchImdbId } from "./api";
import { storage, getApiKey } from "./storage";

const CACHE_KEY = "imdbRatingsCache";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
const AGREGARR_API = "https://api.agregarr.org/api/ratings";

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

function evictStale(cache) {
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(cache)) {
    if (now - cache[key].ts > CACHE_TTL) {
      delete cache[key];
      changed = true;
    }
  }
  return { cache, changed };
}

/**
 * Hook that fetches + caches IMDb ratings for an array of items.
 * Uses existing TMDB external_ids lookup + free Agregarr ratings proxy
 * (based on official IMDb non-commercial datasets). No extra API key required.
 */
export function useImdbRatings(items) {
  const [ratingsMap, setRatingsMap] = useState({});
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

    const { cache, changed } = evictStale(readCache());
    if (changed) writeCache(cache);

    // Seed from cache
    const initial = {};
    const missing = [];
    for (const item of items) {
      const type = item.media_type === "tv" ? "tv" : "movie";
      const cacheKey = `${type}_${item.id}`;
      const entry = cache[cacheKey];
      if (entry && Date.now() - entry.ts <= CACHE_TTL) {
        initial[cacheKey] = entry.rating;
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
      // Resolve IMDb IDs (reuses existing cached fetchImdbId)
      const resolved = await Promise.all(
        missing.map(async (item) => {
          const type = item.media_type === "tv" ? "tv" : "movie";
          try {
            const imdbId = await fetchImdbId(type, item.id, apiKey);
            return { item, type, imdbId };
          } catch {
            return { item, type, imdbId: null };
          }
        }),
      );
      if (cancelled) return;

      const toFetch = resolved.filter((r) => r.imdbId);
      if (!toFetch.length) return;

      const newRatings = {};
      const BATCH = 40;

      for (let i = 0; i < toFetch.length; i += BATCH) {
        if (cancelled) return;
        const batch = toFetch.slice(i, i + BATCH);
        const query = batch.map((b) => `id=${b.imdbId}`).join("&");
        try {
          const res = await fetch(`${AGREGARR_API}?${query}`);
          if (!res.ok) continue;
          const data = await res.json();
          const ratingById = Object.fromEntries(
            (Array.isArray(data) ? data : []).map((d) => [d.imdbId, d.rating]),
          );

          for (const { item, type, imdbId } of batch) {
            const rating = ratingById[imdbId];
            if (typeof rating === "number" && rating > 0) {
              const key = `${type}_${item.id}`;
              newRatings[key] = rating;
              cache[key] = { rating, ts: Date.now() };
            }
          }
        } catch {
          // ignore batch failures
        }
      }

      if (cancelled) return;
      if (Object.keys(newRatings).length) {
        writeCache(cache);
        setRatingsMap((prev) => ({ ...prev, ...newRatings }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemsKey, apiKey]);

  return ratingsMap;
}

export function getImdbRatingForItem(ratingsMap, item) {
  if (!item) return null;
  const type = item.media_type === "tv" ? "tv" : "movie";
  return ratingsMap[`${type}_${item.id}`] ?? null;
}
