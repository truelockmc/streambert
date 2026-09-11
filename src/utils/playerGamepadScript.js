//   A / Cross          play / pause
//   D-pad Left/Right    seek -10s / +10s (repeats while held)
//   D-pad Up/Down       volume down / up (repeats while held)
//   LB / RB             skip -15s / +15s
//   Y / Triangle        toggle fullscreen
//   B / Circle          exit fullscreen, or request the host navigate back
//                        (sets window.__gamepadExitRequested)
export const GAMEPAD_PLAYER_SCRIPT = `
(function() {
  if (window.__gamepadControlsInjected) return;
  window.__gamepadControlsInjected = true;

  var BTN = { A:0,B:1,X:2,Y:3,LB:4,RB:5,LT:6,RT:7,BACK:8,START:9,LS:10,RS:11,UP:12,DOWN:13,LEFT:14,RIGHT:15 };
  var DEADZONE = 0.45;
  var REPEAT_DELAY = 420, REPEAT_RATE = 140;

  var toastEl = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = [
        'position:fixed','bottom:24px','left:50%','transform:translateX(-50%)',
        'background:rgba(0,0,0,0.78)','color:#fff','padding:8px 16px','border-radius:8px',
        'font:600 12px system-ui,sans-serif','z-index:2147483647','pointer-events:none',
        'opacity:0','transition:opacity .2s',
      ].join(';');
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function() { toastEl.style.opacity = '0'; }, 900);
  }

  function getVideo() { return document.querySelector('video'); }

  function seek(delta) {
    var v = getVideo(); if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + delta));
    toast((delta > 0 ? 'Skip +' : 'Skip -') + Math.abs(delta) + 's');
  }
  function togglePlay() {
    var v = getVideo(); if (!v) return;
    if (v.paused) { v.play(); toast('Play'); } else { v.pause(); toast('Pause'); }
  }
  function changeVolume(delta) {
    var v = getVideo(); if (!v) return;
    v.muted = false;
    v.volume = Math.max(0, Math.min(1, v.volume + delta));
    toast('Volume ' + Math.round(v.volume * 100) + '%');
  }
  function toggleFullscreen() {
    var v = getVideo();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function() {});
    } else if (v && v.requestFullscreen) {
      v.requestFullscreen().catch(function() {});
    }
  }

  var prevButtons = [];
  var dirState = null;
  var raf = null;

  function onButtonDown(i) {
    if (i === BTN.A) togglePlay();
    else if (i === BTN.Y) toggleFullscreen();
    else if (i === BTN.LB) seek(-15);
    else if (i === BTN.RB) seek(15);
    else if (i === BTN.B) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(function() {});
      } else {
        window.__gamepadExitRequested = true;
      }
    }
  }
  function onDirection(dir) {
    if (dir === 'left') seek(-10);
    else if (dir === 'right') seek(10);
    else if (dir === 'up') changeVolume(0.1);
    else if (dir === 'down') changeVolume(-0.1);
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var pad = null;
    for (var i = 0; i < pads.length; i++) { if (pads[i]) { pad = pads[i]; break; } }
    if (!pad) { prevButtons = []; dirState = null; return; }

    for (var bi = 0; bi < pad.buttons.length; bi++) {
      var b = pad.buttons[bi];
      var pressed = !!(b && (b.pressed || b.value > 0.5));
      var wasPressed = !!prevButtons[bi];
      if (pressed && !wasPressed) onButtonDown(bi);
      prevButtons[bi] = pressed;
    }

    var lx = pad.axes[0] || 0, ly = pad.axes[1] || 0;
    var dir = null;
    if ((pad.buttons[BTN.UP] && pad.buttons[BTN.UP].pressed) || ly < -DEADZONE) dir = 'up';
    else if ((pad.buttons[BTN.DOWN] && pad.buttons[BTN.DOWN].pressed) || ly > DEADZONE) dir = 'down';
    else if ((pad.buttons[BTN.LEFT] && pad.buttons[BTN.LEFT].pressed) || lx < -DEADZONE) dir = 'left';
    else if ((pad.buttons[BTN.RIGHT] && pad.buttons[BTN.RIGHT].pressed) || lx > DEADZONE) dir = 'right';

    var now = performance.now();
    if (dir) {
      if (!dirState || dirState.dir !== dir) {
        dirState = { dir: dir, next: now + REPEAT_DELAY };
        onDirection(dir);
      } else if (now >= dirState.next) {
        dirState.next = now + REPEAT_RATE;
        onDirection(dir);
      }
    } else {
      dirState = null;
    }
  }

  raf = requestAnimationFrame(tick);

  window.__gamepadControlsCleanup = function() {
    if (raf) cancelAnimationFrame(raf);
    window.__gamepadControlsInjected = false;
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    toastEl = null;
  };
})();
`;

// Polled by the host every ~250ms while playing (see TVPage.jsx /
// MoviePage.jsx) to notice a B-button "leave the player" request, since the
// webview usually holds input focus during playback and the host's own
// gamepad loop won't see button presses at that point.
export const GAMEPAD_EXIT_CHECK_JS =
  "(() => window.__gamepadExitRequested === true)()";

export const GAMEPAD_EXIT_RESET_JS =
  "(() => { window.__gamepadExitRequested = false; })()";

export const GAMEPAD_CLEANUP_JS =
  "(() => { if (window.__gamepadControlsCleanup) window.__gamepadControlsCleanup(); })()";
