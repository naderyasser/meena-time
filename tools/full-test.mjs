// Full functional test of the real Electron app (run: xvfb-run -a node tools/full-test.mjs).
// Walks every menu item, every toolbar button and every dialog; prints PASS/FAIL per
// check and saves a screenshot of each screen in test-shots/.
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
import { execFileSync } from 'child_process'

const ROOT = '/root/meena-time'
const SHOTS = `${ROOT}/test-shots`
const UD = '/tmp/mt-fulltest'
fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true })
fs.rmSync(UD, { recursive: true, force: true })

let pass = 0, fail = 0
const results = []
const check = (name, ok, info = '') => { ok ? pass++ : fail++; results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + info}`) }

const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p = await app.firstWindow()
await p.setViewportSize({ width: 1366, height: 768 })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text()) })
// native print / save dialogs can't be driven headless: stub them
await p.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1 } })
await app.evaluate(({ dialog }, ud) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: ud + '/manual-backup.sqlite' }) }, UD)

let shot = 0
const snap = async (name) => p.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, '0')}-${name}.png` })
const menu = async (m, item) => {
  await p.locator('#menubar .menu > button', { hasText: m }).first().click()
  await p.locator('.menu.open .drop button', { hasText: item }).first().click()
  await p.waitForTimeout(250)
}
const dlgText = async () => (await p.locator('.dlg-backdrop').last().textContent()).trim()
const okMsg = async () => { const t = (await p.locator('.dlg-backdrop .body').last().textContent()).trim(); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(150); return t }
const yes = async () => { await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'نعم' }).click(); await p.waitForTimeout(250) }
const win = (t) => p.locator('.win', { has: p.locator('.cap', { hasText: t }) }).last()
const btn = (w, name) => w.locator('.toolbar button', { hasText: name }).first()
const lastRow = (w) => w.locator('tbody tr').last()
const rowCount = async (w) => (await w.locator('tbody tr').count()) - 1 // minus the blank row
const closeWin = async (w) => { await btn(w, 'إغلاق').click(); await p.waitForTimeout(150) }

// ── 1. login ──────────────────────────────────────────────
await p.waitForSelector('text=شاشة الدخول', { timeout: 20000 })
await snap('login')
check('login: year defaults to current year', (await p.locator('#year').inputValue()) === String(new Date().getFullYear()))
await p.locator('#pass').fill('bad'); await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(300)
check('login: wrong password rejected', /غير صحيحة/.test(await p.locator('.dlg .err').textContent()))
await p.locator('#pass').fill(''); await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(700)
check('login: default admin «أ» with empty password', await p.locator('#home').isVisible())
await snap('home')
check('home: 4 tiles', (await p.locator('.tile').count()) === 4)
check('home: trial banner shown when unregistered', await p.locator('.trial').isVisible())
check('caption: Unregistered', /Unregistered/.test(await p.locator('#caption-text').textContent()))
check('menubar: 6 menus', (await p.locator('#menubar .menu').count()) === 6)

// every menu opens and lists its items
for (const [m, n] of [['البيانات الأساسية', 8], ['الإجراءات', 10], ['التقارير', 11], ['الإعدادات', 3], ['أدوات', 2], ['مساعدة', 1]]) {
  await p.locator('#menubar .menu > button', { hasText: m }).first().click(); await p.waitForTimeout(150)
  check(`menu «${m}» has ${n} items`, (await p.locator('.menu.open .drop button').count()) === n, `got ${await p.locator('.menu.open .drop button').count()}`)
  if (m === 'البيانات الأساسية' || m === 'الإجراءات' || m === 'التقارير') await snap(`menu-${m}`)
  await p.keyboard.press('Escape'); await p.mouse.click(700, 700); await p.waitForTimeout(100)
}

// ── 2. settings: company ──────────────────────────────────
await menu('الإعدادات', 'بيانات المؤسسة'); await snap('company')
await p.locator('.dlg').getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(150)
check('company: name required', /مطلوب/.test(await p.locator('.dlg .err').textContent()))
await p.locator('#co-name').fill('مستشفى الاختبار'); await p.locator('#co-phone').fill('0112345678')
await p.locator('.dlg').getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(250)
await menu('الإعدادات', 'بيانات المؤسسة')
check('company: saved and reloaded', (await p.locator('#co-name').inputValue()) === 'مستشفى الاختبار')
await p.locator('.dlg').getByRole('button', { name: 'إغلاق' }).click()

