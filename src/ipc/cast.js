// ── IPC: Cast (Chromecast + DLNA) ────────────────────────────────────────────
// Main-process subsystem. Provides:
//   - Device discovery (mDNS for Google Cast, SSDP for DLNA)
//   - LAN-routable HTTP server: /file/:token, /sub/:token, /proxy/:token, /health
//     (separate from src/ipc/allmanga.js getPlayerServer which stays 127.0.0.1)
//   - Session lifecycle: connect / loadMedia / play / pause / stop / seek / volume
//   - IPC surface mirrors PIP naming (cast:* channels)
//
// Single active session at a time, like the PIP window.

const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ipcMain, app } = require("electron");

// Lazy-required heavy deps (keep cold start fast)
let Bonjour = null;
let castv2Client = null;
let dlnacasts = null;

// ── Module state ─────────────────────────────────────────────────────────────

/** id format: "cast:<mdnsName>" or "dlna:<usn>" */
const _devices = new Map();

let _bonjourBrowser = null;
let _bonjourInstance = null;
let _bonjourBindIp = null;
let _dlnaList = null;
let _discoveryRunning = false;
let _lastDlnaUpdate = 0;

/** { device, type:"cast"|"dlna", client?, player?, contentUrl, mediaInfo, lastStatus, tearDown } */
let _session = null;

let _castServer = null;

/** token -> { kind:"file"|"sub"|"proxy", filePath?, target?, referer?, headers?, contentType?, expiresAt } */
const _serveTokens = new Map();

/** Dedup index for proxy tokens: `${target}\n${referer}\n${isHls}` -> token.
 * Prevents the HLS rewriter minting a fresh token every time a receiver
 * re-fetches a playlist (seek / variant switch), which would grow _serveTokens
 * without bound over a long session. */
const _proxyTokenIndex = new Map();

const SERVE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

let _getMainWindow = () => null;
let _devicesPushTimer = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function pushDevicesUpdate() {
  if (_devicesPushTimer) clearTimeout(_devicesPushTimer);
  _devicesPushTimer = setTimeout(() => {
    _devicesPushTimer = null;
    const mw = _getMainWindow();
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send("cast:devices-updated", listDevices());
    }
  }, 100);
}

function pushStatus(status) {
  const mw = _getMainWindow();
  if (mw && !mw.isDestroyed()) mw.webContents.send("cast:status", status);
}

function pushSessionEnded(reason) {
  const mw = _getMainWindow();
  if (mw && !mw.isDestroyed())
    mw.webContents.send("cast:session-ended", { reason });
}

function pushError(message) {
  const mw = _getMainWindow();
  if (mw && !mw.isDestroyed()) mw.webContents.send("cast:error", { message });
}

function listDevices() {
  return [..._devices.values()]
    .map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      address: d.address,
      port: d.port,
      model: d.model || null,
      friendlyName: d.friendlyName || d.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function _ipv4ToInt(ip) {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const o = Number(part);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function _sameSubnet(ip, netmask, target) {
  const a = _ipv4ToInt(ip);
  const m = _ipv4ToInt(netmask);
  const t = _ipv4ToInt(target);
  if (a == null || m == null || t == null) return false;
  return ((a & m) >>> 0) === ((t & m) >>> 0);
}

// Pick the LAN IPv4 the cast receiver can actually reach. When the receiver's
// address is known, prefer the local interface on the SAME subnet (critical on
// machines with a VPN/secondary NIC, where the first "preferred"-named adapter
// may be on an unreachable network). Falls back to a preferred adapter, then any
// non-internal IPv4, then loopback.
function getLocalIPv4(targetAddr) {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    const lname = name.toLowerCase();
    const isVirtual =
      lname.includes("vethernet") ||
      lname.includes("vmware") ||
      lname.includes("virtualbox") ||
      lname.includes("docker") ||
      lname.includes("hyper-v") ||
      lname.includes("loopback") ||
      lname.includes("vbox");
    const isPreferred =
      lname.startsWith("en") ||
      lname.startsWith("eth") ||
      lname.startsWith("wlan") ||
      lname.includes("wi-fi") ||
      lname.includes("wifi") ||
      lname.includes("ethernet");
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (isVirtual) continue;
      candidates.push({
        address: addr.address,
        netmask: addr.netmask,
        preferred: isPreferred,
      });
    }
  }
  if (targetAddr) {
    const match = candidates.find((c) =>
      _sameSubnet(c.address, c.netmask, targetAddr),
    );
    if (match) return match.address;
  }
  const pref = candidates.find((c) => c.preferred);
  return (pref || candidates[0])?.address || "127.0.0.1";
}

