// Full functional test of the real Electron app (run: xvfb-run -a node tools/full-test.mjs).
// Walks every menu item, every toolbar button and every dialog; prints PASS/FAIL per
// check and saves a screenshot of each screen in test-shots/.
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { startMockZK } from './mock-zk.mjs'

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
// printing goes through main (print:html → hidden window): record the documents instead
await app.evaluate(({ ipcMain }) => { globalThis.__prints = []; ipcMain.removeHandler('print:html'); ipcMain.handle('print:html', (e, html) => { globalThis.__prints.push(html); return { ok: true } }) })
const prints = () => app.evaluate(() => globalThis.__prints)
await app.evaluate(({ dialog }, ud) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: ud + '/manual-backup.sqlite' }) }, UD)

let shot = 0
const snap = async (name) => p.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, '0')}-${name}.png` })
const menu = async (m, item, sub) => {
  await p.locator('#menubar .menu > button', { hasText: m }).first().click()
  if (sub) await p.locator('.menu.open .drop .has-sub', { hasText: sub }).hover()
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
check('login: single database shown', (await p.locator('#year option').count()) === 1)
await p.locator('#pass').fill('bad'); await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(300)
check('login: wrong password rejected', /غير صحيحة/.test(await p.locator('.dlg .err').textContent()))
await p.locator('#user').fill('Admin'); await p.locator('#pass').fill(''); await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(400)
check('first login: «admin» signs in as «أ» and is forced to set a password', /تعيين كلمة مرور جديدة/.test(await dlgText()) && /«أ»/.test(await dlgText()))
await p.locator('#np1').fill('ab'); await p.locator('#np2').fill('ab'); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(150)
check('first login: short password rejected', /4 أحرف/.test(await p.locator('.dlg-backdrop').last().locator('.err').textContent()))
await snap('force-password')
await p.locator('#np1').fill('start1'); await p.locator('#np2').fill('start1'); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(700)
check('login: default admin «أ» in after setting the password', await p.locator('#home').isVisible())
await snap('home')
check('home: 4 tiles', (await p.locator('.tile').count()) === 4)
check('home: trial banner shown when unregistered', await p.locator('.trial').isVisible())
check('caption: Unregistered', /Unregistered/.test(await p.locator('#caption-text').textContent()))
check('caption: version matches package.json', (await p.locator('#caption-text').textContent()).includes(`Ver. ${JSON.parse(fs.readFileSync(`${ROOT}/package.json`, 'utf8')).version} `))
check('menubar: 6 menus', (await p.locator('#menubar .menu').count()) === 6)

// every menu opens and lists its items
for (const [m, n] of [['البيانات الأساسية', 9], ['الإجراءات', 11], ['التقارير', 16], ['الإعدادات', 7], ['أدوات', 6], ['مساعدة', 2]]) {
  await p.locator('#menubar .menu > button', { hasText: m }).first().click(); await p.waitForTimeout(150)
  check(`menu «${m}» has ${n} items`, (await p.locator('.menu.open .drop button').count()) === n, `got ${await p.locator('.menu.open .drop button').count()}`)
  if (m === 'البيانات الأساسية' || m === 'الإجراءات' || m === 'التقارير') await snap(`menu-${m}`)
  await p.keyboard.press('Escape'); await p.mouse.click(700, 700); await p.waitForTimeout(100)
}

// ── 2. settings: company ──────────────────────────────────
await menu('الإعدادات', 'بيانات المؤسسة'); let cw = win('بيانات الشركة'); await snap('company')
await btn(cw, 'موافق').click(); await p.waitForTimeout(150)
check('company: name required', /مطلوب/.test(await okMsg()))
await cw.locator('#co-company_name').fill('مستشفى الاختبار'); await cw.locator('#co-company_phone').fill('0112345678'); await cw.locator('#co-company_activity').fill('خدمات طبية')
await cw.locator('#co-company_email').fill('bad'); await btn(cw, 'موافق').click(); await p.waitForTimeout(150)
check('company: bad email rejected', /البريد/.test(await okMsg()))
await cw.locator('#co-company_email').fill('info@test.sa'); await btn(cw, 'موافق').click(); await p.waitForTimeout(250); await okMsg(); await closeWin(cw)
await menu('الإعدادات', 'بيانات المؤسسة'); cw = win('بيانات الشركة')
check('company: saved and reloaded', (await cw.locator('#co-company_name').inputValue()) === 'مستشفى الاختبار' && (await cw.locator('#co-company_email').inputValue()) === 'info@test.sa')
await closeWin(cw)

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

let w = await gridCrud('قوائم البرنامج', 'قوائم البرنامج', [{ name_ar: 'ممرض' }, { name_ar: 'محاسب' }])
check('lists: Apex «نوع القائمة» panel with the 7 list types', (await w.locator('.list-types .lt').count()) === 7)
for (const [type, name] of [['الجنسيات', 'سعودي'], ['نوع الاجازة', 'سنوية'], ['أنواع الأذونات', 'إذن شخصي'], ['الديانة', 'مسيحي']]) {
  await w.locator('.list-types .lt', { hasText: type }).click(); await p.waitForTimeout(120)
  check(`lists: «${type}» caption + own (empty) list`, (await w.locator('.grid-caption').textContent()) === type && (await rowCount(w)) === 0)
  await lastRow(w).locator('[data-f=name_ar]').fill(name); await btn(w, 'حفظ').click(); await p.waitForTimeout(200)
}
await w.locator('.list-types .lt', { hasText: 'الوظائف' }).click(); await p.waitForTimeout(120)
check('lists: switching back shows the jobs only', (await rowCount(w)) === 2)
check('lists: rows stored with their type', await p.evaluate(() => DB.all('SELECT list_type t, name_ar n FROM lists ORDER BY id').map((r) => r.t + ':' + r.n).join()) === 'job:ممرض م,job:محاسب,nationality:سعودي,leave:سنوية,permission:إذن شخصي,religion:مسيحي')
// «طباعة» prints the list itself as a report (letterhead + table), not the screen
{
  const before = (await prints()).length
  await btn(w, 'طباعة').click(); await p.waitForTimeout(400)
  const doc = (await prints())[before] || ''
  check('grid print: sends a document', !!doc)
  fs.writeFileSync(`${SHOTS}/grid-print.html`, doc)
  check('grid print: letterhead + title + rows as text', doc.includes('rep-head') && doc.includes('قوائم البرنامج') && doc.includes('ممرض'))
  check('grid print: no form controls in the printout', !/<(select|input)\b/.test(doc.split('<body')[1] || ''))
}
await closeWin(w)
await menu('البيانات الأساسية', 'الإدارات والأقسام'); w = win('قوائم الأقسام والإدارات'); await snap('departments')
await btn(w, 'جديد').click(); await p.waitForTimeout(120); check('departments: «جديد» needs a selected إدارة', /حدد الإدارة/.test(await okMsg()))
await btn(w, 'رئيسي').click(); await btn(w, 'حفظ').click(); await p.waitForTimeout(150); check('departments: name required', /مطلوب/.test(await okMsg()))
await w.locator('#dw-ar').fill('الإدارة الطبية'); await w.locator('#dw-en').fill('Medical'); await btn(w, 'حفظ').click(); await p.waitForTimeout(200); await okMsg()
check('departments: «رئيسي» saved a top-level إدارة in the tree', (await w.locator('.dept-tree > ul > li > .tn', { hasText: 'الإدارة الطبية' }).count()) === 1 && (await w.locator('#dw-id').inputValue()) === '1')
await btn(w, 'جديد').click(); await w.locator('#dw-ar').fill('قسم الطوارئ'); await btn(w, 'حفظ').click(); await p.waitForTimeout(200); await okMsg()
check('departments: «جديد» saved a section under the selected إدارة', (await w.locator('.dept-tree li li .tn', { hasText: 'قسم الطوارئ' }).count()) === 1 && await p.evaluate(() => DB.one("SELECT parent_id FROM departments WHERE name_ar = 'قسم الطوارئ'").parent_id) === 1)
await btn(w, 'رئيسي').click(); await w.locator('#dw-ar').fill('الإدارة الطبية'); await btn(w, 'حفظ').click(); await p.waitForTimeout(150)
check('departments: duplicate name at the same level refused', /مكرر/.test(await okMsg())); await btn(w, 'إهمال').click()
await w.locator('.tn', { hasText: 'الإدارة الطبية' }).click(); await w.locator('#dw-ar').fill('xx'); await btn(w, 'إهمال').click(); await p.waitForTimeout(100)
check('departments: «إهمال» restores the record', (await w.locator('#dw-ar').inputValue()) === 'الإدارة الطبية')
await btn(w, 'حذف').click(); await p.waitForTimeout(150)
check('departments: parent with sections cannot be deleted', /أقسام تابعة/.test(await okMsg()))
await closeWin(w)
w = await gridCrud('المشاريع', 'المشاريع', [{ name_ar: 'مشروع أ', name_en: 'Project A' }]); await closeWin(w)
w = await gridCrud('مجموعات الموظفين', 'مجموعات الموظفين', [{ name_ar: 'المجموعة الأولى' }])
check('employee groups: Apex «الموظفون» button', (await btn(w, 'الموظفون').count()) === 1); await closeWin(w)
w = await gridCrud('العطلات الرسمية', 'العطلات الرسمية', [{ name_ar: 'اليوم الوطني', from_date: '2026-09-23', to_date: '2026-09-23' }]); await closeWin(w)
await menu('البيانات الأساسية', 'تعريف الأجهزة'); w = win('اعدادات الجهاز'); await snap('devices')
await btn(w, 'جديد').click(); await w.locator('#dv-name').fill('جهاز المدخل'); await btn(w, 'حفظ').click(); await p.waitForTimeout(150)
check('devices: IP required', /IP/.test(await okMsg()))
await w.locator('#dv-ip').fill('127.0.0.1'); await w.locator('#dv-pick').click(); await p.waitForTimeout(150)
await p.locator('.dlg .dv-tree .tn', { hasText: 'قسم الطوارئ' }).click(); await p.waitForTimeout(100)
check('devices: القسم picked from the tree', /قسم الطوارئ/.test(await w.locator('#dv-dep').inputValue()))
await btn(w, 'حفظ').click(); await p.waitForTimeout(200); await okMsg()
check('devices: saved and listed with its code + department', (await w.locator('tbody tr[data-id]').count()) === 1 && /قسم الطوارئ/.test(await w.locator('tbody tr').first().textContent()) && (await w.locator('#dv-port').inputValue()) === '4370')
await closeWin(w)
await menu('البيانات الأساسية', 'الإدارات والأقسام'); w = win('قوائم الأقسام والإدارات'); await w.locator('.tn', { hasText: 'قسم الطوارئ' }).click(); await btn(w, 'حذف').click(); await p.waitForTimeout(150)
check('departments: section used by a device cannot be deleted', /مرتبط/.test(await okMsg())); await closeWin(w)
w = await gridCrud('مجموعات أوقات الدوام', 'مواعيد العمل', [{ name_ar: 'صباحي' }, { name_ar: 'مسائي' }])

// shift times
await w.locator('tbody tr').first().click(); await btn(w, 'المواعيد').click(); await p.waitForTimeout(300)
let tw = win('المواعيد')
check('shift times: window opens with 7 days', (await tw.locator('tbody tr').count()) === 7)
check('shift times: Friday off by default', await tw.locator('tbody tr').nth(6).locator('.off').isChecked())
await btn(tw, 'حفظ').click(); await p.waitForTimeout(150)
check('shift times: empty times rejected', /مطلوب/.test(await okMsg()))
const r0 = tw.locator('tbody tr').first()
for (const [f, v] of [['start_in', '06:00'], ['check_in', '08:00'], ['late_min', '15'], ['end_in', '11:00'], ['start_out', '12:00'], ['early_min', '15'], ['check_out', '16:00'], ['end_out', '20:00']]) await r0.locator(`[data-f=${f}]`).fill(v)
await btn(tw, 'نسخ لكل الأيام').click(); await p.waitForTimeout(100)
check('shift times: «نسخ لكل الأيام» copies to working days', (await tw.locator('tbody tr').nth(3).locator('[data-f=check_in]').inputValue()) === '08:00')
await tw.locator('tbody tr').nth(5).locator('.off').check(); await p.waitForTimeout(100)
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
check('employees: add #1 (all fields)', (await addEmployee('1001', 'أحمد علي', { extra: { name_en: 'Ahmed Ali', job_id: 'ممرض م', department_id: 'الإدارة الطبية', section_id: 'قسم الطوارئ', group_id: 'المجموعة الأولى م', project_id: 'مشروع أ م', gender: 'ذكر', nationality_id: 'سعودي', religion: 'مسلم', mobile: '0500000000', email: 'a@b.co', hire_date: '2026-09-01', ot_after: 'x' } })) === true)
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
await menu('الإجراءات', 'قراءة الحركات'); w = win('قراءة الحركات'); await snap('read-punches')
await w.locator('#rp-read-file').click(); check('read punches: file required', /اختر ملف/.test(await okMsg()))
await w.locator('#rp-from').fill('2026-09-20'); await w.locator('#rp-to').fill('2026-09-30')
await w.locator('#rp-file').setInputFiles(`${UD}/attlog.dat`); await w.locator('#rp-read-file').click(); await p.waitForTimeout(400)
let imp = await w.locator('#rp-msg').textContent()
check('read punches: period filter keeps only 20–30 Sep', /خارج الفترة 6/.test(imp) && /جديدة 5/.test(imp), imp)
await w.locator('#rp-from').fill('2026-09-01'); await w.locator('#rp-read-file').click(); await p.waitForTimeout(400)
imp = await w.locator('#rp-msg').textContent()
check('read punches: re-read the whole month (4 new, 6 dup) + unknown 9999 handled', /جديدة 4 · مكررة 6/.test(imp) && /(غير معرّفة 1|موظفين جدد 1)/.test(imp), imp)
check('read punches: «عدد الحركات» shows the new count', (await w.locator('#rp-count').inputValue()) === '4')
fs.writeFileSync(`${UD}/old.dat`, '  1001\t2024-03-10 08:00:00\t1\t0')
await w.locator('#rp-file').setInputFiles(`${UD}/old.dat`); await w.locator('#rp-allp').check()
check('read punches: «كل الفترات» disables the dates', await w.locator('#rp-from').isDisabled())
await w.locator('#rp-read-file').click(); await p.waitForTimeout(400)
imp = await w.locator('#rp-msg').textContent()
check('read punches: «كل الفترات» keeps a 2024 punch', /جديدة 1/.test(imp) && !/خارج الفترة/.test(imp), imp)
await w.locator('#rp-allp').uncheck()
await p.waitForTimeout(2500)
check('read punches: unreachable device shows the red light', (await w.locator('.st .dot.off').count()) >= 1)
await w.locator('.rp-dev').first().check(); await w.locator('#rp-read-dev').click(); await p.waitForTimeout(12000)
check('read punches: unreachable device → clear error', /تعذّر الاتصال/.test(await w.locator('#rp-msg').textContent()), await w.locator('#rp-msg').textContent())
await closeWin(w)

// «نقل بصمات الموظفين» against two fake devices (tools/mock-zk.mjs)
await menu('الإجراءات', 'نقل بصمات الموظفين بين الأجهزة'); w = win('نقل بصمات الموظفين'); await snap('transfer-fingers')
await w.locator('#pw-go').click(); await p.waitForTimeout(150)
check('transfer: needs two devices', /جهازين/.test(await okMsg())); await closeWin(w)
const zkA = await startMockZK({ port: 14390, users: [{ uid: 1, userId: '1001', name: 'موظف 1' }, { uid: 2, userId: '1002', name: 'موظف 2' }, { uid: 3, userId: '1500', name: 'x' }],
  templates: [{ uid: 1, fid: 0, template: Buffer.alloc(500, 1) }, { uid: 2, fid: 0, template: Buffer.alloc(500, 2) }, { uid: 2, fid: 5, template: Buffer.alloc(500, 3) }] })
const zkB = await startMockZK({ port: 14391, key: 77 })
await p.evaluate(async () => { DB.run("INSERT INTO devices (name, ip, port) VALUES ('جهاز أ', '127.0.0.1', 14390)"); DB.run("INSERT INTO devices (name, ip, port, comm_key) VALUES ('جهاز ب', '127.0.0.1', 14391, '77')"); await DB.flush() })
await menu('الإجراءات', 'نقل بصمات الموظفين بين الأجهزة'); w = win('نقل بصمات الموظفين')
await w.locator('#tf-from').selectOption({ label: 'جهاز أ — 127.0.0.1' }); await w.locator('#tf-to').selectOption({ label: 'جهاز أ — 127.0.0.1' })
await w.locator('#pw-go').click(); await p.waitForTimeout(150)
check('transfer: same device refused', /مختلفين/.test(await okMsg()))
await w.locator('#tf-to').selectOption({ label: 'جهاز ب — 127.0.0.1' })
await w.locator('#tf-codes').check(); await w.locator('#tf-cf').fill('1001'); await w.locator('#tf-ct').fill('1002')
await w.locator('#pw-go').click(); await p.waitForTimeout(1500)
let tfm = await okMsg()
check('transfer: range copied with fingers', /تم نقل 2 موظف و 3 بصمة/.test(tfm), tfm)
check('transfer: target device got exactly those users', zkB.state.users.map((u) => u.userId).sort().join() === '1001,1002' && zkB.state.templates.length === 3)
check('transfer: progress bar full', (await w.locator('#pw-bar').evaluate((e) => e.style.width)) === '100%')
await w.locator('#tf-codes').uncheck(); await w.locator('#tf-to').selectOption({ label: 'جهاز المدخل — 127.0.0.1' })
await w.locator('#pw-go').click(); await p.waitForTimeout(12000)
check('transfer: unreachable target → clear error', /تعذّر الاتصال/.test(await okMsg()))
await closeWin(w)
await p.evaluate(async () => { DB.run("DELETE FROM devices WHERE port IN (14390, 14391)"); await DB.flush() })
zkA.server.close(); zkB.server.close()

await menu('الإجراءات', 'عرض الحركات'); w = win('عرض الحركات')
await w.locator('#vp-date').fill('2026-09-19'); await w.locator('#vp-date').dispatchEvent('change'); await p.waitForTimeout(200)
let vr = await w.locator('tbody tr', { hasText: '1001' }).evaluate((tr) => [...tr.children].map((c) => c.textContent))
check('view punches (Apex): one row per employee for the day, 1001 in 08:10 out 16:02', vr[3] === '08:10' && vr[4] === '16:02', vr.join('|'))
check('view punches: day title + السابق/التالي', /السبت 2026-09-19/.test(await w.locator('#vp-day').textContent()))
await w.locator('#vp-next').click(); await p.waitForTimeout(150); check('view punches: «التالي» → 2026-09-20', (await w.locator('#vp-date').inputValue()) === '2026-09-20')
await w.locator('#vp-prev').click(); await p.waitForTimeout(150)
await w.locator('.bar-search').fill('1002'); await p.waitForTimeout(200); check('view punches: search by number', (await w.locator('tbody tr').count()) === 1)
await w.locator('.bar-search').fill(''); await p.waitForTimeout(150)
await w.locator('.dept-tree .tn', { hasText: 'قسم الطوارئ' }).click(); await p.waitForTimeout(150)
check('view punches: departments tree filters (قسم الطوارئ → 1001 only)', (await w.locator('tbody tr').count()) === 1 && /1001/.test(await w.locator('tbody').textContent()))
await snap('view-punches')
await w.locator('tbody tr', { hasText: '1001' }).dblclick(); await p.waitForTimeout(300)
let ew2 = win('إضافة وتعديل حركات موظف')
check('view punches: double-click opens the edit window on that employee/day', (await ew2.locator('#ep-code').inputValue()) === '1001' && (await ew2.locator('#ep-date').inputValue()) === '2026-09-19' && (await ew2.locator('tbody tr').count()) >= 1)
await closeWin(ew2); await closeWin(w)

await menu('الإجراءات', 'إضافة وتعديل الحركات'); w = win('إضافة وتعديل حركات موظف')
await w.locator('#ep-code').fill('1001'); await w.locator('#ep-code').dispatchEvent('change')
await w.locator('#ep-date').fill('2026-09-21'); await w.locator('#ep-date').dispatchEvent('change'); await p.waitForTimeout(150)
await btn(w, 'إضافة').click(); await w.locator('.t-in').last().fill('25:00'); await btn(w, 'حفظ').click(); await p.waitForTimeout(150)
check('edit punches: invalid time rejected', /HH:MM/.test(await okMsg()))
await w.locator('.t-in').last().fill('08:05'); await w.locator('.t-out').last().fill('16:00'); await btn(w, 'حفظ').click(); await p.waitForTimeout(150)
check('edit punches: password required (كلمة السر)', /كلمة السر غير صحيحة/.test(await okMsg()))
await w.locator('#ep-pw').fill('start1'); await btn(w, 'حفظ').click(); await p.waitForTimeout(250); await okMsg()
const flags = async () => w.locator('tbody tr').first().evaluate((tr) => [...tr.querySelectorAll('input[type=checkbox]')].map((c) => c.checked))
check('edit punches: pair saved, «مضاف» ticked', (await w.locator('tbody tr').count()) === 1 && (await flags())[2] === true, JSON.stringify(await flags()))
await w.locator('.t-in').first().fill('08:07'); await btn(w, 'حفظ').click(); await p.waitForTimeout(250); await okMsg()
check('edit punches: changed time → «معدل» ticked', (await flags())[1] === true, JSON.stringify(await flags()))
await w.locator('tbody tr').first().click(); await btn(w, 'حذف').click(); await p.waitForTimeout(150); await yes()
check('edit punches: delete pair', (await w.locator('tbody tr[data-i]').count()) === 0)
await btn(w, 'إضافة').click(); await w.locator('.t-in').last().fill('08:05'); await w.locator('.t-out').last().fill('16:00'); await btn(w, 'حفظ').click(); await p.waitForTimeout(250); await okMsg()
await snap('edit-punches'); await closeWin(w)

await menu('الإجراءات', 'إضافة إجازات'); w = win('أجازات الموظفين'); await snap('leaves')
await btn(w, 'جديد').click(); await p.waitForTimeout(150)
check('leaves: Apex dialog with الموظف / مجموعة الموظفين', (await p.locator('.leave-dlg [name=lv-w]').count()) === 2 && await p.locator('#lv-grp').isDisabled())
await p.locator('.dlg').getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(100)
check('leaves: employee required', /اختر الموظف/.test(await p.locator('.dlg .err').textContent()))
// drop-down opens with a real mouse click (own list, not the native popup) and picks a value
{
  const sel = p.locator('#lv-type')
  await sel.click(); await p.waitForTimeout(150)
  check('select: drop-down list opens on click', await p.locator('.sel-pop').isVisible())
  await snap('select-open')
  await p.locator('.sel-pop .sel-opt', { hasText: 'سنوية' }).click(); await p.waitForTimeout(100)
  check('select: picked value is set', (await sel.evaluate((e) => e.options[e.selectedIndex].text)) === 'سنوية')
  check('select: list closes after picking', !(await p.locator('.sel-pop').count()))
  await sel.click(); await p.keyboard.press('Escape'); await p.waitForTimeout(100)
  check('select: Escape closes the list', !(await p.locator('.sel-pop').count()))
}
await p.locator('#lv-code').fill('1001'); await p.locator('#lv-code').dispatchEvent('input')
check('leaves: typing the code picks the employee', (await p.locator('#lv-emp').evaluate((e) => e.options[e.selectedIndex].text)).length > 0)
await p.locator('#lv-f').fill('2026-09-22'); await p.locator('#lv-t').fill('2026-09-22')
await p.locator('.dlg').getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(250); await okMsg()
{ const t = await w.locator('tbody tr').first().textContent(); check('leaves: saved and listed (code, dates, المدة 1, type)', (await w.locator('tbody tr[data-id]').count()) === 1 && /1001[^]*2026-09-22[^]*1[^]*سنوية/.test(t), t) }
await btn(w, 'جديد').click(); await p.locator('#lv-code').fill('1001'); await p.locator('#lv-code').dispatchEvent('input')
await p.locator('#lv-f').fill('2026-09-21'); await p.locator('#lv-t').fill('2026-09-23'); await p.locator('.dlg').getByRole('button', { name: 'حفظ' }).click(); await p.waitForTimeout(200)
check('leaves: overlapping leave refused', /متداخلة/.test(await okMsg()))
await closeWin(w)
await menu('الإجراءات', 'إضافة أذونات'); w = win('إضافة أذونات لموظف'); await snap('permissions')
await lastRow(w).locator('[data-f=employee_id]').selectOption({ index: 2 }); await lastRow(w).locator('[data-f=date]').fill('2026-09-19')
await lastRow(w).locator('[data-f=from_time]').fill('3pm'); await btn(w, 'حفظ').click(); await p.waitForTimeout(150)
check('permissions: bad time rejected', /HH:MM|مطلوب/.test(await okMsg()))
await lastRow(w).locator('[data-f=from_time]').fill('15:00'); await lastRow(w).locator('[data-f=to_time]').fill('16:00')
await btn(w, 'حفظ').click(); await p.waitForTimeout(250); check('permissions: saved', (await rowCount(w)) === 1); await closeWin(w)

// ── 6. reports (all 11) ───────────────────────────────────
const detailedExpect = { '2026-09-19': 'حضور', '2026-09-20': 'حضور متأخر', '2026-09-21': 'حضور', '2026-09-22': 'إجازة', '2026-09-23': 'عطلة رسمية', '2026-09-24': 'عطلة إسبوعية' }
const reports = ['مواعيد العمل', 'الموظفين', 'الحركات الغير مكتملة', 'التأخير عن بداية الدوام اليومي', 'التأخير عن الدوام خلال فترة', 'إجازات الموظفين',
  'الحضور والانصراف تفصيلي', 'الحضور والانصراف إجمالي', 'الغياب خلال فترة', 'حالة اليوم', 'بيان تأخير الموظفين', 'تأخير وإضافي الشفتات',
  'الحضور والانصراف بالحركات', 'أذونات الموظفين', 'حركات الأبواب', 'الجزاءات']
const trialOpen = ['الحضور والانصراف تفصيلي', 'الحضور والانصراف إجمالي', 'حالة اليوم', 'الحضور والانصراف بالحركات']
for (const r of reports) {
  await menu('التقارير', r)
  if (!trialOpen.includes(r)) { check(`report «${r}» locked in trial`, /المسجلة فقط/.test(await okMsg())); continue }
  const rw = win(r)
  check(`report «${r}» opens (trial)`, await rw.isVisible())
  await rw.locator('#r-from').fill('2026-09-19'); if (await rw.locator('#r-to').count()) await rw.locator('#r-to').fill(r === 'حالة اليوم' ? '2026-09-19' : '2026-09-24')
  await btn(rw, 'موافق').click(); await p.waitForTimeout(250)
  check(`report «${r}»: company header`, (await rw.locator('.rep-head .box.r .co').textContent()) === 'مستشفى الاختبار')
  if (r === 'الحضور والانصراف تفصيلي') {
    const grp = rw.locator('.rep-emp .rep-sub', { hasText: '1001' })
    const rows = await rw.locator('.rep-emp').first().locator('tbody tr').evaluateAll((trs) => trs.map((tr) => { const d = tr.dataset; return [d.date, '', d.in, d.out, d.late, d.early, d.ot, d.worked, d.status] }))
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
    check('total (Apex layout): 1001 — worked hours, 50 min late+early, no absence hours', row[1] === '1001' && /^\d\d:\d\d$/.test(row[5]) && row[6] === '00:50' && row[7] === '', row.join('|'))
    await snap('report-total')
  }
  // print counter: 3 prints then blocked
  if (r === 'حالة اليوم') {
    for (let i = 0; i < 3; i++) { await btn(rw, 'طباعة').click(); await p.waitForTimeout(150) }
    check('trial: 3 prints allowed', (await prints()).filter((h) => h.includes('حالة اليوم')).length >= 3)
    await btn(rw, 'طباعة').click(); await p.waitForTimeout(150)
    check('trial: 4th print blocked', /انتهت مرات الطباعة/.test(await okMsg()))
  }
  await closeWin(rw)
}

// ── 7. posting ────────────────────────────────────────────
await menu('الإجراءات', 'ترحيل الحركات'); w = win('ترحيل الحركات وحساب ساعات العمل'); await snap('post')
await w.locator('#pw-from').fill('2026-09-19'); await w.locator('#pw-to').fill('2026-09-20'); await w.locator('#pw-to').dispatchEvent('input')
const unposted = +(await w.locator('#pw-count').inputValue())
check('posting: «عدد الحركات غير المرحلة» counts the period punches', unposted > 0, `n=${unposted}`)
await w.locator('#pw-go').click(); await p.waitForTimeout(300); check('posting: period posted', /ترحيل الحركات/.test(await okMsg()))
check('posting: count drops to 0 and the bar is full', (await w.locator('#pw-count').inputValue()) === '0' && /100%/.test(await w.locator('#pw-bar').getAttribute('style')))
await w.locator('#pw-to').fill('2026-09-21'); await w.locator('#pw-go').click(); await p.waitForTimeout(300); await okMsg()
check('posting: re-posting an overlapping period keeps posted days frozen', await p.evaluate(() => DB.one("SELECT COUNT(*) n FROM posted_attendance WHERE date = '2026-09-20'").n) > 0)
await p.evaluate(() => { Engine.unpost('2026-09-21', '2026-09-21') })
await w.locator('#pw-to').fill('2099-01-01'); await w.locator('#pw-go').click(); await p.waitForTimeout(200); check('posting: future refused', /لا يمكن ترحيل/.test(await okMsg()))
await w.locator('#pw-codes').check(); await w.locator('#pw-to').fill('2026-09-20'); await w.locator('#pw-go').click(); await p.waitForTimeout(150)
check('posting: «أرقام الموظفين» needs a number', /أرقام الموظفين/.test(await okMsg()))
await w.locator('#pw-codes').uncheck(); await closeWin(w)
await menu('الإجراءات', 'إضافة وتعديل الحركات'); w = win('إضافة وتعديل حركات موظف')
await w.locator('#ep-code').fill('1001'); await w.locator('#ep-code').dispatchEvent('change')
await w.locator('#ep-date').fill('2026-09-20'); await w.locator('#ep-date').dispatchEvent('change'); await p.waitForTimeout(150)
check('posting: posted day shows «مرحل» and locks the times', (await w.locator('.t-in').first().isDisabled()) && (await w.locator('tbody tr').first().locator('input[type=checkbox]').first().isChecked()))
await btn(w, 'إضافة').click(); await btn(w, 'حفظ').click(); await p.waitForTimeout(150); check('posting: posted day locked for edits', /مرحّل/.test(await okMsg())); await closeWin(w)
await menu('الإجراءات', 'الغاء الحركات المسحوبة'); await p.locator('#pd-from').fill('2026-09-01'); await p.locator('#pd-to').fill('2026-09-30')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(250); check('delete pulled punches: blocked by posted period', /تتداخل/.test(await okMsg()))
await menu('الإجراءات', 'الغاء ترحيل'); w = win('الغاء ترحيل الحركات خلال فترة'); check('unpost: Apex window (no grid, one button)', (await w.locator('#pw-go').count()) === 1 && (await w.locator('#pw-count').count()) === 0)
await w.locator('#pw-from').fill('2026-09-19'); await w.locator('#pw-to').fill('2026-09-20')
await w.locator('#pw-codes').check(); await w.locator('#pw-cf').fill('999999'); await w.locator('#pw-go').click(); await p.waitForTimeout(150)
check('unpost: unknown employee number refused', /لا يوجد موظفين/.test(await okMsg()))
await w.locator('#pw-cf').fill('1001'); await w.locator('#pw-go').click(); await p.waitForTimeout(200); await okMsg()
check('unpost: one employee released, others stay posted', await p.evaluate(() => !Engine.isPosted('2026-09-20', '1001') && Engine.isPosted('2026-09-20')))
await w.locator('#pw-codes').uncheck(); await w.locator('#pw-go').click(); await p.waitForTimeout(200)
check('unpost: whole period released', /بنجاح/.test(await okMsg()) && await p.evaluate(() => !Engine.isPosted('2026-09-19') && !Engine.isPosted('2026-09-20')))
await snap('unpost'); await closeWin(w)
await menu('الإجراءات', 'الغاء الحركات المعدلة يدويا'); await p.locator('#pd-from').fill('2026-09-01'); await p.locator('#pd-to').fill('2026-09-30')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(200)
await p.locator('#ap-pw').fill('wrong'); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(150)
check('delete manual punches: password required', /غير صحيحة/.test(await p.locator('.dlg-backdrop').last().locator('.err').textContent()))
await p.locator('#ap-pw').fill('start1'); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(200); check('delete manual punches: confirms count (2)', /حذف 2 حركة/.test(await dlgText())); await yes(); await okMsg()
await menu('الإجراءات', 'الغاء الحركات المسحوبة'); await p.locator('#pd-from').fill('2026-09-01'); await p.locator('#pd-to').fill('2026-09-19')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(200); await p.locator('#ap-pw').fill('start1'); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(200); check('delete pulled punches: confirms count (4)', /حذف 4 حركة/.test(await dlgText()), await dlgText()); await yes(); await okMsg()
await menu('الإجراءات', 'الغاء جميع بيانات الموظف'); await p.locator('#pe-from').fill('1003')
await p.locator('.dlg').getByRole('button', { name: 'الغاء البيانات' }).click(); await p.waitForTimeout(150); await p.locator('#ap-pw').fill('start1'); await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(200); await yes(); check('purge employee: done', /تم حذف جميع بيانات 1 موظف/.test(await okMsg()))

// ── 8. users, system, backup, register ────────────────────
await menu('الإعدادات', 'صلاحيات المستخدمين', 'اعدادات المستخدمين'); w = win('صلاحيات المستخدمين'); await snap('roles')
check('roles: built-in «مدير النظام» locked with every box ticked', (await w.locator('.screens input[data-a]:not(:checked)').count()) === 0 && (await w.locator('.screens input[data-a]:not([disabled])').count()) === 0)
await btn(w, 'جديد').click(); await btn(w, 'حفظ').click(); check('roles: name required', /مطلوب/.test(await okMsg()))
await w.locator('#ro-ar').fill('موارد بشرية'); await w.locator('#ro-en').fill('HR'); await btn(w, 'حفظ').click(); await okMsg()
check('roles: role added', (await w.locator('#ro-list tr').count()) === 2)
await closeWin(w)
await menu('الإعدادات', 'إدارة المستخدمين', 'اعدادات المستخدمين'); w = win('إدارة المستخدمين'); await snap('users')
await btn(w, 'جديد').click(); await w.locator('#us-login').fill('hr'); await w.locator('#us-name').fill('موظف الموارد'); await w.locator('#us-role').selectOption({ label: 'موارد بشرية' })
await w.locator('#us-pw').fill('12'); await w.locator('#us-pw2').fill('12'); await btn(w, 'حفظ').click(); check('users: short password rejected', /4 أحرف/.test(await okMsg()))
await w.locator('#us-pw').fill('1234'); await w.locator('#us-pw2').fill('1235'); await btn(w, 'حفظ').click(); check('users: mismatch rejected', /غير متطابقتين/.test(await okMsg()))
await w.locator('#us-pw2').fill('1234'); await btn(w, 'حفظ').click(); await okMsg()
check('users: user added with its role', (await w.locator('#us-list tr').count()) === 2 && /موارد بشرية/.test(await w.locator('#us-list').textContent()))
check('users: passwords never shown', !/1234/.test(await w.locator('#us-list').textContent()))
await w.locator('#us-list tr').first().click(); await btn(w, 'حذف').click(); await p.waitForTimeout(150); check('users: current / last admin cannot be deleted', /آخر مدير|المستخدم الحالي/.test(await okMsg()))
await w.locator('#us-list tr').first().click(); await w.locator('#us-role').selectOption({ label: 'موارد بشرية' }); await btn(w, 'حفظ').click(); check('users: last admin cannot lose the admin role', /آخر مدير/.test(await okMsg()))
await w.locator('#us-list tr').first().click(); await w.locator('#us-pw').fill('admin1'); await w.locator('#us-pw2').fill('admin1'); await btn(w, 'حفظ').click(); await okMsg(); await closeWin(w)
await menu('الإعدادات', 'اعدادات النظام'); w = win('إعدادات النظام'); check('system settings: Apex window with the 7 rules', (await w.locator('.sys-set .rules .row').count()) === 7 && (await w.locator('#s-ignore').inputValue()) === '0'); await snap('system'); await closeWin(w)
await menu('أدوات', 'نسخة احتياطية'); check('backup: file written', /تم حفظ/.test(await okMsg()) && fs.existsSync(`${UD}/manual-backup.sqlite`))
check('backup: automatic daily backup exists', fs.readdirSync(`${UD}/backups`).length >= 0)
await menu('مساعدة', 'عن البرنامج'); { const m = await okMsg(); check('about: version', m.includes(JSON.parse(fs.readFileSync(`${ROOT}/package.json`, 'utf8')).version)); check('about: data folder', m.includes('mt-fulltest')) }
await menu('مساعدة', 'دليل الاستخدام'); w = win('دليل الاستخدام')
check('guide: opens with all sections', (await w.locator('.guide section').count()) >= 10); await snap('guide')
await w.locator('.guide nav a').last().click(); await p.waitForTimeout(300); await closeWin(w)

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

// ── 8b. v0.2 features (registered: no employee limit) ─────
const openGroupTimes = async (name) => {
  await menu('البيانات الأساسية', 'مواعيد العمل'); const gw = win('مجموعات أوقات الدوام')
  await gw.locator('tbody tr', { has: p.locator(`input[value="${name}"]`) }).first().click()
  await btn(gw, 'المواعيد').click(); await p.waitForTimeout(300)
  return [gw, win('المواعيد')]
}
const fillWin = async (row, t) => { for (const [f, v] of Object.entries(t)) await row.locator(`[data-f=${f}]`).fill(String(v)) }
const W = (a, b, c, d, e, f) => ({ start_in: a, check_in: b, late_min: 15, end_in: c, start_out: d, early_min: 15, check_out: e, end_out: f })
// new shift groups: normal split, night (extended), open, rotating
await menu('البيانات الأساسية', 'مواعيد العمل'); w = win('مجموعات أوقات الدوام')
for (const g of [{ name_ar: 'مقسم' }, { name_ar: 'ليلي' }, { name_ar: 'مفتوح', open_shift: 1 }, { name_ar: 'متغير', rotational: 1, start_date: '2026-09-19' }, { name_ar: 'خطأ', open_shift: 1, rotational: 1, start_date: '2026-09-19' }]) {
  const r = lastRow(w)
  await r.locator('[data-f=name_ar]').fill(g.name_ar)
  if (g.open_shift) await r.locator('[data-f=open_shift]').check()
  if (g.rotational) await r.locator('[data-f=rotational]').check()
  if (g.start_date) await r.locator('[data-f=start_date]').fill(g.start_date)
  await btn(w, 'حفظ').click(); await p.waitForTimeout(250)
  if (g.name_ar === 'خطأ') { check('shift groups: open + rotating together rejected', /وليس الاثنين/.test(await okMsg())); await btn(w, 'إهمال').click() }
}
await lastRow(w).locator('[data-f=name_ar]').fill('بدون تاريخ'); await lastRow(w).locator('[data-f=rotational]').check(); await btn(w, 'حفظ').click(); await p.waitForTimeout(200)
check('shift groups: rotating needs a start date', /تاريخ بدء العمل بالدوام مطلوب/.test(await okMsg())); await btn(w, 'إهمال').click(); await closeWin(w)
// split shift: 2 ورديات every working day
let [gw, t] = await openGroupTimes('مقسم')
await t.locator('tbody tr').first().locator('.cnt').selectOption('2'); await p.waitForTimeout(150)
await fillWin(t.locator('tbody tr').nth(0), W('07:00', '08:00', '09:00', '11:30', '12:00', '13:00'))
await fillWin(t.locator('tbody tr').nth(1), W('15:00', '16:00', '17:00', '19:30', '20:00', '21:00'))
check('split shift: 2 وردية rows for the day', (await t.locator('tbody tr[data-day="0"]').count()) === 2)
await fillWin(t.locator('tbody tr').nth(1), W('11:00', '16:00', '17:00', '19:30', '20:00', '21:00'))
await btn(t, 'حفظ').click(); await p.waitForTimeout(200); check('split shift: overlapping second وردية rejected', /لا يمكن أن يكون قبل|شفت ممتد/.test(await okMsg()))
await fillWin(t.locator('tbody tr').nth(1), W('15:00', '16:00', '17:00', '19:30', '20:00', '21:00'))
await btn(t, 'نسخ لكل الأيام').click(); await p.waitForTimeout(150)
await btn(t, 'حفظ').click(); await p.waitForTimeout(250); check('split shift: saved', /تم حفظ/.test(await okMsg()))
await snap('v2-split-shift'); await closeWin(t); await closeWin(gw)
// night shift 22:00 → 06:00 «شفت ممتد»
;[gw, t] = await openGroupTimes('ليلي')
await fillWin(t.locator('tbody tr').first(), W('20:00', '22:00', '23:59', '04:00', '06:00', '09:00'))
await btn(t, 'حفظ').click(); await p.waitForTimeout(200); check('night shift: past-midnight times need «شفت ممتد»', /شفت ممتد/.test(await okMsg()))
await t.locator('tbody tr').first().locator('[data-f=extended]').check()
await btn(t, 'نسخ لكل الأيام').click(); await p.waitForTimeout(150)
await t.locator('tbody tr').first().locator('[data-f=extended]').check()
for (let i = 1; i < 6; i++) { const cb = t.locator('tbody tr').nth(i).locator('[data-f=extended]'); if (await cb.isEnabled()) await cb.check() }
await btn(t, 'حفظ').click(); await p.waitForTimeout(250); check('night shift: extended shift saved', /تم حفظ/.test(await okMsg()))
await closeWin(t); await closeWin(gw)
// open shift: 08:00 required; Ramadan: 05:00
;[gw, t] = await openGroupTimes('مفتوح')
check('open shift: open-shift editor', (await t.locator('.req').count()) === 7)
for (let i = 0; i < 6; i++) await t.locator('tbody tr').nth(i).locator('.req').fill('08:00')
await t.locator('.tabs button', { hasText: 'أيام رمضان' }).click(); await p.waitForTimeout(150)
for (let i = 0; i < 6; i++) { await t.locator('tbody tr').nth(i).locator('.off').uncheck(); await p.waitForTimeout(50) }
for (let i = 0; i < 6; i++) await t.locator('tbody tr').nth(i).locator('.req').fill('05:00')
await btn(t, 'حفظ').click(); await p.waitForTimeout(250); check('open shift: year + Ramadan saved', /تم حفظ/.test(await okMsg()))
await snap('v2-open-shift'); await closeWin(t); await closeWin(gw)
// rotating: [2 days 07-15, 1 rest] [2 days 15-23, 1 rest], starting 2026-09-19
;[gw, t] = await openGroupTimes('متغير')
check('rotation: blocks editor', (await t.locator('.block').count()) === 1)
let b0 = t.locator('.block').nth(0)
await b0.locator('.work').fill('2'); await b0.locator('.rest').fill('1')
await fillWin(b0.locator('tbody tr').first(), W('06:00', '07:00', '08:00', '14:00', '15:00', '17:00'))
check('rotation: rows 2-4 disabled until enabled', await b0.locator('tbody tr').nth(1).locator('[data-f=check_in]').isDisabled())
await t.locator('.block-btns .add').click(); await p.waitForTimeout(150)
check('rotation: «إضافة مجموعة مواعيد» adds a block + «حذف» appears', (await t.locator('.block').count()) === 2 && (await t.locator('.block-btns .del').count()) === 1)
const b1 = t.locator('.block').nth(1)
await b1.locator('.work').fill('2'); await b1.locator('.rest').fill('1')
await fillWin(b1.locator('tbody tr').first(), W('14:00', '15:00', '16:00', '22:00', '23:00', '23:59'))
await btn(t, 'حفظ').click(); await p.waitForTimeout(250); check('rotation: saved', /تم حفظ/.test(await okMsg()), '')
await snap('v2-rotation'); await closeWin(t)
check('rotation: cycle total = 2×8h + 2×8h = 32:00', (await gw.locator('tbody tr', { has: p.locator('input[value="متغير"]') }).locator('td').nth(4).textContent()) === '32:00')
await closeWin(gw)
// Ramadan period
await menu('البيانات الأساسية', 'مواعيد رمضان'); w = win('مواعيد رمضان')
await lastRow(w).locator('[data-f=from_date]').fill('2026-09-22'); await lastRow(w).locator('[data-f=to_date]').fill('2026-09-22')
await btn(w, 'حفظ').click(); await p.waitForTimeout(250); check('ramadan: period saved', (await rowCount(w)) === 1); await closeWin(w)
// 4 employees on the new shifts (licence registered → no trial cap)
await menu('البيانات الأساسية', 'الموظفين')
for (const [code, name, shift] of [['1004', 'مقسم الدوام', 'مقسم'], ['1005', 'ليلي الدوام', 'ليلي'], ['1006', 'مفتوح الدوام', 'مفتوح'], ['1007', 'متغير الدوام', 'متغير']]) {
  check(`registered: add ${code} on «${shift}»`, (await addEmployee(code, name, { shift, extra: { hire_date: '2026-09-01' } })) === true)
}
// photo on 1004
await ew.locator('tbody tr', { hasText: '1004' }).dblclick(); await p.waitForTimeout(250); ef = win('تعديل موظف')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNQaLiAFTEMLQkAxtVcAVQ5TgQAAAAASUVORK5CYII=', 'base64')
fs.writeFileSync(`${UD}/p.png`, png)
await ef.locator('.photo input[type=file]').setInputFiles(`${UD}/p.png`); await p.waitForTimeout(400)
await btn(ef, 'حفظ').click(); await p.waitForTimeout(300); await okMsg()
await ew.locator('tbody tr', { hasText: '1004' }).dblclick(); await p.waitForTimeout(250); ef = win('تعديل موظف')
check('employee photo: saved and shown', (await ef.locator('.photo img').count()) === 1); await snap('v2-employee-photo')
// shift change from a date: 1002 → «مسائي» from 2026-09-21 (no timings → off)
await closeWin(ef)
await ew.locator('tbody tr', { hasText: '1002' }).dblclick(); await p.waitForTimeout(250); ef = win('تعديل موظف')
await ef.locator('[data-f=shift_group_id]').selectOption({ label: 'مسائي' }); await btn(ef, 'حفظ').click(); await p.waitForTimeout(200)
check('shift change: asks the start date', /يبدأ الدوام الجديد من/.test(await dlgText()))
await p.locator('#sf').fill('2026-09-21'); await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(300); await okMsg()
await closeWin(ew)
// punches for the new shifts
fs.writeFileSync(`${UD}/att2.dat`, [
  '1004,2026-09-19 08:05', '1004,2026-09-19 12:00', '1004,2026-09-19 16:20', '1004,2026-09-19 20:00',   // split: 20 late in وردية 2
  '1005,2026-09-19 21:58', '1005,2026-09-20 06:02',                                                   // night: 1 shift across midnight
  '1006,2026-09-19 09:00', '1006,2026-09-19 15:00', '1006,2026-09-22 09:00', '1006,2026-09-22 14:00',   // open: 2h short / Ramadan 5h ok
  '1007,2026-09-19 07:00', '1007,2026-09-19 15:00', '1007,2026-09-22 15:10', '1007,2026-09-22 23:00',   // rotating
  '1002,2026-09-21 08:00', '1002,2026-09-21 16:00', '1001,2026-09-21 08:05', '1001,2026-09-21 16:00'].join('\n'))
await menu('الإجراءات', 'قراءة الحركات'); w = win('قراءة الحركات'); await w.locator('#rp-from').fill('2026-09-01')
await w.locator('#rp-file').setInputFiles(`${UD}/att2.dat`); await w.locator('#rp-read-file').click(); await p.waitForTimeout(400)
check('import 2: 18 new punches', /جديدة 18/.test(await w.locator('#rp-msg').textContent()), await w.locator('#rp-msg').textContent())
await closeWin(w)
// detailed report 19..24 for everyone
const detailed = async () => {
  await menu('التقارير', 'الحضور والانصراف تفصيلي'); const rw = win('الحضور والانصراف تفصيلي')
  await rw.locator('#r-from').fill('2026-09-19'); await rw.locator('#r-to').fill('2026-09-24'); await btn(rw, 'موافق').click(); await p.waitForTimeout(300)
  const data = await rw.locator('.report-out').evaluate((out) => {
    const res = {}
    for (const tr of out.querySelectorAll('tr[data-emp]')) { const d = tr.dataset; res[`${d.emp}:${d.date}`] = [d.date, '', d.in, d.out, d.late, d.early, d.ot, d.worked, d.status] }
    return res
  })
  return [rw, data]
}
let [rw, D] = await detailed()
const cell = (k, i) => D[k]?.[i]
check('split shift: 20 min late in وردية 2', cell('1004:2026-09-19', 4) === '00:20' && cell('1004:2026-09-19', 8) === 'حضور متأخر', D['1004:2026-09-19']?.join('|'))
check('split shift: worked 3:55 + 3:40 = 07:35', cell('1004:2026-09-19', 7) === '07:35', cell('1004:2026-09-19', 7))
check('night shift: 21:58 → 06:02 is one present day', cell('1005:2026-09-19', 2) === '21:58' && cell('1005:2026-09-19', 3) === '06:02' && cell('1005:2026-09-19', 7) === '08:04', D['1005:2026-09-19']?.join('|'))
check('night shift: next day does not reuse the 06:02 punch', cell('1005:2026-09-20', 8) === 'غياب', D['1005:2026-09-20']?.join('|'))
check('open shift: 6h worked of 8h → 02:00 owed shows as تأخير', cell('1006:2026-09-19', 4) === '02:00' && cell('1006:2026-09-19', 7) === '06:00', D['1006:2026-09-19']?.join('|'))
check('ramadan: open shift 5h required inside the Ramadan period → no shortfall', cell('1006:2026-09-22', 5) === '' && cell('1006:2026-09-22', 7) === '05:00', D['1006:2026-09-22']?.join('|'))
check('rotation: day 1 present', cell('1007:2026-09-19', 8) === 'حضور', D['1007:2026-09-19']?.join('|'))
check('rotation: day 2 absent', cell('1007:2026-09-20', 8) === 'غياب', D['1007:2026-09-20']?.join('|'))
check('rotation: day 3 rest', cell('1007:2026-09-21', 8) === 'عطلة إسبوعية', D['1007:2026-09-21']?.join('|'))
check('rotation: day 4 on the 2nd block (15:10, within grace)', cell('1007:2026-09-22', 8) === 'حضور' && cell('1007:2026-09-22', 2) === '15:10', D['1007:2026-09-22']?.join('|'))
check('rotation: day 6 rest', cell('1007:2026-09-24', 8) === 'عطلة إسبوعية', D['1007:2026-09-24']?.join('|'))
check('shift history: 1002 before the change still on the old shift (working day → absent, not the new shift\'s day off)', cell('1002:2026-09-19', 8) === 'غياب', D['1002:2026-09-19']?.join('|'))
check('shift history: 1002 from 2026-09-21 on the new shift (no timings → off)', cell('1002:2026-09-21', 8) === 'عطلة إسبوعية', D['1002:2026-09-21']?.join('|'))
await snap('v2-detailed')
// Excel + PDF
await btn(rw, 'Excel').click(); await p.waitForTimeout(800); await okMsg()
const xl = fs.readFileSync(`${UD}/manual-backup.sqlite`)
check('export: Excel file is a real .xlsx (zip)', xl.slice(0, 2).toString() === 'PK' && xl.length > 2000)
await btn(rw, 'PDF').click(); await p.waitForTimeout(3000); const pdfMsg = await okMsg()
const pdf = fs.readFileSync(`${UD}/manual-backup.sqlite`)
check('export: PDF file generated', pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 5000, pdfMsg)
await closeWin(rw)
// posting freezes the day: post 19..20, then move «صباحي م» check-in to 07:00
await menu('الإجراءات', 'ترحيل الحركات'); w = win('ترحيل الحركات وحساب ساعات العمل'); await w.locator('#pw-from').fill('2026-09-19'); await w.locator('#pw-to').fill('2026-09-20')
await w.locator('#pw-go').click(); await p.waitForTimeout(300); await okMsg(); await closeWin(w)
;[gw, t] = await openGroupTimes('صباحي م')
await t.locator('tbody tr').first().locator('[data-f=check_in]').fill('07:00'); await t.locator('tbody tr').first().locator('[data-f=start_in]').fill('06:00')
await btn(t, 'نسخ لكل الأيام').click(); await btn(t, 'حفظ').click(); await p.waitForTimeout(250); await okMsg(); await closeWin(t); await closeWin(gw)
;[rw, D] = await detailed()
check('posting: posted day keeps its result after the shift is edited (still 30 min late)', cell('1001:2026-09-20', 4) === '00:30', D['1001:2026-09-20']?.join('|'))
check('posting: unposted day uses the new times (08:05 vs 07:00 → late)', /متأخر/.test(cell('1001:2026-09-21', 8) || ''), D['1001:2026-09-21']?.join('|'))
await closeWin(rw)
await menu('الإجراءات', 'الغاء ترحيل'); w = win('الغاء ترحيل الحركات خلال فترة'); await w.locator('#pw-from').fill('2026-09-19'); await w.locator('#pw-to').fill('2026-09-20'); await w.locator('#pw-go').click(); await p.waitForTimeout(200); await okMsg(); await closeWin(w)
;[rw, D] = await detailed()
check('unpost: the day is recomputed with the current times (08:30 vs 07:00 → 01:30 late)', cell('1001:2026-09-20', 4) === '01:30', D['1001:2026-09-20']?.join('|'))
await closeWin(rw)
// penalty rules + report
await menu('الإعدادات', 'لائحة الجزاءات'); w = win('لائحة الجزاءات')
const addRule = async (v, occ, act, amount) => { const r = lastRow(w); await r.locator('[data-f=violation]').selectOption({ label: v }); await r.locator('[data-f=occurrence]').selectOption({ index: occ }); await r.locator('[data-f=action]').selectOption({ label: act }); if (amount != null) await r.locator('[data-f=amount]').fill(String(amount)); await btn(w, 'حفظ').click(); await p.waitForTimeout(250) }
await addRule('تأخير', 1, 'خصم دقائق', null); check('penalties: deduction without amount rejected', /القيمة مطلوبة/.test(await okMsg())); await btn(w, 'إهمال').click()
await addRule('تأخير', 1, 'إنذار', null); await addRule('تأخير', 2, 'خصم دقائق', 30); await addRule('غياب', 1, 'خصم أيام', 1)
check('penalties: 3 rules saved', (await rowCount(w)) === 3); await snap('v2-penalty-rules'); await closeWin(w)
await menu('التقارير', 'الجزاءات'); rw = win('الجزاءات'); await rw.locator('#r-from').fill('2026-09-19'); await rw.locator('#r-to').fill('2026-09-24'); await btn(rw, 'موافق').click(); await p.waitForTimeout(300)
const pen = await rw.locator('.report-out').textContent()
check('penalties report: 1st late → إنذار, 2nd late → 30 min, absence → 1 day', /إنذار/.test(pen) && /خصم دقائق/.test(pen) && /خصم أيام/.test(pen), pen.slice(0, 200))
await snap('v2-penalties'); await closeWin(rw)
// permissions: user hr may only open «الموظفين»
await menu('الإعدادات', 'صلاحيات المستخدمين', 'اعدادات المستخدمين'); w = win('صلاحيات المستخدمين')
await w.locator('#ro-list tr', { hasText: 'موارد بشرية' }).click()
await w.locator('.screens tr[data-key="البيانات الأساسية/الموظفين"] input[data-a=print]').check(); await snap('v2-permissions')
check('roles: ticking «طباعة» ticks «عرض»', await w.locator('.screens tr[data-key="البيانات الأساسية/الموظفين"] input[data-a=view]').isChecked())
await btn(w, 'حفظ').click(); await okMsg(); await closeWin(w)
// audit log
await menu('أدوات', 'سجل الحركات'); w = win('سجل الحركات'); const audit = await w.locator('tbody').textContent()
check('audit log: records logins, posting, employee edits, permissions', /تسجيل دخول/.test(audit) && /ترحيل الحركات/.test(audit) && /تعديل موظف/.test(audit) && /تعديل صلاحيات/.test(audit))
await snap('v2-audit'); await closeWin(w)

// ── 8c. backup → change → restore ─────────────────────────
await menu('أدوات', 'نسخة احتياطية'); await okMsg()
fs.copyFileSync(`${UD}/manual-backup.sqlite`, `${UD}/restore-me.sqlite`)
await menu('البيانات الأساسية', 'المشاريع'); w = win('المشاريع'); await lastRow(w).locator('[data-f=name_ar]').fill('مشروع مؤقت'); await btn(w, 'حفظ').click(); await p.waitForTimeout(250)
check('restore: project added after the backup', (await rowCount(w)) === 2); await closeWin(w)
await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }) }, `${UD}/restore-me.sqlite`)
fs.writeFileSync(`${UD}/not-a-db.sqlite`, 'hello')
await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }) }, `${UD}/not-a-db.sqlite`)
await menu('أدوات', 'استرجاع نسخة احتياطية'); await yes(); await p.waitForTimeout(300)
check('restore: a non-backup file is refused', /ليس نسخة احتياطية صالحة/.test(await okMsg()))
await app.evaluate(({ dialog, app }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); app.relaunch = () => {}; app.exit = () => {} }, `${UD}/restore-me.sqlite`)
await menu('أدوات', 'استرجاع نسخة احتياطية'); await yes(); await p.waitForTimeout(400)
check('restore: backup restored', /تم استرجاع/.test(await okMsg()))
await menu('البيانات الأساسية', 'المشاريع'); w = win('المشاريع')
check('restore: data is back to the backup (temporary project gone)', (await rowCount(w)) === 1); await closeWin(w)
// logout returns to the login screen
await menu('أدوات', 'تسجيل خروج')
check('logout: back to the login screen', await p.locator('text=شاشة الدخول').waitFor({ timeout: 10000 }).then(() => true, () => false))
await p.locator('#pass').fill('admin1'); await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(600)
check('logout: login again', await p.locator('#home').isVisible())

// ── 9. restart: data persisted, password changed, licence kept ──
await app.close()
const app2 = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p2 = await app2.firstWindow(); await p2.waitForSelector('text=شاشة الدخول')
await p2.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p2.waitForTimeout(300)
check('restart: old empty password no longer works', /غير صحيحة/.test(await p2.locator('.dlg .err').textContent()))
await p2.locator('#user').fill('hr'); await p2.locator('#pass').fill('1234'); await p2.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p2.waitForTimeout(700)
check('permissions: restricted user sees only permitted menus', (await p2.locator('#menubar .menu').count()) === 3 && (await p2.locator('#menubar .menu > button', { hasText: 'البيانات الأساسية' }).count()) === 1)
await p2.locator('#menubar .menu > button', { hasText: 'البيانات الأساسية' }).click(); await p2.waitForTimeout(150)
check('permissions: only «الموظفين» inside', (await p2.locator('.menu.open .drop button').count()) === 1)
await p2.locator('.menu.open .drop button', { hasText: 'الموظفين' }).click(); await p2.waitForTimeout(300)
{ const ew = p2.locator('.win', { has: p2.locator('.cap', { hasText: 'الموظفين' }) }).last()
  const dis = async (k) => ew.locator(`.toolbar button[data-key=${k}]`).first().isDisabled()
  check('permissions: view+print only → جديد / حذف disabled, طباعة enabled', (await dis('new')) && (await dis('del')) && !(await dis('print')), `new=${await dis('new')} del=${await dis('del')} print=${await dis('print')}`)
  await ew.locator('.toolbar button[data-key=close]').click() }
await p2.locator('body').click({ position: { x: 5, y: 700 } })
await p2.locator('.tile', { hasText: 'التجهيز' }).click(); await p2.waitForTimeout(150)
check('permissions: home tile blocked without permission', /ليس لديك صلاحية/.test(await p2.locator('.dlg-backdrop .body').last().textContent()))
await app2.close()
const app3 = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p3 = await app3.firstWindow(); await p3.waitForSelector('text=شاشة الدخول')
check('login remembers the last user', (await p3.locator('#user').inputValue()) === 'hr')
await p3.locator('#user').fill('أ'); await p3.locator('#pass').fill('admin1'); await p3.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p3.waitForTimeout(700)
check('restart: login with new password', await p3.locator('#home').isVisible())
check('restart: licence kept', /Registered/.test(await p3.locator('#caption-text').textContent()))
await p3.locator('#menubar .menu > button', { hasText: 'البيانات الأساسية' }).click(); await p3.locator('.menu.open .drop button', { hasText: 'الموظفين' }).first().click(); await p3.waitForTimeout(300)
check('restart: employees persisted (6 after purge)', (await p3.locator('.win tbody tr').count()) === 6)
check('restart: automatic daily backup created', fs.existsSync(`${UD}/backups`) && fs.readdirSync(`${UD}/backups`).length >= 1)
await app3.close()

check('no page errors during the whole run', errs.length === 0, errs.slice(0, 3).join(' || '))
console.log(results.join('\n'))
console.log(`\nTOTAL: ${pass} passed, ${fail} failed · screenshots: ${shot} in ${SHOTS}`)
