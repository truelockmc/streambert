// ── IPC: HiAnime (hianime.at) episode resolver + local player server ──────────
// Re-implementation of the scraping method used by ani-cli (v5.1.6):
//   1. GET  /search?keyword=…                       → HTML, parse <h3 class="film-name">
//   2. GET  /api/theme/episode/list/{numericId}      → episode list (data-id / data-number)
//   3. GET  /api/theme/episode/servers?episodeId=…   → server list, pick "ZokoAnime"
//   4. data-hash is base64(embed url); the embed page ships `window.__P="<blob>"`
//   5. blob = base64(json XOR "otaku-embed-v1") → { src: "<master.m3u8>", subtitles: [...] }
//   6. master playlist is fetched with the embed origin as Referer
//
// Requests go through Electron's `net.fetch` (Chromium network stack, so the TLS
// fingerprint looks like a real browser – the equivalent of ani-cli's
// curl-impersonate). If it is unavailable we fall back to Node's https module.

const { ipcMain, net } = require("electron");
const https = require("https");
const http = require("http");

const BASE_URL = "https://hianime.at";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OBFUSCATION_KEY = Buffer.from("otaku-embed-v1", "utf8");
const SERVER_NAME = "ZokoAnime";

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function nodeGet(urlStr, headers, timeoutMs, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return reject(new Error("invalid url: " + urlStr));
    }
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: "GET",
        headers: { "Accept-Encoding": "identity", ...headers },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          hops < 8
        ) {
          res.resume();
          const loc = new URL(res.headers.location, urlStr).href;
          return resolve(nodeGet(loc, headers, timeoutMs, hops + 1));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

// Fetches a URL as text. `referer` is optional. Returns { status, body }.
async function hianimeGet(urlStr, { referer, accept } = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: accept || "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (referer) headers["Referer"] = referer;

  if (net && typeof net.fetch === "function") {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const init = { headers, redirect: "follow", signal: ctrl.signal };
      if (referer) {
        init.referrer = referer;
        init.referrerPolicy = "unsafe-url";
      }
      const res = await net.fetch(urlStr, init);
      return { status: res.status, body: await res.text() };
    } catch (e) {
      if (e?.name === "AbortError") throw new Error("timeout");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  return nodeGet(urlStr, headers, 12000);
}

// Same as hianimeGet, but throws on anything that is not 2xx and detects the
// Cloudflare challenge page.
async function hianimeCurl(urlStr, opts) {
  const res = await hianimeGet(urlStr, opts);
  if (/<title>\s*Just a moment/i.test(res.body)) {
    throw new Error("Blocked by Cloudflare (HiAnime)");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Request failed: HTTP ${res.status} from ${urlStr}`);
  }
  return res.body;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// The theme API wraps its HTML in JSON (escaped quotes/slashes). Return plain
// HTML text no matter whether the payload is JSON or raw HTML.
function unwrapApiHtml(body) {
  let text = body;
  try {
    const json = JSON.parse(body);
    const parts = [];
    const walk = (v) => {
      if (typeof v === "string") parts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(json);
    if (parts.length) text = parts.join("\n");
  } catch {
    // not JSON → use the raw text
  }
  return text.replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\/g, "");
}

function getAttr(tagText, name) {
  const m = tagText.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

// ── Embed config de-obfuscation ───────────────────────────────────────────────
// base64(json XOR "otaku-embed-v1"), key repeated cyclically.

function deobfuscateBlob(blob) {
  const buf = Buffer.from(blob, "base64");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.length];
  }
  return out.toString("utf8");
}

// ── Scraping ──────────────────────────────────────────────────────────────────

// Returns [{ id, title, jname }]
async function hianimeSearch(query) {
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  const html = await hianimeCurl(`${BASE_URL}/search?keyword=${q}`, {
    accept: "text/html",
  });
  // the top-10 sidebar repeats the result markup → cut it off
  const main = html.split('id="main-sidebar"')[0];
  const results = [];
  const re = /<h3 class="film-name">([\s\S]*?)<\/h3>/g;
  let m;
  while ((m = re.exec(main))) {
    const anchor = m[1].match(/<a\s+([^>]*)>/);
    if (!anchor) continue;
    const href = getAttr(anchor[1], "href");
    const title = getAttr(anchor[1], "title");
    if (!href || !title) continue;
    const id = href.split("?")[0].replace(/\/+$/, "").split("/").pop();
    if (!id) continue;
    const jname = getAttr(anchor[1], "data-jname");
    results.push({
      id,
      title: decodeEntities(title),
      jname: jname ? decodeEntities(jname) : null,
    });
  }
  return results;
}

// Returns [{ epId, number }] for a show slug such as "one-piece-100"
async function hianimeEpisodes(showId) {
  const numericId = showId.slice(showId.lastIndexOf("-") + 1);
  const body = await hianimeCurl(
    `${BASE_URL}/api/theme/episode/list/${numericId}`,
    { referer: BASE_URL + "/" },
  );
  const html = unwrapApiHtml(body);
  const episodes = [];
  for (const chunk of html.split("ep-item").slice(1)) {
    const number = getAttr(chunk, "data-number");
    const epId = getAttr(chunk, "data-id");
    // ids from other providers have the same shape → check the slug in the link
    if (!number || !epId || !/^\d+$/.test(epId)) continue;
    if (!chunk.includes(`/watch/${showId}?ep=`)) continue;
    episodes.push({ epId, number });
  }
  return episodes;
}

// Resolves a stream for one episode. Returns
// { masterUrl, referer, malId, subtitle, resolution } or throws.
async function hianimeStream(epId, mode) {
  const body = await hianimeCurl(
    `${BASE_URL}/api/theme/episode/servers?episodeId=${epId}`,
    { referer: BASE_URL + "/" },
  );
  const html = unwrapApiHtml(body);

  // only the ZokoAnime embed is understood by deobfuscateBlob
  let hash = null;
  for (const chunk of html.split("server-item").slice(1)) {
    if (
      getAttr(chunk, "data-type") === mode &&
      getAttr(chunk, "data-server-name") === SERVER_NAME
    ) {
      hash = getAttr(chunk, "data-hash");
      if (hash) break;
    }
  }
  if (!hash) throw new Error(`No ${SERVER_NAME} server for ${mode}`);

  const embedUrl = Buffer.from(hash, "base64").toString("utf8").trim();
  if (!/^https?:\/\//i.test(embedUrl)) throw new Error("Invalid embed url");

  // the stream host wants the embed site as referer; the embed url carries the MAL id
  const referer = embedUrl.replace(/^(https?:\/\/[^/]*).*$/, "$1/");
  const malMatch = embedUrl.match(/\/mal\/(\d+)\//);
  const malId = malMatch ? parseInt(malMatch[1], 10) : null;

  const embedHtml = await hianimeCurl(embedUrl);
  const blobMatch = embedHtml.match(/window\.__P="([^"]*)"/);
  if (!blobMatch) throw new Error("Embed config not found");

  const jsonText = deobfuscateBlob(blobMatch[1]);
  let masterUrl = null;
  let subtitle = null;
  try {
    const cfg = JSON.parse(jsonText);
    const findM3u8 = (v) => {
      if (typeof v === "string") return /\.m3u8/i.test(v) ? v : null;
      if (Array.isArray(v)) {
        for (const x of v) {
          const r = findM3u8(x);
          if (r) return r;
        }
      } else if (v && typeof v === "object") {
        if (typeof v.src === "string" && /\.m3u8/i.test(v.src)) return v.src;
        for (const x of Object.values(v)) {
          const r = findM3u8(x);
          if (r) return r;
        }
      }
      return null;
    };
    masterUrl = findM3u8(cfg);
    const subs = Array.isArray(cfg.subtitles) ? cfg.subtitles : [];
    const def = subs.find((s) => s && s.default) || null;
    subtitle = def?.src || null;
  } catch {
    // JSON.parse failed → same regexes as ani-cli
    const m = jsonText.match(/"src":"([^"]*\.m3u8[^"]*)"/);
    masterUrl = m ? m[1] : null;
    const sub = jsonText
      .split(/\},\s*\{/)
      .find((c) => /"default":true/.test(c) && /"src":"/.test(c));
    subtitle = sub ? (sub.match(/"src":"([^"]*)"/) || [])[1] || null : null;
  }
  if (!masterUrl) throw new Error("No m3u8 source in embed config");
  masterUrl = masterUrl.replace(/\\\//g, "/");
  if (subtitle) subtitle = subtitle.replace(/\\\//g, "/");

  // best available resolution, for display only (hls.js picks the levels itself)
  let resolution = "?";
  try {
    const playlist = await hianimeCurl(masterUrl, { referer });
    let best = 0;
    for (const m of playlist.matchAll(/RESOLUTION=\d+x(\d+)/g)) {
      best = Math.max(best, parseInt(m[1], 10));
    }
    if (best) resolution = best + "p";
  } catch {
    // master playlist unreachable – the player will report the real error
  }

  return { masterUrl, referer, malId, subtitle, resolution };
}

// ── AniList: resolve correct season title for S2+ ────────────────────────────

function sanitizeTitle(t) {
  return t
    .replace(/[''`´]/g, "")
    .replace(/[:!.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function anilistSeasonTitle(baseTitle, seasonNumber) {
  return new Promise((resolve) => {
    const resolveS1 = seasonNumber <= 1;
    const query = `query($search:String){Media(search:$search,type:ANIME,sort:SEARCH_MATCH){title{english romaji}episodes relations{edges{relationType node{type format title{english romaji}episodes startDate{year}seasonYear}}}}}`;
    const body = JSON.stringify({ query, variables: { search: baseTitle } });
    const opts = {
      hostname: "graphql.anilist.co",
      path: "/",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const fallback = {
      title: baseTitle,
      romaji: null,
      episodes: null,
      nextTitle: null,
      nextRomaji: null,
    };

    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const media = json?.data?.Media;
          if (!media) return resolve(fallback);

          const s1Romaji = media?.title?.romaji || null;
          const s1Episodes = media?.episodes || null;
          const sequels = (media.relations?.edges || [])
            .filter(
              (e) =>
                e.relationType === "SEQUEL" &&
                e.node.type === "ANIME" &&
                (e.node.format === "TV" || e.node.format === "TV_SHORT"),
            )
            .sort((a, b) => {
              const ya = a.node.startDate?.year || a.node.seasonYear || 9999;
              const yb = b.node.startDate?.year || b.node.seasonYear || 9999;
              return ya - yb;
            });

          const getTitle = (node) =>
            node.title?.english || node.title?.romaji || null;
          const getRomaji = (node) => node.title?.romaji || null;

          if (resolveS1) {
            const next = sequels[0]?.node ?? null;
            return resolve({
              title: media.title?.english || baseTitle,
              romaji: s1Romaji,
              episodes: s1Episodes,
              nextTitle: next ? getTitle(next) : null,
              nextRomaji: next ? getRomaji(next) : null,
            });
          }

          const target = sequels[seasonNumber - 2];
          if (!target) return resolve({ ...fallback, romaji: s1Romaji });

          const nextNode = sequels[seasonNumber - 1]?.node ?? null;
          resolve({
            title: getTitle(target.node) || baseTitle,
            romaji: getRomaji(target.node) || s1Romaji,
            episodes: target.node.episodes || null,
            nextTitle: nextNode ? getTitle(nextNode) : null,
            nextRomaji: nextNode ? getRomaji(nextNode) : null,
          });
        } catch {
          resolve(fallback);
        }
      });
    });
    req.on("error", () => resolve(fallback));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(fallback);
    });
    req.write(body);
    req.end();
  });
}

