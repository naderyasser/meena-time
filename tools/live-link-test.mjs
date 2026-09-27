// Live link test: the real app against the real site (tamken3). Links a fresh
// database, then measures how closely the two match: every site record that
// should come down is compared by id with what the app stored, a punch taken
// in the app goes up, a punch made on the site comes down, a second sync
// changes nothing, and each leg is timed. The test punches are removed from
// the site at the end.
//   xvfb-run -a node tools/live-link-test.mjs [creds.json]
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'

const ROOT = '/root/meena-time', UD = '/tmp/mt-livetest'
const C = JSON.parse(fs.readFileSync(process.argv[2] || '/root/meena-time-keys-backup/tamken3-api.json'))
const H = { Authorization: `token ${C.key}:${C.secret}`, Accept: 'application/json', 'Content-Type': 'application/json' }
const api = async (method, path, body) => {
  const r = await fetch(C.url + path, { method, headers: H, body: body && JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} → ${r.status} ${j.exc_type || ''}`)
  return j.data ?? j.message
}
const list = (dt, fields, filters = []) => api('GET', `/api/resource/${encodeURIComponent(dt)}?fields=${encodeURIComponent(JSON.stringify(fields))}&filters=${encodeURIComponent(JSON.stringify(filters))}&limit_page_length=0`)

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : '  → ' + extra}`) }
const timings = {}
const timed = async (k, f) => { const t = Date.now(); const r = await f(); timings[k] = Date.now() - t; return r }
const sameSet = (a, b) => { const A = new Set(a), B = new Set(b); return { missing: [...B].filter((x) => !A.has(x)), extra: [...A].filter((x) => !B.has(x)) } }
const setCheck = (name, local, site) => { const d = sameSet(local, site); check(`${name}: ${site.length} on site = ${local.length} in app`, !d.missing.length && !d.extra.length, `missing ${d.missing.length}, extra ${d.extra.length}`); return d }

const day = (off) => new Date(Date.now() + off * 864e5).toISOString().slice(0, 10)
const TEST_DAY = day(-100) // inside the app's 120-day pull window, far from today's attendance
const sitePunches = [] // names to remove at the end

fs.rmSync(UD, { recursive: true, force: true })
const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p = await app.firstWindow()
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
const dlgBtn = (name) => p.locator('.dlg-backdrop').last().getByRole('button', { name })
const q = (sql, a = []) => p.evaluate(([sql, a]) => DB.all(sql, a), [sql, a])
const col = async (sql, a) => (await q(sql, a)).map((r) => Object.values(r)[0])
const sync = () => p.evaluate(async () => { const r = await WebSync.sync({ quiet: true }); return { r, failed: WebSync.pushFailed || 0, err: WebSync.pushError || '', status: document.getElementById('sync-status')?.textContent } })

