const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridge', {
  sqlWasm: () => ipcRenderer.invoke('sql:wasm'),
  listDbs: () => ipcRenderer.invoke('db:list'),
  loadDb: (year) => ipcRenderer.invoke('db:load', year),
  saveDb: (year, bytes) => ipcRenderer.invoke('db:save', year, bytes),
  dbNames: () => ipcRenderer.invoke('db:names'),
  currentDb: () => ipcRenderer.invoke('db:current'),
  useDb: (name) => ipcRenderer.invoke('db:use', name),
  createDb: (name, bytes) => ipcRenderer.invoke('db:create', name, bytes),
  retireDb: (year) => ipcRenderer.invoke('db:retire', year),
  pickDb: () => ipcRenderer.invoke('db:pick'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  licenceStatus: () => ipcRenderer.invoke('licence:status'),
  register: (code) => ipcRenderer.invoke('licence:register', code),
  readDevice: (dev) => ipcRenderer.invoke('device:read', dev),
  pingDevice: (dev) => ipcRenderer.invoke('device:ping', dev),
  transferDevice: (req, onProgress) => {
    const h = (_e, p) => onProgress?.(p)
    ipcRenderer.on('device:transfer-progress', h)
    return ipcRenderer.invoke('device:transfer', req).finally(() => ipcRenderer.removeListener('device:transfer-progress', h))
  },
  backup: (year, bytes) => ipcRenderer.invoke('db:backup', year, bytes),
  paths: () => ipcRenderer.invoke('paths'),
  saveFile: (name, bytes, ext) => ipcRenderer.invoke('file:save', name, bytes, ext),
  savePdf: (name, html) => ipcRenderer.invoke('file:pdf', name, html),
  printHtml: (html) => ipcRenderer.invoke('print:html', html),
  webConfig: () => ipcRenderer.invoke('web:config'),
  webSetConfig: (cfg) => ipcRenderer.invoke('web:setConfig', cfg),
  webCall: (method, p, body, override) => ipcRenderer.invoke('web:call', method, p, body, override),
})
