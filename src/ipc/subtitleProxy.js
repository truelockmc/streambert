// ── Subtitle UTF-8 transcoding proxy ─────────────────────────────────────────
// Embed players load subtitle files (SRT/VTT) directly from third-party CDNs,
// and several of those CDNs return files we cannot render as-is:
//   • Legacy single-byte encodings (e.g. CP1251 Russian) with no/wrong charset.
//   • sub.wyzie.io specifically converts CP1251 → "UTF-8" with a broken pipeline
//     that mixes CP1252/CP1256 char tables, producing valid UTF-8 that reads as
//     Arabic + Latin-1 gibberish.
// webRequest.onBeforeRequest can only redirect or cancel, not rewrite bodies,
// so we run a small loopback HTTP server. main.js redirects subtitle requests
// here; we fetch, detect/repair the encoding, and re-serve as proper UTF-8.

const http = require("http");

let _server = null;
let _port = null;

// ── Wyzie de-mangle ──────────────────────────────────────────────────────────
// sub.wyzie.io converts upstream CP1251 (Russian) subtitle files to "UTF-8"
// incorrectly: each source byte gets interpreted as a character via a broken
// mix of CP1252 (for bytes 0xA0-0xFF) and CP1256 (which "wins" for byte ranges
// that overlap with Arabic letters). The result is valid UTF-8 text but it
// reads as Arabic + Latin-1 accented gibberish instead of Russian. We reverse
// the mapping char-by-char back to the original CP1251 byte stream, then
// decode that stream as CP1251 to recover the real Russian text.

let _reverseMaps = null;
function getReverseMaps() {
  if (_reverseMaps) return _reverseMaps;
  const build = (enc) => {
    const m = new Map();
    const dec = new TextDecoder(enc, { fatal: false });
    for (let b = 0x80; b < 0x100; b++) {
      const ch = dec.decode(new Uint8Array([b]));
      if (ch && ch !== "�") m.set(ch, b);
    }
    return m;
  };
  _reverseMaps = { cp1252: build("windows-1252"), cp1256: build("windows-1256") };
  return _reverseMaps;
}

function tryFixWyzieMangle(text) {
  // Signature: presence of Arabic block chars (U+0600-U+06FF) AND/OR Latin-1
  // supplement chars (U+0080-U+00FF), and no real Cyrillic in the original.
  let hasArabic = false;
  let hasLatinSupp = false;
  let hasCyrillic = false;
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp >= 0x0600 && cp <= 0x06ff) hasArabic = true;
    else if (cp >= 0x00a0 && cp <= 0x00ff) hasLatinSupp = true;
    else if (cp >= 0x0400 && cp <= 0x04ff) hasCyrillic = true;
  }
  // Skip legitimate Russian, real Arabic, real French/etc. — only the
  // specific Wyzie mangle produces *both* Arabic and Latin-1 supplement
  // characters in the same file.
  if (hasCyrillic) return text;
  if (!hasArabic || !hasLatinSupp) return text;

  const { cp1252, cp1256 } = getReverseMaps();
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) {
      bytes.push(cp);
      continue;
    }
    if (cp1252.has(ch)) bytes.push(cp1252.get(ch));
    else if (cp1256.has(ch)) bytes.push(cp1256.get(ch));
    else bytes.push(0x3f); // '?'
  }
  const recovered = new TextDecoder("windows-1251", { fatal: false }).decode(
    Uint8Array.from(bytes),
  );

  // Validate: only accept the recovery if it actually produces a substantial
  // share of Cyrillic letters. Otherwise the file was something else (e.g. a
  // legitimate French subtitle) and we should leave it alone.
  let cyr = 0;
  let total = 0;
  for (let i = 0; i < recovered.length; i++) {
    const cp = recovered.charCodeAt(i);
    if (cp >= 0x21) total++;
    if (cp >= 0x0400 && cp <= 0x04ff) cyr++;
  }
  if (total > 0 && cyr / total > 0.3) return recovered;
  return text;
}

function decodeSubtitleBuffer(buf, declaredCharset) {
  // 1. Honor a non-utf8 charset explicitly declared by the upstream server.
  if (
    declaredCharset &&
    !/^utf-?8$/i.test(declaredCharset) &&
    declaredCharset !== "us-ascii"
  ) {
    try {
      return new TextDecoder(declaredCharset, { fatal: false }).decode(buf);
    } catch {}
  }

  // 2. UTF-8 BOM → strip and decode as UTF-8.
  if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    return tryFixWyzieMangle(buf.slice(3).toString("utf8"));
  }

  // 3. Strict UTF-8: if it parses cleanly, trust it (modulo Wyzie de-mangle).
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return tryFixWyzieMangle(utf8);
  } catch {}

  // 4. Heuristic single-byte fallback. Bytes 0xC0-0xFF in CP1251 are Cyrillic
  // letters; in CP1252 they are accented Latin. Count which range looks more
  // plausible and pick accordingly.
  let cp1251Hits = 0;
  let cp1252Hits = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0xc0 && b <= 0xff) cp1251Hits++;
    if ((b >= 0xc0 && b <= 0xff) || (b >= 0x80 && b <= 0x9f)) cp1252Hits++;
  }
  const encoding = cp1251Hits > 4 ? "windows-1251" : "windows-1252";
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

function start() {
  if (_server) return Promise.resolve(_port);
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, "http://localhost");
        if (u.pathname !== "/subs") {
          res.writeHead(404);
          res.end();
          return;
        }
        const encoded = u.searchParams.get("u");
        if (!encoded) {
          res.writeHead(400);
          res.end();
          return;
        }
        let target;
        try {
          target = Buffer.from(encoded, "base64url").toString("utf8");
          // sanity: must be a valid http(s) URL
          const tu = new URL(target);
          if (tu.protocol !== "http:" && tu.protocol !== "https:") throw 0;
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }

        const referer = u.searchParams.get("ref") || "";
        const upstream = await fetch(target, {
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
            ...(referer ? { Referer: referer } : {}),
          },
        });
        if (!upstream.ok) {
          res.writeHead(upstream.status);
          res.end();
          return;
        }
        const ct = upstream.headers.get("content-type") || "";
        const declared = (ct.match(/charset=([^;]+)/i)?.[1] || "")
          .trim()
          .toLowerCase();
        const buf = Buffer.from(await upstream.arrayBuffer());
        const text = decodeSubtitleBuffer(buf, declared);
        const out = Buffer.from(text, "utf8");
        // Preserve the upstream MIME type (text/plain, text/vtt, etc.) but
        // force the charset to utf-8 since we've already transcoded.
        const baseType = (ct.split(";")[0] || "text/plain").trim();
        res.writeHead(200, {
          "Content-Type": `${baseType}; charset=utf-8`,
          "Content-Length": out.length,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        });
        res.end(out);
      } catch (e) {
        console.error("[subProxy] fetch failed:", e?.message || e);
        res.writeHead(502);
        res.end();
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      _server = server;
      _port = server.address().port;
      resolve(_port);
    });
  });
}

function getPort() {
  return _port;
}

function buildProxyUrl(originalUrl, referer) {
  if (!_port) return null;
  const u = Buffer.from(originalUrl, "utf8").toString("base64url");
  const refParam = referer ? `&ref=${encodeURIComponent(referer)}` : "";
  return `http://127.0.0.1:${_port}/subs?u=${u}${refParam}`;
}

module.exports = { start, getPort, buildProxyUrl, decodeSubtitleBuffer };
