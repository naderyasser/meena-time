// Builds a ready-to-restore test database (أدوات ← استرجاع نسخة احتياطية):
// the web version's setup data (tools/web-setup.json: company, departments,
// jobs, leave types, shifts with their windows, holidays — no personal data)
// + synthetic employees, 2 months of punches, leaves and permissions.
// Runs the real app so the file carries the exact schema. Login: أ / 1234
//   xvfb-run -a node tools/seed-data.mjs  → dist/meena-time-test-data.sqlite
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const UD = '/tmp/mt-seed'
const OUT = `${ROOT}/dist/meena-time-test-data.sqlite`
fs.rmSync(UD, { recursive: true, force: true })
const web = JSON.parse(fs.readFileSync(`${ROOT}/tools/web-setup.json`, 'utf8'))

const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p = await app.firstWindow()
await p.waitForSelector('text=شاشة الدخول')
await p.locator('#user').fill('أ')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click()
await p.locator('#np1').fill('1234'); await p.locator('#np2').fill('1234')
await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'حفظ' }).click()
await p.waitForSelector('#home')

const summary = await p.evaluate(async (web) => {
  // deterministic "random" so every build gives the same data
  let seed = 20260926
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const hm = (t) => { const [h, m] = String(t || '0:0').split(':'); return `${h.padStart(2, '0')}:${m.padStart(2, '0')}` }
  const id = (sql, args) => { DB.run(sql, args); return DB.one('SELECT last_insert_rowid() AS id').id }
  const setMeta = (k, v) => DB.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v])

  DB.run('BEGIN')
  // ── company (web) ──
  setMeta('company_name', web.company[0] || 'شركة تجريبية')
  setMeta('company_name_en', 'Al-Qarawi Trading Co.')
  setMeta('company_address', 'بريدة - القصيم')
  setMeta('company_phone', '016 000 0000')

  // ── departments (web) + a few sections for testing ──
  const dep = {}
  for (const d of web.departments) {
    if (d.is_group) continue // «جميع الاقسام» / «All Departments» are the tree roots
    dep[d.department_name] = id('INSERT INTO departments (name_ar) VALUES (?)', [d.department_name])
  }
  const sections = { مبيعات: ['مبيعات الجملة', 'مبيعات التجزئة'], 'الموارد البشرية': ['شؤون الموظفين'], العمليات: ['المستودع', 'التوصيل'] }
  const sec = {}
  for (const [parent, list] of Object.entries(sections)) if (dep[parent]) sec[parent] = list.map((n) => id('INSERT INTO departments (name_ar, parent_id) VALUES (?, ?)', [n, dep[parent]]))

  // ── lists: jobs (web), leave types (web, in Arabic), nationalities + permissions (test) ──
  const jobs = web.designations.map((n) => id("INSERT INTO lists (list_type, name_ar) VALUES ('job', ?)", [n]))
  const LEAVE_AR = { 'Casual Leave': 'إجازة عارضة', 'Compensatory Off': 'إجازة تعويضية', 'Sick Leave': 'إجازة مرضية', 'Privilege Leave': 'إجازة اعتيادية',
    'Leave Without Pay': 'إجازة بدون راتب', 'Unpaid Leave': 'إجازة بدون راتب', 'Annual Leave': 'إجازة سنوية' }
  const leaveTypes = [...new Set(web.leave_types.map((n) => LEAVE_AR[n]).filter(Boolean))].map((n) => id("INSERT INTO lists (list_type, name_ar) VALUES ('leave', ?)", [n]))
  const NAT = [['سعودي', 'Saudi'], ['مصري', 'Egyptian'], ['هندي', 'Indian'], ['باكستاني', 'Pakistani'], ['سوداني', 'Sudanese'], ['يمني', 'Yemeni'], ['فلبيني', 'Filipino'], ['أردني', 'Jordanian']]
  const nats = NAT.map(([a, e]) => id("INSERT INTO lists (list_type, name_ar, name_en) VALUES ('nationality', ?, ?)", [a, e]))
  const permTypes = ['إذن شخصي', 'إذن عمل', 'إذن طبي'].map((n) => id("INSERT INTO lists (list_type, name_ar) VALUES ('permission', ?)", [n]))

  // ── shifts ──
  const DAY = { Saturday: 0, Sunday: 1, Monday: 2, Tuesday: 3, Wednesday: 4, Thursday: 5, Friday: 6 }
  const W = (start_in, check_in, late, end_in, start_out, early, check_out, end_out) => ({ start_in, check_in, late_min: late, end_in, start_out, early_min: early, check_out, end_out })
  const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const span = (w) => ((mins(w.check_out) - mins(w.check_in)) + 1440) % 1440
  function normalGroup(name, perDay /* slot → [windows] | null (off) */) {
    const g = id('INSERT INTO shift_groups (name_ar) VALUES (?)', [name])
    let total = 0
    for (let d = 0; d < 7; d++) {
      const list = perDay(d)
      if (!list?.length) { DB.run("INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off) VALUES (?, 'Y', ?, 1, 1)", [g, d]); continue }
      list.forEach((w, i) => DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out, extended)
        VALUES (?, 'Y', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [g, d, i + 1, w.start_in, w.check_in, w.late_min, w.end_in, w.start_out, w.early_min, w.check_out, w.end_out, w.extended ? 1 : 0]))
      total += list.reduce((s, w) => s + span(w), 0)
    }
    DB.run('UPDATE shift_groups SET total_minutes = ? WHERE id = ?', [total, g])
    return g
  }
  const webShift = (n) => web.shift_types.find((s) => s.name === n)
  const fromWeb = (n) => {
    const s = webShift(n)
    const rows = (s?.custom_day_windows || []).filter((r) => r.calendar_type === 'Year')
    if (!rows.length) return null
    return normalGroup(n, (d) => rows.filter((r) => DAY[r.day] === d).sort((a, b) => a.window_no - b.window_no)
      .map((r) => ({ ...W(hm(r.start_in), hm(r.check_in), r.late_allowance_min || 0, hm(r.end_in), hm(r.start_out), r.early_out_min || 0, hm(r.check_out), hm(r.end_out)), extended: r.extended })))
  }
  const groups = {}
  // «الفترة الصباحية» on the web is a plain 08:00–16:00 shift (grace 15/15, ±60 min), Friday off
  const morning = webShift('الفترة الصباحية')
  groups.morning = normalGroup('الفترة الصباحية', (d) => d === 6 ? null
    : [W('07:00', hm(morning?.start_time || '8:00'), morning?.late_entry_grace_period ?? 15, '10:00', '14:00', morning?.early_exit_grace_period ?? 15, hm(morning?.end_time || '16:00'), '17:00')])
  groups.evening = normalGroup('الفترة المسائية', (d) => d === 6 ? null : [W('14:00', '15:00', 15, '17:00', '21:00', 15, '23:00', '23:59')])
  groups.split = normalGroup('دوام فترتين', (d) => d === 6 ? null : [W('07:00', '08:00', 10, '09:30', '11:30', 10, '12:00', '13:00'), W('15:30', '16:00', 10, '17:00', '20:30', 10, '21:00', '22:00')])
  groups.test = fromWeb('دوام تجربة')
  groups.d2026 = fromWeb('دوام 2026')
  // open shift from the web: «دوام مفتوح 2027» (8 h, day ends 10:00 next day)
  const open = webShift('دوام مفتوح 2027')
  if (open) {
    const g = id('INSERT INTO shift_groups (name_ar, open_shift) VALUES (?, 1)', [open.name])
    const req = open.custom_day_windows?.[0]?.required_minutes || (open.custom_open_hours || 8) * 60
    for (let d = 0; d < 7; d++) DB.run("INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, required_min, extends_next_day, day_end) VALUES (?, 'Y', ?, 1, ?, ?, 1, '06:00')", [g, d, d === 6 ? 1 : 0, d === 6 ? null : req])
    DB.run('UPDATE shift_groups SET total_minutes = ? WHERE id = ?', [req * 6, g])
    groups.open = g
  }
  // rotating shift like the web's «ورديات متغيرة»: 4 days on (08–16) / 2 days off
  {
    const g = id("INSERT INTO shift_groups (name_ar, rotational, start_date) VALUES ('ورديات متغيرة', 1, '2026-08-01')")
    DB.run("INSERT INTO rotation_blocks (group_id, calendar, idx, work_days, rest_days) VALUES (?, 'Y', 0, 4, 2)", [g])
    DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out)
      VALUES (?, 'Y', 0, 1, 0, '07:00', '08:00', 10, '10:00', '14:00', 10, '16:00', '17:00')`, [g])
    DB.run('UPDATE shift_groups SET total_minutes = ? WHERE id = ?', [4 * 480, g])
    groups.rot = g
  }
  // Ramadan 1448 (≈ 2027-02-08 … 2027-03-09) with shorter morning timings
  DB.run("INSERT INTO ramadan_periods (from_date, to_date) VALUES ('2027-02-08', '2027-03-09')")
  for (let d = 0; d < 6; d++) DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out)
    VALUES (?, 'R', ?, 1, 0, '09:00', '10:00', 15, '11:00', '14:00', 15, '15:00', '16:00')`, [groups.morning, d])
  DB.run("INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off) VALUES (?, 'R', 6, 1, 1)", [groups.morning])

  // ── holidays (web: اليوم الوطني) + other official days ──
  const hol = [['اليوم الوطني', '2026-09-23', '2026-09-23'], ['يوم التأسيس', '2026-02-22', '2026-02-22'], ['إجازة عيد الفطر', '2026-03-19', '2026-03-24'], ['إجازة عيد الأضحى', '2026-05-25', '2026-05-30']]
  for (const d of web.holidays.flatMap((h) => h.days.filter((x) => !x[2]))) if (!hol.some((h) => h[1] === d[0])) hol.push([d[1] || 'عطلة', d[0], d[0]])
  for (const h of hol) DB.run('INSERT INTO holidays (name_ar, from_date, to_date) VALUES (?, ?, ?)', h)

  // ── projects / employee groups / devices / penalty rules ──
  const projects = ['مشروع المستودع الجديد', 'فرع بريدة', 'فرع عنيزة'].map((n) => id('INSERT INTO projects (name_ar) VALUES (?)', [n]))
  const egroups = ['الموظفين الإداريين', 'موظفي الميدان'].map((n) => id('INSERT INTO employee_groups (name_ar) VALUES (?)', [n]))
  const dev1 = id("INSERT INTO devices (name, ip, port, serial) VALUES ('جهاز المدخل الرئيسي', '192.168.1.201', 4370, 'TEST0001')")
  id("INSERT INTO devices (name, ip, port, serial) VALUES ('جهاز المستودع', '192.168.1.202', 4370, 'TEST0002')")
  for (const r of [['late', 1, 1, 'warning', 0], ['late', 1, 2, 'minutes', 30], ['late', 1, 3, 'days', 0.5], ['absent', 0, 1, 'days', 1], ['absent', 0, 2, 'days', 2], ['early', 1, 1, 'warning', 0], ['missing_out', 0, 1, 'warning', 0]])
    DB.run('INSERT INTO penalty_rules (violation, min_minutes, occurrence, action, amount) VALUES (?, ?, ?, ?, ?)', r)

  // ── employees (synthetic, codes 1001…) ──
  const FIRST = ['محمد', 'أحمد', 'عبدالله', 'خالد', 'سعد', 'فهد', 'عبدالرحمن', 'سلطان', 'ناصر', 'فيصل', 'ماجد', 'يوسف', 'إبراهيم', 'عمر', 'علي', 'حسن', 'طارق', 'ياسر', 'بندر', 'تركي', 'مازن', 'وليد', 'هاني', 'رامي']
  const LAST = ['العتيبي', 'القحطاني', 'الشمري', 'الدوسري', 'الحربي', 'المطيري', 'الزهراني', 'الغامدي', 'السبيعي', 'العنزي', 'عبدالعزيز', 'حسين', 'محمود', 'خان', 'سانتوس', 'كومار']
  const plan = [ // [how many, shift key, department, section?]
    [6, 'morning', 'الإدارة'], [4, 'morning', 'الحسابات'], [3, 'morning', 'الموارد البشرية', 0], [4, 'evening', 'مبيعات', 1], [3, 'split', 'مبيعات', 0],
    [3, 'rot', 'العمليات', 0], [2, 'rot', 'العمليات', 1], [2, 'open', 'التسويق'], [2, 'd2026', 'خدمة العملاء'], [1, 'test', 'الشراء'],
  ]
  const emps = []
  let code = 1001
  for (const [n, sk, depName, secIdx] of plan) for (let i = 0; i < n; i++) {
    if (!groups[sk]) continue
    const natIdx = code % 3 === 0 ? int(1, nats.length - 1) : 0
    const hire = `2025-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`
    const status = code === 1012 ? 'غير نشط' : code === 1025 ? 'موقوف' : 'نشط'
    const e = {
      code: String(code), name_ar: `${FIRST[(code - 1001) % FIRST.length]} ${pick(FIRST)} ${pick(LAST)}`, status, job_id: pick(jobs),
      department_id: dep[depName] ?? null, section_id: secIdx != null ? sec[depName]?.[secIdx] ?? null : null, group_id: pick(egroups), project_id: rnd() < 0.3 ? pick(projects) : null,
      shift_group_id: groups[sk], hire_date: hire, gender: 'ذكر', nationality_id: nats[natIdx], national_id: String((natIdx ? 2 : 1) * 1000000000 + int(10000000, 99999999)),
      religion: 'مسلم', birth_date: `${int(1975, 2000)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
      mobile: `05${int(10000000, 99999999)}`, email: `emp${code}@example.com`, address: 'بريدة', attendance_method: 'بصمة', no_punch_out: 0,
      ot_before: rnd() < 0.3 ? 1 : 0, ot_after: rnd() < 0.5 ? 1 : 0, ot_holidays: rnd() < 0.3 ? 1 : 0, ot_deduct_late: rnd() < 0.3 ? 1 : 0,
    }
    const cols = Object.keys(e)
    e.id = id(`INSERT INTO employees (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => e[c]))
    DB.run('INSERT INTO employee_shifts (employee_id, group_id, from_date) VALUES (?, ?, ?)', [e.id, e.shift_group_id, hire])
    e.sk = sk
    emps.push(e)
    code++
  }
  // one shift change mid-period (history-safe): 1004 moves to the evening shift on 2026-09-01
  const moved = emps.find((e) => e.code === '1004')
  if (moved) DB.run('INSERT INTO employee_shifts (employee_id, group_id, from_date) VALUES (?, ?, ?)', [moved.id, groups.evening, '2026-09-01'])

  // ── leaves & permissions ──
  const active = emps.filter((e) => e.status === 'نشط')
  const leaves = [['1002', 0, '2026-08-10', '2026-08-14'], ['1007', 2, '2026-09-06', '2026-09-07'], ['1015', 5, '2026-08-17', '2026-08-27'], ['1020', 1, '2026-09-14', '2026-09-14'], ['1003', 4, '2026-09-20', '2026-09-22']]
  const onLeave = new Set()
  for (const [c, t, f, to] of leaves) {
    const e = emps.find((x) => x.code === c); if (!e) continue
    DB.run('INSERT INTO leaves (employee_id, type_id, from_date, to_date, notes) VALUES (?, ?, ?, ?, ?)', [e.id, leaveTypes[t % leaveTypes.length], f, to, 'بيانات تجريبية'])
    for (const d of Engine.dates(f, to)) onLeave.add(`${c}|${d}`)
  }
  const perms = [['1001', 0, '2026-09-08', '09:00', '11:00'], ['1005', 1, '2026-09-10', '13:00', '16:00'], ['1009', 2, '2026-08-25', '08:00', '10:00'], ['1013', 0, '2026-09-16', '19:00', '21:00']]
  for (const [c, t, d, f, to] of perms) {
    const e = emps.find((x) => x.code === c); if (!e) continue
    DB.run('INSERT INTO permissions (employee_id, type_id, date, from_time, to_time, notes) VALUES (?, ?, ?, ?, ?, ?)', [e.id, permTypes[t], d, f, to, 'بيانات تجريبية'])
  }

  // ── punches: 2026-08-01 … yesterday, following each employee's real schedule ──
  DB.run('COMMIT')
  const cfg = Engine.loadConfig()
  const holidays = DB.all('SELECT * FROM holidays')
  const isHoliday = (d) => holidays.some((h) => h.from_date <= d && h.to_date >= d)
  const until = Engine.addDays(Engine.today(), -1)
  const ts = (date, m) => { const d = Engine.addDays(date, Math.floor(m / 1440)); m = ((m % 1440) + 1440) % 1440; return `${d} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}` }
  let punches = 0
  DB.run('BEGIN')
  const add = (c, t) => { DB.run("INSERT OR IGNORE INTO punches (emp_code, ts, source, device_id) VALUES (?, ?, 'device', ?)", [c, t, dev1]); punches++ }
  for (const e of active) {
    const habit = rnd() // some people are often late, most are punctual
    for (const date of Engine.dates('2026-08-01', until)) {
      if (isHoliday(date) || onLeave.has(`${e.code}|${date}`)) continue
      const gid = DB.one('SELECT group_id FROM employee_shifts WHERE employee_id = ? AND from_date <= ? ORDER BY from_date DESC LIMIT 1', [e.id, date])?.group_id
      const s = Engine.schedule(cfg, gid, date)
      if (s.kind === 'off' || s.kind === 'none') continue
      const r = rnd()
      if (r < 0.04) continue // absent
      if (s.kind === 'open') {
        const inM = int(7 * 60 + 30, 10 * 60)
        add(e.code, ts(date, inM))
        if (rnd() > 0.03) add(e.code, ts(date, inM + (s.open.required_min || 480) + int(-45, 40)))
        continue
      }
      s.windows.forEach((w, i) => {
        const late = rnd() < (habit > 0.8 ? 0.35 : 0.08)
        add(e.code, ts(date, late ? w.check_in + int(w.late_min + 1, 45) : w.check_in - int(0, 25)))
        if (rnd() < 0.03 && i === s.windows.length - 1) return // forgot to punch out
        const early = rnd() < 0.06
        add(e.code, ts(date, early ? w.check_out - int(w.early_min + 1, 60) : w.check_out + int(0, rnd() < 0.15 ? 90 : 15)))
      })
    }
  }
  DB.run('COMMIT')
  DB.audit('بيانات تجريبية', 'seed-data', `${emps.length} موظف، ${punches} حركة`)
  await DB.flush()
  return { employees: emps.length, active: active.length, groups: Object.fromEntries(Object.entries(groups).filter(([, v]) => v)), departments: Object.keys(dep).length, jobs: jobs.length, punches, holidays: hol.length }
}, web)

console.log(JSON.stringify(summary))
await app.close()
fs.copyFileSync(`${UD}/meena-time.sqlite`, OUT)
console.log('→', OUT, fs.statSync(OUT).size, 'bytes')
