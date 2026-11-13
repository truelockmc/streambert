import { useEffect } from "react";

/**
 * The episode length and title ride in the hash so the embed host never sees them.
 * Title checks use the opening captions, because a matching runtime can still be
 * a different episode.
 */
export function withRuntimeHint(url, minutes, title) {
  const mins = Number(minutes);
  const name = typeof title === "string" ? title.trim() : "";
  if (!url) return url;
  if ((!Number.isFinite(mins) || mins <= 0) && !name) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!/vidrift/i.test(parsed.hostname)) return url;
  const parts = parsed.hash
    .replace(/^#/, "")
    .split("&")
    .filter((part) => part && !part.startsWith("sb-runtime=") && !part.startsWith("sb-title="));
  if (Number.isFinite(mins) && mins > 0) parts.push(`sb-runtime=${Math.round(mins)}`);
  if (name) parts.push(`sb-title=${encodeURIComponent(name)}`);
  parsed.hash = parts.join("&");
  return parsed.toString();
}

/** First other TV source. VidSrc is first, so a bad Vidrift file lands there. */
export function nextTvSource(sources, currentId, skipIds) {
  const skipped = new Set(skipIds || []);
  if (currentId) skipped.add(currentId);
  const list = (sources || []).filter(
    (source) => !source.async && !source.movieOnly && source.tvUrl && !skipped.has(source.id),
  );
  return list[0]?.id ?? null;
}

// A source's file for these episodes is a different series. Other episodes of
// the same show stay on the saved source. Add another row for the next show.
const WHO_EPISODES = [
  {
    id: 57243,
    season: 1,
    episodes: [1, 2, 3],
    source: "vidrift",
    playOn: "vidsrc",
  },
];

export function showUsesWhoEpisode(showId) {
  return WHO_EPISODES.some((item) => item.id === Number(showId));
}

/** Source to play instead, when this episode's file on `sourceId` is the wrong series. */
export function whoEpisode(showId, season, episode, sourceId) {
  const rule = WHO_EPISODES.find(
    (item) =>
      item.id === Number(showId) &&
      item.season === Number(season) &&
      item.episodes.includes(Number(episode)) &&
      item.source === sourceId,
  );
  return rule ? rule.playOn : null;
}

