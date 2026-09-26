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
    this.sql = await initSqlJs({ locateFile: (f) => base + f })
  },

  async open(year) {
    const bytes = await window.bridge.loadDb(year)
    this.db = bytes ? new this.sql.Database(new Uint8Array(bytes)) : new this.sql.Database()
    this.year = year
    this.migrate()
    if (!bytes) await this.flush()
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
