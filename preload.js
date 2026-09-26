const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridge', {
  sqlWasm: () => ipcRenderer.invoke('sql:wasm'),
  listDbs: () => ipcRenderer.invoke('db:list'),
  loadDb: (year) => ipcRenderer.invoke('db:load', year),
  saveDb: (year, bytes) => ipcRenderer.invoke('db:save', year, bytes),
  licenceStatus: () => ipcRenderer.invoke('licence:status'),
  register: (code) => ipcRenderer.invoke('licence:register', code),
  readDevice: (dev) => ipcRenderer.invoke('device:read', dev),
  backup: (year, bytes) => ipcRenderer.invoke('db:backup', year, bytes),
  paths: () => ipcRenderer.invoke('paths'),
})