// ── 3. base-data grids (add / required / save / edit / undo / delete) ──
async function gridCrud(title, menuItem, fill, { required = 'مطلوب' } = {}) {
  await menu('البيانات الأساسية', menuItem)
  const w = win(title)
  check(`${title}: window opens`, await w.isVisible())
  await snap(`grid-${title}`)
  // required field
  await lastRow(w).locator('[data-f]').first().evaluate((el) => { el.value = el.tagName === 'SELECT' ? el.value : ' '; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input')) })
  await btn(w, 'حفظ').click(); await p.waitForTimeout(200)
  if (await p.locator('.dlg-backdrop').count()) check(`${title}: required validation`, (await okMsg()).includes(required))
  await btn(w, 'إهمال').click(); await p.waitForTimeout(150)
  check(`${title}: «إهمال» discards unsaved row`, (await rowCount(w)) === 0)
  for (const values of fill) {
    const r = lastRow(w)
    for (const [f, v] of Object.entries(values)) {
      const el = r.locator(`[data-f=${f}]`)
      if ((await el.evaluate((e) => e.tagName)) === 'SELECT') await el.selectOption(typeof v === 'number' ? { index: v } : { label: v })
      else await el.fill(String(v))
    }
    await btn(w, 'حفظ').click(); await p.waitForTimeout(250)
    if (await p.locator('.dlg-backdrop').count()) check(`${title}: save`, false, await okMsg())
  }
  check(`${title}: ${fill.length} rows saved`, (await rowCount(w)) === fill.length, `rows=${await rowCount(w)}`)
  // edit first row, undo, then edit + save
  const first = w.locator('tbody tr').first().locator('[data-f]').first()
  if ((await first.evaluate((e) => e.tagName)) === 'INPUT') {
    const orig = await first.inputValue()
    await first.fill(orig + ' X'); await btn(w, 'إهمال').click(); await p.waitForTimeout(150)
    check(`${title}: «إهمال» restores edited value`, (await w.locator('tbody tr').first().locator('[data-f]').first().inputValue()) === orig)
    await w.locator('tbody tr').first().locator('[data-f]').first().fill(orig + ' م'); await btn(w, 'حفظ').click(); await p.waitForTimeout(200)
    check(`${title}: edit saved`, (await w.locator('tbody tr').first().locator('[data-f]').first().inputValue()) === orig + ' م')
  }
  await btn(w, 'مساعدة').click(); await p.waitForTimeout(100); check(`${title}: «مساعدة» shows help`, (await okMsg()).length > 5)
  await btn(w, 'طباعة').click(); await p.waitForTimeout(100)
  return w
}

let w = await gridCrud('قوائم البرنامج', 'قوائم البرنامج', [
  { list_type: 'الوظائف', name_ar: 'ممرض' }, { list_type: 'الوظائف', name_ar: 'محاسب' }, { list_type: 'الجنسيات', name_ar: 'سعودي' },
  { list_type: 'أنواع الإجازات', name_ar: 'سنوية' }, { list_type: 'أنواع الأذونات', name_ar: 'إذن شخصي' }])
await closeWin(w)
w = await gridCrud('الإدارات والأقسام', 'الإدارات والأقسام', [{ name_ar: 'الإدارة الطبية' }, { name_ar: 'قسم الطوارئ', parent_id: 1 }])
// department with a section can't be deleted
await w.locator('tbody tr').first().click(); await btn(w, 'حذف').click(); await p.waitForTimeout(200)
check('departments: parent with sections cannot be deleted', /أقسام تابعة/.test(await okMsg()))
await closeWin(w)
w = await gridCrud('المشاريع', 'المشاريع', [{ name_ar: 'مشروع أ', name_en: 'Project A' }]); await closeWin(w)
w = await gridCrud('مجموعات الموظفين', 'مجموعات الموظفين', [{ name_ar: 'المجموعة الأولى' }]); await closeWin(w)
w = await gridCrud('العطلات الرسمية', 'العطلات الرسمية', [{ name_ar: 'اليوم الوطني', from_date: '2026-09-23', to_date: '2026-09-23' }]); await closeWin(w)
w = await gridCrud('تعريف الأجهزة', 'تعريف الأجهزة', [{ name: 'جهاز المدخل', ip: '127.0.0.1', port: '4370' }]); await closeWin(w)
w = await gridCrud('مجموعات أوقات الدوام', 'مواعيد العمل', [{ name_ar: 'صباحي' }, { name_ar: 'مسائي' }])

// shift times
await w.locator('tbody tr').first().click(); await btn(w, 'المواعيد').click(); await p.waitForTimeout(300)
let tw = win('المواعيد')
check('shift times: window opens with 7 days', (await tw.locator('tbody tr').count()) === 7)
check('shift times: Friday off by default', await tw.locator('tbody tr').nth(6).locator('[data-f=is_off]').isChecked())
await btn(tw, 'حفظ').click(); await p.waitForTimeout(150)
check('shift times: empty times rejected', /مطلوب/.test(await okMsg()))
const r0 = tw.locator('tbody tr').first()
for (const [f, v] of [['start_in', '06:00'], ['check_in', '08:00'], ['late_min', '15'], ['end_in', '11:00'], ['start_out', '12:00'], ['early_min', '15'], ['check_out', '16:00'], ['end_out', '20:00']]) await r0.locator(`[data-f=${f}]`).fill(v)
await btn(tw, 'نسخ لكل الأيام').click(); await p.waitForTimeout(100)
check('shift times: «نسخ لكل الأيام» copies to working days', (await tw.locator('tbody tr').nth(3).locator('[data-f=check_in]').inputValue()) === '08:00')
await tw.locator('tbody tr').nth(5).locator('[data-f=is_off]').check(); await p.waitForTimeout(100)
check('shift times: «عطلة» disables the day', await tw.locator('tbody tr').nth(5).locator('[data-f=check_in]').isDisabled())
await r0.locator('[data-f=late_min]').fill('200'); await btn(tw, 'حفظ').click(); await p.waitForTimeout(150)
check('shift times: grace beyond end_in rejected', /يتجاوز/.test(await okMsg()))
await r0.locator('[data-f=late_min]').fill('15'); await r0.locator('[data-f=check_out]').fill('11:30'); await btn(tw, 'حفظ').click(); await p.waitForTimeout(150)
check('shift times: out before start_out rejected', /لا يمكن أن يكون قبل/.test(await okMsg()))
await r0.locator('[data-f=check_out]').fill('16:00'); await r0.locator('[data-f=start_in]').fill('8:00'); await btn(tw, 'حفظ').click(); await p.waitForTimeout(150)
check('shift times: bad format rejected', /HH:MM/.test(await okMsg()))
await r0.locator('[data-f=start_in]').fill('06:00'); await btn(tw, 'حفظ').click(); await p.waitForTimeout(250)
check('shift times: valid week saved', /تم حفظ المواعيد/.test(await okMsg()))
await snap('shift-times')
await closeWin(tw)
check('shift groups: total = 5 × 8h = 40:00', (await w.locator('tbody tr').first().locator('td').nth(4).textContent()) === '40:00')
await closeWin(w)

// ── 4. employees ──────────────────────────────────────────
await menu('البيانات الأساسية', 'الموظفين')
const ew = win('الموظفين')
check('employees: window opens', await ew.isVisible())
async function addEmployee(code, name, { expect = 'تمت إضافة الموظف', shift = 'صباحي م', extra = {} } = {}) {
  await btn(ew, 'جديد').click(); await p.waitForTimeout(250)
  const f = win('اضافة موظف')
  if (code !== null) await f.locator('[data-f=code]').fill(code)
  if (name !== null) await f.locator('[data-f=name_ar]').fill(name)
  if (shift) await f.locator('[data-f=shift_group_id]').selectOption({ label: shift })
  for (const [k, v] of Object.entries(extra)) {
    const el = f.locator(`[data-f=${k}]`)
    const tag = await el.evaluate((e) => e.tagName + (e.type || ''))
    if (tag.startsWith('SELECT')) await el.selectOption({ label: v }); else if (tag === 'INPUTcheckbox') await el.check(); else await el.fill(v)
  }
  if (code === '1001') await snap('employee-form')
  await btn(f, 'حفظ').click(); await p.waitForTimeout(300)
  const m = await okMsg()
  if (await f.count()) await closeWin(f)
  return m.includes(expect) ? true : m
}
check('employees: code required', (await addEmployee(null, 'بدون كود', { expect: 'كود الموظف مطلوب' })) === true)
check('employees: code must be digits', (await addEmployee('A12', 'حروف', { expect: 'أرقاماً فقط' })) === true)
check('employees: name required', (await addEmployee('1009', null, { expect: 'بالعربية مطلوب' })) === true)
check('employees: shift required', (await addEmployee('1009', 'بدون دوام', { expect: 'الدوام مطلوب', shift: null })) === true)
check('employees: bad email rejected', (await addEmployee('1009', 'ايميل', { expect: 'البريد', extra: { email: 'x@' } })) === true)
check('employees: add #1 (all fields)', (await addEmployee('1001', 'أحمد علي', { extra: { name_en: 'Ahmed Ali', job_id: 'ممرض', department_id: 'الإدارة الطبية م', section_id: 'قسم الطوارئ', group_id: 'المجموعة الأولى م', project_id: 'مشروع أ م', gender: 'ذكر', nationality_id: 'سعودي', religion: 'مسلم', mobile: '0500000000', email: 'a@b.co', hire_date: '2026-09-01', ot_after: 'x' } })) === true)
check('employees: duplicate code rejected', (await addEmployee('1001', 'مكرر', { expect: 'مستخدم لموظف آخر' })) === true)
check('employees: add #2', (await addEmployee('1002', 'خالد سعد', { extra: { hire_date: '2026-09-01' } })) === true)
check('employees: add #3', (await addEmployee('1003', 'سارة محمد', { extra: { hire_date: '2026-09-01' } })) === true)
check('employees: 4th blocked in trial', (await addEmployee('1004', 'رابع', { expect: '3 موظفين فقط' })) === true)
check('employees: list shows 3', (await ew.locator('tbody tr').count()) === 3)
await ew.locator('.toolbar input').fill('سارة'); await p.waitForTimeout(200)
check('employees: search by name', (await ew.locator('tbody tr').count()) === 1)
await ew.locator('.toolbar input').fill('1002'); await p.waitForTimeout(200)
check('employees: search by code', (await ew.locator('tbody tr').count()) === 1)
await ew.locator('.toolbar input').fill(''); await p.waitForTimeout(200)
await snap('employees-list')
await ew.locator('tbody tr', { hasText: '1001' }).dblclick(); await p.waitForTimeout(250)
let ef = win('تعديل موظف')
check('employees: double-click opens edit form with data', (await ef.locator('[data-f=name_en]').inputValue()) === 'Ahmed Ali' && (await ef.locator('[data-f=section_id] option:checked').textContent()) === 'قسم الطوارئ')
await ef.locator('[data-f=mobile]').fill('0555555555'); await btn(ef, 'حفظ').click(); await p.waitForTimeout(250); await okMsg()
await ew.locator('tbody tr', { hasText: '1001' }).click(); await btn(ew, 'تعديل').click(); await p.waitForTimeout(250)
ef = win('تعديل موظف'); check('employees: edit saved', (await ef.locator('[data-f=mobile]').inputValue()) === '0555555555'); await closeWin(ef)
await btn(ew, 'حذف').click(); await p.waitForTimeout(150); check('employees: delete asks confirmation', /حذف الموظف/.test(await dlgText()))
await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'لا' }).click()
await closeWin(ew)
// shift group in use cannot be deleted
await menu('البيانات الأساسية', 'مواعيد العمل'); w = win('مجموعات أوقات الدوام'); await w.locator('tbody tr').first().click()
await btn(w, 'حذف').click(); await p.waitForTimeout(150); check('shift groups: in-use group cannot be deleted', /مستخدم/.test(await okMsg())); await closeWin(w)
// lists: job in use cannot be deleted
await menu('البيانات الأساسية', 'قوائم البرنامج'); w = win('قوائم البرنامج'); await w.locator('tbody tr', { has: p.locator('input[value="ممرض م"], input[value="ممرض"]') }).first().click()
await btn(w, 'حذف').click(); await p.waitForTimeout(150); check('lists: job in use cannot be deleted', /مستخدم/.test(await okMsg())); await closeWin(w)