try {
  await p.waitForSelector('text=شاشة الدخول')
  await p.locator('#user').fill('أ'); await dlgBtn('موافق').click()
  await p.locator('#np1').fill('1234'); await p.locator('#np2').fill('1234'); await dlgBtn('حفظ').click()
  await p.waitForSelector('#home')

  // ── link through the real dialog ──
  await p.locator('#menubar .menu > button', { hasText: 'الإعدادات' }).first().click()
  await p.locator('.menu.open .drop button', { hasText: 'الربط بالموقع' }).first().click()
  await p.locator('#wl-url').fill(C.url); await p.locator('#wl-key').fill(C.key); await p.locator('#wl-secret').fill(C.secret)
  await timed('connection test', async () => { await dlgBtn('اختبار الاتصال').click(); await p.locator('.dlg-backdrop').last().locator('.err').filter({ hasText: /ناجح|غير|تعذ|خطأ/ }).waitFor() })
  const conn = await p.locator('.dlg-backdrop').last().locator('.err').textContent()
  check('connection test succeeds', /الاتصال ناجح/.test(conn), conn)
  await dlgBtn('حفظ وربط').click()
  if (await dlgBtn('نعم').isVisible({ timeout: 1500 }).catch(() => false)) await dlgBtn('نعم').click()
  await timed('first sync (full pull)', async () => { await p.locator('.dlg-backdrop .body', { hasText: /تمت المزامنة|تعذّرت/ }).waitFor({ timeout: 120000 }) })
  const msg = await p.locator('.dlg-backdrop .body').last().textContent()
  check('first sync completes', /تمت المزامنة/.test(msg), msg)
  await dlgBtn('موافق').click()

  // ── site truth, read independently ──
  const [deps, emps, shifts, sas, leaves, perms, holLists, cks] = await Promise.all([
    list('Department', ['name', 'parent_department', 'is_group']),
    list('Employee', ['name', 'attendance_device_id', 'status', 'department', 'default_shift']),
    list('Shift Type', ['name', 'custom_shift_kind']),
    list('Shift Assignment', ['name', 'employee', 'shift_type', 'start_date'], [['docstatus', '=', 1], ['status', '=', 'Active']]),
    list('Leave Application', ['name'], [['docstatus', '=', 1], ['status', '=', 'Approved']]),
    list('Permission Request', ['name'], [['docstatus', '=', 1], ['status', '=', 'Approved']]).catch(() => []),
    list('Holiday List', ['name']),
    list('Employee Checkin', ['name', 'employee', 'time'], [['time', '>=', `${day(-120)} 00:00:00`]]),
  ])
  const codeOf = (e) => String(e.attendance_device_id || e.name).trim()

  // ── data parity, record by record ──
  const roots = new Set(deps.filter((d) => d.is_group && !d.parent_department).map((d) => d.name))
  const depsExpected = deps.filter((d) => !roots.has(d.name) && !(d.is_group && roots.has(d.parent_department) && /all/i.test(d.name))).map((d) => d.name)
  setCheck('departments', await col('SELECT web_id FROM departments WHERE web_id IS NOT NULL'), depsExpected)
  setCheck('employees', await col('SELECT web_id FROM employees WHERE web_id IS NOT NULL'), emps.map((e) => e.name))
  const localEmp = Object.fromEntries((await q('SELECT e.web_id, e.code, e.status, d.web_id dep FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.web_id IS NOT NULL')).map((r) => [r.web_id, r]))
  const STATUS = { Active: 'نشط', Inactive: 'غير نشط', Suspended: 'موقوف', Left: 'منتهي' }
  const fieldBad = emps.filter((e) => { const l = localEmp[e.name]; return !l || l.code !== codeOf(e) || l.status !== STATUS[e.status] || (depsExpected.includes(e.department) && l.dep !== e.department) })
  check(`employee fields (code, status, department): ${emps.length - fieldBad.length}/${emps.length} match`, !fieldBad.length, fieldBad.map((e) => e.name).join(','))
  setCheck('shift types (non-rotational)', await col("SELECT web_id FROM shift_groups WHERE web_id IS NOT NULL AND web_id <> '__rest'"), shifts.filter((s) => s.custom_shift_kind !== 'Rotational').map((s) => s.name))
  const noWindows = await col("SELECT g.web_id FROM shift_groups g WHERE g.web_id IS NOT NULL AND g.web_id <> '__rest' AND NOT EXISTS (SELECT 1 FROM shift_windows w WHERE w.group_id = g.id)")
  check('every pulled shift has its weekly timetable', !noWindows.length, noWindows.join(','))
  // shift history: each assignment → a dated row for that employee with that shift
  const hist = new Set((await q("SELECT e.web_id emp, s.from_date, g.web_id grp FROM employee_shifts s JOIN employees e ON e.id = s.employee_id JOIN shift_groups g ON g.id = s.group_id")).map((r) => `${r.emp}|${r.from_date}|${r.grp}`))
  const saNonRot = sas.filter((a) => shifts.find((s) => s.name === a.shift_type)?.custom_shift_kind !== 'Rotational')
  const saMissing = saNonRot.filter((a) => !hist.has(`${a.employee}|${a.start_date}|${a.shift_type}`))
  check(`shift assignments → shift history: ${saNonRot.length - saMissing.length}/${saNonRot.length}`, !saMissing.length, saMissing.map((a) => a.name).join(','))
  const defMissing = emps.filter((e) => e.default_shift && shifts.find((s) => s.name === e.default_shift)?.custom_shift_kind !== 'Rotational' && ![...hist].some((h) => h.startsWith(`${e.name}|`) && h.endsWith(`|${e.default_shift}`)))
  check('default shifts present in shift history', !defMissing.length, defMissing.map((e) => e.name).join(','))
  setCheck('approved leaves', await col('SELECT web_id FROM leaves WHERE web_id IS NOT NULL'), leaves.map((l) => l.name))
  setCheck('approved permissions', await col('SELECT web_id FROM permissions WHERE web_id IS NOT NULL'), perms.map((x) => x.name))
  const localCk = Object.fromEntries((await q("SELECT web_id, emp_code, ts FROM punches WHERE web_id IS NOT NULL AND web_id <> 'dup'")).map((r) => [r.web_id, r]))
  const empCode = Object.fromEntries(emps.map((e) => [e.name, codeOf(e)]))
  const ckBad = cks.filter((c) => { const l = localCk[c.name]; return !l || l.emp_code !== empCode[c.employee] || l.ts !== String(c.time).slice(0, 19) })
  check(`site punches (last 120 days) in the app, same employee + time: ${cks.length - ckBad.length}/${cks.length}`, !ckBad.length, ckBad.map((c) => c.name).join(','))
  check('holiday lists read', holLists.length > 0)

  // ── desktop → site ──
  const target = emps.find((e) => e.status === 'Active')
  const upTs = `${TEST_DAY} 03:17:${String(new Date().getSeconds()).padStart(2, '0')}`
  await p.evaluate(async ([code, ts]) => { DB.run("INSERT INTO punches (emp_code, ts, source) VALUES (?, ?, 'manual'), ('LIVETEST-NOBODY', ?, 'manual')", [code, ts, ts]); await DB.flush() }, [codeOf(target), upTs])
  const s2 = await timed('sync with 1 punch to push', sync)
  const upLocal = (await q('SELECT web_id FROM punches WHERE emp_code = ? AND ts = ?', [codeOf(target), upTs]))[0]
  const upSite = await list('Employee Checkin', ['name', 'employee', 'time', 'device_id', 'custom_client_ref'], [['employee', '=', target.name], ['time', '=', upTs]])
  if (upSite[0]) sitePunches.push(upSite[0].name)
  check('app punch reached the site once', upSite.length === 1 && s2.failed === 0, JSON.stringify({ n: upSite.length, failed: s2.failed, err: s2.err }))
  check('site copy tagged as coming from the app', upSite[0]?.device_id === 'Meena Time' && /^meena-time:/.test(upSite[0]?.custom_client_ref || ''), JSON.stringify(upSite[0]))
  check('app punch now linked to its site record', upLocal?.web_id && upLocal.web_id === upSite[0]?.name, JSON.stringify(upLocal))
  check('punch of an employee unknown to the site stays local', (await col("SELECT COUNT(*) FROM punches WHERE emp_code = 'LIVETEST-NOBODY' AND web_id IS NULL"))[0] === 1)

  // ── site → desktop (a punch recorded on the site, e.g. mobile / another device) ──
  const downTs = `${TEST_DAY} 03:47:${String(new Date().getSeconds()).padStart(2, '0')}`
  const made = (await api('POST', '/api/method/base_meena.biometric_management.desktop_sync.push_checkins', { punches: [{ employee: target.name, time: downTs }] }))[0]
  if (made?.name) sitePunches.push(made.name)
  check('site-side punch created', !!made?.name, JSON.stringify(made))
  await timed('sync pulling 1 new site punch', sync)
  const down = (await q('SELECT source, web_id FROM punches WHERE emp_code = ? AND ts = ?', [codeOf(target), downTs]))
  check('site punch arrived in the app once, linked', down.length === 1 && down[0].web_id === made?.name, JSON.stringify(down))

  // ── idempotency: nothing new on either side ──
  const before = { local: (await col('SELECT COUNT(*) FROM punches'))[0], site: (await list('Employee Checkin', ['name'], [['employee', '=', target.name], ['time', 'between', [`${TEST_DAY} 00:00:00`, `${TEST_DAY} 23:59:59`]]])).length }
  const s4 = await timed('idle sync (nothing changed)', sync)
  const after = { local: (await col('SELECT COUNT(*) FROM punches'))[0], site: (await list('Employee Checkin', ['name'], [['employee', '=', target.name], ['time', 'between', [`${TEST_DAY} 00:00:00`, `${TEST_DAY} 23:59:59`]]])).length }
  check('repeat sync creates no duplicates (app / site)', before.local === after.local && before.site === after.site && s4.r?.punches === 0, JSON.stringify({ before, after, new: s4.r?.punches }))
  check('status chip shows linked, no failures', /مرتبط بالموقع/.test(s4.status) && !/لم تُرفع/.test(s4.status), s4.status)

  // ── site-owned screens are locked while linked ──
  check('site-owned tables blocked from local edits', await p.evaluate(() => { const r = WebSync.blocks('employees') && WebSync.blocks('shift_groups'); document.querySelector('.dlg-backdrop:last-of-type button')?.click(); return r }))
  check('no page errors', !errors.length, errors.join(' | '))
} catch (e) {
  check('test ran to the end', false, e.stack)
} finally {
  // ── clean the site ──
  for (const n of sitePunches) {
    try { await api('DELETE', `/api/resource/Employee%20Checkin/${encodeURIComponent(n)}`); console.log(`cleanup: removed ${n}`) } catch (e) { console.log(`cleanup: COULD NOT REMOVE ${n} (${e.message}) — remove it on the site`) }
  }
  await app.close().catch(() => {})
  fs.rmSync(UD, { recursive: true, force: true })
}

console.log('\nTimings (ms):'); for (const [k, v] of Object.entries(timings)) console.log(`  ${k.padEnd(32)} ${v}`)
console.log(`\n${pass}/${pass + fail} passed — link parity ${Math.round((100 * pass) / (pass + fail))}%`)
process.exit(fail ? 1 : 0)
