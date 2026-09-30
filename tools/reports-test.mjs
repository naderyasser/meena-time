// Every report in Apex Time's layout, registered mode: contents + the 4 «الموظفون» filters.
// Run: xvfb-run -a node tools/reports-test.mjs   (screenshots → test-shots/rep-*.png)
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
const ROOT = '/root/meena-time', UD = '/tmp/mt-reportstest', SHOTS = `${ROOT}/test-shots`
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true })
const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p = await app.firstWindow()
await p.setViewportSize({ width: 1400, height: 900 })
await p.waitForSelector('text=شاشة الدخول', { timeout: 20000 })
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ' — ' + detail : ''}`) }

// data: 2 departments (+ a section), 2 shifts (1 period · 2 periods), 4 employees, a week of punches
await p.evaluate(() => {
  document.querySelectorAll('.dlg-backdrop').forEach((b) => b.remove())
  licence = { ok: true, edition: 'Gold' }
  Session.userId = 1; Session.username = 'admin'; Session.admin = true
  const S = (k, v) => DB.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [k, v])
  S('company_name', 'شركة الاختبار'); S('company_name_en', 'Test Co'); S('company_activity', 'تجارة'); S('company_phone', '0110000000'); S('company_email', 'a@b.sa')
  DB.run('BEGIN')
  DB.run("INSERT INTO departments (id, name_ar) VALUES (1, 'الإدارة'), (2, 'المبيعات')"); DB.run("INSERT INTO departments (id, name_ar, parent_id) VALUES (3, 'الدعم', 1)")
  DB.run("INSERT INTO lists (id, list_type, name_ar) VALUES (1, 'job', 'مهندس'), (2, 'leave', 'سنوية'), (3, 'permission', 'شخصي')")
  DB.run("INSERT INTO employee_groups (id, name_ar) VALUES (1, 'الفرقة أ')")
  DB.run("INSERT INTO projects (id, name_ar) VALUES (1, 'مشروع 1')")
  DB.run("INSERT INTO shift_groups (id, name_ar) VALUES (1, 'صباحي'), (2, 'مقسم')")
  for (let d = 0; d < 7; d++) {
    const off = d === 6 ? 1 : 0 // الجمعة
    DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out) VALUES (1,'Y',${d},1,${off},'06:00','08:00',0,'11:00','11:30',0,'16:00','20:00')`)
    DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out) VALUES (2,'Y',${d},1,${off},'07:00','08:00',0,'10:00','10:30',0,'12:00','12:59')`)
    DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out) VALUES (2,'Y',${d},2,${off},'13:00','14:00',0,'16:00','16:30',0,'18:00','22:00')`)
  }
  const emps = [[1, '101', 'أحمد', 1, null, 1, 1], [2, '102', 'سالم', 1, 3, 1, null], [3, '103', 'خالد', 2, null, 2, 1], [4, '104', 'فهد', 2, null, 1, null]]
  for (const [id, code, name, dep, sec, shift, grp] of emps) {
    DB.run('INSERT INTO employees (id, code, name_ar, department_id, section_id, shift_group_id, group_id, job_id, project_id, hire_date, ot_before, ot_after) VALUES (?,?,?,?,?,?,?,1,1,?,1,1)', [id, code, name, dep, sec, shift, grp, '2026-01-01'])
    DB.run("INSERT INTO employee_shifts (employee_id, group_id, from_date) VALUES (?, ?, '2026-01-01')", [id, shift])
  }
  DB.run("INSERT INTO devices (id, name, ip, port) VALUES (1, 'بوابة 1', '10.0.0.9', 4370)")
  const P = (code, ts, dev = 1) => DB.run("INSERT INTO punches (emp_code, ts, source, device_id) VALUES (?, ?, 'device', ?)", [code, ts, dev])
  // Mon 2026-09-14 … Sun 2026-09-20 (Fri 18 = weekly off)
  P('101', '2026-09-14 08:10:00'); P('101', '2026-09-14 16:30:00')      // 10 late, 30 OT
  P('101', '2026-09-15 07:30:00'); P('101', '2026-09-15 15:40:00')      // 30 OT before, 20 early
  P('102', '2026-09-14 08:00:00'); P('102', '2026-09-14 16:00:00')      // on time; 15th absent
  P('103', '2026-09-14 08:05:00'); P('103', '2026-09-14 12:00:00'); P('103', '2026-09-14 14:20:00'); P('103', '2026-09-14 18:30:00') // 5 late p1, 20 late p2, 30 OT p2
  P('104', '2026-09-14 08:00:00')                                      // missing out
  DB.run("INSERT INTO leaves (employee_id, type_id, from_date, to_date, notes) VALUES (4, 2, '2026-09-15', '2026-09-16', 'سفر')")
  DB.run("INSERT INTO permissions (employee_id, type_id, date, from_time, to_time) VALUES (1, 3, '2026-09-16', '10:00', '11:30')")
  DB.run("INSERT INTO holidays (name_ar, from_date, to_date) VALUES ('اليوم الوطني', '2026-09-17', '2026-09-17')")
  DB.run('COMMIT')
  buildMenu(); renderHome()
})