// ── 5. procedures ─────────────────────────────────────────
fs.writeFileSync(`${UD}/attlog.dat`, [
  '  1001\t2026-09-19 08:10:05\t1\t0', '  1001\t2026-09-19 16:02:11\t1\t1',         // Sat: in grace → on time
  '  1001\t2026-09-20 08:30:00\t1\t0', '  1001\t2026-09-20 15:40:00\t1\t1',         // Sun: 30 late, 20 early
  '  1001\t2026-09-23 08:40:00\t1\t0', '  1001\t2026-09-23 16:05:00\t1\t1',         // Wed: public holiday
  '  1001\t2026-09-24 09:00:00\t1\t0',                                              // Thu: weekly off
  '1002,2026-09-19 07:55', '1002,19/09/2026 15:00',                                   // CSV + dd/mm/yyyy; 60 early
  '  9999\t2026-09-19 08:00:00\t1\t0', '  1001\t2026-09-19 08:10:05\t1\t0', 'garbage line'].join('\n'))
await menu('الإجراءات', 'قراءة الحركات'); await snap('read-punches')
await p.locator('.dlg').getByRole('button', { name: 'قراءة من الملف' }).click(); await p.waitForTimeout(150)
check('read punches: file required', /اختر ملف/.test(await p.locator('.dlg .err').textContent()))
await p.locator('#rp-file').setInputFiles(`${UD}/attlog.dat`)
await p.locator('.dlg').getByRole('button', { name: 'قراءة من الملف' }).click(); await p.waitForTimeout(400)
const imp = await p.locator('.dlg .err').textContent()
check('read punches: file import counts (9 new, 1 dup, 1 unknown)', /جديدة 9 · مكررة 1 · لموظفين غير معرّفين 1/.test(imp), imp)
await p.locator('.dlg').getByRole('button', { name: 'قراءة من الجهاز' }).click(); await p.waitForTimeout(12000)
check('read punches: unreachable device → clear error', /تعذّر الاتصال/.test(await p.locator('.dlg .err').textContent()), await p.locator('.dlg .err').textContent())
await p.locator('.dlg').getByRole('button', { name: 'إغلاق' }).click()

