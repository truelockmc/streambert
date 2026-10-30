// Injected at document start into every frame of the player WebView
// (PlayerController.java). Embedded players usually put the <video> inside
// cross-origin iframes, so each frame reports its own video and obeys remote
// commands relayed down the frame tree with postMessage.
(function () {
  if (window.__stbtv) return;
  window.__stbtv = true;

  var port = window.StreambertTV; // WebMessageListener object, one per frame
  var lastSeek = 0;
  var lastSeekTo = null;

  // The longest playable video in this frame (skips short ad/preview clips)
  function mainVideo() {
    var best = null;
    var list = document.querySelectorAll("video");
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!(v.duration > 0) || v.duration === Infinity) continue;
      if (!best || v.duration > best.duration) best = v;
    }
    return best;
  }

  document.addEventListener(
    "seeked",
    function (e) {
      if (e.target && e.target.tagName === "VIDEO") {
        lastSeek = Date.now();
        lastSeekTo = e.target.currentTime;
      }
    },
    true,
  );

  function report() {
    var v = mainVideo();
    if (!v || !port) return;
    try {
      port.postMessage(
        JSON.stringify({
          t: "progress",
          currentTime: v.currentTime,
          duration: v.duration,
          paused: v.paused,
          recentUserSeek: lastSeek ? Date.now() - lastSeek < 6000 : false,
          lastUserSeekTo: lastSeekTo,
        }),
      );
    } catch (e) {}
  }
  setInterval(report, 1000);

  function act(cmd, arg) {
    var v = mainVideo();
    if (!v) return;
    if (cmd === "toggle") {
      if (v.paused) v.play().catch(function () {});
      else v.pause();
    } else if (cmd === "play") {
      v.play().catch(function () {});
    } else if (cmd === "pause") {
      v.pause();
    } else if (cmd === "seek") {
      v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + arg));
    }
    report();
  }

  function relay(msg) {
    for (var i = 0; i < window.frames.length; i++) {
      try {
        window.frames[i].postMessage(msg, "*");
      } catch (e) {}
    }
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.__stbtv !== 1) return;
    act(d.cmd, d.arg);
    relay(d);
  });

  // Entry point for PlayerController (top frame only)
  window.__stbtvCommand = function (cmd, arg) {
    var msg = { __stbtv: 1, cmd: cmd, arg: arg || 0 };
    act(cmd, msg.arg);
    relay(msg);
  };
})();
