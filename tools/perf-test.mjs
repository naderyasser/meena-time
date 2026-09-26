// Performance on customer-sized data: 200 employees × 1 year of punches.
// Run: xvfb-run -a node tools/perf-test.mjs
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
const ROOT = '/root/meena-time', UD = '/tmp/mt-perftest'
fs.rmSync(UD, { recursive: true, force: true })
const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p = await app.firstWindow()
await p.waitForSelector('text=شاشة الدخول', { timeout: 20000 })
const time = async (label, fn) => { const t = await p.evaluate(fn); console.log(`${label.padEnd(58)} ${t.ms.toFixed(0).padStart(6)} ms ${t.info || ''}`); return t }

await time('seed: 200 employees, 1 shift, year of punches', async () => {
  const t0 = performance.now()
  DB.run('BEGIN')
  DB.run("INSERT INTO shift_groups (id, name_ar) VALUES (1, 'صباحي')")
  for (let d = 0; d < 7; d++) DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out)
    VALUES (1, 'Y', ${d}, 1, ${d >= 5 ? 1 : 0}, '06:00','08:00',15,'11:00','12:00',15,'16:00','20:00')`)
  for (let i = 1; i <= 200; i++) {
    DB.run("INSERT INTO employees (id, code, name_ar, shift_group_id, hire_date) VALUES (?, ?, ?, 1, '2025-01-01')", [i, String(1000 + i), `موظف ${i}`])
    DB.run("INSERT INTO employee_shifts (employee_id, group_id, from_date) VALUES (?, 1, '2025-01-01')", [i])
  }
  let n = 0
  for (let d = new Date('2025-10-01T00:00:00'); d <= new Date('2026-09-30T00:00:00'); d.setDate(d.getDate() + 1)) {
    const day = (d.getDay() + 1) % 7
    if (day >= 5) continue
    const iso = Engine.iso(d)
    for (let i = 1; i <= 200; i++) {
      if ((i + d.getDate()) % 23 === 0) continue // some absences
      const inM = 470 + ((i * 7 + d.getDate() * 3) % 40), outM = 955 + ((i * 5 + d.getDate()) % 30)
      DB.run("INSERT OR IGNORE INTO punches (emp_code, ts, source) VALUES (?, ?, 'device')", [String(1000 + i), `${iso} ${Engine.hm(inM)}:00`])
      DB.run("INSERT OR IGNORE INTO punches (emp_code, ts, source) VALUES (?, ?, 'device')", [String(1000 + i), `${iso} ${Engine.hm(outM)}:00`])
      n += 2
    }
  }
  DB.run('COMMIT')
  return { ms: performance.now() - t0, info: `(${n} punches)` }
})
await time('save database to disk (flush)', async () => { const t0 = performance.now(); await DB.flush(); return { ms: performance.now() - t0, info: `(${(DB.db.export().length / 1048576).toFixed(1)} MB)` } })
await time('report: «حالة اليوم» — 200 employees, 1 day', async () => { const t0 = performance.now(); const r = Engine.compute({ from: '2026-09-15', to: '2026-09-15' }); return { ms: performance.now() - t0, info: `(${r.length} rows)` } })
await time('report: detailed — 200 employees, 1 month', async () => { const t0 = performance.now(); const r = Engine.compute({ from: '2026-08-01', to: '2026-08-31' }); return { ms: performance.now() - t0, info: `(${r.length} rows)` } })
await time('report: totals — 200 employees, 1 full year', async () => { const t0 = performance.now(); const r = Engine.compute({ from: '2025-10-01', to: '2026-09-30' }); return { ms: performance.now() - t0, info: `(${r.length} rows)` } })
await time('report: 1 employee, 1 full year', async () => { const t0 = performance.now(); const r = Engine.compute({ from: '2025-10-01', to: '2026-09-30', employeeIds: [5] }); return { ms: performance.now() - t0, info: `(${r.length} rows)` } })
await time('import: 10,000-line punch file (parse + store + save)', async () => {
  const lines = []
  for (let i = 0; i < 10000; i++) lines.push(`  ${1001 + (i % 200)}\t2026-10-${String(1 + (i % 28)).padStart(2, '0')} ${String(8 + (i % 9)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00\t1\t0`)
  const t0 = performance.now(); const msg = await storePunches(parsePunchFile(lines.join('\n')), 'file')
  return { ms: performance.now() - t0, info: `(${msg.slice(0, 40)})` }
})
await time('posting: 200 employees × 1 month (snapshot + save)', async () => { const t0 = performance.now(); Engine.post('2026-07-01', '2026-07-31'); await DB.flush(); return { ms: performance.now() - t0 } })
await time('report after posting: 1 month (from snapshots)', async () => { const t0 = performance.now(); const r = Engine.compute({ from: '2026-07-01', to: '2026-07-31' }); return { ms: performance.now() - t0, info: `(${r.length} rows)` } })
const mem = await app.evaluate(({ webContents }) => webContents.getAllWebContents()[0].getProcessMemoryInfo?.().then?.((m) => m) ?? null)
console.log('renderer memory (private KB):', mem?.private ?? 'n/a')
await app.close()
fs.rmSync(UD, { recursive: true, force: true })
