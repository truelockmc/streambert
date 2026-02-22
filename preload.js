const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  // m3u8 capture
  onM3u8Found: (cb) => {
    const h = (_, url) => cb(url);
    ipcRenderer.on("m3u8-found", h);
    return h;
  },
  offM3u8Found: (h) => ipcRenderer.removeListener("m3u8-found", h),

  // subtitle capture (.vtt / .srt)
  onSubtitleFound: (cb) => {
    const h = (_, url) => cb(url);
    ipcRenderer.on("subtitle-found", h);
    return h;
  },
  offSubtitleFound: (h) => ipcRenderer.removeListener("subtitle-found", h),

  // Download progress events
  onDownloadProgress: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on("download-progress", h);
    return h;
  },
  offDownloadProgress: (h) =>
    ipcRenderer.removeListener("download-progress", h),

  // Download actions
  checkDownloader: (folder) => ipcRenderer.invoke("check-downloader", folder),
  runDownload: (args) => ipcRenderer.invoke("run-download", args),
  getDownloads: () => ipcRenderer.invoke("get-downloads"),
  deleteDownload: (args) => ipcRenderer.invoke("delete-download", args),
  showInFolder: (path) => ipcRenderer.invoke("show-in-folder", path),
  fileExists: (path) => ipcRenderer.invoke("file-exists", path),
  scanDirectory: (path) => ipcRenderer.invoke("scan-directory", path),

  // Misc
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openPath: (filePath) => ipcRenderer.invoke("open-path", filePath),
  openPathAtTime: (filePath, seconds) =>
    ipcRenderer.invoke("open-path-at-time", { filePath, seconds }),

  // Close confirmation
  onConfirmClose: (cb) => {
    const h = (_, data) => cb(data);
    ipcRenderer.on("confirm-close", h);
    return h;
  },
  offConfirmClose: (h) => ipcRenderer.removeListener("confirm-close", h),
  respondClose: (confirm) => ipcRenderer.send("close-response", confirm),

  // anime episode resolver (main-process HTTP, bypasses CORS/bot-check)
  resolveAllManga: (args) => ipcRenderer.invoke("resolve-allmanga", args),
  setPlayerVideo: (args) => ipcRenderer.invoke("set-player-video", args),
  debugAllManga: (args) => ipcRenderer.invoke("debug-allmanga", args),

  // App version (from package.json via Electron)
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  // Quit app
  quitApp: () => ipcRenderer.invoke("quit-app"),

  // Storage cleaning
  getCacheSize: () => ipcRenderer.invoke("get-cache-size"),
  getDownloadsSize: () => ipcRenderer.invoke("get-downloads-size"),
  clearAppCache: () => ipcRenderer.invoke("clear-app-cache"),
  clearWatchData: () => ipcRenderer.invoke("clear-watch-data"),
  deleteAllDownloads: () => ipcRenderer.invoke("delete-all-downloads"),
  resetApp: () => ipcRenderer.invoke("reset-app"),
});
