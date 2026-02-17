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

// Parse a single line of yt-dlp / binary output
function parseLine(line) {
  // "[download]   X.X% of ~ Y.YY ZiB at    W.W ZiB/s ETA HH:MM:SS"
  const dlMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\S+)\s+at\s+([\d.]+\s*\S+\/s)/)
  if (dlMatch) return { progress: parseFloat(dlMatch[1]), size: dlMatch[2].trim(), speed: dlMatch[3].trim() }

  // "[download] X.X% of Y.YMiB" (no speed yet)
  const dlSimple = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\S+)/)
  if (dlSimple) return { progress: parseFloat(dlSimple[1]), size: dlSimple[2].trim() }

  // "Downloading: X.XX% (bytes/total bytes)"
  const customMatch = line.match(/^Downloading:\s+([\d.]+)%/)
  if (customMatch) return { progress: parseFloat(customMatch[1]) }

  // HLS fragment progress: "[download] fragment X of Y" or "[hlsnative] Downloading fragment X of Y"
  const fragMatch = line.match(/fragment\s+(\d+)\s+(?:of\s+|\/\s*)(\d+)/i)
  if (fragMatch) {
    const current = parseInt(fragMatch[1])
    const total = parseInt(fragMatch[2])
    const progress = total > 0 ? Math.round((current / total) * 100) : 0
    return { progress, totalFragments: total, lastMessage: line.trim() }
  }

  // "[hlsnative] Total fragments: N"
  const fragTotalMatch = line.match(/Total fragments:\s+(\d+)/)
  if (fragTotalMatch) return { totalFragments: parseInt(fragTotalMatch[1]) }

  // "[download] Destination: /path/to/file"
  const destMatch = line.match(/\[download\] Destination:\s+(.+)/)
  if (destMatch) return { filePath: destMatch[1].trim() }

  // Merging / post-processing destination
  const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"/)
  if (mergeMatch) return { filePath: mergeMatch[1].trim() }

  // "[download] 100% of ..."
  const fullMatch = line.match(/\[download\]\s+100%/)
  if (fullMatch) return { progress: 100 }

  // Status messages — informational only, never mark as error
  if (line.trim().length > 0) {
    return { lastMessage: line.trim() }
  }

  return null
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

      // Detect MIME type by extension
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
    } catch (e) {
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
      progress: 0, speed: '', size: '', totalFragments: 0,
      lastMessage: 'Starting…', startedAt: Date.now(), completedAt: null,
      mediaId: mediaId || null, mediaType: mediaType || null,
      season: season || null, episode: episode || null,
      posterPath: posterPath || null,
      tmdbId: tmdbId || mediaId || null,
    }
    downloads.push(entry)
    sendProgress({ ...entry })

    const args = [
      '--cli', m3u8Url,
      '-f', 'mp4 (with Audio)',
      '-r', 'best',
      '-b', '320',
      '-n', name,
      '-d', downloadPath,
    ]

    const proc = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    const handleLine = (line) => {
      if (!line.trim()) return
      const parsed = parseLine(line)
      if (!parsed) return
      const idx = downloads.findIndex(d => d.id === id)
      if (idx === -1) return
      downloads[idx] = { ...downloads[idx], ...parsed }
      // Never let mid-stream messages mark the download as error;
      // error status is only set by the process exit code below.
      sendProgress({ id, ...parsed, status: downloads[idx].status })
    }

    let buf = ''
    proc.stdout.on('data', chunk => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      lines.forEach(handleLine)
    })
    proc.stderr.on('data', chunk => {
      const lines = chunk.toString().split('\n')
      lines.forEach(handleLine)
    })

    proc.on('close', (code) => {
      if (buf.trim()) handleLine(buf.trim())
      const idx = downloads.findIndex(d => d.id === id)
      if (idx !== -1) {
        // Determine final status solely from exit code
        const status = code === 0 ? 'completed' : 'error'
        downloads[idx].status = status
        downloads[idx].completedAt = Date.now()
        if (code === 0) downloads[idx].progress = 100

        // Try to find the output file if not already detected
        if (code === 0 && !downloads[idx].filePath) {
          try {
            const files = fs.readdirSync(downloadPath)
            // Find newest file matching the name
            const videoExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov']
            const match = files
              .filter(f => videoExts.some(e => f.toLowerCase().endsWith(e)))
              .map(f => ({ f, mtime: fs.statSync(path.join(downloadPath, f)).mtimeMs }))
              .sort((a, b) => b.mtime - a.mtime)[0]
            if (match) downloads[idx].filePath = path.join(downloadPath, match.f)
          } catch {}
        }

        // Get real file size
        if (downloads[idx].filePath) {
          try {
            const stat = fs.statSync(downloads[idx].filePath)
            const bytes = stat.size
            const size = bytes > 1e9 ? (bytes / 1e9).toFixed(2) + ' GB'
              : bytes > 1e6 ? (bytes / 1e6).toFixed(1) + ' MB'
              : bytes > 1e3 ? (bytes / 1e3).toFixed(1) + ' KB'
              : bytes + ' B'
            downloads[idx].size = size
          } catch {}
        }

        sendProgress({
          id,
          status: downloads[idx].status,
          progress: downloads[idx].progress,
          completedAt: downloads[idx].completedAt,
          filePath: downloads[idx].filePath,
          size: downloads[idx].size,
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
              const stat = fs.statSync(fullPath)
              const bytes = stat.size
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
