// One SQLite database per year, like Apex Time's «قاعدة البيانات: 2026».
// sql.js keeps it in memory; every write is flushed to disk via the bridge.
const DB = {
  sql: null,
  db: null,
  year: null,

  async init() {
    const base = window.location.protocol === 'file:' ? '../node_modules/sql.js/dist/' : '/sql.js/'
    await new Promise((ok, fail) => {
      const s = document.createElement('script')
      s.src = base + 'sql-wasm.js'
      s.onload = ok
      s.onerror = fail
      document.head.appendChild(s)
    })
    this.sql = await initSqlJs({ wasmBinary: new Uint8Array(await window.bridge.sqlWasm()) })
  },

  // One database for all years. v0.x kept one file per year: on first start
  // they are merged into the main file (newest year = master data; punches,
  // leaves, permissions, posting and the audit trail from every year, matched
  // to employees by code) and the old files are kept renamed.
  async open() {
    this.year = 'main'
    const bytes = await window.bridge.loadDb('main')
    if (bytes) {
      this.db = new this.sql.Database(new Uint8Array(bytes))
      this.migrate()
      return
    }
    const years = (await window.bridge.listDbs()).sort()
    const loadYear = async (y) => { const d = new this.sql.Database(new Uint8Array(await window.bridge.loadDb(y))); return d }
    if (!years.length) {
      this.db = new this.sql.Database()
      this.migrate()
      await this.flush()
      return
    }
    this.db = await loadYear(years.at(-1))
    this.migrate()
    for (const y of years.slice(0, -1)) {
      const old = await loadYear(y)
      this.mergeFrom(old)
      old.close()
    }
    this.audit('دمج قواعد البيانات', `السنوات ${years.join('، ')}`)
    await this.flush()
    for (const y of years) await window.bridge.retireDb(y)
  },

  mergeFrom(old) {
    const q = (sql, params = []) => { const st = old.prepare(sql); st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out }
    const has = (t) => q("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [t]).length > 0
    const codeToId = Object.fromEntries(this.all('SELECT id, code FROM employees').map((e) => [e.code, e.id]))
    const oldIdToCode = has('employees') ? Object.fromEntries(q('SELECT id, code FROM employees').map((e) => [e.id, e.code])) : {}
    const mapEmp = (oldId) => codeToId[oldIdToCode[oldId]]
    this.run('BEGIN')
    if (has('punches')) for (const r of q('SELECT emp_code, ts, source, device_id, created_at FROM punches'))
      this.run('INSERT OR IGNORE INTO punches (emp_code, ts, source, device_id, created_at) VALUES (?,?,?,?,?)', [r.emp_code, r.ts, r.source, r.device_id, r.created_at])
    if (has('leaves')) for (const r of q('SELECT * FROM leaves')) { const id = mapEmp(r.employee_id); if (id) this.run('INSERT INTO leaves (employee_id, type_id, from_date, to_date, notes) VALUES (?,?,?,?,?)', [id, r.type_id, r.from_date, r.to_date, r.notes]) }
    if (has('permissions')) for (const r of q('SELECT * FROM permissions')) { const id = mapEmp(r.employee_id); if (id) this.run('INSERT INTO permissions (employee_id, type_id, date, from_time, to_time, notes) VALUES (?,?,?,?,?,?)', [id, r.type_id, r.date, r.from_time, r.to_time, r.notes]) }
    if (has('holidays')) for (const r of q('SELECT * FROM holidays'))
      if (!this.one('SELECT 1 FROM holidays WHERE from_date = ? AND to_date = ?', [r.from_date, r.to_date])) this.run('INSERT INTO holidays (name_ar, from_date, to_date) VALUES (?,?,?)', [r.name_ar, r.from_date, r.to_date])
    if (has('ramadan_periods')) for (const r of q('SELECT * FROM ramadan_periods'))
      if (!this.one('SELECT 1 FROM ramadan_periods WHERE from_date = ?', [r.from_date])) this.run('INSERT INTO ramadan_periods (from_date, to_date) VALUES (?,?)', [r.from_date, r.to_date])
    if (has('posted_periods')) for (const r of q('SELECT * FROM posted_periods')) this.run('INSERT INTO posted_periods (from_date, to_date, posted_at) VALUES (?,?,?)', [r.from_date, r.to_date, r.posted_at])
    if (has('posted_attendance')) for (const r of q('SELECT * FROM posted_attendance')) { const id = mapEmp(r.employee_id); if (id) this.run('INSERT OR IGNORE INTO posted_attendance (employee_id, date, data) VALUES (?,?,?)', [id, r.date, r.data]) }
    if (has('audit_log')) for (const r of q('SELECT * FROM audit_log')) this.run('INSERT INTO audit_log (ts, username, action, target, details) VALUES (?,?,?,?,?)', [r.ts, r.username, r.action, r.target, r.details])
    this.run('COMMIT')
  },

  // «استرجاع نسخة احتياطية»: validate the file, then replace the database
  async restore(bytes) {
    let test
    try {
      test = new this.sql.Database(new Uint8Array(bytes))
      const t = test.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.flat() || []
      if (!['employees', 'punches', 'users'].every((x) => t.includes(x))) return false
    } catch { return false } finally { test?.close() }
    this.db = new this.sql.Database(new Uint8Array(bytes))
    this.migrate()
    this.audit('استرجاع نسخة احتياطية', '')
    await this.flush()
    return true
  },

  migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, is_admin INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS shift_groups (
        id INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT DEFAULT '',
        total_minutes INTEGER DEFAULT 0, open_shift INTEGER DEFAULT 0);
      -- «المواعيد» of a shift group: one row per weekday (0 = السبت … 6 = الجمعة),
      -- the 8 attendance terms used by the cloud version.
      CREATE TABLE IF NOT EXISTS shift_times (
        group_id INTEGER NOT NULL, day INTEGER NOT NULL, is_off INTEGER DEFAULT 0,
        start_in TEXT, check_in TEXT, late_min INTEGER DEFAULT 0, end_in TEXT,
        start_out TEXT, early_min INTEGER DEFAULT 0, check_out TEXT, end_out TEXT,
        PRIMARY KEY (group_id, day));
      CREATE TABLE IF NOT EXISTS lists (
        id INTEGER PRIMARY KEY, list_type TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT DEFAULT '');
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT DEFAULT '', parent_id INTEGER);
      CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT DEFAULT '');
      CREATE TABLE IF NOT EXISTS employee_groups (id INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT DEFAULT '');
      CREATE TABLE IF NOT EXISTS holidays (
        id INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, ip TEXT, port INTEGER DEFAULT 4370, serial TEXT, comm_key TEXT DEFAULT '0');
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name_ar TEXT NOT NULL, name_en TEXT DEFAULT '',
        status TEXT DEFAULT 'نشط', job_id INTEGER, department_id INTEGER, section_id INTEGER,
        group_id INTEGER, project_id INTEGER, shift_group_id INTEGER, hire_date TEXT,
        gender TEXT, nationality_id INTEGER, national_id TEXT, religion TEXT, birth_date TEXT,
        mobile TEXT, email TEXT, address TEXT,
        ot_deduct_late INTEGER DEFAULT 0, ot_before INTEGER DEFAULT 0, ot_after INTEGER DEFAULT 0,
        ot_holidays INTEGER DEFAULT 0, no_punch_out INTEGER DEFAULT 0);
      -- one row per fingerprint punch; source = device | file | manual
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY, emp_code TEXT NOT NULL, ts TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'device',
        device_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), UNIQUE (emp_code, ts));
      CREATE INDEX IF NOT EXISTS punches_ts ON punches (ts);
      CREATE TABLE IF NOT EXISTS leaves (
        id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, type_id INTEGER, from_date TEXT NOT NULL, to_date TEXT NOT NULL, notes TEXT);
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, type_id INTEGER, date TEXT NOT NULL,
        from_time TEXT NOT NULL, to_time TEXT NOT NULL, notes TEXT);
      -- «ترحيل الحركات»: posted days are locked against punch edits until «الغاء ترحيل»
      CREATE TABLE IF NOT EXISTS posted_periods (
        id INTEGER PRIMARY KEY, from_date TEXT NOT NULL, to_date TEXT NOT NULL, posted_at TEXT DEFAULT (datetime('now','localtime')));
      CREATE TABLE IF NOT EXISTS print_counts (report TEXT PRIMARY KEY, n INTEGER DEFAULT 0);
    `)
    if (!this.one('SELECT 1 FROM users LIMIT 1')) {
      // first run: default admin «أ» with an empty password, like the video's login
      this.db.run('INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)', ['أ', ''])
    }
    this.migrateV2()
    this.migrateV3()
    this.migrateV4()
  },

  // 1.2 — Apex Time's permission model: named roles («صلاحيات المستخدمين») with
  // عرض/إضافة/حذف/تعديل/طباعة per screen; each user gets one role. Existing users keep
  // exactly what they had: admins → the built-in «مدير النظام», others → a role of their own.
  migrateV4() {
    const addCol = (t, c, def) => { if (!this.all(`PRAGMA table_info(${t})`).some((x) => x.name === c)) this.db.run(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`) }
    this.db.run(`CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT DEFAULT '',
      perms TEXT DEFAULT '{}', builtin INTEGER DEFAULT 0)`)
    addCol('users', 'role_id', 'INTEGER')
    addCol('users', 'full_name', "TEXT DEFAULT ''")
    // «إضافة وتعديل حركات موظف»: an edited punch keeps the device time it replaced (→ «معدل»);
    // a note per employee per day
    addCol('punches', 'orig_ts', 'TEXT')
    this.db.run('CREATE TABLE IF NOT EXISTS punch_notes (emp_code TEXT NOT NULL, date TEXT NOT NULL, notes TEXT, PRIMARY KEY (emp_code, date))')
    if (!this.one('SELECT 1 FROM roles WHERE id = 1')) this.db.run("INSERT INTO roles (id, name_ar, name_en, builtin) VALUES (1, 'مدير النظام', 'Administrator', 1)")
    for (const u of this.all('SELECT * FROM users WHERE role_id IS NULL')) {
      let role = 1
      if (!u.is_admin) {
        const all = { view: 1, add: 1, del: 1, edit: 1, print: 1 }
        const perms = Object.fromEntries(JSON.parse(u.permissions || '[]').map((k) => [k, all]))
        this.db.run('INSERT INTO roles (name_ar, name_en, perms) VALUES (?, ?, ?)', [`صلاحيات ${u.username}`, u.username, JSON.stringify(perms)])
        role = this.one('SELECT last_insert_rowid() AS id').id
      }
      this.db.run('UPDATE users SET role_id = ?, full_name = COALESCE(NULLIF(full_name, \'\'), username) WHERE id = ?', [role, u.id])
    }
  },

  // v2 (0.2.0): up to 4 «ورديات» per day + «شفت ممتد», open shifts, rotating
  // shifts (blocks), Ramadan timings, dated employee shifts, posting snapshots,
  // user permissions, audit log, employee photo, penalty rules.
  migrateV2() {
    const addCol = (t, c, def) => { if (!this.all(`PRAGMA table_info(${t})`).some((x) => x.name === c)) this.db.run(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`) }
    addCol('shift_groups', 'rotational', 'INTEGER DEFAULT 0')
    addCol('shift_groups', 'start_date', 'TEXT')
    addCol('employees', 'photo', 'TEXT')
    addCol('employees', 'attendance_method', "TEXT DEFAULT 'بصمة'")
    addCol('users', 'permissions', 'TEXT')
    this.db.run(`
      -- one row per (group, calendar Y|R, slot, window 1..4). slot = weekday 0..6
      -- for normal/open shifts, block index for rotating shifts.
      CREATE TABLE IF NOT EXISTS shift_windows (
        group_id INTEGER NOT NULL, calendar TEXT NOT NULL DEFAULT 'Y', slot INTEGER NOT NULL, window_no INTEGER NOT NULL DEFAULT 1,
        is_off INTEGER DEFAULT 0, start_in TEXT, check_in TEXT, late_min INTEGER DEFAULT 0, end_in TEXT,
        start_out TEXT, early_min INTEGER DEFAULT 0, check_out TEXT, end_out TEXT, extended INTEGER DEFAULT 0,
        required_min INTEGER, extends_next_day INTEGER DEFAULT 0, day_end TEXT,
        PRIMARY KEY (group_id, calendar, slot, window_no));
      CREATE TABLE IF NOT EXISTS rotation_blocks (
        group_id INTEGER NOT NULL, calendar TEXT NOT NULL DEFAULT 'Y', idx INTEGER NOT NULL,
        work_days INTEGER NOT NULL, rest_days INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (group_id, calendar, idx));
      CREATE TABLE IF NOT EXISTS ramadan_periods (id INTEGER PRIMARY KEY, from_date TEXT NOT NULL, to_date TEXT NOT NULL);
      -- which shift group an employee is on from which date (history-safe shift changes)
      CREATE TABLE IF NOT EXISTS employee_shifts (
        id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, group_id INTEGER NOT NULL, from_date TEXT NOT NULL,
        UNIQUE (employee_id, from_date));
      -- «ترحيل الحركات» freezes the computed day so later setting changes never rewrite it
      CREATE TABLE IF NOT EXISTS posted_attendance (
        employee_id INTEGER NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (employee_id, date));
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY, ts TEXT DEFAULT (datetime('now','localtime')), username TEXT, action TEXT, target TEXT, details TEXT);
      -- «لائحة الجزاءات»: violation × occurrence in the month → action
      CREATE TABLE IF NOT EXISTS penalty_rules (
        id INTEGER PRIMARY KEY, violation TEXT NOT NULL, min_minutes INTEGER DEFAULT 0, occurrence INTEGER NOT NULL DEFAULT 1,
        action TEXT NOT NULL, amount REAL DEFAULT 0, notes TEXT);
    `)
    if (this.one("SELECT value FROM meta WHERE key = 'schema'")?.value !== '2') {
      // carry v1 data over: weekly times → window 1 of the year calendar; employee shift → dated row
      this.db.run(`INSERT OR IGNORE INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out)
        SELECT group_id, 'Y', day, 1, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out FROM shift_times`)
      this.db.run(`INSERT OR IGNORE INTO employee_shifts (employee_id, group_id, from_date)
        SELECT id, shift_group_id, COALESCE(hire_date, '2000-01-01') FROM employees WHERE shift_group_id IS NOT NULL`)
      this.db.run("INSERT INTO meta (key, value) VALUES ('schema', '2') ON CONFLICT(key) DO UPDATE SET value = '2'")
    }
  },

  // v3 (1.1.0): link with the web version — each row pulled from the site keeps
  // the site's document name in web_id; punches pushed to the site get it too.
  migrateV3() {
    const addCol = (t, c, def) => { if (!this.all(`PRAGMA table_info(${t})`).some((x) => x.name === c)) this.db.run(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`) }
    for (const t of ['departments', 'lists', 'projects', 'employee_groups', 'holidays', 'shift_groups', 'employees', 'leaves', 'permissions', 'punches']) addCol(t, 'web_id', 'TEXT')
    // punches deleted on the site: a device / file re-read must not bring them back
    this.db.run('CREATE TABLE IF NOT EXISTS web_deleted (emp_code TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (emp_code, ts))')
    // 1.1.4 — the site's attendance rules: holidays + weekly offs come from each employee's
    // holiday list; shifts without per-day windows use the site's simple rule (plain_rule)
    addCol('holidays', 'list_id', 'TEXT')
    addCol('employees', 'holiday_list', 'TEXT')
    addCol('shift_groups', 'plain_rule', 'INTEGER DEFAULT 0')
    this.db.run('CREATE TABLE IF NOT EXISTS web_weekly_offs (list_id TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY (list_id, date))')
  },

  audit(action, target, details = '') {
    try { this.db.run('INSERT INTO audit_log (username, action, target, details) VALUES (?, ?, ?, ?)', [window.Session?.username || '', action, target, String(details).slice(0, 500)]) } catch {}
  },

  all(sql, params = []) {
    const st = this.db.prepare(sql)
    st.bind(params)
    const rows = []
    while (st.step()) rows.push(st.getAsObject())
    st.free()
    return rows
  },
  one(sql, params = []) { return this.all(sql, params)[0] || null },
  run(sql, params = []) { this.db.run(sql, params) },

  async flush() { await window.bridge.saveDb(this.year, this.db.export()) },
}
