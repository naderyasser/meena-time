// Screenshots for the 1.2.2 client requests (open shift periods, «وقت إهمال الحركات», admin login).
// Run: xvfb-run -a node tools/request-shots.mjs → feature-shots/req-*.png
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
import os from 'os'

const ROOT = '/root/meena-time', OUT = `${ROOT}/feature-shots`
const UD = `${os.homedir()}/.config/Meena Time Demo`
fs.mkdirSync(OUT, { recursive: true }); fs.rmSync(UD, { recursive: true, force: true })
const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--demo', '--no-sandbox'], cwd: ROOT })
const p = await app.firstWindow()
await p.setViewportSize({ width: 1366, height: 768 })
const snap = async (name, loc) => {
  const b = await loc.boundingBox()
  await p.screenshot({ path: `${OUT}/${name}.png`, clip: { x: Math.max(0, b.x - 6), y: Math.max(0, b.y - 6), width: Math.min(1366, b.width + 12), height: Math.min(768, b.height + 12) } })
}

await p.waitForSelector('text=شاشة الدخول', { timeout: 20000 })
await p.locator('#user').fill('admin'); await p.locator('#pass').fill('1234')
await snap('req-1-دخول-admin', p.locator('.dlg').last())
await p.locator('.dlg').getByRole('button', { name: 'موافق' }).click(); await p.waitForTimeout(1500)

// an open-shift employee (8 h) who punched two periods yesterday and one period today
const d = await p.evaluate(() => {
  const y = Engine.addDays(Engine.today(), -1), t = Engine.today()
  DB.run("INSERT INTO shift_groups (name_ar, open_shift) VALUES ('دوام مفتوح 8 ساعات', 1)")
  const gid = DB.one('SELECT last_insert_rowid() AS id').id
  for (let s = 0; s < 7; s++) DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, required_min) VALUES (${gid}, 'Y', ${s}, 1, 0, 480)`)
  DB.run(`INSERT INTO employees (code, name_ar, shift_group_id, hire_date, ot_after) VALUES ('9001', 'موظف دوام مفتوح', ${gid}, '2026-01-01', 1)`)
  const eid = DB.one('SELECT last_insert_rowid() AS id').id
  DB.run(`INSERT INTO employee_shifts (employee_id, group_id, from_date) VALUES (${eid}, ${gid}, '2026-01-01')`)
  for (const ts of [`${y} 08:00`, `${y} 08:04`, `${y} 12:00`, `${y} 16:00`, `${y} 20:00`, `${t} 08:00`, `${t} 12:00`])
    DB.run("INSERT INTO punches (emp_code, ts, source) VALUES ('9001', ?, 'device')", [ts + ':00'])
  const S = Engine.settings(); S.ignore_min = 30
  DB.run("INSERT INTO meta (key, value) VALUES ('sys_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(S)])
  return { y, t }
})

await p.evaluate(() => openSystemSettings()); await p.waitForSelector('.sys-set'); await p.waitForTimeout(300)
await snap('req-2-وقت-إهمال-الحركات', p.locator('.win').last())
await p.locator('.win').last().locator('.toolbar button', { hasText: 'إغلاق' }).first().click().catch(() => {})

await p.evaluate(() => openReport('الحضور والانصراف تفصيلي')); await p.waitForTimeout(500)
const w = p.locator('.win').last()
await w.locator('#r-from').fill(d.y); await w.locator('#r-to').fill(d.t)
await w.locator('#rf-codes').check(); await w.locator('#r-code-from').fill('9001'); await w.locator('#r-code-to').fill('9001')
await w.locator('.toolbar button', { hasText: 'موافق' }).first().click(); await p.waitForTimeout(1500)
await snap('req-3-الدوام-المفتوح-فترتين', p.locator('.win').last())

await app.close()
fs.rmSync(UD, { recursive: true, force: true })
console.log(fs.readdirSync(OUT).filter((f) => f.startsWith('req-')).join('\n'))
