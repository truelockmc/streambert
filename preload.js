const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  /** Called whenever the main process detects a .m3u8 URL */
  onM3u8Found: (cb) => {
    const handler = (_, url) => cb(url)
    ipcRenderer.on('m3u8-found', handler)
    return handler // return so caller can remove it later
  },
  offM3u8Found: (handler) => ipcRenderer.removeListener('m3u8-found', handler),

  checkDownloader: (folder) => ipcRenderer.invoke('check-downloader', folder),
  runDownload: (args)         => ipcRenderer.invoke('run-download', args),
  pickFolder: ()              => ipcRenderer.invoke('pick-folder'),
  openExternal: (url)         => ipcRenderer.invoke('open-external', url),
})
