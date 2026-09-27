// Harder link scenarios, real app ↔ real site (tamken3), through a local relay
// that can "cut the internet": offline then back, wrong key, bulk upload,
// a punch that reached the site another way first, two PCs linked to one site,
// setup edited on the site (add / rename / delete), punches edited or deleted
// on the site, unlink + relink. Everything created on the site is removed at the end.
//   xvfb-run -a node tools/live-scenarios-test.mjs [creds.json]
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
import http from 'http'

const ROOT = '/root/meena-time'
const C = JSON.parse(fs.readFileSync(process.argv[2] || '/root/meena-time-keys-backup/tamken3-api.json'))
const H = { Authorization: `token ${C.key}:${C.secret}`, Accept: 'application/json', 'Content-Type': 'application/json' }
const api = async (method, path, body) => {
  const r = await fetch(C.url + path, { method, headers: H, body: body && JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { let m = j.exc_type || ''; try { m += ' ' + JSON.parse(JSON.parse(j._server_messages)[0]).message } catch {} throw new Error(`${method} ${path.split('?')[0]} → ${r.status} ${m}`) }
  return j.data ?? j.message
}
const res = (dt, n = '') => `/api/resource/${encodeURIComponent(dt)}${n ? '/' + encodeURIComponent(n) : ''}`
const list = (dt, fields, filters = []) => api('GET', `${res(dt)}?fields=${encodeURIComponent(JSON.stringify(fields))}&filters=${encodeURIComponent(JSON.stringify(filters))}&limit_page_length=0`)
const PUSH = '/api/method/base_meena.biometric_management.desktop_sync.push_checkins'

let pass = 0, fail = 0, skip = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : '  → ' + extra}`) }
const skipped = (name, why) => { skip++; console.log(`SKIP  ${name}  → ${why}`) }
const timings = {}
const timed = async (k, f) => { const t = Date.now(); const r = await f(); timings[k] = Date.now() - t; return r }
const day = (off) => new Date(Date.now() + off * 864e5).toISOString().slice(0, 10)
const TEST_DAY = day(-101), sec = (i) => `${String(Math.floor(i / 3600) % 24).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`
const created = [] // [doctype, name, submitted] — removed in reverse at the end
const siteCks = () => list('Employee Checkin', ['name', 'time'], [['employee', '=', target.name], ['time', 'between', [`${TEST_DAY} 00:00:00`, `${TEST_DAY} 23:59:59`]]])

// ── relay: the app talks to the site through here; `down` = no internet ──
let down = false
const relay = http.createServer((req, rsp) => {
  if (down) return req.socket.destroy()
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', async () => {
    try {
      const r = await fetch(C.url + req.url, { method: req.method, headers: { authorization: req.headers.authorization, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body || undefined })
      rsp.writeHead(r.status, { 'Content-Type': 'application/json' }); rsp.end(await r.text())
    } catch { req.socket.destroy() }
  })
})
await new Promise((r) => relay.listen(8799, '127.0.0.1', r))
const RELAY = 'http://127.0.0.1:8799'

const apps = []
async function openApp(ud) {
  fs.rmSync(ud, { recursive: true, force: true })
  const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${ud}`], cwd: ROOT })
  apps.push([app, ud])
  const p = await app.firstWindow()
  p.errors = []
  p.on('pageerror', (e) => p.errors.push(e.message))
  const btn = (name) => p.locator('.dlg-backdrop').last().getByRole('button', { name })
  await p.waitForSelector('text=شاشة الدخول')
  await p.locator('#user').fill('أ'); await btn('موافق').click()
  await p.locator('#np1').fill('1234'); await p.locator('#np2').fill('1234'); await btn('حفظ').click()
  await p.waitForSelector('#home')
  await p.evaluate(async (c) => { await window.bridge.webSetConfig(c); await WebSync.init(false) }, { url: RELAY, key: C.key, secret: C.secret })
  // test punches sit ~100 days back (away from live attendance), so widen the delete-check window to reach them
  await p.evaluate(() => { WebSync.RECONCILE_DAYS = 120 })
  return p
}
const q = (p, sql, a = []) => p.evaluate(([sql, a]) => DB.all(sql, a), [sql, a])
const one = async (p, sql, a) => Object.values((await q(p, sql, a))[0] || {})[0]
const sync = (p) => p.evaluate(async () => { const r = await WebSync.sync({ quiet: true }); await DB.flush(); return { r, failed: WebSync.pushFailed || 0, err: WebSync.pushError || '', status: document.getElementById('sync-status')?.textContent || '' } })
const addPunches = (p, rows) => p.evaluate(async (rows) => { for (const [c, t] of rows) DB.run("INSERT INTO punches (emp_code, ts, source) VALUES (?, ?, 'manual')", [c, t]); await DB.flush() }, rows)