function makeToken(entry, ttlMs = SERVE_TOKEN_TTL_MS) {
  const token = crypto.randomBytes(16).toString("hex");
  _serveTokens.set(token, { ...entry, expiresAt: Date.now() + ttlMs });
  return token;
}

// Reuse a proxy token for an identical upstream so repeated playlist fetches
// don't accumulate tokens. Refreshes the TTL on reuse.
function makeProxyToken({ target, referer, headers, isHls }) {
  const key = `${target}\n${referer || ""}\n${isHls ? 1 : 0}`;
  const existing = _proxyTokenIndex.get(key);
  if (existing) {
    const e = _serveTokens.get(existing);
    if (e && e.expiresAt > Date.now()) {
      e.expiresAt = Date.now() + SERVE_TOKEN_TTL_MS;
      return existing;
    }
    _proxyTokenIndex.delete(key);
  }
  const token = makeToken({
    kind: "proxy",
    target,
    referer: referer || null,
    headers: headers || {},
    isHls: !!isHls,
  });
  _proxyTokenIndex.set(key, token);
  return token;
}

function castUrlFor(token, kind = "file") {
  if (!_castServer) return null;
  const ip = getLocalIPv4(_session?.device?.address);
  const port = _castServer.address().port;
  return `http://${ip}:${port}/${kind}/${token}`;
}

function gcServeTokens() {
  const now = Date.now();
  for (const [tok, entry] of _serveTokens) {
    if (entry.expiresAt < now) _serveTokens.delete(tok);
  }
  for (const [key, tok] of _proxyTokenIndex) {
    if (!_serveTokens.has(tok)) _proxyTokenIndex.delete(key);
  }
}
setInterval(gcServeTokens, 5 * 60 * 1000).unref();

// ── HTTP server ──────────────────────────────────────────────────────────────

const COMMON_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";

function _contentTypeForExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".mkv":
      return "video/x-matroska";
    case ".webm":
      return "video/webm";
    case ".ts":
      return "video/mp2t";
    case ".avi":
      return "video/x-msvideo";
    case ".mov":
      return "video/quicktime";
    case ".vtt":
      return "text/vtt";
    case ".srt":
      return "text/vtt"; // we convert in /sub
    default:
      return "application/octet-stream";
  }
}

function _serveLocalFile(filePath, contentType, req, res) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const total = stat.size;
    const range = req.headers["range"];
    const baseHeaders = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    };
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        return;
      }
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start > end ||
        end >= total
      ) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...baseHeaders, "Content-Length": total });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

function _isHlsContentType(ct) {
  if (!ct) return false;
  ct = ct.toLowerCase();
  return ct.includes("mpegurl") || ct.includes("vnd.apple");
}

/** Rewrite an HLS playlist so every segment URL flows through /proxy/<childToken>. */
function _rewriteHlsPlaylist(body, baseUrl, parentEntry) {
  const baseHeadersJson = JSON.stringify(parentEntry.headers || {});
  const ip = getLocalIPv4(_session?.device?.address);
  const port = _castServer.address().port;
  const rewriteUrl = (raw) => {
    let abs;
    try {
      abs = new URL(raw, baseUrl).toString();
    } catch {
      return raw;
    }
    const tok = makeProxyToken({
      target: abs,
      referer: parentEntry.referer,
      headers: JSON.parse(baseHeadersJson),
      // Variant playlists (master → media) must also be rewritten even if the
      // upstream mislabels their content-type.
      isHls: /\.m3u8(\?|$)/i.test(abs),
    });
    return `http://${ip}:${port}/proxy/${tok}`;
  };
  return body
    .split(/\r?\n/)
    .map((line) => {
      if (!line || line.startsWith("#")) {
        // Rewrite URI="..." attributes (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA)
        return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${rewriteUrl(u)}"`);
      }
      return rewriteUrl(line.trim());
    })
    .join("\n");
}