// ── Show cache (episode lists rarely change within a session) ────────────────

const SHOW_CACHE_TTL = 10 * 60 * 1000;
const _episodeCache = new Map(); // showId -> { ts, episodes }

async function cachedEpisodes(showId) {
  const hit = _episodeCache.get(showId);
  if (hit && Date.now() - hit.ts < SHOW_CACHE_TTL) return hit.episodes;
  const episodes = await hianimeEpisodes(showId);
  if (episodes.length) _episodeCache.set(showId, { ts: Date.now(), episodes });
  return episodes;
}

// ── Local player server ───────────────────────────────────────────────────────
// All media requests go through /proxy so the stream host always sees the right
// Referer. HLS playlists are rewritten so every sub-playlist, segment, key and
// audio rendition is proxied too.

let _playerServer = null;
let _currentVideoUrl = null;
let _currentVideoReferer = BASE_URL + "/";
let _currentVideoSubtitle = null;
let _currentVideoStartTime = 0;

function proxied(u) {
  return "/proxy?url=" + encodeURIComponent(u);
}

function rewritePlaylist(text, playlistUrl) {
  const abs = (u) => new URL(u, playlistUrl).href;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxied(abs(u))}"`);
      }
      return proxied(abs(t));
    })
    .join("\n");
}

function buildPlayerHtml(videoUrl, startTime, subtitleUrl) {
  const isM3u8 = /\.m3u8/i.test(videoUrl);
  const track = subtitleUrl
    ? `<track kind="subtitles" src="${proxied(subtitleUrl)}" srclang="en" label="Subtitles" default>`
    : "";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;display:block}</style>
