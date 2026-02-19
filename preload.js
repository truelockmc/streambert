const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  // m3u8 capture
  onM3u8Found: (cb) => { const h = (_, url) => cb(url); ipcRenderer.on('m3u8-found', h); return h },
  offM3u8Found: (h) => ipcRenderer.removeListener('m3u8-found', h),

  // Download progress events
  onDownloadProgress: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('download-progress', h); return h },
  offDownloadProgress: (h) => ipcRenderer.removeListener('download-progress', h),

  // Download actions
  checkDownloader: (folder) => ipcRenderer.invoke('check-downloader', folder),
  runDownload: (args) => ipcRenderer.invoke('run-download', args),
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  deleteDownload: (args) => ipcRenderer.invoke('delete-download', args),
  showInFolder: (path) => ipcRenderer.invoke('show-in-folder', path),
  fileExists: (path) => ipcRenderer.invoke('file-exists', path),
  scanDirectory: (path) => ipcRenderer.invoke('scan-directory', path),

  // Misc
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),

  // Close confirmation
  onConfirmClose: (cb) => { const h = (_, data) => cb(data); ipcRenderer.on('confirm-close', h); return h },
  offConfirmClose: (h) => ipcRenderer.removeListener('confirm-close', h),
  respondClose: (confirm) => ipcRenderer.send('close-response', confirm),

  // Quit app
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Storage cleaning
  clearAppCache: () => ipcRenderer.invoke('clear-app-cache'),
  clearWatchData: () => ipcRenderer.invoke('clear-watch-data'),
  deleteAllDownloads: () => ipcRenderer.invoke('delete-all-downloads'),
  resetApp: () => ipcRenderer.invoke('reset-app'),
})