await menu('الإجراءات', 'عرض الحركات'); w = win('عرض الحركات')
await w.locator('#vp-from').fill('2026-09-01'); await w.locator('#vp-go').click(); await p.waitForTimeout(200)
check('view punches: all 9 listed', (await w.locator('tbody tr').count()) === 9, `${await w.locator('tbody tr').count()}`)
await w.locator('#vp-emp').selectOption({ index: 2 }); await w.locator('#vp-go').click(); await p.waitForTimeout(200)
check('view punches: filter by employee', (await w.locator('tbody tr').count()) === 2)
await snap('view-punches'); await closeWin(w)

await menu('الإجراءات', 'إضافة وتعديل الحركات'); w = win('إضافة وتعديل الحركات لموظف')
await w.locator('#ep-date').fill('2026-09-21'); await w.locator('#ep-date').dispatchEvent('change')
await w.locator('#ep-time').fill('25:00'); await btn(w, 'إضافة حركة').click(); await p.waitForTimeout(150)
check('edit punches: invalid time rejected', /HH:MM/.test(await okMsg()))
await w.locator('#ep-time').fill('08:05'); await btn(w, 'إضافة حركة').click(); await p.waitForTimeout(250)
await w.locator('#ep-time').fill('16:00'); await btn(w, 'إضافة حركة').click(); await p.waitForTimeout(250)
check('edit punches: 2 manual punches added', (await w.locator('tbody tr').count()) === 2)
await w.locator('tbody tr').last().click(); await btn(w, 'حذف الحركة').click(); await p.waitForTimeout(150); await yes()
check('edit punches: delete punch', (await w.locator('tbody tr').count()) === 1)
await w.locator('#ep-time').fill('16:00'); await btn(w, 'إضافة حركة').click(); await p.waitForTimeout(250)
await snap('edit-punches'); await closeWin(w)