</head><body>
<video id="v" ${isM3u8 ? "" : `src="${proxied(videoUrl)}"`} autoplay controls playsinline crossorigin="anonymous">${track}</video>
${
  isM3u8
    ? `
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
<script>
  const video=document.getElementById('v');
  const src=${JSON.stringify(proxied(videoUrl))};
  const startTime=${Number(startTime) || 0};
  if(window.Hls&&Hls.isSupported()){
    const hls=new Hls({autoStartLoad:false});
    hls.loadSource(src);hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED,()=>{
      // start on the best quality (like ani-cli); ABR may still adapt downwards
      hls.startLevel=hls.levels.length-1;
      hls.startLoad(startTime>0?startTime:-1);
      video.play().catch(()=>{});
    });
  }else if(video.canPlayType('application/vnd.apple.mpegurl')){
    video.src=src;
    if(startTime>0)video.addEventListener('loadedmetadata',()=>{video.currentTime=startTime;},{once:true});
  }
</script>`
    : startTime > 0
      ? `<script>
  const v=document.getElementById('v');
  v.addEventListener('loadedmetadata',()=>{v.currentTime=${Number(startTime) || 0};},{once:true});
</script>`
      : ""
}
</body></html>`;
}

function proxyRequest(target, req, res, hops = 0) {
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const lib = targetUrl.protocol === "https:" ? https : http;
  const headers = {
    "User-Agent": USER_AGENT,
    Referer: _currentVideoReferer,
    Accept: "*/*",
    "Accept-Encoding": "identity",
  };
  if (req.headers["range"]) headers["Range"] = req.headers["range"];

  const proxyReq = lib.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      path: targetUrl.pathname + targetUrl.search,
      method: "GET",
      headers,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502;
      if (
        status >= 300 &&
        status < 400 &&
        proxyRes.headers.location &&
        hops < 8
      ) {
        proxyRes.resume();
        proxyRequest(
          new URL(proxyRes.headers.location, target).href,
          req,
          res,
          hops + 1,
        );
        return;
      }

      const contentType = String(proxyRes.headers["content-type"] || "");
      const isPlaylist =
        /\.m3u8(\?|$)/i.test(targetUrl.pathname + targetUrl.search) ||
        /mpegurl/i.test(contentType);

      if (isPlaylist && status === 200) {
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const out = text.trimStart().startsWith("#EXTM3U")
            ? rewritePlaylist(text, target)
            : text;
          res.writeHead(200, {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          });
          res.end(out);
        });
        proxyRes.on("error", () => {
          res.writeHead(502);
          res.end();
        });
        return;
      }

      const passHeaders = {};
      for (const h of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "last-modified",
        "etag",
      ]) {
        if (proxyRes.headers[h]) passHeaders[h] = proxyRes.headers[h];
      }
      passHeaders["Access-Control-Allow-Origin"] = "*";
      passHeaders["Cache-Control"] = "no-store";
      res.writeHead(status, passHeaders);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  proxyReq.setTimeout(20000, () => proxyReq.destroy());
  res.on("close", () => proxyReq.destroy());
  proxyReq.end();
}

function getPlayerServer() {
  if (_playerServer) return Promise.resolve(_playerServer);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");

      if (url.pathname === "/player" || url.pathname === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Cache-Control": "no-store",
        });
        res.end(
          buildPlayerHtml(
            _currentVideoUrl || "",
            _currentVideoStartTime || 0,
            _currentVideoSubtitle,
          ),
        );
        return;
      }

      if (url.pathname === "/proxy") {
        const target = url.searchParams.get("url");
        if (!target) {
          res.writeHead(400);
          res.end();
          return;
        }
        proxyRequest(target, req, res);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      _playerServer = server;
      resolve(server);
    });
    server.on("error", reject);
  });
}

// ── Show / episode resolution ────────────────────────────────────────────────

// Finds the HiAnime show for the given title candidates. Prefers an exact
// (normalized) title match over the first search hit.
async function findShow(candidates) {
  const wanted = new Set(candidates.map(normalizeTitle));
  let fallback = null;
  for (const candidate of candidates) {
    let results;
    try {
      results = await hianimeSearch(candidate);
    } catch (e) {
      if (/Cloudflare/i.test(e.message)) throw e;
      continue;
    }
    if (!results.length) continue;
    const exact = results.find(
      (r) =>
        wanted.has(normalizeTitle(r.title)) ||
        (r.jname && wanted.has(normalizeTitle(r.jname))),
    );
    if (exact) return exact;
    if (!fallback) fallback = results[0];
  }
  return fallback;
}

// ── IPC registration ──────────────────────────────────────────────────────────

function register() {
  ipcMain.handle(
    "set-player-video",
    async (_, { url, referer, startTime, subtitle }) => {
      _currentVideoUrl = url;
      _currentVideoReferer = referer || BASE_URL + "/";
      _currentVideoSubtitle = subtitle || null;
      _currentVideoStartTime = startTime || 0;
      const server = await getPlayerServer();
      return { playerUrl: `http://127.0.0.1:${server.address().port}/player` };
    },
  );

  ipcMain.handle(
    "resolve-hianime",
    async (
      _,
      { title, seasonNumber, episodeNumber, isMovie, translationType },
    ) => {
      try {
        const season = seasonNumber || 1;
        const mode = translationType === "dub" ? "dub" : "sub";

        // 1. AniList season title lookup (S2+ have their own HiAnime entry)
        const anilistResult = isMovie
          ? {
              title,
              romaji: null,
              episodes: null,
              nextTitle: null,
              nextRomaji: null,
            }
          : await anilistSeasonTitle(title, season);

        let searchTitle = anilistResult.title;
        let adjustedEpisodeNumber = episodeNumber;

        if (
          !isMovie &&
          anilistResult.episodes &&
          episodeNumber > anilistResult.episodes &&
          anilistResult.nextTitle
        ) {
          adjustedEpisodeNumber = episodeNumber - anilistResult.episodes;
          searchTitle = anilistResult.nextTitle;
        }

        // 2. Build search candidate list
        const candidates = [
          ...new Set([
            searchTitle,
            sanitizeTitle(searchTitle),
            ...(anilistResult.romaji && searchTitle === anilistResult.title
              ? [anilistResult.romaji]
              : []),
            ...(anilistResult.nextRomaji &&
            searchTitle === anilistResult.nextTitle
              ? [anilistResult.nextRomaji]
              : []),
            title,
            sanitizeTitle(title),
          ]),
        ].filter(Boolean);

        // 3. Search HiAnime
        const show = await findShow(candidates);
        if (!show) return { ok: false, error: "No results for: " + searchTitle };

        // 4. Episode list → episode id
        const episodes = await cachedEpisodes(show.id);
        if (!episodes.length) {
          return { ok: false, error: "No episodes found for: " + show.title };
        }
        const wantedNumber = isMovie ? "1" : String(adjustedEpisodeNumber);
        const episode =
          episodes.find((e) => e.number === wantedNumber) ||
          episodes.find((e) => parseFloat(e.number) === Number(wantedNumber)) ||
          (isMovie ? episodes[0] : null);
        if (!episode) {
          return { ok: false, error: "Episode " + wantedNumber + " not found" };
        }

        // 5. Stream (embed → de-obfuscate → master playlist)
        const stream = await hianimeStream(episode.epId, mode);
        return {
          ok: true,
          url: stream.masterUrl,
          resolution: stream.resolution,
          sourceName: SERVER_NAME,
          isDirectMp4: false,
          referer: stream.referer,
          subtitle: stream.subtitle,
          malId: stream.malId,
          searchTitle,
          matchedTitle: show.title,
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  );

  ipcMain.handle("debug-hianime", async (_, args = {}) => {
    try {
      if (args.epId) {
        const stream = await hianimeStream(String(args.epId), args.mode || "sub");
        return stream;
      }
      if (args.showId) {
        const episodes = await hianimeEpisodes(args.showId);
        return { count: episodes.length, episodes: episodes.slice(0, 50) };
      }
      const season = args.season || 1;
      const resolved = await anilistSeasonTitle(args.title || "", season);
      const results = await hianimeSearch(resolved.title);
      return { resolvedTitle: resolved, results };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = {
  register,
  // exported for tests
  _internal: { deobfuscateBlob, unwrapApiHtml, rewritePlaylist, normalizeTitle },
};
