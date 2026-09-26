// Link-with-the-site test on the real app against tools/mock-frappe.mjs:
// first link replaces local setup, pull maps every entity, local punches are
// pushed, second sync is idempotent, setup screens are locked, unlink unlocks.
//   xvfb-run -a node tools/sync-test.mjs
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
import { start } from './mock-frappe.mjs'

const ROOT = '/root/meena-time', UD = '/tmp/mt-synctest'
fs.rmSync(UD, { recursive: true, force: true })
const mock = await start(8765)
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : '  → ' + extra}`) }

const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p = await app.firstWindow()
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
const menu = async (m, item) => { await p.locator('#menubar .menu > button', { hasText: m }).first().click(); await p.locator('.menu.open .drop button', { hasText: item }).first().click(); await p.waitForTimeout(250) }
const okMsg = async () => { const t = (await p.locator('.dlg-backdrop .body').last().textContent()).trim(); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(150); return t }
const dlgBtn = (name) => p.locator('.dlg-backdrop').last().getByRole('button', { name })
const q = (sql) => p.evaluate((sql) => DB.all(sql), sql)
const n = async (sql) => (await q(sql))[0].n

await p.waitForSelector('text=شاشة الدخول')
await p.locator('#user').fill('أ'); await dlgBtn('موافق').click()
await p.locator('#np1').fill('1234'); await p.locator('#np2').fill('1234'); await dlgBtn('حفظ').click()
await p.waitForSelector('#home')

// local data before linking: an employee whose code exists on the site (1001) + one that doesn't
await p.evaluate(async () => {
  DB.run("INSERT INTO departments (name_ar) VALUES ('إدارة محلية')")
  DB.run("INSERT INTO employees (code, name_ar) VALUES ('1001', 'محلي 1001'), ('9999', 'محلي فقط')")
  DB.run("INSERT INTO punches (emp_code, ts, source) VALUES ('1001', '2026-09-21 08:01:00', 'manual'), ('1001', '2026-09-20 07:55:10', 'device'), ('9999', '2026-09-21 08:00:00', 'manual')")
  await DB.flush()
})
check('unlinked: no status chip', !(await p.locator('#sync-status').isVisible().catch(() => false)))

// ── link ──
await menu('الإعدادات', 'الربط بالموقع')
await p.locator('#wl-url').fill('http://127.0.0.1:8765'); await p.locator('#wl-key').fill('k'); await p.locator('#wl-secret').fill('bad')
await dlgBtn('اختبار الاتصال').click(); await p.waitForTimeout(500)
check('link: wrong secret rejected', /غير صحيحة/.test(await p.locator('.dlg-backdrop').last().locator('.err').textContent()))
await p.locator('#wl-secret').fill('s')
await dlgBtn('اختبار الاتصال').click(); await p.waitForTimeout(500)
check('link: test connection OK', /الاتصال ناجح/.test(await p.locator('.dlg-backdrop').last().locator('.err').textContent()))
await dlgBtn('حفظ وربط').click(); await p.waitForTimeout(500)
check('link: first link asks to replace local setup', /سيتم استبدال/.test(await p.locator('.dlg-backdrop').last().textContent()))
await dlgBtn('نعم').click(); await p.waitForTimeout(2500)
const msg = await okMsg()
check('sync: summary message', /تمت المزامنة/.test(msg), msg)

check('secret not stored in the database', !(await n("SELECT COUNT(*) n FROM meta WHERE value LIKE '%s%' AND key LIKE 'web%' AND value = 's'")))
check('secret file is not plain text in DB backups', !fs.readFileSync(`${UD}/meena-time.sqlite`).includes(Buffer.from('token k:s')))
check('departments: roots skipped, section under parent', JSON.stringify(await q('SELECT d.name_ar, p.name_ar parent FROM departments d LEFT JOIN departments p ON p.id = d.parent_id ORDER BY d.id')) ===
  JSON.stringify([{ name_ar: 'الحسابات', parent: null }, { name_ar: 'المبيعات', parent: null }, { name_ar: 'مبيعات الجملة', parent: 'المبيعات' }]))
check('first link removed local-only setup', !(await n("SELECT COUNT(*) n FROM departments WHERE name_ar = 'إدارة محلية'")) && !(await n("SELECT COUNT(*) n FROM employees WHERE code = '9999'")))
check('lists: jobs, leave types, nationality', (await n("SELECT COUNT(*) n FROM lists WHERE list_type = 'job'")) === 2 && (await n("SELECT COUNT(*) n FROM lists WHERE list_type = 'leave'")) === 2 && (await n("SELECT COUNT(*) n FROM lists WHERE list_type = 'nationality'")) === 1)
check('holidays: only non-weekly', JSON.stringify(await q('SELECT name_ar, from_date FROM holidays')) === JSON.stringify([{ name_ar: 'اليوم الوطني', from_date: '2026-09-23' }]))
const groups = await q("SELECT name_ar, open_shift, total_minutes FROM shift_groups WHERE web_id <> '__rest' ORDER BY id")
check('shifts: normal/plain/open pulled, rotational parent skipped', groups.map((g) => g.name_ar).join('|') === 'دوام صباحي|دوام بسيط|دوام مفتوح', JSON.stringify(groups))
check('shift windows: 6 working days + Friday off', (await n("SELECT COUNT(*) n FROM shift_windows w JOIN shift_groups g ON g.id = w.group_id WHERE g.name_ar = 'دوام صباحي' AND w.is_off = 0")) === 6 &&
  (await n("SELECT COUNT(*) n FROM shift_windows w JOIN shift_groups g ON g.id = w.group_id WHERE g.name_ar = 'دوام صباحي' AND w.is_off = 1 AND w.slot = 6")) === 1)
const plain = (await q("SELECT w.* FROM shift_windows w JOIN shift_groups g ON g.id = w.group_id WHERE g.name_ar = 'دوام بسيط' AND w.slot = 1"))[0]
check('plain shift → window from start/end + grace', plain.check_in === '09:00' && plain.check_out === '17:00' && plain.late_min === 15 && plain.early_min === 5 && plain.start_in === '08:00' && plain.end_out === '18:00', JSON.stringify(plain))
check('open shift: 8 h required, Friday off', (await n("SELECT COUNT(*) n FROM shift_windows w JOIN shift_groups g ON g.id = w.group_id WHERE g.name_ar = 'دوام مفتوح' AND w.required_min = 480")) === 6)
const emps = await q('SELECT code, name_ar, status, web_id FROM employees ORDER BY code')
check('employees: 3 from the site, code = device id (or employee id)', emps.map((e) => e.code).join('|') === '1001|1002|HR-EMP-00003', JSON.stringify(emps))
check('employees: status mapped', emps.find((e) => e.web_id === 'HR-EMP-00003').status === 'غير نشط')
const e1 = (await q("SELECT e.*, d.name_ar dep, j.name_ar job, pr.name_ar proj, g.name_ar grp FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN lists j ON j.id = e.job_id LEFT JOIN projects pr ON pr.id = e.project_id LEFT JOIN employee_groups g ON g.id = e.group_id WHERE code = '1001'"))[0]
check('employee fields: dept/job/project/group/OT', e1.dep === 'الحسابات' && e1.job === 'محاسب' && e1.proj === 'فرع بريدة' && e1.grp === 'الإداريين' && e1.ot_after === 1 && e1.gender === 'ذكر', JSON.stringify(e1))
const hist = await q("SELECT s.from_date, g.name_ar FROM employee_shifts s JOIN employees e ON e.id = s.employee_id JOIN shift_groups g ON g.id = s.group_id WHERE e.code = '1002' ORDER BY s.from_date")
check('shift history: default, assignment, gap → rest, next assignment', hist.map((h) => `${h.from_date}:${h.name_ar}`).join(' ') === '2025-01-01:دوام بسيط 2026-09-01:دوام صباحي 2026-09-11:راحة (من الموقع) 2026-09-13:دوام بسيط', JSON.stringify(hist))
check('leaves: approved only', (await n('SELECT COUNT(*) n FROM leaves')) === 1)
check('permissions: approved, times HH:MM', JSON.stringify(await q('SELECT date, from_time, to_time FROM permissions')) === JSON.stringify([{ date: '2026-09-15', from_time: '10:00', to_time: '12:00' }]))
check('punches: site checkins pulled (web source)', (await n("SELECT COUNT(*) n FROM punches WHERE source = 'web'")) === 1)
check('punches: same (code, ts) from site + device kept once, linked', (await n("SELECT COUNT(*) n FROM punches WHERE emp_code = '1001' AND ts = '2026-09-20 07:55:10'")) === 1 && (await n("SELECT COUNT(*) n FROM punches WHERE ts = '2026-09-20 07:55:10' AND web_id = 'CHK-1'")) === 1)
check('push: local manual punch sent to the site', mock.posted.some((r) => r.employee === 'HR-EMP-00001' && r.time === '2026-09-21 08:01:00'))
check('push: punch of an employee unknown to the site stays local', !mock.posted.some((r) => r.time === '2026-09-21 08:00:00') && (await n("SELECT COUNT(*) n FROM punches WHERE emp_code = '9999' AND web_id IS NULL")) === 1)
check('status chip visible', /مرتبط بالموقع/.test(await p.locator('#sync-status').textContent()))

// attendance computed from pulled data
const day = await p.evaluate(() => Engine.compute({ from: '2026-09-20', to: '2026-09-20', employeeIds: [DB.one("SELECT id FROM employees WHERE code = '1001'").id] })[0])
check('engine: pulled shift + punches → present', day.status === 'حضور' && day.shift === 'دوام صباحي', `${day.status} ${day.shift}`)

// ── second sync: nothing new, nothing duplicated ──
const before = mock.posted.length
const r2 = await p.evaluate(() => WebSync.sync({ quiet: true }))
check('second sync: idempotent', r2.punches === 0 && mock.posted.length === before && (await n('SELECT COUNT(*) n FROM employees')) === 3 && (await n("SELECT COUNT(*) n FROM shift_groups WHERE web_id <> '__rest'")) === 3)

// ── changes on the site show up; removed rows go away ──
mock.db.Department.push({ name: 'الجودة - T', department_name: 'الجودة', parent_department: 'All Departments', is_group: 0 })
mock.db.Designation.splice(1, 1)
mock.db.Employee[1].employee_name = 'اسم معدّل'
mock.db['Employee Checkin'].push({ name: 'CHK-9', employee: 'HR-EMP-00002', time: '2026-09-22 09:02:00' })
await p.evaluate(() => WebSync.sync({ quiet: true }))
check('site changes: new department, removed job, renamed employee, new punch', (await n("SELECT COUNT(*) n FROM departments WHERE name_ar = 'الجودة'")) === 1 &&
  (await n("SELECT COUNT(*) n FROM lists WHERE list_type = 'job'")) === 1 && (await n("SELECT COUNT(*) n FROM employees WHERE name_ar = 'اسم معدّل'")) === 1 &&
  (await n("SELECT COUNT(*) n FROM punches WHERE emp_code = '1002' AND ts = '2026-09-22 09:02:00'")) === 1)
mock.db.Employee.splice(2, 1)
await p.evaluate(() => WebSync.sync({ quiet: true }))
check('employee removed on the site → «منتهي» here', (await q("SELECT status FROM employees WHERE code = 'HR-EMP-00003'"))[0].status === 'منتهي')

// ── device/file punches go up right away ──
await p.evaluate(() => storePunches([{ code: '1002', ts: '2026-09-23 08:00:00' }], 'file'))
await p.waitForTimeout(1500)
check('file import → pushed to the site', mock.posted.some((r) => r.employee === 'HR-EMP-00002' && r.time === '2026-09-23 08:00:00'))

// ── site demands GPS (like tamken3): REST push fails → reported, punch kept for later ──
mock.opts.geo = true
await p.evaluate(() => storePunches([{ code: '1001', ts: '2026-09-24 08:00:00' }], 'manual'))
await p.waitForTimeout(1500)
check('geo site, no endpoint: punch not sent, kept local', !mock.posted.some((r) => r.time === '2026-09-24 08:00:00') && (await n("SELECT COUNT(*) n FROM punches WHERE ts = '2026-09-24 08:00:00' AND web_id IS NULL")) === 1)
check('geo site: failure shown on the status chip', /لم تُرفع 1 حركة/.test(await p.locator('#sync-status').textContent()))
await p.evaluate(() => WebSync.sync())
check('geo site: failure reason in the sync message', /لم تُرفع 1 حركة: .*Latitude/.test(await okMsg()))
// ── desktop endpoint installed: the waiting punch goes up through it ──
mock.opts.method = true
await p.evaluate(() => WebSync.sync({ quiet: true }))
check('endpoint: waiting punch sent', mock.posted.some((r) => r.employee === 'HR-EMP-00001' && r.time === '2026-09-24 08:00:00' && r.device_id === 'Meena Time'))
check('endpoint: punch linked, chip clear', (await n("SELECT COUNT(*) n FROM punches WHERE ts = '2026-09-24 08:00:00' AND web_id LIKE 'CHK-%'")) === 1 && !/لم تُرفع/.test(await p.locator('#sync-status').textContent()))
const before2 = mock.posted.length
await p.evaluate(() => WebSync.sync({ quiet: true }))
check('endpoint: nothing re-sent', mock.posted.length === before2)

// ── locked while linked ──
await menu('البيانات الأساسية', 'الإدارات والأقسام')
const w = p.locator('.win', { has: p.locator('.cap', { hasText: 'الإدارات والأقسام' }) }).last()
await w.locator('tbody tr').last().locator('input[data-f="name_ar"]').fill('إدارة جديدة')
await w.locator('.toolbar button', { hasText: 'حفظ' }).click(); await p.waitForTimeout(300)
check('locked: saving a department shows the site message', /عدّل هذه البيانات من الموقع/.test(await okMsg()))
check('locked: nothing saved', !(await n("SELECT COUNT(*) n FROM departments WHERE name_ar = 'إدارة جديدة'")))
await w.locator('.toolbar button', { hasText: 'إغلاق' }).click(); await p.waitForTimeout(200)
if (await p.locator('.dlg-backdrop').count()) await dlgBtn('نعم').click()

// ── offline: a clear message, data untouched ──
mock.server.close()
await p.waitForTimeout(200)
await p.evaluate(() => WebSync.sync({ quiet: true }))
check('offline: status shows the failure', /تعذّرت المزامنة/.test(await p.locator('#sync-status').textContent()))
check('offline: data kept', (await n('SELECT COUNT(*) n FROM employees')) === 3)

// ── unlink → editable again ──
await menu('الإعدادات', 'الربط بالموقع')
await dlgBtn('الغاء الربط').click(); await p.waitForTimeout(300)
check('unlink: message', /تم إلغاء الربط/.test(await okMsg()))
check('unlink: status chip hidden', !(await p.locator('#sync-status').isVisible()))
check('unlink: link file removed', !fs.existsSync(`${UD}/web-link.json`))
check('unlinked: edits allowed', await p.evaluate(() => !WebSync.blocks('departments')))
check('no page errors', !errors.length, errors.join(' | '))

await app.close()
console.log(`\nTOTAL: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