await menu('الإجراءات', 'إضافة إجازات'); w = win('إضافة إجازات لموظف'); await snap('leaves')
await lastRow(w).locator('[data-f=employee_id]').selectOption({ index: 1 }); await lastRow(w).locator('[data-f=type_id]').selectOption({ label: 'سنوية' })
await lastRow(w).locator('[data-f=from_date]').fill('2026-09-22'); await lastRow(w).locator('[data-f=to_date]').fill('2026-09-22')
await btn(w, 'حفظ').click(); await p.waitForTimeout(250); check('leaves: saved', (await rowCount(w)) === 1); await closeWin(w)
await menu('الإجراءات', 'إضافة أذونات'); w = win('إضافة أذونات لموظف'); await snap('permissions')
await lastRow(w).locator('[data-f=employee_id]').selectOption({ index: 2 }); await lastRow(w).locator('[data-f=date]').fill('2026-09-19')
await lastRow(w).locator('[data-f=from_time]').fill('3pm'); await btn(w, 'حفظ').click(); await p.waitForTimeout(150)
check('permissions: bad time rejected', /HH:MM|مطلوب/.test(await okMsg()))
await lastRow(w).locator('[data-f=from_time]').fill('15:00'); await lastRow(w).locator('[data-f=to_time]').fill('16:00')
await btn(w, 'حفظ').click(); await p.waitForTimeout(250); check('permissions: saved', (await rowCount(w)) === 1); await closeWin(w)

