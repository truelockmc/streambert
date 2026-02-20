// ── Age Rating Backend ────────────────────────────────────────────────────────

export const RATING_COUNTRIES = [
  { code: "US", label: "United States (MPAA / TV Parental)" },
  { code: "DE", label: "Germany (FSK)" },
  { code: "GB", label: "United Kingdom (BBFC)" },
  { code: "FR", label: "France (CNC)" },
  { code: "AU", label: "Australia (ACB)" },
  { code: "NZ", label: "New Zealand (OFLC)" },
  { code: "BR", label: "Brazil (DEJUS)" },
  { code: "CA", label: "Canada (CRTC)" },
  { code: "JP", label: "Japan (EIRIN)" },
];

const CERT_TO_AGE = {
  US: {
    g: 0,
    nr: 0,
    "not rated": 0,
    unrated: 0,
    "tv-y": 0,
    "tv-y7": 7,
    "tv-g": 0,
    pg: 7,
    "tv-pg": 7,
    "pg-13": 13,
    "tv-13": 13,
    "tv-14": 14,
    r: 17,
    "nc-17": 18,
    "tv-ma": 18,
    x: 18,
  },
  DE: {
    "fsk 0": 0,
    0: 0,
    "fsk 6": 6,
    6: 6,
    "fsk 12": 12,
    12: 12,
    "fsk 16": 16,
    16: 16,
    "fsk 18": 18,
    18: 18,
    "ab 0": 0,
    "ab 6": 6,
    "ab 12": 12,
    "ab 16": 16,
    "ab 18": 18,
  },
  GB: { u: 0, uc: 0, pg: 7, "12a": 12, 12: 12, 15: 15, 18: 18, r18: 18 },
  FR: { u: 0, g: 0, "tous publics": 0, 10: 10, 12: 12, 16: 16, 18: 18 },
  AU: {
    g: 0,
    pg: 7,
    m: 15,
    ma: 15,
    "ma 15+": 15,
    "ma15+": 15,
    r: 18,
    "r 18+": 18,
    "r18+": 18,
    "x 18+": 18,
    "x18+": 18,
    rc: 18,
  },
  NZ: {
    g: 0,
    pg: 7,
    m: 0,
    r13: 13,
    r15: 15,
    r16: 16,
    r18: 18,
    rp13: 13,
    rp16: 16,
  },
  BR: { l: 0, livre: 0, 10: 10, 12: 12, 14: 14, 16: 16, 18: 18 },
  CA: {
    g: 0,
    pg: 7,
    "14a": 14,
    "18a": 18,
    r: 18,
    a: 18,
    "13+": 13,
    "16+": 16,
    "18+": 18,
  },
  JP: {
    g: 0,
    pg12: 12,
    "pg-12": 12,
    r15: 15,
    "r-15": 15,
    r18: 18,
    "r-18": 18,
    "rz-18": 18,
  },
};

export function certToMinAge(cert, countryCode) {
  if (!cert || !cert.trim()) return null;
  const map = CERT_TO_AGE[countryCode] || CERT_TO_AGE["US"];
  const key = cert.trim().toLowerCase();
  if (key in map) return map[key];
  const stripped = key.replace(/\s+/g, "");
  for (const [k, v] of Object.entries(map)) {
    if (k.replace(/\s+/g, "") === stripped) return v;
  }
  return null;
}

export function isRestricted(contentMinAge, ageLimitSetting) {
  if (ageLimitSetting === null || ageLimitSetting === undefined) return false;
  if (contentMinAge === null || contentMinAge === undefined) return false;
  return contentMinAge > ageLimitSetting;
}

export async function fetchMovieRating(movieId, apiKey, countryCode) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${movieId}/release_dates`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) return { cert: null, minAge: null };
    const data = await res.json();
    const results = data.results || [];
    const codesToTry = countryCode !== "US" ? [countryCode, "US"] : ["US"];
    for (const code of codesToTry) {
      const entry = results.find((r) => r.iso_3166_1 === code);
      if (!entry) continue;
      const dates = entry.release_dates || [];
      const sorted = [
        ...dates.filter((d) => d.type === 3),
        ...dates.filter((d) => d.type !== 3),
      ];
      const certEntry = sorted.find(
        (d) => d.certification && d.certification.trim() !== "",
      );
      if (certEntry) {
        const cert = certEntry.certification.trim();
        return { cert, minAge: certToMinAge(cert, code) };
      }
    }
    return { cert: null, minAge: null };
  } catch {
    return { cert: null, minAge: null };
  }
}

export async function fetchTVRating(tvId, apiKey, countryCode) {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/tv/${tvId}/content_ratings`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) return { cert: null, minAge: null };
    const data = await res.json();
    const results = data.results || [];
    const codesToTry = countryCode !== "US" ? [countryCode, "US"] : ["US"];
    for (const code of codesToTry) {
      const entry = results.find((r) => r.iso_3166_1 === code);
      if (entry?.rating && entry.rating.trim() !== "") {
        const cert = entry.rating.trim();
        return { cert, minAge: certToMinAge(cert, code) };
      }
    }
    return { cert: null, minAge: null };
  } catch {
    return { cert: null, minAge: null };
  }
}

export function getAgeLimitSetting(storage) {
  const val = storage.get("ageLimit");
  if (val === null || val === undefined || val === "") return null;
  return Number(val);
}

export function getRatingCountry(storage) {
  return storage.get("ratingCountry") || "US";
}
