// Browser preview of the renderer (for screenshots / review without Windows).
// Serves renderer/ + sql.js and implements the same bridge over HTTP.
const http = require('http')
const fs = require('fs')
const path = require('path')
const { requestCode, verifyLicence } = require('../lib/license')

const ROOT = path.join(__dirname, '..')
const DATA = path.join(ROOT, 'preview-data')
fs.mkdirSync(DATA, { recursive: true })
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }
const licFile = path.join(DATA, 'licence.key')

const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))) })
const json = (res, obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }

http.createServer(async (req, res) => {
  fs.mkdirSync(DATA, { recursive: true })
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  if (p === '/api/dbs') return json(res, fs.readdirSync(DATA).map((f) => f.match(/^(\d{4})\.sqlite$/)?.[1]).filter(Boolean))
  const m = p.match(/^\/api\/db\/(\d{4})$/)
  if (m) {
    const f = path.join(DATA, `${m[1]}.sqlite`)
    if (req.method === 'PUT') { fs.writeFileSync(f, await body(req)); return json(res, true) }
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(fs.readFileSync(f))
  }
  if (p === '/api/licence') return json(res, { requestCode: requestCode(), ...verifyLicence(fs.existsSync(licFile) ? fs.readFileSync(licFile, 'utf8') : '') })
  if (p === '/api/register') {
    const code = (await body(req)).toString()
    const r = verifyLicence(code)
    if (r.ok) fs.writeFileSync(licFile, code.trim())
    return json(res, r)
  }
  if (p === '/') { res.writeHead(302, { Location: '/renderer/index.html' }); return res.end() }
  let file = p
  if (file.startsWith('/sql.js/')) file = '/node_modules/sql.js/dist/' + file.slice(8)
  const full = path.join(ROOT, path.normalize(file))
  if (!full.startsWith(ROOT) || !fs.existsSync(full)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' })
  res.end(fs.readFileSync(full))
}).listen(process.env.PORT || 3099, '127.0.0.1', () => console.log('preview on', process.env.PORT || 3099))