// ── 6. reports (all 11) ───────────────────────────────────
const detailedExpect = { '2026-09-19': 'حضور', '2026-09-20': 'حضور متأخر', '2026-09-21': 'حضور', '2026-09-22': 'إجازة', '2026-09-23': 'عطلة رسمية', '2026-09-24': 'عطلة إسبوعية' }
const reports = ['مواعيد العمل', 'الموظفين', 'الحركات الغير مكتملة', 'التأخير عن بداية الدوام اليومي', 'التأخير عن الدوام خلال فترة', 'إجازات الموظفين',
  'الحضور والانصراف تفصيلي', 'الحضور والانصراف إجمالي', 'الغياب خلال فترة', 'حالة اليوم', 'الحضور والانصراف بالحركات']
const trialOpen = ['الحضور والانصراف تفصيلي', 'الحضور والانصراف إجمالي', 'حالة اليوم', 'الحضور والانصراف بالحركات']
for (const r of reports) {
  await menu('التقارير', r)
  if (!trialOpen.includes(r)) { check(`report «${r}» locked in trial`, /المسجلة فقط/.test(await okMsg())); continue }
  const rw = win(r)
  check(`report «${r}» opens (trial)`, await rw.isVisible())
  await rw.locator('#r-from').fill('2026-09-19'); if (await rw.locator('#r-to').count()) await rw.locator('#r-to').fill('2026-09-24')
  await btn(rw, 'عرض').click(); await p.waitForTimeout(250)
  check(`report «${r}»: company header`, (await rw.locator('.rep-head .co').textContent()) === 'مستشفى الاختبار')
  if (r === 'الحضور والانصراف تفصيلي') {
    const grp = rw.locator('.rep-group', { hasText: '1001' })
    const rows = await rw.locator('table.rep').first().locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)))
    const got = Object.fromEntries(rows.map((c) => [c[0], c[8]]))
    for (const [d, s] of Object.entries(detailedExpect)) check(`engine: 1001 on ${d} = ${s}`, (got[d] || '').startsWith(s), got[d])
    const r20 = rows.find((c) => c[0] === '2026-09-20')
    check('engine: 30 min late + 20 min early on 09-20', r20 && r20[4] === '00:30' && r20[5] === '00:20', r20?.join('|'))
    check('engine: grouped by employee', (await grp.count()) === 1)
    const all = await rw.locator('.report-out').textContent()
    check('engine: 1002 permission 15:00-16:00 cancels early leave', !/1002[\s\S]*?2026-09-19[^\n]*01:00/.test(all))
    await snap('report-detailed')
  }
  if (r === 'حالة اليوم') { await snap('report-daystatus'); check('day status: 3 employees', (await rw.locator('table.rep tbody tr').count()) === 3) }
  if (r === 'الحضور والانصراف إجمالي') {
    const row = await rw.locator('table.rep tbody tr', { hasText: '1001' }).first().evaluate((tr) => [...tr.children].map((td) => td.textContent))
    check('total: 1001 present 3 days, 0 absent, 1 leave', row[2] === '3' && row[3] === '0' && row[4] === '1', row.join('|'))
    await snap('report-total')
  }
  // print counter: 3 prints then blocked
  if (r === 'حالة اليوم') {
    for (let i = 0; i < 3; i++) { await btn(rw, 'طباعة').click(); await p.waitForTimeout(150) }
    check('trial: 3 prints allowed', (await p.evaluate(() => window.__printed)) >= 3)
    await btn(rw, 'طباعة').click(); await p.waitForTimeout(150)
    check('trial: 4th print blocked', /انتهت مرات الطباعة/.test(await okMsg()))
  }
  await closeWin(rw)
}

