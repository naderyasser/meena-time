// Electron main process: one window, the database file in the user's data
// folder (no XAMPP, no fixed drive), and the licence check.
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { requestCode, verifyLicence } = require('./lib/license')

// Demo: own data folder, starts with the test data, all features unlocked.
// Installer: demo/demo-data.sqlite is bundled by tools/build-demo.sh (normal
// builds have no demo/). From source: `npm run demo` (= electron . --demo).
const DEMO_DB = process.argv.includes('--demo') ? path.join(__dirname, 'tools', 'demo-data.sqlite') : path.join(__dirname, 'demo', 'demo-data.sqlite')
const DEMO = fs.existsSync(DEMO_DB)
if (DEMO) app.setPath('userData', path.join(app.getPath('appData'), 'Meena Time Demo'))
const dataDir = () => app.getPath('userData')
// one database for all years (v1.0); `name` = 'main', or a 4-digit year for a v0.x per-year file
const dbPath = (name) => path.join(dataDir(), name === 'main' ? 'meena-time.sqlite' : `meena-time-${name}.sqlite`)
const licencePath = () => path.join(dataDir(), 'licence.key')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'Meena Time',
    backgroundColor: '#3fc1e9',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  Menu.setApplicationMenu(null) // the app draws its own Arabic menu bar
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

// sql.js' .wasm is handed over as bytes: fetch() can't read file:// (or app.asar) URLs.
ipcMain.handle('sql:wasm', () => fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')))
ipcMain.handle('db:list', () =>
  fs.existsSync(dataDir())
    ? fs.readdirSync(dataDir()).map((f) => f.match(/^meena-time-(\d{4})\.sqlite$/)?.[1]).filter(Boolean)
    : [])
ipcMain.handle('db:load', (_e, year) => (fs.existsSync(dbPath(year)) ? fs.readFileSync(dbPath(year)) : null))
// after merging v0.x per-year files into the main DB, keep them renamed (never deleted)
ipcMain.handle('db:retire', (_e, year) => {
  if (!/^\d{4}$/.test(year) || !fs.existsSync(dbPath(year))) return false
  fs.renameSync(dbPath(year), dbPath(year) + '.v0-merged')
  return true
})
ipcMain.handle('db:save', (_e, year, bytes) => {
  fs.mkdirSync(dataDir(), { recursive: true })
  const tmp = dbPath(year) + '.tmp'
  fs.writeFileSync(tmp, Buffer.from(bytes))
  fs.renameSync(tmp, dbPath(year)) // atomic replace: a crash never leaves a half-written DB
  return true
})
ipcMain.handle('licence:status', () => {
  if (DEMO) return { requestCode: requestCode(), ok: true, edition: 'Demo' }
  const code = fs.existsSync(licencePath()) ? fs.readFileSync(licencePath(), 'utf8') : ''
  return { requestCode: requestCode(), ...verifyLicence(code) }
})
ipcMain.handle('licence:register', (_e, code) => {
  const res = verifyLicence(code)
  if (res.ok) {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(licencePath(), String(code).trim())
  }
  return res
})

// «قراءة الحركات» from a ZKTeco device on the LAN (TCP 4370, UDP fallback inside node-zklib).
ipcMain.handle('device:read', async (_e, { ip, port }) => {
  const ZKLib = require('node-zklib')
  const zk = new ZKLib(ip, port || 4370, 10000, 4000)
  try {
    await zk.createSocket()
    const res = await zk.getAttendances()
    const pad = (n) => String(n).padStart(2, '0')
    const punches = (res?.data || []).map((a) => {
      const d = new Date(a.recordTime)
      return { code: String(a.deviceUserId), ts: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
    })
    return { ok: true, punches }
  } catch (err) {
    return { ok: false, error: `تعذّر الاتصال بالجهاز ${ip}:${port || 4370} — تأكد أن الجهاز يعمل وعلى نفس الشبكة` }
  } finally {
    try { await zk.disconnect() } catch {}
  }
})

// Daily automatic backup on start-up: copy each year's DB to userData/backups,
// keep the newest 30 copies.
function dailyBackup() {
  try {
    const dir = path.join(dataDir(), 'backups')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 10)
    for (const f of fs.readdirSync(dataDir()).filter((f) => /^meena-time(-\d{4})?\.sqlite$/.test(f))) {
      const dest = path.join(dir, f.replace('.sqlite', `-${stamp}.sqlite`))
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(dataDir(), f), dest)
    }
    const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort()
    for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.unlinkSync(path.join(dir, old))
  } catch (err) {
    console.error('backup failed', err)
  }
}

ipcMain.handle('db:pick', async (e) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'اختر ملف النسخة الاحتياطية', filters: [{ name: 'Meena Time DB', extensions: ['sqlite'] }], properties: ['openFile'],
  })
  return canceled || !filePaths[0] ? null : fs.readFileSync(filePaths[0])
})
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0) })
ipcMain.handle('paths', () => ({ data: dataDir(), backups: path.join(dataDir(), 'backups') }))
ipcMain.handle('db:backup', async (e, year, bytes) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'حفظ نسخة احتياطية',
    defaultPath: path.join(app.getPath('documents'), `meena-time-backup-${new Date().toISOString().slice(0, 10)}.sqlite`),
    filters: [{ name: 'Meena Time DB', extensions: ['sqlite'] }],
  })
  if (canceled || !filePath) return { ok: false }
  fs.writeFileSync(filePath, Buffer.from(bytes))
  return { ok: true, path: filePath }
})

const FILTERS = { xlsx: [{ name: 'Excel', extensions: ['xlsx'] }], pdf: [{ name: 'PDF', extensions: ['pdf'] }] }
async function askSavePath(e, name, ext) {
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: path.join(app.getPath('documents'), name.replace(/[\\/:*?"<>|]/g, ' ')), filters: FILTERS[ext] || [],
  })
  return canceled ? null : filePath
}
ipcMain.handle('file:save', async (e, name, bytes, ext) => {
  const fp = await askSavePath(e, name, ext)
  if (!fp) return { ok: false }
  fs.writeFileSync(fp, Buffer.from(bytes))
  return { ok: true, path: fp }
})
// Report → PDF through Chromium's own renderer (keeps the Arabic shaping and RTL)
ipcMain.handle('file:pdf', async (e, name, html) => {
  const fp = await askSavePath(e, name, 'pdf')
  if (!fp) return { ok: false }
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } })
    fs.writeFileSync(fp, pdf)
    return { ok: true, path: fp }
  } catch (err) {
    return { ok: false, error: 'تعذّر إنشاء ملف PDF' }
  } finally {
    w.destroy()
  }
})

// Print through a hidden window so only the document prints (not the desktop),
// and a missing/failed printer comes back as a message instead of nothing happening
ipcMain.handle('print:html', async (e, html) => {
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    return await new Promise((resolve) => w.webContents.print({ printBackground: true }, (ok, reason) =>
      resolve(ok || /cancel/i.test(reason || '') ? { ok } : { ok: false, error: `تعذّرت الطباعة (${reason || 'لا توجد طابعة'}) — يمكنك الحفظ PDF بدلاً منها` })))
  } finally {
    w.destroy()
  }
})

app.whenReady().then(() => {
  if (DEMO && !fs.existsSync(dbPath('main'))) {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.copyFileSync(DEMO_DB, dbPath('main'))
  }
  dailyBackup()
  createWindow()
})
app.on('window-all-closed', () => app.quit())