// Runs inside the Vidrift page. Opening captions have to say the episode
// title. A file with no captions stays. A file whose captions are a different
// episode asks the app to play another source.
const episodeMatchInstaller = `function installEpisodeMatch() {
  if (window.__sbMatch) return;
  if (!/vidrift/i.test(location.hostname || "")) return;
  window.__sbMatch = true;

  function hashValue(name) {
    var parts = (location.hash || "").replace(/^#/, "").split("&");
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split("=");
      if (pair[0] !== name) continue;
      var raw = pair.slice(1).join("=");
      try { return decodeURIComponent(raw); } catch (e) { return raw; }
    }
    return "";
  }

  var title = hashValue("sb-title");
  var words = (title.toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  if (!words.length) return;

  function grab(url) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    var opts = { credentials: "omit" };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (res) { return res.text(); }).then(function (text) {
      clearTimeout(timer);
      return text;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function firstMedia(masterUrl, text) {
    var lines = text.split("\\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === "#") continue;
      try { return new URL(line, masterUrl).href; } catch (e) { return null; }
    }
    return null;
  }

  function englishSubUri(masterUrl, text) {
    var lines = text.split("\\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("TYPE=SUBTITLES") === -1) continue;
      if (!/LANGUAGE="en/i.test(lines[i]) && !/NAME="English"/i.test(lines[i])) continue;
      var uri = lines[i].match(/URI="([^"]+)"/);
      if (!uri) continue;
      try { return new URL(uri[1], masterUrl).href; } catch (e) { return null; }
    }
    return null;
  }

  function earlyText(vtt) {
    var lines = vtt.split("\\n");
    var stamp = 0;
    var kept = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("-->") !== -1) {
        var m = lines[i].match(/(\\d+):(\\d+):(\\d+)/);
        stamp = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
        continue;
      }
      if (stamp > 90) continue;
      var line = lines[i].trim();
      if (!line || line.indexOf("WEBVTT") === 0 || /^\\d+$/.test(line)) continue;
      kept.push(line);
    }
    return kept.join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  }

  function hasWord(text, word) {
    return (" " + text + " ").indexOf(" " + word + " ") !== -1;
  }

  function judge(vtt) {
    var early = earlyText(vtt);
    if (!early.trim()) return "unknown";
    for (var i = 0; i < words.length; i++) {
      if (hasWord(early, words[i])) return "hit";
    }
    return "miss";
  }

  function identify(url) {
    return grab(url).then(function (text) {
      if (text.indexOf("WEBVTT") === 0) return judge(text);
      var sub = englishSubUri(url, text);
      if (!sub) return "unknown";
      return grab(sub).then(function (playlist) {
        if (playlist.indexOf("WEBVTT") === 0) return judge(playlist);
        var seg = firstMedia(sub, playlist);
        if (!seg) return "unknown";
        return grab(seg).then(judge);
      });
    }).catch(function () { return "unknown"; });
  }

  function bootPath() {
    var parts = location.pathname.split("/").filter(Boolean);
    var embed = parts.indexOf("embed");
    if (embed < 0) return null;
    var kind = parts[embed + 1];
    if (kind === "tv" && parts[embed + 4]) {
      return "/api/boot/tv/" + parts[embed + 2] + "/" + parts[embed + 3] + "/" + parts[embed + 4];
    }
    if (kind === "movie" && parts[embed + 2]) {
      return "/api/boot/movie/" + parts[embed + 2];
    }
    return null;
  }

  function streamUrls(data) {
    var meta = (data && (data.meta || data)) || {};
    var streams = meta.orionStreams || data.orionStreams || [];
    var urls = [];
    if (!Array.isArray(streams)) streams = [];
    streams.forEach(function (stream) {
      if (!stream || !stream.url) return;
      if (stream.type && stream.type !== "hls") return;
      try { urls.push(new URL(stream.url, location.origin).href); } catch (e) {}
    });
    [meta.evionUrl, meta.vexonUrl].forEach(function (url) {
      if (url && urls.indexOf(url) === -1) urls.push(url);
    });
    return urls;
  }

  function leaveSource() {
    if (window.__sbFailover) return;
    window.__sbFailover = true;
    try {
      if (window.StreambertMatch && StreambertMatch.failover) StreambertMatch.failover();
    } catch (e) {}
  }

  var path = bootPath();
  if (!path) return;
  grab(path).then(function (body) { return JSON.parse(body); }).then(function (data) {
    var urls = streamUrls(data);
    if (!urls.length) return null;
    return Promise.all(urls.map(function (url) {
      return identify(url).then(function (verdict) { return { url: url, verdict: verdict }; });
    }));
  }).then(function (rows) {
    if (!rows) return;
    window.__sbCaptions = rows.map(function (row) { return row.verdict; });
    var hits = rows.filter(function (row) { return row.verdict === "hit"; });
    var misses = rows.filter(function (row) { return row.verdict === "miss"; });
    if (hits.length) {
      window.__sbChoice = "match";
      return;
    }
    if (misses.length) {
      window.__sbChoice = "mismatch";
      leaveSource();
    }
  }).catch(function () {});
}`;

export const EPISODE_MATCH_SOURCE = `(function(){\n${episodeMatchInstaller}\ninstallEpisodeMatch();\n})();`;

/** Desktop player webview. The Fire TV shell injects the same script itself. */
export function useEpisodeMatch(webviewRef, playing, reloadKey) {
  useEffect(() => {
    const shellOwnsPlayer =
      typeof window !== "undefined" &&
      typeof window.StreambertTv?.openPlayer === "function";
    if (!playing || shellOwnsPlayer) return undefined;
    const view = webviewRef.current;
    if (!view) return undefined;
    const run = () => {
      view.executeJavaScript(EPISODE_MATCH_SOURCE).catch(() => {});
    };
    const poll = setInterval(() => {
      view.executeJavaScript("window.__sbFailover===true").then((flag) => {
        if (flag) window.dispatchEvent(new CustomEvent("streambert:source-mismatch"));
      }).catch(() => {});
    }, 1000);
    view.addEventListener("did-finish-load", run);
    return () => {
      clearInterval(poll);
      view.removeEventListener("did-finish-load", run);
    };
  }, [webviewRef, playing, reloadKey]);
}
