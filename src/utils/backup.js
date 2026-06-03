// ── Backup & Restore Utilities ────────────────────────────────────────────────
// Single source of truth for which keys are included in backups.
// Used by manual export/import (SettingsPage) and scheduled backups (App.jsx).

const PREFIX = "streambert_";

// All localStorage keys (without prefix) that are included in backups
export const BACKUP_KEYS = [
  // Watch data
  "saved",
  "savedOrder",
  "history",
  "progress",
  "watched",
  // UI / layout preferences
  "homeRowOrder",
  "homeRowVisible",
  "homeViewMode",
  "startPage",
  // Player preferences
  "playerSource",
  "allmangaDubMode",
  "introSkipMode",
  // Other Stuff
  "ageLimit",
  "ratingCountry",
  "watchedThreshold",
  "autoplayNextEnabled",
  "autoplayNextDuration",
  "autoplayNextLayout",
  // Subtitles
  "subtitleDownload",
  "subtitleLang",
  // Paths & folders
  "downloadPath",
  "downloaderFolder",
  // Misc settings
  "invidiousBase",
  "autoCheckUpdates",
  // Search history
  "searchHistory",
  // Appearance & behaviour
  "accentColor",
  "fontSize",
  "compactMode",
  "reduceAnimations",
  "librarySort",
  "historyEnabled",
  // TMDB metadata language (e.g. "de-DE")
  "tmdbLang",
  // Notification preferences
  "notifyDownloadComplete",
  "notifyNewEpisode",
  // Episode-release cache
  "episodeReleaseCache",
];

/**
 * Reads all backup keys from localStorage and returns a plain data object.
 * Null values are omitted to keep exports clean.
 */
export function collectBackupData() {
  const data = {};
  for (const key of BACKUP_KEYS) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw !== null) data[key] = JSON.parse(raw);
    } catch {
      // skip unparseable entries
    }
  }
  return data;
}

/**
 * Writes a data object back into localStorage.
 * Only keys present in BACKUP_KEYS are written (no arbitrary injection).
 */
export function restoreBackupData(data) {
  if (!data || typeof data !== "object") throw new Error("Invalid backup data");
  for (const key of BACKUP_KEYS) {
    if (data[key] !== undefined && data[key] !== null) {
      localStorage.setItem(PREFIX + key, JSON.stringify(data[key]));
    }
  }
}
