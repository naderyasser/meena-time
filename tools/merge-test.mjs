// v0.x → v1.0: two per-year database files must be merged into one on first start.
// Run: xvfb-run -a node tools/merge-test.mjs
import { _electron as electron } from '/home/frappeuser/tamken3-audit/node_modules/playwright/index.mjs'
import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const initSqlJs = require('/root/meena-time/node_modules/sql.js')
const ROOT = '/root/meena-time', UD = '/tmp/mt-mergetest'
fs.rmSync(UD, { recursive: true, force: true }); fs.mkdirSync(UD, { recursive: true })

// the v0 schema = the first CREATE block of renderer/db.js migrate()
const src = fs.readFileSync(`${ROOT}/renderer/db.js`, 'utf8')
const v0 = src.slice(src.indexOf('this.db.run(`') + 13, src.indexOf('`)', src.indexOf('this.db.run(`')))
const SQL = await initSqlJs()
function yearDb(year, employees, punches) {
  const db = new SQL.Database()
  db.run(v0)
  db.run("INSERT INTO users (username, password, is_admin) VALUES ('أ', '', 1)")
  db.run("INSERT INTO shift_groups (id, name_ar) VALUES (1, 'صباحي')")
  for (let d = 0; d < 7; d++) db.run(`INSERT INTO shift_times VALUES (1, ${d}, ${d === 6 ? 1 : 0}, '06:00','08:00',15,'11:00','12:00',15,'16:00','20:00')`)
  for (const [id, code, name] of employees) db.run('INSERT INTO employees (id, code, name_ar, shift_group_id, hire_date) VALUES (?,?,?,1,?)', [id, code, name, `${year - 1}-01-01`])
  for (const [code, ts] of punches) db.run("INSERT INTO punches (emp_code, ts, source) VALUES (?, ?, 'device')", [code, ts])
  db.run("INSERT INTO holidays (name_ar, from_date, to_date) VALUES ('اليوم الوطني', ?, ?)", [`${year}-09-23`, `${year}-09-23`])
  fs.writeFileSync(`${UD}/meena-time-${year}.sqlite`, Buffer.from(db.export()))
}
// 2025: employee 1001 had id 7 there; 2026 renumbered him to id 1 → merge must match by code
yearDb(2025, [[7, '1001', 'أحمد']], [['1001', '2025-06-01 08:01:00'], ['1001', '2025-06-01 16:00:00']])
yearDb(2026, [[1, '1001', 'أحمد'], [2, '1002', 'خالد']], [['1001', '2026-02-01 08:02:00'], ['1002', '2026-02-01 08:03:00']])
const db25 = new SQL.Database(fs.readFileSync(`${UD}/meena-time-2025.sqlite`))
db25.run("INSERT INTO leaves (employee_id, from_date, to_date) VALUES (7, '2025-07-01', '2025-07-03')")
fs.writeFileSync(`${UD}/meena-time-2025.sqlite`, Buffer.from(db25.export()))

let pass = 0, fail = 0
const check = (n, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  → ' + info}`) }
const app = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p = await app.firstWindow()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.waitForSelector('text=شاشة الدخول', { timeout: 20000 })
const files = fs.readdirSync(UD)
check('merge: one main database created', files.includes('meena-time.sqlite'))
check('merge: old year files kept, renamed', files.includes('meena-time-2025.sqlite.v0-merged') && files.includes('meena-time-2026.sqlite.v0-merged') && !files.includes('meena-time-2025.sqlite'))
const q = async (sql, params = []) => p.evaluate(([s, pr]) => DB.all(s, pr), [sql, params])
check('merge: employees from the newest year (2)', (await q('SELECT * FROM employees')).length === 2)
check('merge: punches of both years (4)', (await q('SELECT * FROM punches')).length === 4)
check('merge: 2025 leave mapped to the 2026 employee id by code', (await q('SELECT employee_id FROM leaves'))[0]?.employee_id === 1)
check('merge: holidays of both years (2)', (await q('SELECT * FROM holidays')).length === 2)
check('merge: v1 weekly times converted to the new shift model', (await q("SELECT * FROM shift_windows WHERE group_id = 1 AND calendar = 'Y'")).length === 7)
check('merge: employee shift history created', (await q('SELECT * FROM employee_shifts')).length === 2)
check('merge: logged in the audit trail', (await q("SELECT * FROM audit_log WHERE action = 'دمج قواعد البيانات'")).length === 1)
// the merged data is usable: 2025 report for 1001 on 2025-06-01
const r = await p.evaluate(() => Engine.compute({ from: '2025-06-01', to: '2025-06-01' }).map((x) => [x.emp.code, x.status, Engine.hm(x.in)]))
check('merge: 2025 punches still produce attendance', JSON.stringify(r).includes('"1001","حضور","08:01"'), JSON.stringify(r))
await app.close()
// second start: nothing is merged again
const app2 = await electron.launch({ executablePath: `${ROOT}/node_modules/electron/dist/electron`, args: ['.', '--no-sandbox', `--user-data-dir=${UD}`], cwd: ROOT })
const p2 = await app2.firstWindow(); await p2.waitForSelector('text=شاشة الدخول')
check('merge: runs once only', (await p2.evaluate(() => DB.all('SELECT * FROM punches').length)) === 4)
await app2.close()
check('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\nTOTAL: ${pass} passed, ${fail} failed`)
fs.rmSync(UD, { recursive: true, force: true })
