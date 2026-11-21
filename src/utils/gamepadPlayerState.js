// Tiny shared flag: while a video is actively playing, gamepad input is
// handled entirely inside the <webview> (see playerGamepadScript.js)
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