const win = (t) => p.locator('.win', { has: p.locator('.cap', { hasText: t }) }).last()
async function run(name, { from = '2026-09-14', to = '2026-09-16', filter } = {}) {
  await p.evaluate((n) => openReport(n), name)
  const w = win(name)
  if (await w.locator('#r-from').count()) { await w.locator('#r-from').fill(from); await w.locator('#r-to').fill(to) }
  if (await w.locator('#r-month').count()) { await w.locator('#r-month').selectOption('9'); await w.locator('#r-year').fill('2026') }
  if (filter) await filter(w)
  await w.locator('.toolbar button[data-key=show]').click(); await p.waitForTimeout(400)
  const out = w.locator('.report-out')
  if (await p.locator('.dlg-backdrop').count()) console.log('   dialog:', (await p.locator('.dlg-backdrop .body').last().textContent()).trim())
  const res = { text: await out.textContent(), html: await out.innerHTML(), w }
  return res
}
const shot = async (name, w) => { await w.evaluate((el) => { el.style.width = '1300px'; el.style.height = '860px'; el.style.left = '10px'; el.style.top = '10px' }); await p.screenshot({ path: `${SHOTS}/rep-${name}.png` }) }
const close = async (w) => { await w.locator('.toolbar button[data-key=close]').click(); await p.waitForTimeout(100) }

let r = await run('الحضور والانصراف تفصيلي')
check('detailed: company header (AR + EN) and footer', /شركة الاختبار/.test(r.text) && /Test Co/.test(r.text) && /اسم المستخدم : admin/.test(r.text) && /a@b\.sa/.test(r.text))
check('detailed: one block per employee (4)', (await r.w.locator('.rep-emp').count()) === 4)
check('detailed: 4 periods by default', (await r.w.locator('.rep-emp').first().locator('thead th[colspan="2"]').count()) === 4)
let d = await r.w.locator('tr[data-emp="101"][data-date="2026-09-14"]').evaluate((tr) => ({ ...tr.dataset, cells: [...tr.children].map((c) => c.textContent) }))
check('detailed: 101 on 14th — in 08:10 out 16:30, 10 late, 30 OT, duty 07:50', d.in === '08:10' && d.out === '16:30' && d.late === '00:10' && d.ot === '00:30' && d.cells.includes('07:50'), JSON.stringify(d))
d = await r.w.locator('tr[data-emp="102"][data-date="2026-09-15"]').evaluate((tr) => [...tr.children].map((c) => c.textContent).at(-1))
check('detailed: absent day says «غائب» (red)', d === 'غائب')
d = await r.w.locator('tr[data-emp="103"][data-date="2026-09-14"]').evaluate((tr) => [...tr.children].map((c) => c.textContent))
check('detailed: split shift shows both periods', d.includes('08:05') && d.includes('12:00') && d.includes('14:20') && d.includes('18:30'), d.join('|'))
await shot('detailed', r.w)
// «عدد الورديات التي تظهر في التقارير» = 2
await close(r.w)
await p.evaluate(() => DB.run("INSERT INTO meta (key, value) VALUES ('sys_settings', '{\"report_shifts\":2}') ON CONFLICT(key) DO UPDATE SET value = excluded.value"))
r = await run('الحضور والانصراف تفصيلي')
check('detailed: «عدد الورديات» setting = 2 → 2 period columns', (await r.w.locator('.rep-emp').first().locator('thead th[colspan="2"]').count()) === 2)
await close(r.w)

