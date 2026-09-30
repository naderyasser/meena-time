// «إعدادات النظام» — every rule in the engine + the settings window + automatic read/post.
// Run: xvfb-run -a node tools/settings-test.mjs
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
const ROOT = '/root/meena-time', UD = '/tmp/mt-settingstest'
fs.rmSync(UD, { recursive: true, force: true })
const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p = await app.firstWindow()
await p.waitForSelector('text=شاشة الدخول', { timeout: 20000 })
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

// one employee, 1 shift 08:00–16:00 (grace 0) every day, two periods on day 2
await p.evaluate(() => {
  DB.run('BEGIN')
  DB.run("INSERT INTO shift_groups (id, name_ar) VALUES (1, 'صباحي')")
  for (let d = 0; d < 7; d++) {
    DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out)
      VALUES (1, 'Y', ${d}, 1, 0, '06:00','08:00',0,'11:00','11:30',0,'${d === 2 ? '12:00' : '16:00'}','${d === 2 ? '12:30' : '20:00'}')`)
    if (d === 2) DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out)
      VALUES (1, 'Y', 2, 2, 0, '12:31','13:00',0,'14:00','14:30',0,'17:00','21:00')`)
  }
  DB.run("INSERT INTO employees (id, code, name_ar, shift_group_id, hire_date, ot_before, ot_after) VALUES (1, '1', 'موظف', 1, '2026-01-01', 1, 1)")
  DB.run("INSERT INTO employee_shifts (employee_id, group_id, from_date) VALUES (1, 1, '2026-01-01')")
  DB.run('COMMIT')
})
const day = (dow) => p.evaluate((dow) => { let d = '2026-06-01'; while (Engine.DAY_INDEX(d) !== dow) d = Engine.addDays(d, 1); return d }, dow)
const D0 = await day(0), D2 = await day(2) // D2 = the two-period day
const setPunches = (date, times) => p.evaluate(({ date, times }) => {
  DB.run('DELETE FROM punches'); for (const t of times) DB.run("INSERT INTO punches (emp_code, ts, source) VALUES ('1', ?, 'device')", [`${date} ${t}:00`])
}, { date, times })
const setS = (s) => p.evaluate((s) => DB.run("INSERT INTO meta (key, value) VALUES ('sys_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(s)]), s)
const row = (date) => p.evaluate((date) => { const r = Engine.compute({ from: date, to: date })[0]; return { kind: r.kind, in: Engine.hm(r.in), out: Engine.hm(r.out), late: r.late, early: r.early, ot: r.ot, punches: r.punches.length } }, date)

// defaults = old behaviour
await setS({})
await setPunches(D0, ['07:40', '16:25'])
let r = await row(D0)
check('defaults: OT before 20 + after 25 = 45', r.ot === 45, JSON.stringify(r))

// ignore window
await setPunches(D0, ['07:58', '08:03', '16:00'])
await setS({ ignore_min: 10 })
r = await row(D0)
check('ignore 10 min: 08:03 dropped, in 07:58', r.in === '07:58' && r.punches === 2, JSON.stringify(r))
await setS({ ignore_min: 0 })
r = await row(D0)
check('ignore 0: all 3 punches kept', r.punches === 3, JSON.stringify(r))

// OT thresholds (Apex help: 30 min set, came 20 early → no OT)
await setPunches(D0, ['07:40', '16:25'])
await setS({ ot_before_min: 30, ot_after_min: 30 })
r = await row(D0)
check('OT thresholds 30/30: 20 early + 25 late → 0', r.ot === 0, JSON.stringify(r))
await setPunches(D0, ['07:20', '16:45'])
r = await row(D0)
check('OT thresholds 30/30: 40 early + 45 late → 85', r.ot === 85, JSON.stringify(r))

// absent after late / early
await setPunches(D0, ['09:10', '16:00'])
await setS({ absent_late_on: 1, absent_late_min: 60 })
r = await row(D0)
check('absent after 60 min late: 70 min late → غياب', r.kind === 'absent', JSON.stringify(r))
await setS({ absent_late_on: 0, absent_late_min: 60 })
r = await row(D0)
check('rule off: 70 min late stays present', r.kind === 'present' && r.late === 70, JSON.stringify(r))
await setPunches(D0, ['08:00', '15:00'])
await setS({ absent_early_on: 1, absent_early_min: 30 })
r = await row(D0)
check('absent after 30 min early leave: left 60 early → غياب', r.kind === 'absent', JSON.stringify(r))

// first in / last out (2 periods 08–12 & 13–17, 4 punches)
await setPunches(D2, ['08:00', '10:30', '11:00', '17:00'])
await setS({ first_last: 0 })
r = await row(D2)
check('two periods, rule off: period 2 has no in → late/early from pairing', r.in === '08:00', JSON.stringify(r))
await setS({ first_last: 1 })
r = await row(D2)
check('first-in-last-out: in 08:00 out 17:00, no early', r.in === '08:00' && r.out === '17:00' && r.early === 0 && r.late === 0, JSON.stringify(r))

// Apex: a closed period missing a punch counts its whole duration as تأخير
await setS({ first_last: 0 })
await setPunches(D2, ['08:00', '12:00', '13:05'])
r = await row(D2)
check('two periods, period 2 has no check-out → its 4 h count as late', r.kind === 'present' && r.late === 240, JSON.stringify(r))
await setPunches(D2, ['12:00', '13:00', '17:00'])
r = await row(D2)
check('period 1 has no check-in → its 4 h count as late', r.late === 240, JSON.stringify(r))
await setS({})

// open shift (8 h required): punches pair into periods; hours still owed show as تأخير
await p.evaluate(() => {
  DB.run("INSERT INTO shift_groups (id, name_ar, open_shift) VALUES (2, 'مفتوح', 1)")
  for (let d = 0; d < 7; d++) DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, required_min) VALUES (2, 'Y', ${d}, 1, 0, 480)`)
  DB.run("INSERT INTO employees (id, code, name_ar, shift_group_id, hire_date, ot_after) VALUES (2, '2', 'موظف مفتوح', 2, '2026-01-01', 1)")
  DB.run("INSERT INTO employee_shifts (employee_id, group_id, from_date) VALUES (2, 2, '2026-01-01')")
})
const openRow = (date, times) => p.evaluate(({ date, times }) => {
  DB.run('DELETE FROM punches'); for (const t of times) DB.run("INSERT INTO punches (emp_code, ts, source) VALUES ('2', ?, 'device')", [`${date} ${t}:00`])
  const r = Engine.compute({ from: date, to: date }).find((x) => x.emp.code === '2')
  return { kind: r.kind, status: r.status, periods: (r.windows || []).map((w) => `${Engine.hm(w.in)}-${w.out == null ? '' : Engine.hm(w.out)}`).join(' '), worked: r.worked, late: r.late || 0, ot: r.ot || 0, missing: !!r.missingOut }
}, { date, times })
await setS({ ignore_min: 15 })
r = await openRow(D0, ['08:00', '12:00'])
check('open: first period only 08–12 → 4 h late still owed', r.periods === '08:00-12:00' && r.worked === 240 && r.late === 240, JSON.stringify(r))
r = await openRow(D0, ['08:00', '12:00', '16:00'])
check('open: 3rd punch opens period 2, period 1 out stays 12:00', r.periods === '08:00-12:00 16:00-' && r.worked === 240 && r.missing, JSON.stringify(r))
r = await openRow(D0, ['08:00', '12:00', '16:00', '20:00'])
check('open: 4 punches = two periods, 8 h worked, no late', r.periods === '08:00-12:00 16:00-20:00' && r.worked === 480 && r.late === 0 && r.status === 'حضور', JSON.stringify(r))
r = await openRow(D0, ['08:00', '12:00', '15:00', '21:00'])
check('open: 10 h over two periods → 2 h overtime', r.worked === 600 && r.ot === 120 && r.late === 0, JSON.stringify(r))
r = await openRow(D0, ['08:00', '08:05', '12:00', '12:10'])
check('open + ignore 15 min: repeats dropped → one period 08–12', r.periods === '08:00-12:00' && r.late === 240, JSON.stringify(r))
await setS({ ignore_min: 30, absent_late_on: 1, absent_late_min: 60 })
r = await openRow(D0, ['08:00', '12:00', '16:00', '20:00'])
check('open + ignore 30 min: all four punches kept', r.periods === '08:00-12:00 16:00-20:00' && r.worked === 480, JSON.stringify(r))
r = await openRow(D0, ['08:00', '12:00'])
check('open: owed hours never trigger «غياب بعد تأخير»', r.kind === 'present' && r.late === 240, JSON.stringify(r))
await setS({})
await p.evaluate(() => { DB.run('DELETE FROM punches'); DB.run('DELETE FROM employee_shifts WHERE employee_id = 2'); DB.run('DELETE FROM employees WHERE id = 2') })

// the settings window: open, fill, save, reopen
await p.evaluate(() => { document.querySelectorAll('.dlg-backdrop').forEach((b) => b.remove()); Session.userId = 1; Session.username = 'test'; Session.admin = true; buildMenu(); renderHome() })
await p.evaluate(() => openSystemSettings())
await p.waitForSelector('.sys-set')
await p.fill('#s-ignore', '7'); await p.selectOption('#s-shifts', '2'); await p.fill('#s-otb', '15'); await p.fill('#s-ota', '20')
await p.check('#s-al'); await p.fill('#s-alm', '90'); await p.check('#s-fl')
await p.fill('#s-time', '10:30:00'); await p.click('#s-tadd'); await p.fill('#s-time', '22:40:00'); await p.click('#s-tadd')
await p.check('#s-auto')
await p.click('.win:has(.sys-set) .toolbar button[data-key=save]')
await p.waitForSelector('text=تم حفظ إعدادات النظام'); await p.click('.dlg button:has-text("موافق")')
let S = await p.evaluate(() => Engine.settings())
check('window saves all fields', S.ignore_min === 7 && S.report_shifts === 2 && S.ot_before_min === 15 && S.ot_after_min === 20 && S.absent_late_on === 1 && S.absent_late_min === 90 && S.first_last === 1 && S.auto_read === 1 && S.auto_times.join() === '10:30:00,22:40:00', JSON.stringify(S))
await p.click('.win:has(.sys-set) .toolbar button[data-key=close]')
await p.evaluate(() => openSystemSettings()); await p.waitForSelector('.sys-set')
const shown = await p.evaluate(() => ({ ig: document.querySelector('#s-ignore').value, t: [...document.querySelectorAll('#s-tlist option')].map((o) => o.value).join() }))
check('reopened window shows saved values', shown.ig === '7' && shown.t === '10:30:00,22:40:00', JSON.stringify(shown))
await p.fill('#s-ignore', 'abc'); await p.click('.win:has(.sys-set) .toolbar button[data-key=save]')
check('bad number rejected', await p.isVisible('text=القيم بالدقائق'))
await p.click('.dlg button:has-text("موافق")'); await p.click('.win:has(.sys-set) .toolbar button[data-key=close]')

// auto read + post (device read stubbed): reads, stores, posts finished days only
const res = await p.evaluate(async () => {
  clearInterval(AutoRead.timer) // the real scheduler (times saved above) must not run in the middle of the test
  DB.run('DELETE FROM posted_attendance'); DB.run('DELETE FROM posted_periods')
  DB.run('DELETE FROM punches'); DB.run("INSERT INTO devices (id, name, ip, port) VALUES (1, 'جهاز', '10.0.0.5', 4370)")
  const y = Engine.addDays(Engine.today(), -1)
  AutoRead.read = async () => ({ ok: true, punches: [{ code: '1', ts: `${y} 08:00:00` }, { code: '1', ts: `${Engine.today()} 08:00:00` }] })
  const log = await AutoRead.run(Engine.settings())
  const posted = DB.all('SELECT * FROM posted_periods')
  return { log, posted, punches: DB.one('SELECT COUNT(*) n FROM punches').n, today: Engine.today(), y }
})
check('auto read stored the device punches', res.punches === 2, JSON.stringify(res.log))
check('auto post covers finished days only (to = yesterday)', res.posted.length === 1 && res.posted[0].to_date === res.y, JSON.stringify(res.posted))
const due = await p.evaluate(async () => {
  let runs = 0; const orig = AutoRead.run; AutoRead.run = async () => { runs++ }
  const t = new Date(); const hms = (d) => d.toTimeString().slice(0, 8)
  const s = Engine.settings(); s.auto_times = [hms(new Date(t.getTime() - 60000))]; s.auto_read = 1
  DB.run("UPDATE meta SET value = ? WHERE key = 'sys_settings'", [JSON.stringify(s)])
  AutoRead.done.clear(); await AutoRead.tick(t); await AutoRead.tick(t)
  AutoRead.run = orig; return runs
})
check('scheduled time due → runs exactly once', due === 1, `runs=${due}`)

// upgrade from ≤1.1.5 (per-user «<menu>/<item>» lists) → roles, nobody gains or loses access
const mig = await p.evaluate(() => {
  DB.run('DROP TABLE roles'); DB.run('UPDATE users SET role_id = NULL')
  DB.run("INSERT INTO users (username, password, is_admin, permissions) VALUES ('old', 'x', 0, ?)", [JSON.stringify(['البيانات الأساسية/الموظفين', 'التقارير/حالة اليوم'])])
  DB.migrateV4()
  const u = DB.all('SELECT u.username, u.role_id, r.name_ar, r.builtin, r.perms FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id')
  DB.migrateV4() // idempotent
  return { u, roles: DB.one('SELECT COUNT(*) n FROM roles').n }
})
const old = mig.u.find((x) => x.username === 'old'), admin = mig.u.find((x) => x.username !== 'old')
check('migration: admin → built-in «مدير النظام»', admin?.builtin === 1 && admin.role_id === 1, JSON.stringify(admin))
check('migration: restricted user → own role with exactly its 2 screens', old && !old.builtin && Object.keys(JSON.parse(old.perms)).sort().join() === 'البيانات الأساسية/الموظفين,التقارير/حالة اليوم', JSON.stringify(old))
check('migration: running twice creates nothing new', mig.roles === 2, `roles=${mig.roles}`)

// «انشاء قاعدة بيانات»: a second, empty database; pick it at login; the first keeps its data
await p.evaluate(async () => { DB.run('UPDATE users SET password = ? WHERE id = 1', [await hashPassword('pw1234')]); await DB.flush(); licence = { ok: true, edition: 'Pro' } })
await p.evaluate(() => openCreateDb()); await p.waitForSelector('.create-db')
await p.fill('#cd-name', 'فرع جدة'); await p.fill('#cd-pw', 'bad'); await p.click('#cd-go')
check('create db: wrong admin password refused', await p.isVisible('text=كلمة مرور مدير النظام غير صحيحة')); await p.click('.dlg button:has-text("موافق")')
await p.fill('#cd-name', '2019'); await p.fill('#cd-pw', 'pw1234'); await p.click('#cd-go')
check('create db: a bare year name refused (kept for old per-year files)', await p.isVisible('text=غير صالح')); await p.click('.dlg button:has-text("موافق")')
await p.fill('#cd-name', 'فرع جدة'); await p.click('#cd-go'); await p.waitForSelector('text=تم انشاء قاعدة البيانات')
await p.click('.dlg button:has-text("لا")')
await p.fill('#cd-pw', 'pw1234'); await p.click('#cd-go')
check('create db: same name twice refused', await p.isVisible('text=بنفس اسم')); await p.click('.dlg button:has-text("موافق")')
check('create db: listed for the login screen', (await p.evaluate(() => window.bridge.dbNames())).join() === 'main,فرع جدة')
await p.evaluate(() => window.bridge.useDb('فرع جدة')); await p.reload(); await p.waitForSelector('text=شاشة الدخول')
const other = await p.evaluate(() => ({ y: DB.year, emps: DB.one('SELECT COUNT(*) n FROM employees').n, users: DB.all('SELECT username FROM users').map((u) => u.username).join(), sel: document.querySelector('#year').value, dis: document.querySelector('#year').disabled, cap: document.querySelector('#caption-text').textContent }))
check('switch db: new database is empty with the default user', other.y === 'فرع جدة' && other.emps === 0 && other.users === 'أ', JSON.stringify(other))
check('switch db: login shows the database list + caption names it', other.sel === 'فرع جدة' && !other.dis && other.cap.includes('فرع جدة'), JSON.stringify(other))
await p.evaluate(() => window.bridge.useDb('main')); await p.reload(); await p.waitForSelector('text=شاشة الدخول')
check('switch back: the main database still has its data', await p.evaluate(() => DB.year === 'main' && DB.one('SELECT COUNT(*) n FROM employees').n === 1))

console.log(`\n${pass} passed, ${fail} failed`)
await app.close()
fs.rmSync(UD, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
