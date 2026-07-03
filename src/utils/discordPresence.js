// ── Discord Rich Presence (renderer side) ──────────────────────────────────
// Builds the small activity payload from whatever the user is currently
// looking at and forwards it to the main process (src/ipc/discordRpc.js).

import { storage, STORAGE_KEYS, isElectron } from "./storage";

// Small badge shown as the "small_image" next to the cover.
const APP_ICON_URL =
  "https://raw.githubusercontent.com/truelockmc/streambert/main/public/icon.png";
const GITHUB_URL = "https://github.com/truelockmc/streambert";

export function readDiscordRpcSettings() {
  return {
    enabled: !!storage.get(STORAGE_KEYS.DISCORD_RPC_ENABLED),
    showCover: storage.get(STORAGE_KEYS.DISCORD_RPC_SHOW_COVER) !== false,
    showTimestamp:
      storage.get(STORAGE_KEYS.DISCORD_RPC_SHOW_TIMESTAMP) !== false,
    showButton: storage.get(STORAGE_KEYS.DISCORD_RPC_SHOW_BUTTON) !== false,
  };
}

/** Push the enabled/disabled state to the main process (connects/disconnects). */
export function applyDiscordRpcEnabled(enabled) {
  if (!isElectron || !window.electron?.discordRpcSetEnabled) return;
  window.electron.discordRpcSetEnabled(!!enabled);
}

function baseAssets(posterUrl, settings) {
  const assets = {};
  if (settings.showCover && posterUrl) {
    assets.large_image = posterUrl;
    assets.small_image = APP_ICON_URL;
    assets.small_text = "Streambert";
  } else {
    assets.large_image = APP_ICON_URL;
  }
  return assets;
}

function buttons(settings) {
  return settings.showButton
    ? [{ label: "Watch media for free", url: GITHUB_URL }]
    : undefined;
}

/**
 * @param {object} info
 *   info.title        - movie/show title
 *   info.subtitle     - e.g. "Film" or "S2 · E5"
 *   info.posterUrl    - full https poster URL (imgUrl(...) result) or null
 *   info.startedAt    - ms epoch timestamp the item was opened
 */
export function sendWatchingActivity(info, settings) {
  if (!isElectron || !window.electron?.discordRpcUpdateActivity) return;
  if (!settings.enabled) return;

  const activity = {
    type: 3, // "Watching"
    details: info.title?.slice(0, 128) || "Streambert",
    state: (info.subtitle || "Streambert").slice(0, 128),
    assets: {
      ...baseAssets(info.posterUrl, settings),
      large_text: info.title?.slice(0, 128) || "Streambert",
    },
  };
  if (settings.showTimestamp && info.startedAt) {
    activity.timestamps = { start: info.startedAt };
  }
  const btns = buttons(settings);
  if (btns) activity.buttons = btns;

  window.electron.discordRpcUpdateActivity(activity);
}

export function sendIdleActivity(settings) {
  if (!isElectron || !window.electron?.discordRpcUpdateActivity) return;
  if (!settings.enabled) return;

  const activity = {
    type: 3,
    details: "Idling",
    assets: { large_image: APP_ICON_URL, large_text: "Streambert" },
  };
  const btns = buttons(settings);
  if (btns) activity.buttons = btns;

  window.electron.discordRpcUpdateActivity(activity);
}

export function clearActivity() {
  if (!isElectron || !window.electron?.discordRpcUpdateActivity) return;
  window.electron.discordRpcUpdateActivity(null);
}
