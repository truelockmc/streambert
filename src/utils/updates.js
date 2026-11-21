// ── App Update Utilities ──────────────────────────────────────────────────────
// Centralised update-check logic. Imported by both App.jsx and SettingsPage.jsx.
//
// Supports multiple release sources (GitHub + Codeberg).

export const GITHUB_REPO = "truelockmc/streambert";
export const CODEBERG_REPO = "truelockmc/streambert";

// ── Source registry ───────────────────────────────────────────────────────────
// Each entry just describes *where* to fetch from and how to build the
// "view release" URL. The actual fetch/parse/compare code below is shared.
export const UPDATE_SOURCES = {
  github: {
    id: "github",
    label: "GitHub",
    apiUrl: `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`,
    headers: { Accept: "application/vnd.github+json" },
    fallbackUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
  },
  codeberg: {
    id: "codeberg",
    label: "Codeberg",
    apiUrl: `https://codeberg.org/api/v1/repos/${CODEBERG_REPO}/releases?limit=10`,
    headers: { Accept: "application/json" },
    fallbackUrl: `https://codeberg.org/${CODEBERG_REPO}/releases`,
  },
};

export const DEFAULT_UPDATE_SOURCE = "github";

// Normalise "1.3" → "1.3.0" so semver comparison works correctly
export function normaliseVersion(v) {
  const parts = String(v).replace(/^v/i, "").split(".");
  while (parts.length < 3) parts.push("0");
  return parts.slice(0, 3).map(Number);
}

// Returns true only when `a` is strictly greater than `b` (semver arrays)
export function semverGt(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

// Fetch current app version fresh each time, avoids race condition
async function getCurrentVersion() {
  if (typeof window !== "undefined" && window.electron?.getAppVersion) {
    return window.electron.getAppVersion();
  }
  return "0.0.0";
}

/**
 * Check for updates against a given source ("github" | "codeberg").
 * Same logic, same validation, regardless of source, only the API
 * endpoint and headers differ (see UPDATE_SOURCES above).
 */
export async function checkForUpdates(source = DEFAULT_UPDATE_SOURCE) {
  const cfg = UPDATE_SOURCES[source];
  if (!cfg) throw new Error(`Unknown update source: ${source}`);

  const currentVersion = await getCurrentVersion();

  const res = await fetch(cfg.apiUrl, {
    headers: cfg.headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${cfg.label} API error ${res.status}`);
  const releases = await res.json();

  // Skip pre-releases and drafts, only consider stable published releases
  const data = Array.isArray(releases)
    ? releases.find((r) => !r.prerelease && !r.draft)
    : null;
  if (!data) throw new Error(`No stable release found on ${cfg.label}`);

  const latestRaw = (data.tag_name || "").replace(/^v/i, "");
  const latestParts = normaliseVersion(latestRaw);
  const currentParts = normaliseVersion(currentVersion);
  const url = data.html_url || cfg.fallbackUrl;

  // Map release assets to install formats.
  const assets = {};
  for (const asset of data.assets || []) {
    const name = (asset.name || "").toLowerCase();
    const downloadUrl = asset.browser_download_url;
    if (name.endsWith(".appimage")) assets.appimage = downloadUrl;
    else if (name.endsWith(".deb")) assets.deb = downloadUrl;
    else if (name.endsWith(".exe")) assets.exe = downloadUrl;
    else if (name.endsWith(".pacman")) assets.pacman = downloadUrl;
    else if (name.endsWith(".dmg")) assets.dmg = downloadUrl;
  }

  return {
    source: cfg.id,
    sourceLabel: cfg.label,
    latest: latestRaw || currentVersion,
    current: currentVersion,
    url,
    changelog: data.body || "",
    assets,
    hasUpdate: latestRaw !== "" && semverGt(latestParts, currentParts),
  };
}

/**
 * Like checkForUpdates(), but if the chosen source fails (network error,
 * repo gone, API down) it automatically retries with the other source.
 * The result includes `usedFallback: true` when that happened so the UI
 * can optionally show a notice.
 */
export async function checkForUpdatesWithFallback(
  source = DEFAULT_UPDATE_SOURCE,
) {
  try {
    const result = await checkForUpdates(source);
    return { ...result, usedFallback: false };
  } catch (primaryErr) {
    // Try every other source in order
    const fallbacks = Object.keys(UPDATE_SOURCES).filter((s) => s !== source);
    for (const fallback of fallbacks) {
      try {
        const result = await checkForUpdates(fallback);
        return { ...result, usedFallback: true, fallbackFrom: source };
      } catch {
        // continue to next fallback
      }
    }
    // All sources failed
    throw primaryErr;
  }
}