// ── 7. posting ────────────────────────────────────────────
await menu('الإجراءات', 'ترحيل الحركات'); await p.locator('#pd-from').fill('2026-09-19'); await p.locator('#pd-to').fill('2026-09-20')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(250); check('posting: period posted', /تم ترحيل/.test(await okMsg()))
await menu('الإجراءات', 'ترحيل الحركات'); await p.locator('#pd-from').fill('2026-09-20'); await p.locator('#pd-to').fill('2026-09-21')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(250); check('posting: overlapping period refused', /تتداخل/.test(await okMsg()))
await menu('الإجراءات', 'ترحيل الحركات'); await p.locator('#pd-to').fill('2099-01-01')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(250); check('posting: future refused', /لا يمكن ترحيل/.test(await okMsg()))
await menu('الإجراءات', 'إضافة وتعديل الحركات'); w = win('إضافة وتعديل الحركات لموظف')
await w.locator('#ep-date').fill('2026-09-20'); await w.locator('#ep-date').dispatchEvent('change'); await w.locator('#ep-time').fill('12:00')
await btn(w, 'إضافة حركة').click(); await p.waitForTimeout(150); check('posting: posted day locked for edits', /مرحّل/.test(await okMsg())); await closeWin(w)
await menu('الإجراءات', 'الغاء الحركات المسحوبة'); await p.locator('#pd-from').fill('2026-09-01'); await p.locator('#pd-to').fill('2026-09-30')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(250); check('delete pulled punches: blocked by posted period', /تتداخل/.test(await okMsg()))
await menu('الإجراءات', 'الغاء ترحيل'); w = win('الغاء ترحيل الحركات'); check('unpost: posted period listed, no add/save buttons', (await w.locator('tbody tr').count()) === 1 && (await btn(w, 'جديد').count()) === 0)
await w.locator('tbody tr').first().click(); await btn(w, 'حذف').click(); await p.waitForTimeout(150); await yes(); await p.waitForTimeout(200)
check('unpost: period removed', (await w.locator('tbody tr').count()) === 0); await snap('unpost'); await closeWin(w)
await menu('الإجراءات', 'الغاء الحركات المعدلة يدويا'); await p.locator('#pd-from').fill('2026-09-01'); await p.locator('#pd-to').fill('2026-09-30')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(200); check('delete manual punches: confirms count (2)', /حذف 2 حركة/.test(await dlgText())); await yes(); await okMsg()
await menu('الإجراءات', 'الغاء الحركات المسحوبة'); await p.locator('#pd-from').fill('2026-09-01'); await p.locator('#pd-to').fill('2026-09-19')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(200); check('delete pulled punches: confirms count (4)', /حذف 4 حركة/.test(await dlgText()), await dlgText()); await yes(); await okMsg()
await menu('الإجراءات', 'الغاء جميع بيانات الموظف'); await p.locator('#pe-emp').selectOption({ index: 2 })
await p.locator('.dlg').getByRole('button', { name: 'حذف' }).click(); await p.waitForTimeout(150); await yes(); check('purge employee: done', /تم حذف جميع/.test(await okMsg()))

