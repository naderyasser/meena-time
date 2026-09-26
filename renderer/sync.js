// Link with the web version (same client, same data). The site is the source:
// setup data (departments, jobs, leave types, projects, employee groups,
// holidays, shifts, employees + their shift history, approved leaves and
// permissions) and the site's punches come down; punches read here from a
// device / file / by hand go up as Employee Checkin. While linked, the setup
// screens are read-only here — they are edited on the site.
const WebSync = {
  linked: false,
  running: false,
  timer: null,
  // tables owned by the site while linked
  TABLES: ['departments', 'lists', 'projects', 'employee_groups', 'holidays', 'shift_groups', 'employees', 'leaves', 'permissions'],
  DAY: { Saturday: 0, Sunday: 1, Monday: 2, Tuesday: 3, Wednesday: 4, Thursday: 5, Friday: 6 },
  STATUS: { Active: 'نشط', Inactive: 'غير نشط', Suspended: 'موقوف', Left: 'منتهي' },

  // at start-up (quiet sync now) or right after linking (syncNow = false: the caller syncs with a message)
  async init(syncNow = true) {
    this.linked = !!(await window.bridge.webConfig())?.linked
    this.showStatus()
    if (!this.linked) return
    if (syncNow) this.sync({ quiet: true })
    clearInterval(this.timer)
    this.timer = setInterval(() => this.sync({ quiet: true }), 10 * 60 * 1000)
  },

  // call from any save/delete of a site-owned table; true = blocked (message shown)
  blocks(table) {
    if (!this.linked || !this.TABLES.includes(table)) return false
    UI.message('البيانات مرتبطة بالموقع — عدّل هذه البيانات من الموقع وستصل هنا تلقائياً عند المزامنة')
    return true
  },

  meta(k) { return DB.one('SELECT value FROM meta WHERE key = ?', [k])?.value || '' },
  setMeta(k, v) { DB.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]) },

  showStatus(text) {
    let el = document.getElementById('sync-status')
    if (!el) {
      el = UI.el('<div id="sync-status"></div>')
      document.body.appendChild(el)
      el.addEventListener('click', () => this.linked && !this.running && this.sync())
    }
    el.style.display = this.linked ? '' : 'none'
    const last = this.meta('web_last_sync')
    el.textContent = text || (last ? `مرتبط بالموقع · آخر مزامنة ${last.slice(0, 16)}` : 'مرتبط بالموقع · لم تتم المزامنة بعد')
    el.title = 'اضغط للمزامنة الآن'
  },

  async get(dt, fields, filters = []) {
    const q = `fields=${encodeURIComponent(JSON.stringify(fields))}&filters=${encodeURIComponent(JSON.stringify(filters))}&limit_page_length=0&order_by=${encodeURIComponent('creation asc')}`
    const r = await window.bridge.webCall('GET', `/api/resource/${encodeURIComponent(dt)}?${q}`)
    if (r.error) throw new Error(r.error)
    return r.data || []
  },
  async doc(dt, name) {
    const r = await window.bridge.webCall('GET', `/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`)
    if (r.error) throw new Error(r.error)
    return r.data
  },

  // ── one full round: push local punches, then pull everything ──
  async sync({ quiet = false } = {}) {
    if (this.running || !this.linked) return
    this.running = true
    this.showStatus('جاري المزامنة مع الموقع…')
    try {
      const data = await this.fetchAll()
      const pushed = await this.push(data.empByCode)
      const res = this.apply(data)
      this.setMeta('web_last_sync', `${Engine.today()} ${new Date().toTimeString().slice(0, 8)}`)
      DB.audit('مزامنة مع الموقع', '', `${res.employees} موظف، ${res.punches} حركة جديدة، ${pushed} حركة مرفوعة`)
      await DB.flush()
      this.showStatus()
      if (!quiet) UI.message(`تمت المزامنة: ${res.employees} موظف، ${res.groups} دوام، ${res.punches} حركة جديدة من الموقع، ${pushed} حركة مرفوعة للموقع`)
      return res
    } catch (e) {
      try { DB.run('ROLLBACK') } catch {}
      this.showStatus(`تعذّرت المزامنة: ${e.message}`)
      if (!quiet) UI.message(`تعذّرت المزامنة: ${e.message}`)
    } finally {
      this.running = false
    }
  },

  async fetchAll() {
    const since = this.meta('web_checkins_since') || Engine.addDays(Engine.today(), -120)
    const [departments, designations, leaveTypes, projects, egroups, holidayLists, shiftTypes, employees, assignments, leaves, perms, checkins] = await Promise.all([
      this.get('Department', ['name', 'department_name', 'parent_department', 'is_group']),
      this.get('Designation', ['name']),
      this.get('Leave Type', ['name']),
      this.get('Project', ['name', 'project_name']).catch(() => []),
      this.get('Employee Group', ['name']).catch(() => []),
      this.get('Holiday List', ['name', 'weekly_off']),
      this.get('Shift Type', ['name', 'custom_shift_kind', 'custom_name_en', 'custom_is_rotational_internal', 'start_time', 'end_time', 'late_entry_grace_period', 'early_exit_grace_period', 'begin_check_in_before_shift_start_time', 'allow_check_out_after_shift_end_time', 'holiday_list', 'custom_open_hours', 'custom_day_end_time']),
      this.get('Employee', ['name', 'employee_name', 'custom_employee_name_en', 'attendance_device_id', 'status', 'gender', 'date_of_birth', 'date_of_joining', 'department', 'designation', 'custom_employee_group', 'custom_project', 'custom_nationality', 'custom_religion', 'cell_number', 'personal_email', 'company_email', 'current_address', 'default_shift',
        'custom_ot_deduct_late', 'custom_ot_before_shift', 'custom_ot_after_shift', 'custom_ot_holidays', 'custom_checkout_without_punch']),
      this.get('Shift Assignment', ['name', 'employee', 'shift_type', 'start_date', 'end_date'], [['docstatus', '=', 1], ['status', '=', 'Active']]),
      this.get('Leave Application', ['name', 'employee', 'leave_type', 'from_date', 'to_date', 'description'], [['docstatus', '=', 1], ['status', '=', 'Approved']]),
      this.get('Permission Request', ['name', 'employee', 'permission_date', 'from_time', 'to_time', 'reason'], [['docstatus', '=', 1], ['status', '=', 'Approved']]).catch(() => []),
      this.get('Employee Checkin', ['name', 'employee', 'time'], [['time', '>=', `${since} 00:00:00`]]),
    ])
    // child tables need the full documents
    const withWindows = await Promise.all(shiftTypes.filter((s) => s.custom_shift_kind !== 'Rotational').map((s) => this.doc('Shift Type', s.name).then((d) => ({ ...s, windows: d.custom_day_windows || [] }))))
    const hl = await Promise.all(holidayLists.map((h) => this.doc('Holiday List', h.name)))
    const empByCode = {}
    for (const e of employees) empByCode[this.codeOf(e)] = e.name
    return { departments, designations, leaveTypes, projects, egroups, holidayLists: hl, shiftTypes: withWindows, employees, assignments, leaves, perms, checkins, empByCode }
  },

  codeOf: (e) => String(e.attendance_device_id || e.name).trim(),

  // ── local punches → site (device / file / manual, not yet sent) ──
  async push(empByCode) {
    const rows = DB.all("SELECT id, emp_code, ts FROM punches WHERE web_id IS NULL AND source <> 'web' ORDER BY ts LIMIT 5000")
    let n = 0
    for (const r of rows) {
      const employee = empByCode[r.emp_code]
      if (!employee) continue // employee not on the site (yet): stays local
      const res = await window.bridge.webCall('POST', '/api/resource/Employee%20Checkin', { employee, time: r.ts, device_id: 'Meena Time', custom_client_ref: `mt:${r.emp_code}:${r.ts}` })
      if (res.offline) throw new Error(res.error)
      if (res.data?.name) { DB.run('UPDATE punches SET web_id = ? WHERE id = ?', [res.data.name, r.id]); n++ }
      else if (/same timestamp|already has a log/i.test(res.error || '')) DB.run("UPDATE punches SET web_id = 'dup' WHERE id = ?", [r.id])
    }
    return n
  },

  // ── site → local, one transaction ──
  apply(d) {
    const hm = (t) => (t ? String(t).split(':').slice(0, 2).map((x) => x.padStart(2, '0')).join(':') : null)
    const mins = (t) => { const [h, m] = hm(t).split(':').map(Number); return h * 60 + m }
    DB.run('BEGIN')
    // first link: local setup rows that never came from the site are replaced by the site's
    if (!this.meta('web_linked_once')) {
      for (const t of ['departments', 'lists', 'projects', 'employee_groups', 'holidays', 'leaves', 'permissions']) DB.run(`DELETE FROM ${t} WHERE web_id IS NULL`)
      const oldGroups = DB.all('SELECT id FROM shift_groups WHERE web_id IS NULL').map((r) => r.id)
      for (const g of oldGroups) { DB.run('DELETE FROM shift_windows WHERE group_id = ?', [g]); DB.run('DELETE FROM rotation_blocks WHERE group_id = ?', [g]) }
      DB.run('DELETE FROM shift_groups WHERE web_id IS NULL')
      DB.run('DELETE FROM employee_shifts WHERE employee_id IN (SELECT id FROM employees WHERE web_id IS NULL)')
      DB.run('DELETE FROM employees WHERE web_id IS NULL') // their punches stay, keyed by code
      this.setMeta('web_linked_once', '1')
    }
    // upsert by web_id; rows gone from the site are removed (employees: marked «منتهي»)
    const upsert = (table, webId, row) => {
      const cur = DB.one(`SELECT id FROM ${table} WHERE web_id = ?`, [webId])
      const cols = Object.keys(row)
      if (cur) { DB.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => row[c]), cur.id]); return cur.id }
      DB.run(`INSERT INTO ${table} (${cols.join(', ')}, web_id) VALUES (${cols.map(() => '?').join(', ')}, ?)`, [...cols.map((c) => row[c]), webId])
      return DB.one('SELECT last_insert_rowid() AS id').id
    }
    const prune = (table, keep, where = '1') => {
      const ids = DB.all(`SELECT id, web_id FROM ${table} WHERE web_id IS NOT NULL AND ${where}`).filter((r) => !keep.has(r.web_id)).map((r) => r.id)
      for (const id of ids) DB.run(`DELETE FROM ${table} WHERE id = ?`, [id])
    }

    // departments (the tree roots «All Departments» are groups — skip), sections = child departments
    const dep = {}
    const roots = new Set(d.departments.filter((x) => x.is_group && !x.parent_department).map((x) => x.name))
    const deps = d.departments.filter((x) => !roots.has(x.name) && !(x.is_group && roots.has(x.parent_department) && /all/i.test(x.name)))
    for (const x of deps.filter((x) => !x.parent_department || roots.has(x.parent_department))) dep[x.name] = upsert('departments', x.name, { name_ar: x.department_name, parent_id: null })
    for (const x of deps.filter((x) => x.parent_department && !roots.has(x.parent_department))) dep[x.name] = upsert('departments', x.name, { name_ar: x.department_name, parent_id: dep[x.parent_department] ?? null })
    prune('departments', new Set(Object.keys(dep)))

    // lists
    const list = {}
    const keep = new Set()
    const L = (type, name) => { const k = `${type}:${name}`; keep.add(k); return (list[k] ||= upsert('lists', k, { list_type: type, name_ar: name })) }
    d.designations.forEach((x) => L('job', x.name))
    d.leaveTypes.forEach((x) => L('leave', x.name))
    for (const e of d.employees) if (e.custom_nationality) L('nationality', e.custom_nationality)
    // permission types are local-only on the site (no type field): keep one default
    const permType = L('permission', 'إذن')
    prune('lists', keep)

    const proj = {}; for (const x of d.projects) proj[x.name] = upsert('projects', x.name, { name_ar: x.project_name || x.name })
    prune('projects', new Set(Object.keys(proj)))
    const eg = {}; for (const x of d.egroups) eg[x.name] = upsert('employee_groups', x.name, { name_ar: x.name })
    prune('employee_groups', new Set(Object.keys(eg)))

    // holidays: every list's non-weekly days, one row per date
    const hol = new Set()
    const weeklyOff = {}
    for (const h of d.holidayLists) {
      weeklyOff[h.name] = h.weekly_off
      for (const x of h.holidays || []) {
        if (x.weekly_off) continue
        const k = `${x.holiday_date}`
        if (hol.has(k)) continue
        hol.add(k)
        upsert('holidays', k, { name_ar: String(x.description || 'عطلة رسمية').replace(/<[^>]+>/g, '').trim() || 'عطلة رسمية', from_date: x.holiday_date, to_date: x.holiday_date })
      }
    }
    prune('holidays', hol)

    // shifts
    const grp = {}
    for (const s of d.shiftTypes) {
      const open = s.custom_shift_kind === 'Open'
      const id = upsert('shift_groups', s.name, { name_ar: s.name, name_en: s.custom_name_en || '', open_shift: open ? 1 : 0, rotational: 0 })
      grp[s.name] = id
      DB.run('DELETE FROM shift_windows WHERE group_id = ?', [id])
      DB.run('DELETE FROM rotation_blocks WHERE group_id = ?', [id])
      let total = 0
      const off = this.DAY[weeklyOff[s.holiday_list]] ?? 6
      const byCal = { Y: s.windows.filter((w) => w.calendar_type !== 'Ramadan'), R: s.windows.filter((w) => w.calendar_type === 'Ramadan') }
      if (open) {
        const req = s.windows[0]?.required_minutes || Math.round((s.custom_open_hours || 8) * 60)
        for (const cal of ['Y', 'R']) {
          if (cal === 'R' && !byCal.R.length) continue
          for (let day = 0; day < 7; day++) {
            const w = byCal[cal].length ? byCal[cal].find((x) => this.DAY[x.day] === day) : (day === off ? null : { required_minutes: req, extends_next_day: 1, day_end_time: s.custom_day_end_time })
            DB.run('INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, required_min, extends_next_day, day_end) VALUES (?, ?, ?, 1, ?, ?, ?, ?)',
              [id, cal, day, w ? 0 : 1, w ? w.required_minutes || req : null, w?.extends_next_day ? 1 : 0, w?.extends_next_day ? hm(w.day_end_time) : null])
            if (w && cal === 'Y') total += w.required_minutes || req
          }
        }
      } else {
        // no per-day windows on the site → the shift's plain times on every day except the weekly off
        if (!byCal.Y.length && s.start_time && hm(s.start_time) !== hm(s.end_time)) {
          const pre = s.begin_check_in_before_shift_start_time || 60, post = s.allow_check_out_after_shift_end_time || 60
          const t = (m) => hm(`${Math.floor((((m % 1440) + 1440) % 1440) / 60)}:${(((m % 1440) + 1440) % 1440) % 60}`)
          const a = mins(s.start_time), b = mins(s.end_time), mid = a + Math.round((((b - a) + 1440) % 1440) / 2)
          for (let day = 0; day < 7; day++) if (day !== off) byCal.Y.push({ day: Object.keys(this.DAY)[day], window_no: 1, start_in: t(a - pre), check_in: hm(s.start_time), late_allowance_min: s.late_entry_grace_period || 0,
            end_in: t(mid), start_out: t(mid + 1), early_out_min: s.early_exit_grace_period || 0, check_out: hm(s.end_time), end_out: t(b + post) })
        }
        for (const cal of ['Y', 'R']) {
          if (cal === 'R' && !byCal.R.length) continue
          for (let day = 0; day < 7; day++) {
            const ws = byCal[cal].filter((w) => this.DAY[w.day] === day).sort((a, b) => a.window_no - b.window_no)
            if (!ws.length) { DB.run('INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off) VALUES (?, ?, ?, 1, 1)', [id, cal, day]); continue }
            ws.forEach((w, i) => {
              DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out, extended)
                VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, cal, day, i + 1, hm(w.start_in), hm(w.check_in), w.late_allowance_min || 0, hm(w.end_in), hm(w.start_out), w.early_out_min || 0, hm(w.check_out), hm(w.end_out), w.extended ? 1 : 0])
              if (cal === 'Y') total += (((mins(w.check_out) - mins(w.check_in)) % 1440) + 1440) % 1440
            })
          }
        }
      }
      DB.run('UPDATE shift_groups SET total_minutes = ? WHERE id = ?', [total, id])
    }
    // gaps between dated shift assignments (rotating schedules' rest days) → an all-off group
    const restId = () => grp['__rest'] ||= (() => {
      const id = upsert('shift_groups', '__rest', { name_ar: 'راحة (من الموقع)', open_shift: 0, rotational: 0, total_minutes: 0 })
      DB.run('DELETE FROM shift_windows WHERE group_id = ?', [id])
      for (let day = 0; day < 7; day++) DB.run("INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off) VALUES (?, 'Y', ?, 1, 1)", [id, day])
      return id
    })()
    const goneGroups = DB.all('SELECT id, web_id FROM shift_groups WHERE web_id IS NOT NULL').filter((r) => !(r.web_id in grp) && r.web_id !== '__rest')
    for (const g of goneGroups) { DB.run('DELETE FROM shift_windows WHERE group_id = ?', [g.id]); DB.run('DELETE FROM rotation_blocks WHERE group_id = ?', [g.id]); DB.run('DELETE FROM shift_groups WHERE id = ?', [g.id]) }

    // employees + their shift history
    const emp = {}
    const G = { Male: 'ذكر', Female: 'أنثى' }
    for (const e of d.employees) {
      const code = this.codeOf(e)
      // code is UNIQUE: a stale row holding this code (renumbered on the site) steps aside
      DB.run("UPDATE employees SET code = code || '-' || id WHERE code = ? AND (web_id IS NULL OR web_id <> ?)", [code, e.name])
      emp[e.name] = upsert('employees', e.name, {
        code, name_ar: e.employee_name || e.name, name_en: e.custom_employee_name_en || '', status: this.STATUS[e.status] || 'نشط',
        job_id: e.designation ? list[`job:${e.designation}`] ?? null : null, department_id: dep[e.department] ?? null, section_id: null,
        group_id: eg[e.custom_employee_group] ?? null, project_id: proj[e.custom_project] ?? null, shift_group_id: grp[e.default_shift] ?? null,
        hire_date: e.date_of_joining || null, gender: G[e.gender] || null, nationality_id: e.custom_nationality ? list[`nationality:${e.custom_nationality}`] : null,
        religion: e.custom_religion || null, birth_date: e.date_of_birth || null, mobile: e.cell_number || null, email: e.personal_email || e.company_email || null, address: e.current_address || null,
        ot_deduct_late: e.custom_ot_deduct_late ? 1 : 0, ot_before: e.custom_ot_before_shift ? 1 : 0, ot_after: e.custom_ot_after_shift ? 1 : 0, ot_holidays: e.custom_ot_holidays ? 1 : 0, no_punch_out: e.custom_checkout_without_punch ? 1 : 0,
      })
    }
    for (const r of DB.all('SELECT id, web_id FROM employees WHERE web_id IS NOT NULL')) if (!(r.web_id in emp)) DB.run("UPDATE employees SET status = 'منتهي' WHERE id = ?", [r.id])
    const byEmp = {}
    for (const a of d.assignments) if (emp[a.employee] && grp[a.shift_type]) (byEmp[a.employee] ||= []).push(a)
    for (const e of d.employees) {
      const id = emp[e.name]
      DB.run('DELETE FROM employee_shifts WHERE employee_id = ?', [id])
      const rows = []
      if (grp[e.default_shift]) rows.push([e.date_of_joining || '2000-01-01', grp[e.default_shift]])
      const as = (byEmp[e.name] || []).sort((a, b) => a.start_date.localeCompare(b.start_date))
      as.forEach((a, i) => {
        rows.push([a.start_date, grp[a.shift_type]])
        const next = as[i + 1]
        if (a.end_date) {
          const after = Engine.addDays(a.end_date, 1)
          if (!next || next.start_date > after) rows.push([after, next || !grp[e.default_shift] ? restId() : grp[e.default_shift]])
        }
      })
      const seen = new Map(); for (const [f, g] of rows) seen.set(f, g) // later rows win on the same date
      for (const [f, g] of seen) DB.run('INSERT INTO employee_shifts (employee_id, group_id, from_date) VALUES (?, ?, ?)', [id, g, f])
      if (seen.size) DB.run('UPDATE employees SET shift_group_id = ? WHERE id = ?', [[...seen].sort((a, b) => a[0].localeCompare(b[0])).pop()[1], id])
    }

    // approved leaves / permissions
    const lv = new Set()
    for (const x of d.leaves) if (emp[x.employee]) { lv.add(x.name); upsert('leaves', x.name, { employee_id: emp[x.employee], type_id: list[`leave:${x.leave_type}`] ?? null, from_date: x.from_date, to_date: x.to_date, notes: x.description || '' }) }
    prune('leaves', lv)
    const pm = new Set()
    for (const x of d.perms) if (emp[x.employee]) { pm.add(x.name); upsert('permissions', x.name, { employee_id: emp[x.employee], type_id: permType, date: x.permission_date, from_time: hm(x.from_time), to_time: hm(x.to_time), notes: x.reason || '' }) }
    prune('permissions', pm)

    // the site's punches (incl. the ones this app pushed earlier — UNIQUE(code, ts) keeps one)
    const codeByEmp = Object.fromEntries(d.employees.map((e) => [e.name, this.codeOf(e)]))
    let punches = 0
    for (const c of d.checkins) {
      const code = codeByEmp[c.employee]
      if (!code) continue
      const ts = String(c.time).slice(0, 19)
      const had = DB.one('SELECT id, web_id FROM punches WHERE emp_code = ? AND ts = ?', [code, ts])
      if (had) { if (!had.web_id || had.web_id === 'dup') DB.run('UPDATE punches SET web_id = ? WHERE id = ?', [c.name, had.id]); continue }
      DB.run("INSERT INTO punches (emp_code, ts, source, web_id) VALUES (?, ?, 'web', ?)", [code, ts, c.name])
      punches++
    }
    // next time only fetch the last few days (late edits on the site are still caught)
    this.setMeta('web_checkins_since', Engine.addDays(Engine.today(), -7))
    DB.run('COMMIT')
    return { employees: d.employees.length, groups: d.shiftTypes.length, punches }
  },
}

