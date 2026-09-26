const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridge', {
  listDbs: () => ipcRenderer.invoke('db:list'),
  loadDb: (year) => ipcRenderer.invoke('db:load', year),
  saveDb: (year, bytes) => ipcRenderer.invoke('db:save', year, bytes),
  licenceStatus: () => ipcRenderer.invoke('licence:status'),
  register: (code) => ipcRenderer.invoke('licence:register', code),
})
