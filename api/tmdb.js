const TMDB_BASE = "https://api.themoviedb.org/3";

const ALLOWED_PREFIXES = [
  "/collection/",
  "/configuration",
  "/movie/",
  "/search/",
  "/trending/",
  "/tv/",
];

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const token =
    process.env.TMDB_READ_ACCESS_TOKEN || process.env.STREAMBERT_TMDB_TOKEN;
  if (!token) {
    sendJson(res, 500, { error: "TMDB proxy is not configured" });
    return;
  }

  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) {
    sendJson(res, 400, { error: "Invalid TMDB path" });
    return;
  }

  const requested = new URL(rawPath, "https://streambert.local");
  if (
    !ALLOWED_PREFIXES.some((prefix) => requested.pathname.startsWith(prefix))
  ) {
    sendJson(res, 403, { error: "TMDB path is not allowed" });
    return;
  }

  const url = new URL(`${TMDB_BASE}${requested.pathname}${requested.search}`);

  const tmdbRes = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await tmdbRes.text();
  res.statusCode = tmdbRes.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(text);
}