r = await run('الحضور والانصراف إجمالي')
let row = await r.w.locator('table.rep tbody tr', { hasText: '102' }).evaluate((tr) => [...tr.children].map((c) => c.textContent))
check('total: 102 absent 2 days (15th, 16th) = 16:00 absence hours', row[7] === '16:00', row.join('|'))
check('total: totals row', /الإجمالي/.test(await r.w.locator('table.rep tfoot').textContent()))
await shot('total', r.w); await close(r.w)

r = await run('حالة اليوم', { from: '2026-09-15', to: '2026-09-15' })
check('day status: 101 مداوم, 102 غائب, 104 أجازة', /مداوم/.test(r.text) && /غائب/.test(r.text) && /أجازة/.test(r.text), r.text.slice(0, 300))
await shot('daystatus', r.w); await close(r.w)

r = await run('الغياب خلال فترة')
check('absence: grouped by day with «الغياب يوم»', /الغياب يوم الثلاثاء — 2026-09-15/.test(r.text) && /سالم/.test(r.text), r.text.slice(0, 300))
await shot('absence', r.w); await close(r.w)

r = await run('بيان تأخير الموظفين')
const cells = await r.w.locator('table.month-grid tbody tr').first().locator('td.c').evaluateAll((tds) => tds.map((t) => getComputedStyle(t).backgroundColor))
check('month grid: 30 day cells for September', cells.length === 30)
check('month grid: 14th late (yellow), 17th official holiday, 18th weekly off (orange)', cells[13] === 'rgb(255, 255, 0)' && cells[16] === 'rgb(178, 240, 240)' && cells[17] === 'rgb(255, 165, 0)', cells.slice(13, 18).join(' '))
check('month grid: title with month name', /بيان تأخير الموظفين لشهر سبتمبر 2026/.test(r.text))
await shot('month-grid', r.w); await close(r.w)

r = await run('تأخير وإضافي الشفتات')
row = await r.w.locator('.rep-emp', { has: p.locator('.rep-sub', { hasText: 'رقم الموظف: 103' }) }).locator('tbody tr').first().evaluate((tr) => [...tr.children].map((c) => c.textContent))
check('per-shift: 103 period 1 late 00:05, period 2 late 00:20 + OT 00:30', row[2] === '00:05' && row[4] === '00:20' && row[5] === '00:30', row.join('|'))
await shot('per-shift', r.w); await close(r.w)

r = await run('أذونات الموظفين')
check('permissions report: 101 شخصي 10:00–11:30 = 01:30', /أحمد/.test(r.text) && /شخصي/.test(r.text) && /01:30/.test(r.text))
await close(r.w)
r = await run('حركات الأبواب')
check('door movements: every punch with its device', (await r.w.locator('table.rep tbody tr').count()) === 11 && /بوابة 1/.test(r.text))
await shot('doors', r.w); await close(r.w)
r = await run('الحركات الغير مكتملة')
check('incomplete: 104 on 14th, out «لا يوجد»', /فهد/.test(r.text) && /لا يوجد/.test(r.text))
await close(r.w)
r = await run('إجازات الموظفين')
check('leaves: 104 سنوية 2 days', /فهد/.test(r.text) && /سنوية/.test(r.text) && /سفر/.test(r.text))
await close(r.w)
for (const n of ['مواعيد العمل', 'الموظفين', 'التأخير عن بداية الدوام اليومي', 'التأخير عن الدوام خلال فترة', 'الحضور والانصراف بالحركات', 'الجزاءات']) {
  r = await run(n, { from: '2026-09-14', to: n === 'التأخير عن بداية الدوام اليومي' ? '2026-09-14' : '2026-09-16' })
  check(`«${n}» renders without error`, !/NaN|undefined/.test(r.text) && /شركة الاختبار/.test(r.text))
  await close(r.w)
}

