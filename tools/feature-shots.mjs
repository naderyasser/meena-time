// Screenshots of the 1.2.x features on the demo data, for showing clients.
// Run: xvfb-run -a node tools/feature-shots.mjs → feature-shots/*.png
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
import os from 'os'
import { startMockZK } from './mock-zk.mjs'

const ROOT = '/root/meena-time', OUT = `${ROOT}/feature-shots`
const UD = `${os.homedir()}/.config/Meena Time Demo`
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT)
fs.rmSync(UD, { recursive: true, force: true })

const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--demo', '--no-sandbox'], cwd: ROOT })
const p = await app.firstWindow()
await p.setViewportSize({ width: 1366, height: 768 })
const menu = async (m, item) => {
  await p.locator('#menubar .menu > button', { hasText: m }).first().click()
  await p.locator('.menu.open .drop button', { hasText: item }).first().click()
  await p.waitForTimeout(500)
}
const win = (t) => p.locator('.win', { has: p.locator('.cap', { hasText: t }) }).last()
let n = 0
const snap = async (name, loc) => {
  const b = await loc.boundingBox()
  const pad = 6
  await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(1366, b.width + 2 * pad), height: Math.min(768, b.height + 2 * pad) } })
}
const close = async (w) => { await w.locator('.toolbar button', { hasText: 'إغلاق' }).first().click(); await p.waitForTimeout(200) }

await p.waitForSelector('text=شاشة الدخول', { timeout: 20000 })
await p.locator('#user').fill('أ'); await p.locator('#pass').fill('1234')
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(1200)

// fake devices so the transfer window has something to do
const zkA = await startMockZK({ port: 14390, users: Array.from({ length: 12 }, (_, i) => ({ uid: i + 1, userId: String(1001 + i), name: `E${i}` })),
  templates: Array.from({ length: 12 }, (_, i) => ({ uid: i + 1, fid: 0, template: Buffer.alloc(500, i) })) })
const zkB = await startMockZK({ port: 14391 })
await p.evaluate(() => { DB.run("INSERT INTO devices (name, ip, port) VALUES ('جهاز الفرع الرئيسي', '127.0.0.1', 14390)"); DB.run("INSERT INTO devices (name, ip, port) VALUES ('الجهاز الجديد', '127.0.0.1', 14391)") })

await menu('الإجراءات', 'نقل بصمات الموظفين بين الأجهزة'); let w = win('نقل بصمات الموظفين')
await w.locator('#tf-from').selectOption({ label: 'جهاز الفرع الرئيسي — 127.0.0.1' }); await w.locator('#tf-to').selectOption({ label: 'الجهاز الجديد — 127.0.0.1' })
await w.locator('#tf-codes').check(); await w.locator('#tf-cf').fill('1001'); await w.locator('#tf-ct').fill('1012')
await w.locator('#pw-go').click(); await p.waitForTimeout(1500)
await p.locator('.dlg-backdrop').last().getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(200)
await snap('نقل-البصمات', w); await close(w)
zkA.server.close(); zkB.server.close()

await menu('البيانات الأساسية', 'الإدارات والأقسام'); w = win('الأقسام والإدارات')
await w.locator('.tn').nth(1).click().catch(() => {}); await p.waitForTimeout(200); await snap('الأقسام-والإدارات', w); await close(w)

await menu('البيانات الأساسية', 'تعريف الأجهزة'); w = win('اعدادات الجهاز')
await w.locator('tbody tr[data-id]').first().click().catch(() => {}); await p.waitForTimeout(200); await snap('تعريف-الأجهزة', w); await close(w)

await menu('البيانات الأساسية', 'قوائم البرنامج'); w = win('قوائم البرنامج'); await snap('قوائم-البرنامج', w); await close(w)

await menu('البيانات الأساسية', 'مجموعات الموظفين'); w = win('مجموعات الموظفين')
await w.locator('tbody tr').first().click(); await w.locator('.toolbar button', { hasText: 'الموظفون' }).click(); await p.waitForTimeout(600)
const gm = p.locator('.win').last(); await snap('أعضاء-المجموعة', gm); await close(gm); await close(w)

await menu('الإجراءات', 'إضافة إجازات لموظف'); w = win('أجازات الموظفين'); await snap('الإجازات', w)
await w.locator('.toolbar button', { hasText: 'جديد' }).first().click(); await p.waitForTimeout(400)
await snap('إضافة-إجازة', p.locator('.dlg').last()); await p.keyboard.press('Escape'); await p.waitForTimeout(200)
await p.locator('.dlg-backdrop').last().getByRole('button', { name: /الغاء|إغلاق/ }).first().click().catch(() => {}); await close(w)

await menu('الإجراءات', 'ترحيل الحركات'); w = win('ترحيل الحركات'); await snap('ترحيل-الحركات', w); await close(w)
await menu('الإجراءات', 'الغاء ترحيل الحركات'); w = win('الغاء ترحيل'); await snap('الغاء-الترحيل', w); await close(w)
await menu('الإجراءات', 'قراءة الحركات (شبكة - ملف)'); w = win('قراءة الحركات'); await p.waitForTimeout(2500); await snap('قراءة-الحركات', w); await close(w)
await menu('الإجراءات', 'عرض الحركات'); w = win('عرض الحركات'); await snap('عرض-الحركات', w); await close(w)
await menu('الإجراءات', 'إضافة وتعديل الحركات لموظف'); w = win('إضافة وتعديل حركات'); await snap('تعديل-الحركات', w); await close(w)
await menu('أدوات', 'انشاء قاعدة بيانات'); await p.waitForTimeout(300); await snap('انشاء-قاعدة-بيانات', p.locator('.dlg, .win').last())

await app.close()
fs.rmSync(UD, { recursive: true, force: true })
console.log(fs.readdirSync(OUT).join('\n'))
