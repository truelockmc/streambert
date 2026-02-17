const { app, BrowserWindow, ipcMain, session, shell, dialog, protocol } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

let mainWindow

// ── Download store ────────────────────────────────────────────────────────────
let downloads = []
const downloadsFile = () => path.join(app.getPath('userData'), 'downloads.json')

function loadDownloads() {
  try {
    const raw = fs.readFileSync(downloadsFile(), 'utf8')
    downloads = JSON.parse(raw)
  } catch { downloads = [] }
}

function saveDownloads() {
  try {
    const toSave = downloads.filter(d => d.status !== 'downloading')
    fs.writeFileSync(downloadsFile(), JSON.stringify(toSave, null, 2))
  } catch {}
}

function sendProgress(update) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', update)
  }
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  loadDownloads()

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  })

  // Register local file protocol with Range request support (needed for video seeking)
  protocol.handle('localfile', async (request) => {
    try {
      const filePath = decodeURIComponent(request.url.replace('localfile://', ''))
      const stat = fs.statSync(filePath)
      const total = stat.size

      const ext = path.extname(filePath).toLowerCase()
      const mime = ext === '.mkv' ? 'video/x-matroska'
        : ext === '.webm' ? 'video/webm'
        : ext === '.avi' ? 'video/x-msvideo'
        : 'video/mp4'

      const rangeHeader = request.headers.get('range')
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const startByte = parseInt(match[1])
          const endByte = match[2] ? parseInt(match[2]) : total - 1
          const chunkSize = endByte - startByte + 1
          return new Response(fs.createReadStream(filePath, { start: startByte, end: endByte }), {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Range': `bytes ${startByte}-${endByte}/${total}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(chunkSize),
            },
          })
        }
      }

      return new Response(fs.createReadStream(filePath), {
        headers: {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(total),
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  // Videasy session — strip CSP/X-Frame-Options and capture m3u8 URLs
  const videasySession = session.fromPartition('persist:videasy')

  videasySession.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    const headers = { ...details.responseHeaders }
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (lower === 'x-frame-options' || lower === 'content-security-policy') delete headers[key]
    }
    callback({ responseHeaders: headers })
  })

  videasySession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (details.url.includes('.m3u8')) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('m3u8-found', details.url)
      }
    }
    callback({})
  })

  const DEV_URL = process.env.VITE_DEV_SERVER_URL
  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (mainWindow === null) createWindow() })

// ── IPC: downloader binary detection ─────────────────────────────────────────
ipcMain.handle('check-downloader', (_, folderPath) => {
  if (!folderPath) return { exists: false }
  try {
    const entries = fs.readdirSync(folderPath)
    const hasInternal = entries.includes('_internal')
    if (!hasInternal) return { exists: false }
    const binary = entries.find(e => {
      if (e === '_internal' || e.startsWith('.')) return false
      try { return fs.statSync(path.join(folderPath, e)).isFile() } catch { return false }
    })
    const binaryPath = binary ? path.join(folderPath, binary) : null
    return { exists: !!binaryPath, binaryPath }
  } catch { return { exists: false } }
})

