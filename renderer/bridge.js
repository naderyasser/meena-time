// window.bridge comes from preload.js inside Electron. In the browser preview
// the same calls go over HTTP to tools/preview-server.js.
if (!window.bridge) {
  window.bridge = {
    sqlWasm: () => fetch('/sql.js/sql-wasm.wasm').then((r) => r.arrayBuffer()),
    listDbs: () => fetch('/api/dbs').then((r) => r.json()),
    loadDb: async (year) => {
      const r = await fetch(`/api/db/${year}`)
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null
    },
    saveDb: (year, bytes) => fetch(`/api/db/${year}`, { method: 'PUT', body: bytes }).then((r) => r.json()),
    retireDb: async () => true,
    pickDb: async () => null,
    relaunch: async () => location.reload(),
    licenceStatus: () => fetch('/api/licence').then((r) => r.json()),
    register: (code) => fetch('/api/register', { method: 'POST', body: code }).then((r) => r.json()),
    backup: async (year, bytes) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes]))
      a.download = `meena-time-${year}.sqlite`
      a.click()
      return { ok: true, path: a.download }
    },
    saveFile: async (name, bytes) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes]))
      a.download = name
      a.click()
      return { ok: true, path: name }
    },
    printHtml: null, // preview: UI.print falls back to window.print
    webConfig: async () => ({ linked: false }),
    webSetConfig: async () => false,
    webCall: async () => ({ error: 'الربط بالموقع يعمل في البرنامج المثبّت فقط' }),
    savePdf: async () => ({ ok: false, error: 'حفظ PDF يعمل في البرنامج المثبّت فقط' }),
    paths: async () => ({ data: '(preview) preview-data/', backups: '(preview) —' }),
    readDevice: async () => ({ ok: false, error: 'القراءة من الجهاز تعمل في البرنامج المثبّت فقط (غير متاحة في المعاينة)' }),
    pingDevice: async () => false,
  }
}