let target, code
try {
  const emps = await list('Employee', ['name', 'attendance_device_id', 'status'])
  target = emps.find((e) => e.status === 'Active'); code = String(target.attendance_device_id || target.name).trim()
  if ((await siteCks()).length) throw new Error(`site already has punches on ${TEST_DAY} for the test employee — pick another day`)

  const A = await openApp('/tmp/mt-scn-a')
  check('A: first sync through the relay', !!(await sync(A)).r)

  // ── 1. no internet, then back ──
  await addPunches(A, [[code, `${TEST_DAY} 06:00:01`]])
  const empsBefore = await one(A, 'SELECT COUNT(*) FROM employees')
  down = true
  const off = await sync(A)
  check('offline: sync fails with a clear message, app keeps working', !off.r && /تعذّرت المزامنة/.test(off.status), off.status)
  check('offline: local data untouched, punch still waiting', (await one(A, 'SELECT COUNT(*) FROM employees')) === empsBefore && (await one(A, 'SELECT web_id FROM punches WHERE ts = ?', [`${TEST_DAY} 06:00:01`])) === null)
  down = false
  const back = await sync(A)
  const up1 = (await siteCks()).find((c) => String(c.time).startsWith(`${TEST_DAY} 06:00:01`))
  if (up1) created.push(['Employee Checkin', up1.name])
  check('back online: waiting punch uploaded on next sync', !!up1 && back.failed === 0 && /مرتبط بالموقع/.test(back.status), back.status)

  // ── 2. key revoked / wrong ──
  await A.evaluate(async (c) => window.bridge.webSetConfig(c), { url: RELAY, key: C.key, secret: 'wrong-secret' })
  const bad = await sync(A)
  check('wrong key: sync refused with a credentials message', !bad.r && /بيانات الربط غير صحيحة/.test(bad.status), bad.status)
  check('wrong key: nothing wiped locally', (await one(A, 'SELECT COUNT(*) FROM employees')) === empsBefore)
  await A.evaluate(async (c) => window.bridge.webSetConfig(c), { url: RELAY, key: C.key, secret: C.secret })

  // ── 3. bulk: 520 punches (3 batches) ──
  const bulk = Array.from({ length: 520 }, (_, i) => [code, `${TEST_DAY} ${sec(7 * 3600 + i * 7)}`])
  await addPunches(A, bulk)
  const b = await timed('bulk upload 520 punches', () => sync(A))
  const onSite = await siteCks()
  for (const c of onSite) if (!created.some((x) => x[1] === c.name)) created.push(['Employee Checkin', c.name])
  check(`bulk: 520 uploaded, none failed (site has ${onSite.length - 1} + 1)`, onSite.length === 521 && b.failed === 0, JSON.stringify({ site: onSite.length, failed: b.failed, err: b.err }))
  check('bulk: every local punch linked', (await one(A, "SELECT COUNT(*) FROM punches WHERE emp_code = ? AND ts LIKE ? AND web_id IS NULL", [code, `${TEST_DAY}%`])) === 0)

  // ── 4. the same punch reached the site another way first (device / ADMS) ──
  const dupTs = `${TEST_DAY} 20:00:00`
  const pre = (await api('POST', PUSH, { punches: [{ employee: target.name, time: dupTs }] }))[0]
  created.push(['Employee Checkin', pre.name])
  await addPunches(A, [[code, dupTs]])
  await sync(A)
  const dups = (await siteCks()).filter((c) => String(c.time).startsWith(dupTs))
  check('already on the site: no duplicate, app links to the existing record', dups.length === 1 && (await one(A, 'SELECT web_id FROM punches WHERE ts = ?', [dupTs])) === pre.name, JSON.stringify({ site: dups.length }))

  // ── 5. two PCs linked to the same site, same punch read on both ──
  const B = await openApp('/tmp/mt-scn-b')
  await sync(B)
  const twoTs = `${TEST_DAY} 21:00:00`
  await addPunches(A, [[code, twoTs]]); await addPunches(B, [[code, twoTs]])
  await Promise.all([sync(A), sync(B)])
  const two = (await siteCks()).filter((c) => String(c.time).startsWith(twoTs))
  for (const c of two) created.push(['Employee Checkin', c.name])
  check('two PCs, same punch at the same moment: one record on the site', two.length === 1, `site has ${two.length}`)
  await Promise.all([sync(A), sync(B)]) // the PC that lost the race links on its next round
  const wa = await one(A, 'SELECT web_id FROM punches WHERE ts = ?', [twoTs]), wb = await one(B, 'SELECT web_id FROM punches WHERE ts = ?', [twoTs])
  check('two PCs: both linked to that record (after one more sync)', !!wa && wa === wb, `${wa} / ${wb}`)
  const onlyB = `${TEST_DAY} 21:30:00`
  await addPunches(B, [[code, onlyB]]); await sync(B); await sync(A)
  const ob = (await siteCks()).find((c) => String(c.time).startsWith(onlyB))
  if (ob) created.push(['Employee Checkin', ob.name])
  check('two PCs: punch read on PC B shows on PC A after its sync', (await one(A, 'SELECT COUNT(*) FROM punches WHERE ts = ?', [onlyB])) === 1)

  // ── 6. setup edited on the site ──
  try {
    const company = (await list('Company', ['name']))[0].name
    const parent = (await list('Department', ['name'], [['is_group', '=', 1], ['parent_department', 'in', ['', null]]]))[0]
    const dep = await api('POST', res('Department'), { department_name: 'LIVETEST قسم', parent_department: parent?.name, company })
    created.push(['Department', dep.name])
    await sync(A)
    check('site adds a department → appears in the app', (await one(A, 'SELECT name_ar FROM departments WHERE web_id = ?', [dep.name])) === 'LIVETEST قسم')
    await api('PUT', res('Department', dep.name), { department_name: 'LIVETEST قسم معدل' })
    await sync(A)
    const renamed = await one(A, 'SELECT name_ar FROM departments WHERE web_id = ?', [dep.name])
    check('site renames it → renamed in the app', renamed === 'LIVETEST قسم معدل', renamed)
    await api('DELETE', res('Department', dep.name)); created.pop()
    await sync(A)
    check('site deletes it → gone from the app', !(await one(A, 'SELECT COUNT(*) FROM departments WHERE web_id = ?', [dep.name])))
  } catch (e) { skipped('site-side department add/rename/delete', e.message) }

  try {
    const st = await api('POST', res('Shift Type'), { name: 'LIVETEST دوام', start_time: '08:00:00', end_time: '16:00:00', late_entry_grace_period: 10 })
    created.push(['Shift Type', st.name])
    await sync(A)
    const w = await q(A, "SELECT w.check_in, w.check_out, w.late_min, w.is_off FROM shift_windows w JOIN shift_groups g ON g.id = w.group_id WHERE g.web_id = ? AND w.calendar = 'Y' ORDER BY w.slot", [st.name])
    check('site adds a shift → app has it with a weekly timetable (08:00–16:00, grace 10)', w.length === 7 && w.filter((x) => !x.is_off).every((x) => x.check_in === '08:00' && x.check_out === '16:00' && x.late_min === 10), JSON.stringify(w.slice(0, 2)))
  } catch (e) { skipped('site-side shift type add', e.message) }

  // ── 7. punch edited / deleted on the site ──
  const vict = (await siteCks()).find((c) => String(c.time).startsWith(`${TEST_DAY} 07:00:00`))
  await api('DELETE', res('Employee Checkin', vict.name))
  created.splice(created.findIndex((x) => x[1] === vict.name), 1)
  await sync(A)
  const still = await one(A, 'SELECT COUNT(*) FROM punches WHERE web_id = ?', [vict.name])
  check('site deletes a punch → removed from the app too', !still, 'app still counts the deleted punch in attendance')
  const moved = (await siteCks()).find((c) => String(c.time).startsWith(`${TEST_DAY} 07:00:07`))
  let editable = true
  try { await api('PUT', res('Employee Checkin', moved.name), { time: `${TEST_DAY} 05:55:55` }) } catch (e) { editable = false; skipped('site edits a punch time', e.message) }
  if (editable) {
    await sync(A)
    const t = await one(A, 'SELECT ts FROM punches WHERE web_id = ?', [moved.name])
    check('site edits a punch time → app follows', t === `${TEST_DAY} 05:55:55`, `app still has ${t}`)
  }

  // ── 8. unlink, edit locally, relink ──
  const counts = async () => JSON.stringify(await q(A, "SELECT (SELECT COUNT(*) FROM employees) e, (SELECT COUNT(*) FROM departments) d, (SELECT COUNT(*) FROM shift_groups) g, (SELECT COUNT(*) FROM punches) p"))
  const c0 = await counts()
  await A.evaluate(async () => { await window.bridge.webSetConfig(null); WebSync.linked = false; clearInterval(WebSync.timer) })
  check('unlinked: setup editable again', !(await A.evaluate(() => WebSync.blocks('employees'))))
  await A.evaluate(async (c) => { await window.bridge.webSetConfig(c); await WebSync.init(false) }, { url: RELAY, key: C.key, secret: C.secret })
  await sync(A)
  check('relink: nothing duplicated or wiped', (await counts()) === c0, `${c0} → ${await counts()}`)

  check('no page errors', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors].join(' | '))
} catch (e) {
  check('scenarios ran to the end', false, e.stack)
} finally {
  // ── clean the site ──
  const left = target ? (await siteCks().catch(() => [])).map((c) => ['Employee Checkin', c.name]) : []
  const all = [...new Map([...created, ...left].map((x) => [x[1], x])).values()].reverse()
  let removed = 0
  for (let i = 0; i < all.length; i += 10) {
    await Promise.all(all.slice(i, i + 10).map(async ([dt, n]) => {
      try { await api('DELETE', res(dt, n)); removed++ } catch (e) { if (!/404/.test(e.message)) console.log(`cleanup: COULD NOT REMOVE ${dt} ${n} (${e.message})`) }
    }))
  }
  console.log(`cleanup: removed ${removed} test records from the site`)
  for (const [app, ud] of apps) { await app.close().catch(() => {}); fs.rmSync(ud, { recursive: true, force: true }) }
  relay.close()
}

console.log('\nTimings (ms):'); for (const [k, v] of Object.entries(timings)) console.log(`  ${k.padEnd(28)} ${v}`)
console.log(`\n${pass}/${pass + fail} passed, ${skip} skipped`)
process.exit(fail ? 1 : 0)
