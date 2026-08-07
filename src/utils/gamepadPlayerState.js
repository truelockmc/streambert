// Tiny shared flag: while a video is actively playing, gamepad input is
// handled entirely inside the <webview> (see playerGamepadScript.js) since
// that guest document is usually the one holding input focus during
// playback — the same reason this app already injects its own keydown
// listener for Space/Arrow keys instead of relying on host-level shortcuts.
//
// TVPage / MoviePage call setPlayerGamepadActive(playing) so the app-wide
// menu navigation (useGamepadNav.js) knows to stay out of the way.
let active = false;

export function setPlayerGamepadActive(value) {
  active = !!value;
}

export function isPlayerGamepadActive() {
  return active;
}
