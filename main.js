// Electron main process: one window, the database file in the user's data
// folder (no XAMPP, no fixed drive), and the licence check.
const { app, BrowserWindow, ipcMain, Menu } = require('electron')
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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
