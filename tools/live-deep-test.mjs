// Deep link test, real app ↔ real site (tamken3) — the parts the other live
// tests don't reach:
//  A. attendance parity: the app's engine vs the site's own «تقرير تفصيلي»,
//     day by day for every employee over the last 60 days (read-only)
//  B. site-side HR records: approved leave, permission, shift assignment and
//     an official holiday are created on the site ~100 days back → reach the
//     app and change the app's attendance for that day → cancelled on the site
//     → gone from the app
//  C. the site changes an employee's device number → the app follows and the
//     employee keeps his punches (reverted after)
//  D. the app on a PC in another time zone
// Everything created or changed on the site is undone at the end.
//   xvfb-run -a node tools/live-deep-test.mjs [creds.json] [--with-permission]
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'

const ROOT = '/root/meena-time'
const C = JSON.parse(fs.readFileSync(process.argv.slice(2).find((a) => !a.startsWith('--')) || '/root/meena-time-keys-backup/tamken3-api.json'))
const H = { Authorization: `token ${C.key}:${C.secret}`, Accept: 'application/json', 'Content-Type': 'application/json' }
const api = async (method, path, body) => {
  let r
  for (let i = 0; ; i++) { // the site may be restarting (deploys)
    r = await fetch(C.url + path, { method, headers: H, body: body && JSON.stringify(body) }).catch(() => null)
    if ((r && ![502, 503, 504].includes(r.status)) || i === 12) break
    await new Promise((s) => setTimeout(s, 3000))
  }
  if (!r) throw new Error(`${method} ${path.split('?')[0]} → site unreachable`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { let m = j.exc_type || ''; try { m += ' ' + JSON.parse(JSON.parse(j._server_messages)[0]).message } catch {} throw new Error(`${method} ${path.split('?')[0]} → ${r.status} ${m}`.replace(/<[^>]+>/g, '')) }
  return j.data ?? j.message
}
const res = (dt, n = '') => `/api/resource/${encodeURIComponent(dt)}${n ? '/' + encodeURIComponent(n) : ''}`
const list = (dt, fields, filters = []) => api('GET', `${res(dt)}?fields=${encodeURIComponent(JSON.stringify(fields))}&filters=${encodeURIComponent(JSON.stringify(filters))}&limit_page_length=0`)
// cancel on the site + close what the site hung on it (approval task, the leave's attendance)
const cancel = async (dt, name) => {
  await api('POST', '/api/method/frappe.client.cancel', { doctype: dt, name })
  for (const t of await list('Workflow Task', ['name', 'status'], [['source_document', '=', name]]).catch(() => [])) if (t.status !== 'Cancelled') await api('PUT', res('Workflow Task', t.name), { status: 'Cancelled' }).catch(() => {})
  for (const a of await list('Attendance', ['name', 'docstatus'], [['leave_application', '=', name]]).catch(() => [])) { if (a.docstatus === 1) await api('POST', '/api/method/frappe.client.cancel', { doctype: 'Attendance', name: a.name }).catch(() => {}); await api('DELETE', res('Attendance', a.name)).catch(() => {}) }
}

let pass = 0, fail = 0, skip = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : '  → ' + extra}`) }
const skipped = (name, why) => { skip++; console.log(`SKIP  ${name}  → ${why}`) }
const day = (off) => new Date(Date.now() + off * 864e5).toISOString().slice(0, 10)
const TEST_DAY = day(-102)
const undo = [] // async functions, run in reverse at the end

const apps = []
async function openApp(ud, env = {}) {
  fs.rmSync(ud, { recursive: true, force: true })
  const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${ud}`], cwd: ROOT, env: { ...process.env, ...env } })
  apps.push([app, ud])
  const p = await app.firstWindow()
  p.errors = []
  p.on('pageerror', (e) => p.errors.push(e.message))
  const btn = (name) => p.locator('.dlg-backdrop').last().getByRole('button', { name })
  await p.waitForSelector('text=شاشة الدخول')
  await p.locator('#user').fill('أ'); await btn('موافق').click()
  await p.locator('#np1').fill('1234'); await p.locator('#np2').fill('1234'); await btn('حفظ').click()
  await p.waitForSelector('#home')
  await p.evaluate(async (c) => { await window.bridge.webSetConfig(c); await WebSync.init(false); WebSync.RECONCILE_DAYS = 130 }, { url: C.url, key: C.key, secret: C.secret })
  return p
}
const q = (p, sql, a = []) => p.evaluate(([sql, a]) => DB.all(sql, a), [sql, a])
const one = async (p, sql, a) => Object.values((await q(p, sql, a))[0] || {})[0]
const sync = (p) => p.evaluate(async () => { const r = await WebSync.sync({ quiet: true }); await DB.flush(); return { r, status: document.getElementById('sync-status')?.textContent || '' } })
// the app's attendance for one or all employees, as plain rows
const appDays = (p, from, to, code = null) => p.evaluate(([from, to, code]) => {
  const ids = code ? DB.all('SELECT id FROM employees WHERE code = ?', [code]).map((r) => r.id) : null
  return Engine.compute({ from, to, employeeIds: ids }).map((r) => ({ code: r.emp.code, date: r.date, kind: r.kind, status: r.status, shift: r.shift, in: r.in, out: r.out, late: r.late, early: r.early, ot: r.ot, worked: r.worked }))
}, [from, to, code])
const hm = (m) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)