// ── IPC: start download ───────────────────────────────────────────────────────
ipcMain.handle('run-download', (_, { binaryPath, m3u8Url, name, downloadPath, mediaId, mediaType, season, episode, posterPath, tmdbId }) => {
  try {
    const id = crypto.randomUUID()

    const entry = {
      id, name, m3u8Url, downloadPath,
      filePath: null, status: 'downloading',
      progress: 0, speed: '', size: '', totalFragments: 0, completedFragments: 0,
      lastMessage: 'Starting…', startedAt: Date.now(), completedAt: null,
      mediaId: mediaId || null, mediaType: mediaType || null,
      season: season || null, episode: episode || null,
      posterPath: posterPath || null,
      tmdbId: tmdbId || mediaId || null,
    }
    downloads.push(entry)
    // Do NOT call sendProgress here. The renderer adds the initial entry via
    // handleDownloadStarted() after invoke() resolves. Calling sendProgress()
    // synchronously inside the handler causes the event to arrive at the renderer
    // BEFORE invoke() resolves, so the renderer adds it via onDownloadProgress
    // AND again via handleDownloadStarted — resulting in two cards.

    const args = [
      '--cli', m3u8Url,
      '-f', 'mp4 (with Audio)',
      '-r', 'best',
      '-b', '320',
      '-n', name,
      '-d', downloadPath,
    ]

    const proc = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    // ── Per-download line parser ───────────────────────────────────────────
    //
    // Actual binary output (uses \r between updates, we split on \r|\n):
    //
    //   [hlsnative] Total fragments: 672
    //   [download] Destination: /home/user/aW5k….mp4
    //   [download] /home/user/file.part-Frag4 has already been downloaded
    //   Downloading: 0.31% (2939944/938676480.0 bytes)/s ETA Unknown (frag 4/672)
    //   [download]   0.8% of ~ 352.64MiB at 3.2MiB/s ETA 01:50 (frag 6/672)
    //   Downloading: 2.23% (2943016/131755366.4 bytes) ... (frag 15/672)
    //   ...
    //
    // Key insight: "(frag N/total)" appears in BOTH "Downloading:" and "[download]"
    // lines. The leading "Downloading: X%" is byte-level progress within the
    // current fragment (oscillates 0→100 per fragment) — DO NOT use it for
    // overall progress. Use (frag N/total) exclusively.

    const handleLine = (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      const idx = downloads.findIndex(d => d.id === id)
      if (idx === -1) return

      // Build an update object by scanning the line for all known patterns.
      // Multiple patterns can match the same line (e.g. frag + speed + size).
      const update = {}

      // ── (frag N/total) — THE source of truth for overall progress ────────
      // Appears as: "... (frag 4/672)" or "(frag 4/672)"
      const fragMatch = trimmed.match(/\(frag\s+(\d+)\/(\d+)\)/)
      if (fragMatch) {
        const currentFrag = parseInt(fragMatch[1])
        const total = parseInt(fragMatch[2])
        update.completedFragments = currentFrag
        update.totalFragments = total
        update.progress = Math.min(99, Math.round((currentFrag / total) * 100))
        update.lastMessage = `Fragment ${currentFrag} / ${total}`
      }

      // ── speed: "at X.XMiB/s" or "at X.XKiB/s" ──────────────────────────
      const speedMatch = trimmed.match(/\bat\s+([\d.]+\s*(?:[KMGT]i?B|B)\/s)/i)
      if (speedMatch) update.speed = speedMatch[1].trim()

      // ── size: "of ~ X.XMiB" or "of X.XMiB" ─────────────────────────────
      const sizeMatch = trimmed.match(/\bof\s+~?\s*([\d.]+\s*(?:[KMGT]i?B|B))\b/i)
      if (sizeMatch) update.size = sizeMatch[1].trim()

      // ── [hlsnative] Total fragments: N ───────────────────────────────────
      const fragTotalMatch = trimmed.match(/Total fragments:\s+(\d+)/)
      if (fragTotalMatch) {
        const total = parseInt(fragTotalMatch[1])
        const u = { totalFragments: total, completedFragments: 0, lastMessage: `HLS: ${total} fragments` }
        downloads[idx] = { ...downloads[idx], ...u }
        sendProgress({ id, ...u, status: downloads[idx].status })
        return
      }

      // ── [download] Destination: /path/file ───────────────────────────────
      const destMatch = trimmed.match(/^\[download\] Destination:\s+(.+)/)
      if (destMatch) {
        const u = { filePath: destMatch[1].trim(), lastMessage: 'Downloading…' }
        downloads[idx] = { ...downloads[idx], ...u }
        sendProgress({ id, ...u, status: downloads[idx].status })
        return
      }

      // ── [Merger] output path ──────────────────────────────────────────────
      const mergeMatch = trimmed.match(/\[Merger\] Merging formats into "(.+)"/)
      if (mergeMatch) {
        const u = { filePath: mergeMatch[1].trim(), lastMessage: 'Merging…', progress: 99 }
        downloads[idx] = { ...downloads[idx], ...u }
        sendProgress({ id, ...u, status: downloads[idx].status })
        return
      }

      // ── Send whatever we gathered (skip if nothing useful) ───────────────
      if (Object.keys(update).length === 0) {
        // Informational line — just update lastMessage if not already showing frag info
        if (!downloads[idx].lastMessage.startsWith('Fragment')) {
          update.lastMessage = trimmed
        }
      }

      if (Object.keys(update).length > 0) {
        downloads[idx] = { ...downloads[idx], ...update }
        sendProgress({ id, ...update, status: downloads[idx].status })
      }
    }

    let buf = ''
    proc.stdout.on('data', chunk => {
      buf += chunk.toString()
      // Binary uses \r to overwrite lines in a terminal — split on all variants
      const lines = buf.split(/\r\n|\r|\n/)
      buf = lines.pop() // hold incomplete last chunk
      lines.forEach(handleLine)
    })
    proc.stderr.on('data', chunk => {
      chunk.toString().split(/\r\n|\r|\n/).forEach(handleLine)
    })

    proc.on('close', (code) => {
      if (buf.trim()) handleLine(buf.trim())
      const idx = downloads.findIndex(d => d.id === id)
      if (idx !== -1) {
        // Status is determined ONLY by exit code, never by mid-stream messages
        const status = code === 0 ? 'completed' : 'error'
        downloads[idx].status = status
        downloads[idx].completedAt = Date.now()
        if (code === 0) downloads[idx].progress = 100

        // Try to detect output file if destination line wasn't caught
        if (code === 0 && !downloads[idx].filePath) {
          try {
            const VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.avi', '.ts', '.m4v']
            const match = fs.readdirSync(downloadPath)
              .filter(f => VIDEO_EXTS.some(e => f.toLowerCase().endsWith(e)))
              .map(f => ({ f, mtime: fs.statSync(path.join(downloadPath, f)).mtimeMs }))
              .sort((a, b) => b.mtime - a.mtime)[0]
            if (match) downloads[idx].filePath = path.join(downloadPath, match.f)
          } catch {}
        }

        // Real file size from disk
        if (downloads[idx].filePath) {
          try {
            const bytes = fs.statSync(downloads[idx].filePath).size
            downloads[idx].size = bytes > 1e9 ? (bytes / 1e9).toFixed(2) + ' GB'
              : bytes > 1e6 ? (bytes / 1e6).toFixed(1) + ' MB'
              : bytes > 1e3 ? (bytes / 1e3).toFixed(1) + ' KB'
              : bytes + ' B'
          } catch {}
        }

        sendProgress({
          id,
          status: downloads[idx].status,
          progress: downloads[idx].progress,
          completedAt: downloads[idx].completedAt,
          filePath: downloads[idx].filePath,
          size: downloads[idx].size,
          completedFragments: downloads[idx].completedFragments,
          totalFragments: downloads[idx].totalFragments,
        })
        saveDownloads()
      }
    })

    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── IPC: get all downloads ────────────────────────────────────────────────────
ipcMain.handle('get-downloads', () => downloads)

// ── IPC: delete a download ────────────────────────────────────────────────────
ipcMain.handle('delete-download', (_, { id, filePath }) => {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
    downloads = downloads.filter(d => d.id !== id)
    saveDownloads()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── IPC: show file in file manager ────────────────────────────────────────────
ipcMain.handle('show-in-folder', (_, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath)
  } else {
    shell.openPath(path.dirname(filePath || ''))
  }
})

// ── IPC: check if file exists ────────────────────────────────────────────────
ipcMain.handle('file-exists', (_, filePath) => {
  try { return fs.existsSync(filePath) } catch { return false }
})

// ── IPC: folder picker ────────────────────────────────────────────────────────
ipcMain.handle('pick-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Select Folder' })
  return result.canceled ? null : result.filePaths[0]
})

// ── IPC: open external URL ────────────────────────────────────────────────────
ipcMain.handle('open-external', (_, url) => { shell.openExternal(url) })

// ── IPC: scan directory for video files ──────────────────────────────────────
ipcMain.handle('scan-directory', (_, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) return []
    const VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.ts']
    const results = []
    const scanDir = (dir, depth = 0) => {
      if (depth > 3) return
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (VIDEO_EXTS.includes(ext)) {
            let size = ''
            try {
              const bytes = fs.statSync(fullPath).size
              size = bytes > 1e9 ? (bytes / 1e9).toFixed(2) + ' GB'
                : bytes > 1e6 ? (bytes / 1e6).toFixed(1) + ' MB'
                : bytes > 1e3 ? (bytes / 1e3).toFixed(1) + ' KB'
                : bytes + ' B'
            } catch {}
            results.push({ filePath: fullPath, name: path.basename(entry.name, ext), size, ext })
          }
        }
      }
    }
    scanDir(folderPath)
    return results
  } catch { return [] }
})
