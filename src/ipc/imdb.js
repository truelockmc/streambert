// OMDb requests run in the main process; the renderer only receives ratings.
const { ipcMain } = require("electron");
const { createHash } = require("crypto");
const { getSecureValue } = require("./storage");

const cache = new Map();
const pending = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function register() {
  ipcMain.handle("has-imdb-api-key", () => !!getSecureValue("omdbApiKey"));

  ipcMain.handle("get-imdb-rating", async (_, imdbId) => {
    if (typeof imdbId !== "string" || !/^tt\d+$/.test(imdbId)) return null;
    const apiKey = getSecureValue("omdbApiKey");
    if (!apiKey) return { rating: null, configured: false };

    const keyHash = createHash("sha256").update(apiKey).digest("hex");
    const cacheKey = `${imdbId}:${keyHash}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return { rating: cached.rating, configured: true, cacheable: true };
    }
    if (pending.has(cacheKey)) return pending.get(cacheKey);

    const request = (async () => {
      try {
        const url = new URL("https://www.omdbapi.com/");
        url.searchParams.set("i", imdbId);
        url.searchParams.set("apikey", apiKey);
        const response = await fetch(url);
        if (!response.ok) {
          return { rating: null, configured: true, cacheable: false };
        }
        const data = await response.json();
        const rating = Number(data?.imdbRating);
        const cacheable = !/invalid api key|request limit/i.test(data?.Error || "");
        return {
          rating:
            data?.Response === "True" && Number.isFinite(rating) && rating > 0
              ? rating
              : null,
          configured: true,
          cacheable,
        };
      } catch {
        return { rating: null, configured: true, cacheable: false };
      }
    })()
      .then((result) => {
        if (result.cacheable) {
          cache.set(cacheKey, { rating: result.rating, ts: Date.now() });
        }
        if (cache.size > 500) {
          const oldest = [...cache.keys()].slice(0, cache.size - 400);
          oldest.forEach((key) => cache.delete(key));
        }
        return result;
      })
      .finally(() => pending.delete(cacheKey));

    pending.set(cacheKey, request);
    return request;
  });
}

module.exports = { register };