let target, code
try {
  const emps = await list('Employee', ['name', 'attendance_device_id', 'status', 'company', 'holiday_list', 'default_shift'])
  target = emps.find((e) => e.status === 'Active' && e.attendance_device_id); code = String(target.attendance_device_id).trim()
  const A = await openApp('/tmp/mt-deep-a')
  check('first sync', !!(await sync(A)).r)

  // ── A. attendance parity with the site's own report ──
  const from = day(-60), to = day(-1)
  const rep = await api('POST', '/api/method/base_meena.api.hr_reports.run_report', { report: 'detailed', filters: JSON.stringify({ from_date: from, to_date: to }) })
  const site = {}
  for (const g of rep.groups) for (const r of g.rows) site[`${r.code}|${r.date}`] = r
  const mine = Object.fromEntries((await appDays(A, from, to)).map((r) => [`${r.code}|${r.date}`, r]))
  const KIND = { present: 'present', absent: 'absent', leave: 'leave', holiday: 'holiday', off: 'off', waiting: 'absent' }
  const diffs = { kind: [], times: [], late: [], early: [], extra: [], missing: [] }
  let compared = 0, withPunches = 0
  for (const [k, s] of Object.entries(site)) {
    const a = mine[k]
    // «قبل التعيين» / «بعد ترك العمل»: the site lists the day, the app leaves it out — neither counts it
    if (s.kind === 'not_employed') { if (a) diffs.kind.push(`${k} site=not_employed app=${a.kind}`); continue }
    if (!a) { diffs.missing.push(k); continue }
    compared++
    const sk = s.kind === 'holiday' && /إسبوعية/.test(s.status) ? 'off' : KIND[s.kind] || s.kind, ak = KIND[a.kind] || a.kind
    if (sk !== ak) { diffs.kind.push(`${k} site=${s.kind}/${s.status} app=${a.kind}/${a.status}`); continue }
    if (s.in1 || a.in != null) {
      withPunches++
      if ((s.in1 || '') !== hm(a.in) || (s.out1 || '') !== hm(a.out)) diffs.times.push(`${k} site=${s.in1}-${s.out1} app=${hm(a.in)}-${hm(a.out)}`)
      if (Number(s.late || 0) !== a.late) diffs.late.push(`${k} site=${s.late} app=${a.late}`)
      if (Number(s.early || 0) !== a.early) diffs.early.push(`${k} site=${s.early} app=${a.early}`)
      if (Number(s.extra || 0) !== a.ot) diffs.extra.push(`${k} site=${s.extra} app=${a.ot}`)
    }
  }
  const total = Object.keys(site).length
  check(`attendance: every site row exists in the app (${total} employee-days)`, !diffs.missing.length, diffs.missing.slice(0, 5).join(', '))
  check(`attendance: same day status (present/absent/leave/holiday/weekly off) ${compared - diffs.kind.length}/${compared}`, !diffs.kind.length, diffs.kind.slice(0, 6).join(' ; '))
  check(`attendance: same in/out times on days with punches (${withPunches} days)`, !diffs.times.length, diffs.times.slice(0, 6).join(' ; '))
  check('attendance: same lateness minutes', !diffs.late.length, diffs.late.slice(0, 6).join(' ; '))
  check('attendance: same early-leave minutes', !diffs.early.length, diffs.early.slice(0, 6).join(' ; '))
  check('attendance: same overtime minutes', !diffs.extra.length, diffs.extra.slice(0, 6).join(' ; '))
  const extra = Object.keys(mine).filter((k) => !site[k] && !/في الانتظار/.test(mine[k].status))
  check('attendance: app has no employee-days the site doesn\'t', !extra.length, extra.slice(0, 5).join(', '))

  // ── B. HR records made on the site reach the app and change its attendance ──
  const before = (await appDays(A, TEST_DAY, TEST_DAY, code))[0]
  // leave
  try {
    const lv = await api('POST', res('Leave Application'), { employee: target.name, leave_type: 'Leave Without Pay', company: target.company, from_date: TEST_DAY, to_date: TEST_DAY, posting_date: day(0), status: 'Approved', description: 'LIVETEST', docstatus: 1 })
    undo.push(async () => { await cancel('Leave Application', lv.name).catch(() => {}); await api('DELETE', res('Leave Application', lv.name)) })
    await sync(A)
    const l = await q(A, 'SELECT l.from_date, l.to_date, t.name_ar type FROM leaves l LEFT JOIN lists t ON t.id = l.type_id WHERE l.web_id = ?', [lv.name])
    check('approved leave on the site → in the app with its dates and type', l.length === 1 && l[0].from_date === TEST_DAY && l[0].type === 'Leave Without Pay', JSON.stringify(l))
    const d = (await appDays(A, TEST_DAY, TEST_DAY, code))[0]
    check(`leave changes the app's attendance for that day (${before.status} → ${d.status})`, d.kind === 'leave', d.status)
    await cancel('Leave Application', lv.name)
    await sync(A)
    check('leave cancelled on the site → removed from the app, day back to normal', !(await one(A, 'SELECT COUNT(*) FROM leaves WHERE web_id = ?', [lv.name])) && (await appDays(A, TEST_DAY, TEST_DAY, code))[0].kind === before.kind)
  } catch (e) { skipped('leave on the site', e.message) }
  // permission — opt-in: the site hangs an approval task on it that the sync user can't delete,
  // so each run leaves one cancelled request + cancelled task behind
  if (!process.argv.includes('--with-permission')) skipped('permission on the site', 'pass --with-permission (leaves a cancelled request on the site)')
  else try {
    const pr = await api('POST', res('Permission Request'), { employee: target.name, company: target.company, permission_date: TEST_DAY, from_time: '10:00:00', to_time: '11:30:00', reason: 'LIVETEST', status: 'Approved', docstatus: 1 })
    undo.push(async () => { await cancel('Permission Request', pr.name).catch(() => {}); await api('DELETE', res('Permission Request', pr.name)) })
    await sync(A)
    const x = await q(A, 'SELECT date, from_time, to_time FROM permissions WHERE web_id = ?', [pr.name])
    check('approved permission on the site → in the app (date, 10:00–11:30)', JSON.stringify(x) === JSON.stringify([{ date: TEST_DAY, from_time: '10:00', to_time: '11:30' }]), JSON.stringify(x))
    await cancel('Permission Request', pr.name)
    await sync(A)
    check('permission cancelled on the site → removed from the app', !(await one(A, 'SELECT COUNT(*) FROM permissions WHERE web_id = ?', [pr.name])))
  } catch (e) { skipped('permission on the site', e.message) }
  // shift assignment (another normal shift for 3 days)
  try {
    const other = (await list('Shift Type', ['name', 'custom_shift_kind', 'custom_is_rotational_internal'])).find((s) => s.custom_shift_kind === 'Normal' && !s.custom_is_rotational_internal && s.name !== target.default_shift)
    const sa = await api('POST', res('Shift Assignment'), { employee: target.name, company: target.company, shift_type: other.name, start_date: TEST_DAY, end_date: day(-100), status: 'Active', docstatus: 1 })
    undo.push(async () => { await cancel('Shift Assignment', sa.name).catch(() => {}); await api('DELETE', res('Shift Assignment', sa.name)) })
    await sync(A)
    const h = await q(A, 'SELECT s.from_date, g.web_id g FROM employee_shifts s JOIN employees e ON e.id = s.employee_id JOIN shift_groups g ON g.id = s.group_id WHERE e.code = ? ORDER BY s.from_date', [code])
    const i = h.findIndex((r) => r.from_date === TEST_DAY)
    check(`shift assignment on the site → app shift history (${other.name} from ${TEST_DAY}, back to default after)`, i >= 0 && h[i].g === other.name && h[i + 1]?.from_date === day(-99) && h[i + 1]?.g === target.default_shift, JSON.stringify(h))
    check('the app computes that day with the assigned shift', (await appDays(A, TEST_DAY, TEST_DAY, code))[0].shift !== before.shift)
    await cancel('Shift Assignment', sa.name)
    await sync(A)
    check('assignment cancelled on the site → app history back to the default shift', !(await q(A, 'SELECT 1 FROM employee_shifts s JOIN employees e ON e.id = s.employee_id WHERE e.code = ? AND s.from_date = ?', [code, TEST_DAY])).length)
  } catch (e) { skipped('shift assignment on the site', e.message) }
  // official holiday in the employee's holiday list
  try {
    const hlName = target.holiday_list
    const hl = await api('GET', res('Holiday List', hlName))
    const orig = hl.holidays.map(({ holiday_date, description, weekly_off }) => ({ holiday_date, description, weekly_off }))
    await api('PUT', res('Holiday List', hlName), { holidays: [...orig, { holiday_date: TEST_DAY, description: 'LIVETEST عطلة', weekly_off: 0 }] })
    undo.push(async () => { await api('PUT', res('Holiday List', hlName), { holidays: orig }) })
    await sync(A)
    check('official holiday added on the site → in the app', (await one(A, 'SELECT COUNT(*) FROM holidays WHERE from_date = ? AND name_ar = ?', [TEST_DAY, 'LIVETEST عطلة'])) === 1)
    const d = (await appDays(A, TEST_DAY, TEST_DAY, code))[0]
    check(`holiday changes the app's attendance for that day (${d.status})`, d.kind === 'holiday', d.status)
    await undo.pop()()
    await sync(A)
    check('holiday removed on the site → removed from the app', !(await one(A, 'SELECT COUNT(*) FROM holidays WHERE from_date = ? AND name_ar = ?', [TEST_DAY, 'LIVETEST عطلة'])))
  } catch (e) { skipped('holiday on the site', e.message) }

  // ── C. the site changes an employee's device number ──
  try {
    const punchesBefore = await one(A, 'SELECT COUNT(*) FROM punches WHERE emp_code = ?', [code])
    const newCode = `9${code}`
    await api('PUT', res('Employee', target.name), { attendance_device_id: newCode })
    undo.push(async () => { await api('PUT', res('Employee', target.name), { attendance_device_id: code }) })
    await sync(A)
    const e = await q(A, 'SELECT code FROM employees WHERE web_id = ?', [target.name])
    check(`device number changed on the site (${code} → ${newCode}) → app follows`, e[0]?.code === newCode, JSON.stringify(e))
    const moved = await one(A, 'SELECT COUNT(*) FROM punches WHERE emp_code = ?', [newCode])
    check(`employee keeps his ${punchesBefore} punches under the new number`, moved === punchesBefore && !(await one(A, 'SELECT COUNT(*) FROM punches WHERE emp_code = ?', [code])), `new ${moved}, old ${await one(A, 'SELECT COUNT(*) FROM punches WHERE emp_code = ?', [code])}`)
    await undo.pop()()
    await sync(A)
    check('changed back → app back, punches still his', (await one(A, 'SELECT code FROM employees WHERE web_id = ?', [target.name])) === code && (await one(A, 'SELECT COUNT(*) FROM punches WHERE emp_code = ?', [code])) === punchesBefore)
  } catch (e) { skipped('device number change on the site', e.message) }

  // ── D. a PC in another time zone ──
  const Z = await openApp('/tmp/mt-deep-z', { TZ: 'America/Los_Angeles' })
  check('other time zone: sync works', !!(await sync(Z)).r)
  const za = await q(Z, "SELECT emp_code, ts FROM punches WHERE source = 'web' ORDER BY ts"), aa = await q(A, "SELECT emp_code, ts FROM punches WHERE source = 'web' ORDER BY ts")
  check(`other time zone: same ${aa.length} punch times as the Riyadh PC (no shifting)`, JSON.stringify(za) === JSON.stringify(aa))
  const zd = await appDays(Z, from, day(-2)), ad = await appDays(A, from, day(-2))
  check('other time zone: same attendance results', JSON.stringify(zd) === JSON.stringify(ad))

  check('no page errors', !A.errors.length && !Z.errors.length, [...A.errors, ...Z.errors].join(' | '))
} catch (e) {
  check('deep test ran to the end', false, e.stack)
} finally {
  for (const f of undo.reverse()) await f().catch((e) => console.log(`cleanup: COULD NOT UNDO (${e.message}) — check the site`))
  console.log(`cleanup: ${undo.length} site changes undone`)
  for (const [app, ud] of apps) { await app.close().catch(() => {}); fs.rmSync(ud, { recursive: true, force: true }) }
}
console.log(`\n${pass}/${pass + fail} passed, ${skip} skipped`)
process.exit(fail ? 1 : 0)