function _serveProxy(entry, req, res) {
  const target = entry.target;
  if (!target) {
    res.writeHead(400);
    res.end();
    return;
  }
  let upstreamUrl;
  try {
    upstreamUrl = new URL(target);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const lib = upstreamUrl.protocol === "https:" ? https : http;

  const upstreamHeaders = {
    "User-Agent": COMMON_UA,
    Accept: "*/*",
    ...(entry.headers || {}),
  };
  if (entry.referer) upstreamHeaders["Referer"] = entry.referer;
  if (req.headers["range"]) upstreamHeaders["Range"] = req.headers["range"];

  const upReq = lib.request(
    {
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (upstreamUrl.protocol === "https:" ? 443 : 80),
      path: upstreamUrl.pathname + upstreamUrl.search,
      method: req.method || "GET",
      headers: upstreamHeaders,
    },
    (upRes) => {
      const passHeaders = {};
      for (const h of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "last-modified",
        "etag",
      ]) {
        if (upRes.headers[h]) passHeaders[h] = upRes.headers[h];
      }
      passHeaders["Access-Control-Allow-Origin"] = "*";
      passHeaders["Cache-Control"] = "no-store";

      const upstreamContentType = upRes.headers["content-type"];
      const looksHls =
        entry.isHls ||
        _isHlsContentType(upstreamContentType) ||
        /\.m3u8(\?|$)/i.test(upstreamUrl.pathname + upstreamUrl.search);

      if (looksHls) {
        // Buffer playlist, rewrite, then send.
        const chunks = [];
        upRes.on("data", (c) => chunks.push(c));
        upRes.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const rewritten = _rewriteHlsPlaylist(body, target, entry);
          const out = Buffer.from(rewritten, "utf8");
          passHeaders["Content-Type"] = "application/vnd.apple.mpegurl";
          delete passHeaders["content-type"];
          passHeaders["Content-Length"] = out.length;
          delete passHeaders["content-length"];
          delete passHeaders["content-range"];
          res.writeHead(upRes.statusCode || 200, passHeaders);
          res.end(out);
        });
        upRes.on("error", () => {
          try {
            res.writeHead(502);
            res.end();
          } catch {}
        });
        return;
      }

      res.writeHead(upRes.statusCode || 200, passHeaders);
      upRes.pipe(res);
    },
  );
  upReq.on("error", (e) => {
    try {
      console.error("[cast proxy]", upstreamUrl.toString(), e.message);
      res.writeHead(502);
      res.end();
    } catch {}
  });
  // Forward request body for non-GET (unlikely for cast media but safe)
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(upReq);
  } else {
    upReq.end();
  }
}

function _serveSub(entry, _req, res) {
  const headers = {
    "Content-Type": "text/vtt; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": "no-store",
  };

  // Local sidecar — convert SRT→VTT on the fly if needed
  if (entry.filePath) {
    fs.readFile(entry.filePath, "utf8", (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      const isSrt =
        entry.filePath.toLowerCase().endsWith(".srt") ||
        !/^WEBVTT/.test(data.trimStart());
      const out = isSrt
        ? "WEBVTT\n\n" + data.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
        : data;
      const buf = Buffer.from(out, "utf8");
      headers["Content-Length"] = buf.length;
      res.writeHead(200, headers);
      res.end(buf);
    });
    return;
  }

  // Remote VTT — fetch upstream, rewrite as VTT
  if (entry.target) {
    let u;
    try {
      u = new URL(entry.target);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const upHeaders = {
      "User-Agent": COMMON_UA,
      Accept: "*/*",
    };
    if (entry.referer) upHeaders["Referer"] = entry.referer;
    lib
      .get(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          headers: upHeaders,
        },
        (upRes) => {
          const chunks = [];
          upRes.on("data", (c) => chunks.push(c));
          upRes.on("end", () => {
            let body = Buffer.concat(chunks).toString("utf8");
            if (!/^WEBVTT/.test(body.trimStart())) {
              body =
                "WEBVTT\n\n" +
                body.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
            }
            const out = Buffer.from(body, "utf8");
            headers["Content-Length"] = out.length;
            res.writeHead(200, headers);
            res.end(out);
          });
        },
      )
      .on("error", () => {
        res.writeHead(502);
        res.end();
      });
    return;
  }

  res.writeHead(404);
  res.end();
}

