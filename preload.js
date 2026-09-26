const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridge', {
  sqlWasm: () => ipcRenderer.invoke('sql:wasm'),
  listDbs: () => ipcRenderer.invoke('db:list'),
  loadDb: (year) => ipcRenderer.invoke('db:load', year),
  saveDb: (year, bytes) => ipcRenderer.invoke('db:save', year, bytes),
  retireDb: (year) => ipcRenderer.invoke('db:retire', year),
  pickDb: () => ipcRenderer.invoke('db:pick'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  licenceStatus: () => ipcRenderer.invoke('licence:status'),
  register: (code) => ipcRenderer.invoke('licence:register', code),
  readDevice: (dev) => ipcRenderer.invoke('device:read', dev),
  backup: (year, bytes) => ipcRenderer.invoke('db:backup', year, bytes),
  paths: () => ipcRenderer.invoke('paths'),
  saveFile: (name, bytes, ext) => ipcRenderer.invoke('file:save', name, bytes, ext),
  savePdf: (name, html) => ipcRenderer.invoke('file:pdf', name, html),
  printHtml: (html) => ipcRenderer.invoke('print:html', html),
})
