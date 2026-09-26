// Electron main process: one window, the database file in the user's data
// folder (no XAMPP, no fixed drive), and the licence check.
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { requestCode, verifyLicence } = require('./lib/license')

const dataDir = () => app.getPath('userData')
const dbPath = (year) => path.join(dataDir(), `meena-time-${year}.sqlite`)
const licencePath = () => path.join(dataDir(), 'licence.key')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'Meena Time',
    backgroundColor: '#3fc1e9',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  Menu.setApplicationMenu(null) // the app draws its own Arabic menu bar
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

ipcMain.handle('db:list', () =>
  fs.existsSync(dataDir())
    ? fs.readdirSync(dataDir()).map((f) => f.match(/^meena-time-(\d{4})\.sqlite$/)?.[1]).filter(Boolean)
    : [])
ipcMain.handle('db:load', (_e, year) => (fs.existsSync(dbPath(year)) ? fs.readFileSync(dbPath(year)) : null))
ipcMain.handle('db:save', (_e, year, bytes) => {
  fs.mkdirSync(dataDir(), { recursive: true })
  const tmp = dbPath(year) + '.tmp'
  fs.writeFileSync(tmp, Buffer.from(bytes))
  fs.renameSync(tmp, dbPath(year)) // atomic replace: a crash never leaves a half-written DB
  return true
})
ipcMain.handle('licence:status', () => {
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
    for (const f of fs.readdirSync(dataDir()).filter((f) => /^meena-time-\d{4}\.sqlite$/.test(f))) {
      const dest = path.join(dir, f.replace('.sqlite', `-${stamp}.sqlite`))
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(dataDir(), f), dest)
    }
    const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort()
    for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.unlinkSync(path.join(dir, old))
  } catch (err) {
    console.error('backup failed', err)
  }
}

ipcMain.handle('paths', () => ({ data: dataDir(), backups: path.join(dataDir(), 'backups') }))
ipcMain.handle('db:backup', async (e, year, bytes) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'حفظ نسخة احتياطية',
    defaultPath: path.join(app.getPath('documents'), `meena-time-${year}-${new Date().toISOString().slice(0, 10)}.sqlite`),
    filters: [{ name: 'Meena Time DB', extensions: ['sqlite'] }],
  })
  if (canceled || !filePath) return { ok: false }
  fs.writeFileSync(filePath, Buffer.from(bytes))
  return { ok: true, path: filePath }
})

app.whenReady().then(() => { dailyBackup(); createWindow() })
app.on('window-all-closed', () => app.quit())