async function getCastServer() {
  if (_castServer) return _castServer;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      // Permissive CORS preflight for cast receivers that probe OPTIONS
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
          "Access-Control-Allow-Headers": "*",
        });
        res.end();
        return;
      }

      if (parts.length === 1 && parts[0] === "health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }

      if (parts.length === 2) {
        const [kind, token] = parts;
        const entry = _serveTokens.get(token);
        if (!entry || entry.expiresAt < Date.now()) {
          res.writeHead(404);
          res.end();
          return;
        }
        if (kind === "file" && entry.kind === "file" && entry.filePath) {
          _serveLocalFile(
            entry.filePath,
            entry.contentType || _contentTypeForExt(entry.filePath),
            req,
            res,
          );
          return;
        }
        if (kind === "proxy" && entry.kind === "proxy") {
          _serveProxy(entry, req, res);
          return;
        }
        if (kind === "sub" && entry.kind === "sub") {
          _serveSub(entry, req, res);
          return;
        }
      }

      res.writeHead(404);
      res.end();
    });
    server.on("error", reject);
    server.listen(0, "0.0.0.0", () => {
      _castServer = server;
      resolve(server);
    });
  });
}

// ── Discovery ────────────────────────────────────────────────────────────────

function _pickServiceAddress(service) {
  if (Array.isArray(service.addresses)) {
    const v4 = service.addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
    if (v4) return v4;
  }
  if (service.referer && service.referer.address) return service.referer.address;
  return null;
}

function _addCastDevice(service) {
  const address = _pickServiceAddress(service);
  if (!address) return;
  const txt = service.txt || {};
  const id = `cast:${service.fqdn || service.name}`;
  _devices.set(id, {
    id,
    type: "cast",
    name: txt.fn || service.name,
    friendlyName: txt.fn || service.name,
    model: txt.md || null,
    address,
    port: service.port || 8009,
    raw: service,
  });
  pushDevicesUpdate();
}

function _removeCastDevice(service) {
  const id = `cast:${service.fqdn || service.name}`;
  if (_devices.delete(id)) pushDevicesUpdate();
}

function _addDlnaPlayer(player) {
  if (!player || !player.name) return;
  const id = `dlna:${player.name}`;
  // host can be "ip:port" or just ip
  let address = player.host || "";
  let port = 0;
  const m = String(address).match(/^([^:]+)(?::(\d+))?$/);
  if (m) {
    address = m[1];
    port = m[2] ? Number(m[2]) : 0;
  }
  _devices.set(id, {
    id,
    type: "dlna",
    name: player.name,
    friendlyName: player.name,
    model: null,
    address,
    port,
    raw: player,
  });
  pushDevicesUpdate();
}

// dlnacasts3 logs `[DLNACASTS] querying ssdp` via console.debug on every search.
// Suppress just that one line while still surfacing real errors/warnings.
function _quietDlnaSearch(fn) {
  const orig = console.debug;
  console.debug = (...args) => {
    if (typeof args[0] === "string" && args[0].includes("[DLNACASTS]")) return;
    orig.apply(console, args);
  };
  try {
    fn();
  } finally {
    console.debug = orig;
  }
}

const DLNA_SSDP_THROTTLE_MS = 8000;

async function startDiscovery({ enableDlna = true } = {}) {
  _discoveryRunning = true;

  // ── Chromecast via mDNS ───────────────────────────────────────────────────
  // Bind the mDNS socket to the LAN interface. On multi-homed machines (active
  // VPN or a second adapter) the default bind lands on the wrong interface and
  // receives zero responses — the cause of "no devices found". Rebuild if the
  // routable IP changed (e.g. VPN toggled) so discovery recovers without a
  // restart. The browser is otherwise kept alive for the session (passive
  // listener, no polling, no log noise); subsequent calls issue a fresh query.
  try {
    if (!Bonjour) Bonjour = require("bonjour-service").Bonjour;
    const bindIp = getLocalIPv4();
    if (_bonjourInstance && _bonjourBindIp && _bonjourBindIp !== bindIp) {
      try {
        if (_bonjourBrowser) _bonjourBrowser.stop();
      } catch {}
      try {
        _bonjourInstance.destroy();
      } catch {}
      _bonjourBrowser = null;
      _bonjourInstance = null;
    }
    if (!_bonjourInstance) {
      _bonjourInstance =
        bindIp && bindIp !== "127.0.0.1"
          ? new Bonjour({ interface: bindIp })
          : new Bonjour();
      _bonjourBindIp = bindIp;
    }
    if (!_bonjourBrowser) {
      _bonjourBrowser = _bonjourInstance.find({ type: "googlecast" }, (svc) => {
        _addCastDevice(svc);
      });
      _bonjourBrowser.on("down", (svc) => _removeCastDevice(svc));
    } else {
      try {
        _bonjourBrowser.update();
      } catch {}
    }
  } catch (e) {
    pushError(`Chromecast discovery failed: ${e.message}`);
  }

  // ── DLNA via SSDP (dlnacasts3), gated by setting + throttled ───────────────
  if (enableDlna) {
    try {
      if (!dlnacasts) dlnacasts = require("dlnacasts3");
      if (!_dlnaList) {
        _dlnaList = dlnacasts();
        _dlnaList.on("update", (player) => _addDlnaPlayer(player));
      }
      const now = Date.now();
      if (now - _lastDlnaUpdate >= DLNA_SSDP_THROTTLE_MS) {
        _lastDlnaUpdate = now;
        _quietDlnaSearch(() => _dlnaList.update());
      }
    } catch (e) {
      pushError(`DLNA discovery failed: ${e.message}`);
    }
  }

  pushDevicesUpdate();
  return { ok: true };
}

