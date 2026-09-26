// window.bridge comes from preload.js inside Electron. In the browser preview
// the same calls go over HTTP to tools/preview-server.js.
if (!window.bridge) {
  window.bridge = {
    listDbs: () => fetch('/api/dbs').then((r) => r.json()),
    loadDb: async (year) => {
      const r = await fetch(`/api/db/${year}`)
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null
    },
    saveDb: (year, bytes) => fetch(`/api/db/${year}`, { method: 'PUT', body: bytes }).then((r) => r.json()),
    licenceStatus: () => fetch('/api/licence').then((r) => r.json()),
    register: (code) => fetch('/api/register', { method: 'POST', body: code }).then((r) => r.json()),
  }
}