// «الموظفون» filters
const codesOf = (w) => w.locator('table.rep tbody tr').evaluateAll((trs) => trs.map((tr) => tr.children[1]?.textContent).filter((c) => /^\d+$/.test(c || '')).join())
r = await run('الحضور والانصراف إجمالي', { filter: async (w) => { await w.locator('#rf-dep').check(); await w.locator('#r-dep').selectOption('1') } })
check('filter: department «الإدارة» includes its section «الدعم» (101, 102)', (await codesOf(r.w)) === '101,102', await codesOf(r.w)); await close(r.w)
r = await run('الحضور والانصراف إجمالي', { filter: async (w) => { await w.locator('#rf-shift').check(); await w.locator('#r-shift').selectOption('2') } })
check('filter: shift «مقسم» → 103', (await codesOf(r.w)) === '103', await codesOf(r.w)); await close(r.w)
r = await run('الحضور والانصراف إجمالي', { filter: async (w) => { await w.locator('#rf-group').check(); await w.locator('#r-group').selectOption('1') } })
check('filter: group «الفرقة أ» → 101, 103', (await codesOf(r.w)) === '101,103', await codesOf(r.w)); await close(r.w)
r = await run('الحضور والانصراف إجمالي', { filter: async (w) => { await w.locator('#rf-codes').check(); await w.locator('#r-code-from').fill('102'); await w.locator('#r-code-to').fill('103') } })
check('filter: numbers 102–103', (await codesOf(r.w)) === '102,103', await codesOf(r.w)); await close(r.w)
r = await run('الحضور والانصراف إجمالي', { filter: async (w) => { await w.locator('#rf-dep').check(); await w.locator('#r-dep').selectOption('1'); await w.locator('#rf-group').check(); await w.locator('#r-group').selectOption('1') } })
check('filter: department AND group combine → 101', (await codesOf(r.w)) === '101', await codesOf(r.w)); await close(r.w)

// Excel with several employee blocks (unique sheet names)
r = await run('الحضور والانصراف تفصيلي')
const xl = await p.evaluate(() => { const wb = XLSX.utils.book_new(); let ok = true
  try { document.querySelectorAll('.win .report-out table.rep').forEach((t, i) => { let n = 'الحضور والانصراف تفصيلي'.slice(0, 26); if (wb.SheetNames.includes(n)) n = `${n.slice(0, 22)} (${i + 1})`; XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(t), n) }) } catch (e) { ok = String(e) }
  return { ok, sheets: wb.SheetNames.length } })
check('excel: one sheet per employee table, unique names', xl.ok === true && xl.sheets === 4, JSON.stringify(xl))