// «الإعدادات ← الربط بالموقع»
async function openWebLink() {
  if (!Session.admin) return UI.message('الربط بالموقع لمدير النظام فقط')
  const cfg = await window.bridge.webConfig()
  const read = (d) => ({ url: d.root.querySelector('#wl-url').value.trim(), key: d.root.querySelector('#wl-key').value.trim(), secret: d.root.querySelector('#wl-secret').value.trim() })
  const valid = (c, d) => {
    if (!/^https?:\/\/[^/\s]+/.test(c.url)) { d.error('اكتب رابط الموقع مثل https://tamken3.base.meena.sa'); return false }
    if (!c.key || !c.secret) { d.error('اكتب مفتاح الربط (API Key) والرمز السري (API Secret)'); return false }
    return true
  }
  const test = async (c) => window.bridge.webCall('GET', '/api/method/frappe.auth.get_logged_user', null, c)
  await UI.dialog({
    head: 'الربط بالموقع', width: 520,
    bodyHtml: `<div style="flex:1;display:flex;flex-direction:column;gap:8px">
      <div style="font-size:12px">عند الربط يصبح الموقع هو مصدر البيانات: الموظفين والإدارات والدوامات والعطلات والإجازات تأتي منه، وحركات البصمة المقروءة هنا تُرفع إليه. تتم المزامنة تلقائياً كل 10 دقائق.</div>
      <div class="fields" style="grid-template-columns:120px 1fr">
        <label>رابط الموقع</label><input type="text" id="wl-url" dir="ltr" placeholder="https://tamken3.base.meena.sa" value="${UI.esc(cfg.url || '')}">
        <label>API Key</label><input type="text" id="wl-key" dir="ltr" value="${UI.esc(cfg.key || '')}">
        <label>API Secret</label><input type="password" id="wl-secret" dir="ltr" placeholder="${cfg.linked ? '(محفوظ — اتركه فارغاً للإبقاء عليه)' : ''}">
      </div>
      <div style="font-size:12px;color:#555">الحالة: ${cfg.linked ? 'مرتبط' : 'غير مرتبط'}</div></div>`,
    buttons: [
      { label: 'اختبار الاتصال', icon: 'ok', onClick: async (d) => {
        const c = read(d)
        if (cfg.linked && !c.secret && c.url === cfg.url && c.key === cfg.key) { const r = await window.bridge.webCall('GET', '/api/method/frappe.auth.get_logged_user'); return d.error(r.error || `الاتصال ناجح — المستخدم ${r.data}`) }
        if (!valid(c, d)) return
        d.error('جاري الاختبار…')
        const r = await test(c)
        d.error(r.error || `الاتصال ناجح — المستخدم ${r.data}`)
      } },
      { label: 'حفظ وربط', icon: 'save', onClick: async (d) => {
        const c = read(d)
        const keepSecret = cfg.linked && !c.secret && c.url === cfg.url && c.key === cfg.key
        if (!keepSecret) {
          if (!valid(c, d)) return
          d.error('جاري الاتصال…')
          const r = await test(c)
          if (r.error) return d.error(r.error)
          await window.bridge.webSetConfig(c)
        }
        const first = !WebSync.meta('web_linked_once') && DB.one('SELECT 1 FROM employees WHERE web_id IS NULL LIMIT 1')
        if (first && !(await UI.dialog({ head: 'تأكيد الربط', width: 440,
          bodyHtml: '<div>سيتم استبدال بيانات الإعداد الموجودة في البرنامج (الموظفين، الإدارات، الدوامات، العطلات، الإجازات) ببيانات الموقع. حركات البصمة الموجودة تبقى وتُرفع للموقع. يُنصح بأخذ نسخة احتياطية أولاً. متابعة؟</div>',
          buttons: [{ label: 'نعم', icon: 'ok', onClick: (x) => x.close(true) }, { label: 'لا', icon: 'cancel', onClick: (x) => x.close(false) }] }))) {
          if (!cfg.linked) await window.bridge.webSetConfig(null)
          return d.error('لم يتم الربط')
        }
        d.close(true)
        DB.audit('الربط بالموقع', c.url || cfg.url)
        await WebSync.init(false)
        await WebSync.sync()
      } },
      { label: 'مزامنة الآن', icon: 'undo', onClick: async (d) => { if (!cfg.linked) return d.error('احفظ بيانات الربط أولاً'); d.close(true); await WebSync.sync() } },
      { label: 'الغاء الربط', icon: 'del', onClick: async (d) => {
        if (!cfg.linked) return d.close(false)
        await window.bridge.webSetConfig(null)
        clearInterval(WebSync.timer)
        WebSync.linked = false
        WebSync.showStatus()
        DB.audit('الغاء الربط بالموقع', cfg.url)
        await DB.flush()
        d.close(true)
        UI.message('تم إلغاء الربط — البيانات الحالية تبقى في البرنامج ويمكن تعديلها هنا')
      } },
      { label: 'إغلاق', icon: 'cancel', onClick: (d) => d.close(false) },
    ],
  })
}