// Fully tear down discovery sockets. Not called on every picker close (that
// caused devices to disappear); reserved for app shutdown.
async function stopDiscovery() {
  _discoveryRunning = false;
  try {
    if (_bonjourBrowser) _bonjourBrowser.stop();
  } catch {}
  _bonjourBrowser = null;
  try {
    if (_bonjourInstance) _bonjourInstance.destroy();
  } catch {}
  _bonjourInstance = null;
  _bonjourBindIp = null;
  try {
    if (_dlnaList) {
      _dlnaList.removeAllListeners("update");
      _dlnaList = null;
    }
  } catch {}
  return { ok: true };
}

// ── Cast load-args resolver ─────────────────────────────────────────────────
//
// Renderer can send either a fully-resolved `contentUrl` or a `mode` descriptor
// that the main process turns into a server token + URL.
//
//   { mode:"localFile", filePath, contentType?, title, posterUrl?, startTime?,
//     localVttSubs: [{ path, lang }] }
//   { mode:"mp4Remote", url, referer, contentType?, title, ..., remoteVttSubs: [{url,lang}] }
//   { mode:"hlsRemote", url, referer, title, ..., remoteVttSubs: [{url,lang}] }
//
// Returns: { contentUrl, contentType, title, posterUrl, startTime, subtitles:[{url,lang}] }
function _resolveLoadArgs(args) {
  const out = {
    contentUrl: null,
    contentType: args.contentType || null,
    title: args.title || "Streambert",
    posterUrl: args.posterUrl || null,
    startTime: Number.isFinite(args.startTime) ? Number(args.startTime) : 0,
    subtitles: [],
  };

  if (args.mode === "localFile") {
    const token = makeToken({
      kind: "file",
      filePath: args.filePath,
      contentType: args.contentType || _contentTypeForExt(args.filePath || ""),
    });
    out.contentUrl = castUrlFor(token, "file");
    out.contentType = args.contentType || _contentTypeForExt(args.filePath || "");
  } else if (args.mode === "mp4Remote") {
    const token = makeProxyToken({
      target: args.url,
      referer: args.referer || null,
      headers: args.extraHeaders || {},
    });
    out.contentUrl = castUrlFor(token, "proxy");
    out.contentType = args.contentType || "video/mp4";
  } else if (args.mode === "hlsRemote") {
    const token = makeProxyToken({
      target: args.url,
      referer: args.referer || null,
      headers: args.extraHeaders || {},
      isHls: true,
    });
    out.contentUrl = castUrlFor(token, "proxy");
    out.contentType = "application/vnd.apple.mpegurl";
  } else if (args.contentUrl) {
    // Fully-resolved URL provided directly
    out.contentUrl = args.contentUrl;
    out.contentType = args.contentType || "video/mp4";
  } else {
    throw new Error("cast:load — missing mode or contentUrl");
  }

  // Subtitles
  if (Array.isArray(args.localVttSubs)) {
    for (const s of args.localVttSubs) {
      if (!s || !s.path) continue;
      const tok = makeToken({ kind: "sub", filePath: s.path });
      out.subtitles.push({ url: castUrlFor(tok, "sub"), lang: s.lang || "und" });
    }
  }
  if (Array.isArray(args.remoteVttSubs)) {
    for (const s of args.remoteVttSubs) {
      if (!s || !s.url) continue;
      const tok = makeToken({
        kind: "sub",
        target: s.url,
        referer: args.referer || null,
      });
      out.subtitles.push({ url: castUrlFor(tok, "sub"), lang: s.lang || "und" });
    }
  }

  return out;
}

