// ── IPTV-org API integration ──────────────────────────────────────────────────
// Data from https://github.com/iptv-org/api (static GitHub Pages CDN)
// Channels + streams + logos are fetched once and cached for 6 hours.

const API_BASE = "https://iptv-org.github.io/api";
const CACHE_KEY = "streambert_iptvCache";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

let _cache = null;

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IPTV fetch failed: ${url} (${res.status})`);
  return res.json();
}

export async function fetchIptvData() {
  // In-memory hit
  if (_cache && Date.now() < _cache.expiresAt) return _cache.data;

  // localStorage hit
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (Date.now() < stored.expiresAt) {
        _cache = stored;
        return stored.data;
      }
    }
  } catch {}

  // Fetch all three in parallel
  const [channels, streams, logos] = await Promise.all([
    fetchJSON(`${API_BASE}/channels.json`),
    fetchJSON(`${API_BASE}/streams.json`),
    fetchJSON(`${API_BASE}/logos.json`),
  ]);

  // Build logo map: channel id → logo url (in_use only, prefer wider logos)
  const logoMap = {};
  for (const l of logos) {
    if (l.in_use && l.url) logoMap[l.channel] = l.url;
  }

  // Build channel map
  const channelMap = {};
  for (const c of channels) {
    if (c.closed === null) channelMap[c.id] = c;
  }

  // Join streams with channel metadata
  const enriched = streams
    .filter((s) => channelMap[s.channel])
    .map((s) => {
      const ch = channelMap[s.channel];
      return {
        id: `${s.channel}@${s.feed || "default"}`,
        channelId: s.channel,
        name: s.title || ch.name,
        channelName: ch.name,
        url: s.url,
        referrer: s.referrer || null,
        userAgent: s.user_agent || null,
        quality: s.quality || null,
        label: s.label || null, // "Geo-blocked", "Not 24/7", null
        country: ch.country,
        categories: ch.categories || [],
        logo: logoMap[s.channel] || null,
        website: ch.website || null,
        isNsfw: ch.is_nsfw || false,
      };
    })
    .filter((s) => !s.isNsfw);

  const data = { streams: enriched };
  const expiresAt = Date.now() + CACHE_TTL;
  _cache = { data, expiresAt };

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, expiresAt }));
  } catch {}

  return data;
}

export function clearIptvCache() {
  _cache = null;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}

// All unique countries present in the stream list
export function getCountries(streams) {
  const seen = new Set();
  return streams
    .map((s) => s.country)
    .filter((c) => c && !seen.has(c) && seen.add(c))
    .sort();
}

// All unique categories present in the stream list
export function getCategories(streams) {
  const seen = new Set();
  return streams
    .flatMap((s) => s.categories)
    .filter((c) => c && !seen.has(c) && seen.add(c))
    .sort();
}