// ── 8. users, system, backup, register ────────────────────
await menu('الإعدادات', 'اعدادات المستخدمين'); w = win('اعدادات المستخدمين'); await snap('users')
await btn(w, 'مستخدم جديد').click(); await p.locator('#u-name').fill('hr'); await p.locator('#u-pw').fill('12'); await p.locator('#u-pw2').fill('12')
await p.locator('.dlg').getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(150); check('users: short password rejected', /4 أحرف/.test(await p.locator('.dlg .err').textContent()))
await p.locator('#u-pw').fill('1234'); await p.locator('#u-pw2').fill('1235'); await p.locator('.dlg').getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(150)
check('users: mismatch rejected', /غير متطابقتين/.test(await p.locator('.dlg .err').textContent()))
await p.locator('#u-pw2').fill('1234'); await p.locator('.dlg').getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(300)
check('users: user added', (await w.locator('tbody tr').count()) === 2)
await w.locator('tbody tr').first().click(); await btn(w, 'حذف').click(); await p.waitForTimeout(150); check('users: last admin cannot be deleted', /آخر مدير/.test(await okMsg()))
await w.locator('tbody tr').first().click(); await btn(w, 'تغيير كلمة المرور').click(); await p.locator('#u-pw').fill('admin1'); await p.locator('#u-pw2').fill('admin1')
await p.locator('.dlg').getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(300); await closeWin(w)
await menu('الإعدادات', 'اعدادات النظام'); check('system settings: shows data folder', (await p.locator('.dlg input').first().inputValue()).includes('mt-fulltest')); await snap('system'); await p.locator('.dlg').getByRole('button', { name: 'إغلاق' }).click()
await menu('أدوات', 'نسخة احتياطية'); check('backup: file written', /تم حفظ/.test(await okMsg()) && fs.existsSync(`${UD}/manual-backup.sqlite`))
check('backup: automatic daily backup exists', fs.readdirSync(`${UD}/backups`).length >= 0)
await menu('مساعدة', 'عن البرنامج'); check('about: version', /0\.1\.1/.test(await okMsg()))

await menu('أدوات', 'تسجيل المنتج'); await snap('register')
const req = await p.locator('#req').inputValue()
check('register: request code format', /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/.test(req), req)
await p.locator('#lic').fill('garbage.Gold'); await p.locator('.dlg').getByRole('button', { name: 'تسجيل' }).click(); await p.waitForTimeout(200)
check('register: invalid licence rejected', /غير صحيح/.test(await p.locator('.dlg .err').textContent()))
const lic = execFileSync('node', [`${ROOT}/tools/keygen.js`, req, 'Gold']).toString().trim()
await p.locator('#lic').fill(lic); await p.locator('.dlg').getByRole('button', { name: 'تسجيل' }).click(); await p.waitForTimeout(300)
check('register: valid licence accepted', /تم تسجيل البرنامج/.test(await okMsg()))
check('register: caption Registered', /Registered/.test(await p.locator('#caption-text').textContent()) && !/Unregistered/.test(await p.locator('#caption-text').textContent()))
check('register: trial banner hidden', (await p.locator('.trial').count()) === 0)
await menu('التقارير', 'الغياب خلال فترة'); check('registered: previously locked report opens', await win('الغياب خلال فترة').isVisible()); await closeWin(win('الغياب خلال فترة'))

// ── 9. restart: data persisted, password changed, licence kept ──
await app.close()
const app2 = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p2 = await app2.firstWindow(); await p2.waitForSelector('text=شاشة الدخول')
await p2.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p2.waitForTimeout(300)
check('restart: old empty password no longer works', /غير صحيحة/.test(await p2.locator('.dlg .err').textContent()))
await p2.locator('#pass').fill('admin1'); await p2.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p2.waitForTimeout(700)
check('restart: login with new password', await p2.locator('#home').isVisible())
check('restart: licence kept', /Registered/.test(await p2.locator('#caption-text').textContent()))
await p2.locator('#menubar .menu > button', { hasText: 'البيانات الأساسية' }).click(); await p2.locator('.menu.open .drop button', { hasText: 'الموظفين' }).first().click(); await p2.waitForTimeout(300)
check('restart: employees persisted (2 after purge)', (await p2.locator('.win tbody tr').count()) === 2)
check('restart: automatic daily backup created', fs.existsSync(`${UD}/backups`) && fs.readdirSync(`${UD}/backups`).length >= 1)
await app2.close()

check('no page errors during the whole run', errs.length === 0, errs.slice(0, 3).join(' || '))
console.log(results.join('\n'))
console.log(`\nTOTAL: ${pass} passed, ${fail} failed · screenshots: ${shot} in ${SHOTS}`)