// ── Chromecast session ───────────────────────────────────────────────────────

function _connectChromecast(device) {
  if (!castv2Client) castv2Client = require("castv2-client");
  const { Client, DefaultMediaReceiver } = castv2Client;

  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const fail = (e) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {}
      reject(e);
    };
    client.on("error", fail);

    client.connect(device.address, () => {
      client.launch(DefaultMediaReceiver, (err, player) => {
        if (err) return fail(err);
        if (settled) return;
        settled = true;

        const tearDown = () => {
          try {
            player.removeAllListeners();
          } catch {}
          try {
            client.removeAllListeners();
          } catch {}
          // Quit the DefaultMediaReceiver app entirely so the device returns to
          // its home screen. Closing the TCP socket alone leaves the receiver
          // running on the cast splash. Fall back to close() if stop() never acks.
          let closed = false;
          const closeOnce = () => {
            if (closed) return;
            closed = true;
            try {
              client.close();
            } catch {}
          };
          try {
            client.stop(player, closeOnce);
            setTimeout(closeOnce, 1500);
          } catch {
            closeOnce();
          }
        };

        player.on("status", (status) => {
          if (!_session) return;
          _session.lastStatus = _mapCastStatus(status);
          pushStatus(_session.lastStatus);
        });
        client.on("status", (status) => {
          if (!_session) return;
          if (status && status.volume) {
            _session.lastStatus = {
              ...(_session.lastStatus || {}),
              volume: status.volume.level,
              muted: !!status.volume.muted,
              deviceId: device.id,
            };
            pushStatus(_session.lastStatus);
          }
        });
        client.on("error", (e) => {
          pushError(`Chromecast error: ${e.message}`);
          pushSessionEnded("error");
          _session = null;
        });

        resolve({ client, player, tearDown });
      });
    });
  });
}

function _mapCastStatus(s) {
  let playerState = "idle";
  if (s) {
    switch (s.playerState) {
      case "PLAYING":
        playerState = "playing";
        break;
      case "PAUSED":
        playerState = "paused";
        break;
      case "BUFFERING":
        playerState = "buffering";
        break;
      case "IDLE":
        playerState =
          s.idleReason === "FINISHED" ? "ended" : "idle";
        break;
    }
  }
  return {
    sessionState: playerState,
    currentTime: s ? s.currentTime || 0 : 0,
    duration: s && s.media ? s.media.duration || 0 : 0,
    deviceId: _session ? _session.device.id : null,
  };
}

// ── DLNA session ─────────────────────────────────────────────────────────────

function _mapDlnaStatus(status) {
  let playerState = "idle";
  if (status) {
    switch (status.playerState) {
      case "PLAYING":
        playerState = "playing";
        break;
      case "PAUSED_PLAYBACK":
        playerState = "paused";
        break;
      case "TRANSITIONNING":
      case "TRANSITIONING":
        playerState = "buffering";
        break;
      case "STOPPED":
      case "NO_MEDIA_PRESENT":
        playerState = "idle";
        break;
    }
  }
  return {
    sessionState: playerState,
    currentTime: status ? status.currentTime || 0 : 0,
    duration: 0,
    volume: status && status.volume ? (status.volume.level || 0) / 100 : 0,
    muted: !!(status && status.volume && status.volume.muted),
    deviceId: _session ? _session.device.id : null,
  };
}

async function _connectDlna(device) {
  const player = device.raw;
  if (!player || typeof player.play !== "function") {
    throw new Error("DLNA player object missing");
  }
  player.removeAllListeners && player.removeAllListeners("status");
  player.on("status", (status) => {
    if (!_session) return;
    _session.lastStatus = _mapDlnaStatus(status);
    pushStatus(_session.lastStatus);
  });
  const tearDown = () => {
    try {
      player.removeAllListeners();
    } catch {}
    try {
      player.stop();
    } catch {}
  };
  return { player, tearDown };
}

// ── Public session API ───────────────────────────────────────────────────────