// Apex: reading punches of an unknown number creates «موظف جديد»
const ac = await p.evaluate(async () => {
  const r1 = await storePunches([{ code: '5000', ts: '2026-09-14 09:00:00' }, { code: '5000', ts: '2026-09-14 17:00:00' }], 'device', 1)
  const e = DB.one("SELECT * FROM employees WHERE code = '5000'")
  const n = DB.one("SELECT COUNT(*) n FROM punches WHERE emp_code = '5000'").n
  WebSync.linked = true
  const r2 = await storePunches([{ code: '6000', ts: '2026-09-14 09:00:00' }], 'device', 1)
  WebSync.linked = false
  licence = { ok: false }
  const r3 = await storePunches([{ code: '7000', ts: '2026-09-14 09:00:00' }], 'device', 1)
  licence = { ok: true, edition: 'Gold' }
  return { r1: r1.text, name: e?.name_ar, en: e?.name_en, n, r2: r2.text, six: !!DB.one("SELECT 1 FROM employees WHERE code = '6000'"), r3: r3.text, seven: !!DB.one("SELECT 1 FROM employees WHERE code = '7000'") }
})
check('unknown number → «موظف جديد» / New Employee + its punches stored', ac.name === 'موظف جديد' && ac.en === 'New Employee' && ac.n === 2 && /موظفين جدد 1/.test(ac.r1), JSON.stringify(ac))
check('linked to the site → not created (site owns employees)', !ac.six && /غير معرّفة 1/.test(ac.r2), ac.r2)
check('trial over its employee limit → not created', !ac.seven && /غير معرّفة 1/.test(ac.r3), ac.r3)

// «الموظفين»: right-click → «نقل الموظف الى قسم اخر»
await p.evaluate(() => Perm.run('البيانات الأساسية/الموظفين', openEmployees))
let ew = win('الموظفين')
await ew.locator('tbody tr', { hasText: '104' }).click({ button: 'right' }); await p.locator('.ctx-menu button').click()
await p.locator('#mv-tree .tn', { hasText: 'الدعم' }).click(); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(250)
const mv = await p.evaluate(() => DB.one("SELECT department_id, section_id FROM employees WHERE code = '104'"))
check('employees: move to section «الدعم» → department = its parent, section = الدعم', mv.department_id === 1 && mv.section_id === 3, JSON.stringify(mv))
await ew.locator('.dept-tree .tn', { hasText: 'الدعم' }).click(); await p.waitForTimeout(150)
check('employees: tree filter «الدعم» → 102 + 104', (await ew.locator('tbody tr').count()) === 2)
await ew.locator('.toolbar button[data-key=close]').click()

// «إضافة إجازات لموظف» → «إجازة لمجموعة»
await p.evaluate(() => Perm.run('الإجراءات/إضافة إجازات لموظف', openLeaves))
const lw = win('إضافة إجازات لموظف')
await lw.locator('.toolbar button[data-key=group]').click()
await p.locator('#gl-g').selectOption('1'); await p.locator('#gl-f').fill('2026-09-21'); await p.locator('#gl-to').fill('2026-09-22')
await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(250)
check('group leave: added for every active member (101, 103)', /لـ 2 موظف/.test(await p.locator('.dlg-backdrop .body').last().textContent()))
await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click()
check('group leave: rows exist', (await p.evaluate(() => DB.one("SELECT COUNT(*) n FROM leaves WHERE from_date = '2026-09-21'").n)) === 2)
await lw.locator('.toolbar button[data-key=close]').click()

// «الغاء جميع بيانات الموظف»: a number range + password
await p.evaluate(async () => { const { hashPassword: h } = window; DB.run('UPDATE users SET password = ? WHERE id = 1', [await hashPassword('pw1234')]) })
await p.evaluate(() => { purgeEmployee() })
await p.locator('#pe-from').fill('5000'); await p.locator('#pe-to').fill('6000')
await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'الغاء البيانات' }).click(); await p.waitForTimeout(150)
await p.locator('#ap-pw').fill('pw1234'); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(150)
await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'نعم' }).click(); await p.waitForTimeout(250)
check('purge range 5000–6000: the auto-created «موظف جديد» and its punches removed', /تم حذف جميع بيانات 1 موظف/.test(await p.locator('.dlg-backdrop .body').last().textContent()) &&
  (await p.evaluate(() => DB.one("SELECT COUNT(*) n FROM punches WHERE emp_code = '5000'").n)) === 0)

console.log(`\n${pass} passed, ${fail} failed`)
await app.close()
fs.rmSync(UD, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
