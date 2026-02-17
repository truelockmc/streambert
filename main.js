const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

let mainWindow

function createWindow() {
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

  // Intercept requests on the dedicated videasy partition to:
  // 1. Strip X-Frame-Options / CSP so the player isn't blocked
  // 2. Capture .m3u8 URLs and forward them to the renderer
  const videasySession = session.fromPartition('persist:videasy')

  videasySession.webRequest.onHeadersReceived(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders }
      // Remove headers that block embedding
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase()
        if (lower === 'x-frame-options' || lower === 'content-security-policy') {
          delete headers[key]
        }
      }
      callback({ responseHeaders: headers })
    }
  )

  videasySession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      if (details.url.includes('.m3u8')) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('m3u8-found', details.url)
        }
      }
      callback({})
    }
  )

  const DEV_URL = process.env.VITE_DEV_SERVER_URL
  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Check if a video-downloader binary exists in the given folder.
// We look for any non-hidden file that sits next to _internal — the
// binary can be named anything (e.g. "Video Downloader", "video-downloader.exe").
ipcMain.handle('check-downloader', (_, folderPath) => {
  if (!folderPath) return { exists: false }
  try {
    const entries = fs.readdirSync(folderPath)
    const hasInternal = entries.includes('_internal')
    if (!hasInternal) return { exists: false }

    // Find the first regular file that isn't _internal or a dotfile
    const binary = entries.find(e => {
      if (e === '_internal') return false
      if (e.startsWith('.')) return false
      try {
        return fs.statSync(path.join(folderPath, e)).isFile()
      } catch { return false }
    })

    const binaryPath = binary ? path.join(folderPath, binary) : null
    return { exists: !!binaryPath, binaryPath }
  } catch {
    return { exists: false }
  }
})

// Launch the download CLI
ipcMain.handle('run-download', (_, { binaryPath, m3u8Url, name, downloadPath }) => {
  try {
    const proc = spawn(
      binaryPath,
      ['--cli', m3u8Url, '-f', 'mp4 (with Audio)', '-r', 'best', '-b', '320', '-n', name, '-d', downloadPath],
      { detached: true, stdio: 'ignore' }
    )
    proc.unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Open native folder picker dialog
ipcMain.handle('pick-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Ordner auswählen',
  })
  return result.canceled ? null : result.filePaths[0]
})

// Open a URL in the system browser
ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url)
})
