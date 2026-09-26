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