async function connect(deviceId) {
  if (!deviceId) return { ok: false, error: "missing deviceId" };
  const device = _devices.get(deviceId);
  if (!device) return { ok: false, error: "device not found" };

  // Single active session — disconnect previous
  if (_session) {
    try {
      _session.tearDown && _session.tearDown();
    } catch {}
    _session = null;
  }

  try {
    if (device.type === "cast") {
      const { client, player, tearDown } = await _connectChromecast(device);
      _session = {
        device,
        type: "cast",
        client,
        player,
        lastStatus: { sessionState: "connecting", deviceId },
        tearDown,
      };
    } else if (device.type === "dlna") {
      const { player, tearDown } = await _connectDlna(device);
      _session = {
        device,
        type: "dlna",
        player,
        lastStatus: { sessionState: "connecting", deviceId },
        tearDown,
      };
    } else {
      return { ok: false, error: `unknown device type: ${device.type}` };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // Ensure the LAN HTTP server is up so subsequent loadMedia can mint URLs
  try {
    await getCastServer();
  } catch (e) {
    return { ok: false, error: `cast server failed: ${e.message}` };
  }

  pushStatus(_session.lastStatus);
  return { ok: true, deviceId };
}

async function loadMedia(args) {
  if (!_session) return { ok: false, error: "no active session" };
  await getCastServer(); // safety: server must be running before tokens are minted

  const resolved = _resolveLoadArgs(args || {});
  _session.contentUrl = resolved.contentUrl;
  _session.mediaInfo = resolved;

  if (_session.type === "cast") {
    if (!castv2Client) castv2Client = require("castv2-client");
    const tracks = resolved.subtitles.map((s, i) => ({
      trackId: i + 1,
      type: "TEXT",
      trackContentId: s.url,
      trackContentType: "text/vtt",
      subtype: "SUBTITLES",
      language: s.lang || "und",
      name: s.lang || `Track ${i + 1}`,
    }));
    const media = {
      contentId: resolved.contentUrl,
      contentType: resolved.contentType,
      streamType: "BUFFERED",
      metadata: {
        type: 0,
        metadataType: 0,
        title: resolved.title,
        images: resolved.posterUrl ? [{ url: resolved.posterUrl }] : [],
      },
    };
    if (tracks.length) {
      media.tracks = tracks;
      media.textTrackStyle = {
        backgroundColor: "#00000000",
        foregroundColor: "#FFFFFFFF",
        edgeType: "OUTLINE",
        edgeColor: "#000000FF",
        fontScale: 1.0,
      };
    }
    const options = {
      autoplay: true,
      currentTime: resolved.startTime,
    };
    if (tracks.length) options.activeTrackIds = [1];

    return new Promise((resolve) => {
      _session.player.load(media, options, (err) => {
        if (err) {
          // Load failed — quit the receiver app so the TV doesn't sit on the
          // cast splash, and reset session state so the UI returns to idle.
          try {
            _session.tearDown && _session.tearDown();
          } catch {}
          _session = null;
          pushSessionEnded("load-failed");
          return resolve({ ok: false, error: err.message });
        }
        resolve({ ok: true, contentUrl: resolved.contentUrl });
      });
    });
  }

  if (_session.type === "dlna") {
    const opts = {
      type: resolved.contentType,
      title: resolved.title,
      seek: resolved.startTime,
      dlnaFeatures:
        "DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01100000000000000000000000000000",
    };
    if (resolved.subtitles.length) {
      opts.subtitles = resolved.subtitles.map((s) => s.url);
      opts.autoSubtitles = true;
    }
    return new Promise((resolve) => {
      _session.player.play(resolved.contentUrl, opts, (err) => {
        if (err) return resolve({ ok: false, error: err.message });
        resolve({ ok: true, contentUrl: resolved.contentUrl });
      });
    });
  }

  return { ok: false, error: "unknown session type" };
}

function _wrap(fn) {
  return new Promise((resolve) => {
    try {
      fn((err) => {
        if (err) return resolve({ ok: false, error: err.message });
        resolve({ ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

async function play() {
  if (!_session) return { ok: false, error: "no active session" };
  if (_session.type === "cast") return _wrap((cb) => _session.player.play(cb));
  if (_session.type === "dlna") return _wrap((cb) => _session.player.resume(cb));
  return { ok: false, error: "unknown session type" };
}

async function pause() {
  if (!_session) return { ok: false, error: "no active session" };
  if (_session.type === "cast") return _wrap((cb) => _session.player.pause(cb));
  if (_session.type === "dlna") return _wrap((cb) => _session.player.pause(cb));
  return { ok: false, error: "unknown session type" };
}

async function stop() {
  if (!_session) return { ok: false, error: "no active session" };
  if (_session.type === "cast") return _wrap((cb) => _session.player.stop(cb));
  if (_session.type === "dlna") return _wrap((cb) => _session.player.stop(cb));
  return { ok: false, error: "unknown session type" };
}

async function seek(seconds) {
  if (!_session) return { ok: false, error: "no active session" };
  const sec = Number(seconds) || 0;
  if (_session.type === "cast") return _wrap((cb) => _session.player.seek(sec, cb));
  if (_session.type === "dlna") return _wrap((cb) => _session.player.seek(sec, cb));
  return { ok: false, error: "unknown session type" };
}

async function setVolume(level) {
  if (!_session) return { ok: false, error: "no active session" };
  const lvl = Math.max(0, Math.min(1, Number(level) || 0));
  if (_session.type === "cast")
    return _wrap((cb) => _session.client.setVolume({ level: lvl }, cb));
  if (_session.type === "dlna")
    return _wrap((cb) => _session.player.setVolume(Math.round(lvl * 100), cb));
  return { ok: false, error: "unknown session type" };
}

async function setMute(muted) {
  if (!_session) return { ok: false, error: "no active session" };
  if (_session.type === "cast")
    return _wrap((cb) => _session.client.setVolume({ muted: !!muted }, cb));
  // DLNA mute via setVolume(0) is unreliable; many renderers don't expose mute. No-op.
  return { ok: true, note: "mute-not-supported" };
}

/**
 * Set the active subtitle track.
 *   trackIndex: 0-based into the subtitles array passed to loadMedia.
 *               null/negative = subtitles off.
 */
async function setSubtitleTrack(trackIndex) {
  if (!_session) return { ok: false, error: "no active session" };
  if (_session.type === "cast") {
    const activeTrackIds =
      trackIndex == null || trackIndex < 0 ? [] : [trackIndex + 1];
    return new Promise((resolve) => {
      try {
        _session.player.media.sessionRequest(
          { type: "EDIT_TRACKS_INFO", activeTrackIds },
          (err) => {
            if (err) return resolve({ ok: false, error: err.message });
            resolve({ ok: true });
          },
        );
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }
  if (_session.type === "dlna") {
    return _wrap((cb) =>
      _session.player.subtitles(trackIndex == null || trackIndex < 0 ? false : trackIndex, cb),
    );
  }
  return { ok: false, error: "unknown session type" };
}

async function disconnect() {
  if (!_session) return { ok: true };
  try {
    _session.tearDown && _session.tearDown();
  } catch {}
  _session = null;
  pushSessionEnded("user");
  return { ok: true };
}

function getStatus() {
  if (!_session) return { sessionState: "idle" };
  return _session.lastStatus || { sessionState: "connecting" };
}

// ── IPC registration ─────────────────────────────────────────────────────────

function register(getMainWindow) {
  _getMainWindow = getMainWindow || (() => null);

  ipcMain.handle("cast:start-discovery", async (_, opts) => {
    try {
      return await startDiscovery(opts || {});
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:stop-discovery", async () => {
    try {
      return await stopDiscovery();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:list-devices", () => listDevices());

  ipcMain.handle("cast:connect", async (_, { deviceId } = {}) => {
    try {
      return await connect(deviceId);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:disconnect", async () => {
    try {
      return await disconnect();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:load", async (_, args) => {
    try {
      return await loadMedia(args || {});
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:play", async () => {
    try {
      return await play();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:pause", async () => {
    try {
      return await pause();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:stop", async () => {
    try {
      return await stop();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:seek", async (_, { seconds } = {}) => {
    try {
      return await seek(seconds);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:set-volume", async (_, { level } = {}) => {
    try {
      return await setVolume(level);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:set-mute", async (_, { muted } = {}) => {
    try {
      return await setMute(muted);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cast:get-status", () => getStatus());

  ipcMain.handle("cast:set-subtitle-track", async (_, { trackIndex } = {}) => {
    try {
      return await setSubtitleTrack(
        trackIndex === undefined ? null : trackIndex,
      );
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Clean disconnect on quit so receiver doesn't sit on a black screen
  app.on("before-quit", () => {
    try {
      if (_session && _session.tearDown) _session.tearDown();
    } catch {}
    _session = null;
  });
}

module.exports = {
  register,
  // Exposed for internal use (e.g. tests, future modules):
  _internals: {
    listDevices,
    getLocalIPv4,
    getCastServer,
    makeToken,
    castUrlFor,
  },
};
