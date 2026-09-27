// Attendance engine — the cloud version's rules (tamken3 shift_rules), per day:
//  • normal / rotating shifts: up to 4 «ورديات», each start_in · check_in(+late grace)
//    · end_in · start_out · check_out(−early grace) · end_out; the last one may be
//    «شفت ممتد» (runs past midnight — its later times roll into the next day).
//    in = earliest punch in [start_in, end_in]; out = latest in [start_out, end_out];
//    a punch used by one وردية is not reused by the next.
//  • late / early: threshold rule — once past the grace, counted from the official time.
//  • open shift: required hours in the day (optionally running into the next day
//    until «نهاية اليوم»); shortfall counts as early leave, surplus as overtime.
//  • rotating shift: blocks of «عدد أيام الدوام» then «عدد أيام العطله», repeating
//    from the group's start date; Ramadan blocks (if any) restart on Ramadan day 1.
//  • Ramadan: a group's Ramadan timings apply inside a Ramadan period, else the year's.
//  • no in-punch → «غياب» for past days, «في الانتظار» today (Apex keeps it waiting);
//    holidays / leaves / weekly offs never count as absent; a permission covering a
//    late/early gap cancels it.
//  • the employee's shift is taken from employee_shifts at that date, and posted
//    («ترحيل») days come from their frozen snapshot — later edits never rewrite them.
const Engine = {
  DAY_INDEX: (d) => (new Date(d + 'T00:00:00').getDay() + 1) % 7, // JS Sun=0 → our Sat=0
  toMin: (t) => (t ? +String(t).slice(0, 2) * 60 + +String(t).slice(3, 5) : null),
  hm: (m) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`),
  iso: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  addDays(date, n) { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); return this.iso(d) },
  diffDays: (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000),
  dates(from, to) { const out = []; for (let d = from; d <= to; d = this.addDays(d, 1)) out.push(d); return out },
  today() { return this.iso(new Date()) },

  // Resolve a list of window rows into absolute minutes from the day's 00:00,
  // rolling any time that goes backwards (past midnight) forward by 24h.
  resolveWindows(rows) {
    let last = -1
    return rows.map((w) => {
      const r = { ...w }
      for (const k of ['start_in', 'check_in', 'end_in', 'start_out', 'check_out', 'end_out']) {
        let m = this.toMin(w[k])
        while (m < last) m += 1440
        r[k] = m
        last = m
      }
      return r
    })
  },

  // The schedule for one group on one date → {kind:'off'|'open'|'windows', windows|open}
  loadConfig() {
    const groups = Object.fromEntries(DB.all('SELECT * FROM shift_groups').map((g) => [g.id, g]))
    const win = {}
    for (const w of DB.all('SELECT * FROM shift_windows ORDER BY window_no')) ((win[w.group_id] ||= {})[`${w.calendar}:${w.slot}`] ||= []).push(w)
    const blocks = {}
    for (const b of DB.all('SELECT * FROM rotation_blocks ORDER BY idx')) ((blocks[b.group_id] ||= {})[b.calendar] ||= []).push(b)
    const ramadan = DB.all('SELECT * FROM ramadan_periods ORDER BY from_date')
    const hasRamadanTimes = Object.fromEntries(Object.entries(win).map(([gid, w]) => [gid, Object.keys(w).some((k) => k.startsWith('R:'))]))
    return { groups, win, blocks, ramadan, hasRamadanTimes }
  },
  schedule(cfg, groupId, date) {
    const g = cfg.groups[groupId]
    if (!g) return { kind: 'none' }
    const rp = cfg.ramadan.find((r) => r.from_date <= date && r.to_date >= date)
    if (g.rotational) {
      const useR = rp && cfg.blocks[groupId]?.R?.length
      const cal = useR ? 'R' : 'Y'
      const bl = cfg.blocks[groupId]?.[cal] || []
      const cycle = bl.reduce((s, b) => s + b.work_days + b.rest_days, 0)
      if (!cycle) return { kind: 'none' }
      const anchor = useR ? rp.from_date : g.start_date || date
      let pos = ((this.diffDays(anchor, date) % cycle) + cycle) % cycle
      for (const b of bl) {
        if (pos < b.work_days) {
          const rows = (cfg.win[groupId]?.[`${cal}:${b.idx}`] || []).filter((w) => !w.is_off)
          return rows.length ? { kind: 'windows', windows: this.resolvedFor(cfg, `${groupId}:${cal}:${b.idx}`, rows) } : { kind: 'off' }
        }
        pos -= b.work_days
        if (pos < b.rest_days) return { kind: 'off' }
        pos -= b.rest_days
      }
      return { kind: 'off' }
    }
    const day = this.DAY_INDEX(date)
    const useR = rp && cfg.hasRamadanTimes[groupId]
    const rows = cfg.win[groupId]?.[`${useR ? 'R' : 'Y'}:${day}`] || []
    if (!rows.length || rows[0].is_off) return { kind: 'off' }
    if (g.open_shift) return { kind: 'open', open: rows[0] }
    return { kind: 'windows', windows: this.resolvedFor(cfg, `${groupId}:${useR ? 'R' : 'Y'}:${day}`, rows) }
  },
  resolvedFor(cfg, key, rows) { return ((cfg._resolved ||= {})[key] ||= this.resolveWindows(rows)) },

  // rows: one per employee per date → {emp, date, day, status, kind, in, out, late, early, ot, worked, punches, missingOut}
  compute({ from, to, employeeIds = null, departmentId = null }) {
    const cfg = this.loadConfig()
    const emps = DB.all(`SELECT e.*, d.name_ar AS dep, s.name_ar AS sec
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN departments s ON s.id = e.section_id
      WHERE e.status = 'نشط' ${departmentId ? 'AND (e.department_id = ? OR e.section_id = ?)' : ''} ORDER BY CAST(e.code AS INTEGER), e.code`,
      departmentId ? [departmentId, departmentId] : [])
      .filter((e) => !employeeIds || employeeIds.includes(e.id))
    const shiftHist = {}
    for (const s of DB.all('SELECT * FROM employee_shifts ORDER BY from_date')) (shiftHist[s.employee_id] ||= []).push(s)
    const holidays = DB.all('SELECT * FROM holidays WHERE to_date >= ? AND from_date <= ?', [from, to])
    const leaves = DB.all('SELECT l.*, t.name_ar AS type FROM leaves l LEFT JOIN lists t ON t.id = l.type_id WHERE to_date >= ? AND from_date <= ?', [from, to])
    const perms = DB.all('SELECT * FROM permissions WHERE date BETWEEN ? AND ?', [from, to])
    const posted = {}
    for (const p of DB.all('SELECT * FROM posted_attendance WHERE date BETWEEN ? AND ?', [from, to])) posted[`${p.employee_id}:${p.date}`] = JSON.parse(p.data)
    const dayBefore = this.addDays(from, -1)
    const punches = {}
    const codeFilter = employeeIds || departmentId ? emps.map((e) => e.code) : null
    for (const p of DB.all(`SELECT emp_code, ts FROM punches WHERE ts >= ? AND ts < ? ${codeFilter ? `AND emp_code IN (${codeFilter.map(() => '?').join(',') || "''"})` : ''} ORDER BY ts`,
      [dayBefore, this.addDays(to, 2), ...(codeFilter || [])])) {
      ;(punches[p.emp_code] ||= []).push(p.ts)
    }
    const today = this.today()
    const days = this.dates(from, to)
    const nextOf = Object.fromEntries(days.map((d, i) => [d, days[i + 1] || this.addDays(d, 1)]))
    const dayIdx = Object.fromEntries(days.map((d) => [d, this.DAY_INDEX(d)]))
    // linked to the site: holidays / weekly offs of the employee's own holiday list (else the
    // company default); rows without a list (entered here) apply to everyone
    const defaultList = DB.one("SELECT value FROM meta WHERE key = 'web_default_holiday_list'")?.value || ''
    const weekly = new Set(DB.all('SELECT list_id, date FROM web_weekly_offs WHERE date BETWEEN ? AND ?', [from, to]).map((w) => `${w.list_id}|${w.date}`))
    const holidayFor = (list, d) => holidays.find((h) => h.from_date <= d && h.to_date >= d && (!h.list_id || h.list_id === list))
    const rows = []
    for (const e of emps) {
      const hList = e.holiday_list || defaultList
      const hist = shiftHist[e.id] || []
      const groupAt = (date) => { let g = null; for (const s of hist) if (s.from_date <= date) g = s.group_id; return g ?? (hist.length ? null : e.shift_group_id) }
      // punches indexed by date → minutes; a day sees its own punches plus the next
      // day's shifted by +24h (for a «شفت ممتد» / open shift running past midnight)
      const byDate = {}
      for (const ts of punches[e.code] || []) (byDate[ts.slice(0, 10)] ||= []).push(this.toMin(ts.slice(11, 16)))
      const poolFor = (date) => [...(byDate[date] || []), ...(byDate[nextOf[date]] || []).map((m) => m + 1440)]
      const empLeaves = leaves.filter((l) => l.employee_id === e.id)
      // a previous day's extended window "owns" its after-midnight punches
      let consumedUntil = -Infinity
      const prev = this.schedule(cfg, groupAt(dayBefore), dayBefore)
      if (prev.kind === 'windows' && !cfg.groups[groupAt(dayBefore)]?.plain_rule) {
        const lastEnd = prev.windows.at(-1).end_out
        if (lastEnd > 1440) consumedUntil = lastEnd - 1440
      } else if (prev.kind === 'open' && prev.open.extends_next_day) consumedUntil = this.toMin(prev.open.day_end) || 0
      for (const date of days) {
        const day = dayIdx[date]
        if (e.hire_date && date < e.hire_date) continue
        const snap = posted[`${e.id}:${date}`]
        if (snap) { rows.push({ ...snap, emp: e, date, day, posted: true }); consumedUntil = snap._consumedUntil ?? -Infinity; continue }
        const gid = groupAt(date)
        const sch = this.schedule(cfg, gid, date)
        // this day's punches (+ next day's, for an extended last وردية), minus those
        // an extended shift of the previous day already owns
        const all = poolFor(date).filter((m) => m > consumedUntil)
        const own = all.filter((m) => m < 1440)
        const base = { emp: e, date, day, shift: cfg.groups[gid]?.name_ar || '', punches: own, in: null, out: null, late: 0, early: 0, ot: 0, worked: 0, missingOut: false }
        const holiday = holidayFor(hList, date)
        const leave = empLeaves.find((l) => l.from_date <= date && l.to_date >= date)
        let r
        if (leave) r = { ...base, kind: 'leave', status: `إجازة${leave.type ? ' — ' + leave.type : ''}` }
        else if (holiday) r = { ...base, kind: 'holiday', status: `عطلة رسمية — ${holiday.name_ar}`, in: own[0] ?? null, out: own.length > 1 ? own.at(-1) : null }
        else if (sch.kind === 'none' || sch.kind === 'off' || weekly.has(`${hList}|${date}`)) {
          r = { ...base, kind: 'off', status: 'عطلة إسبوعية', in: own[0] ?? null, out: own.length > 1 ? own.at(-1) : null }
          if (own.length && e.ot_holidays) { r.in = own[0]; r.out = own.at(-1); r.worked = r.ot = Math.max(0, r.out - r.in) }
        } else if (sch.kind === 'open') r = this.evalOpen(base, sch.open, all, e, date, today)
        else if (cfg.groups[gid]?.plain_rule) r = this.evalPlain({ ...base, punches: byDate[date] || [] }, sch.windows[0], date, today, perms.filter((p) => p.employee_id === e.id && p.date === date))
        else r = this.evalWindows(base, sch.windows, all, e, date, today, perms.filter((p) => p.employee_id === e.id && p.date === date))
        consumedUntil = -Infinity
        if (sch.kind === 'windows' && !cfg.groups[gid]?.plain_rule && sch.windows.at(-1).end_out > 1440) consumedUntil = sch.windows.at(-1).end_out - 1440
        if (sch.kind === 'open' && sch.open.extends_next_day) consumedUntil = this.toMin(sch.open.day_end) || 0
        r._consumedUntil = consumedUntil
        rows.push(r)
      }
    }
    return rows
  },

  // the site's rule for a shift with only a start and an end (no per-day windows):
  // first punch = in, last punch = out, grace minutes are deducted from lateness / early leave
  // (the day's own punches by date; an end not after the start = overnight)
  // an approved permission (إذن) excuses the lateness / early leave it covers, as on the site
  evalPlain(base, w, date, today, perms = []) {
    const ps = [...base.punches].sort((a, b) => a - b)
    const start = w.check_in % 1440, end = w.check_out % 1440 > start ? w.check_out % 1440 : (w.check_out % 1440) + 1440
    const first = ps.length ? ps[0] : null, last = ps.length > 1 ? ps.at(-1) : null
    const spans = perms.map((p) => { const a = this.toMin(p.from_time), b = this.toMin(p.to_time); return [a, b > a ? b : b + 1440] })
    const covered = (lo, hi) => (hi > lo ? spans.reduce((s, [a, b]) => s + Math.max(0, Math.min(hi, b) - Math.max(lo, a)), 0) : 0)
    const late = first != null ? Math.max(0, first - (start + (w.late_min || 0)) - covered(start, first)) : 0
    const early = last != null ? Math.max(0, end - (w.early_min || 0) - last - covered(last, end)) : 0
    const r = { ...base, in: first, out: last, late, early, ot: last != null ? Math.max(0, last - end) : 0, worked: first != null && last > first ? last - first : 0, missingOut: ps.length === 1,
      windows: [{ in: first, out: last, late, early }] }
    if (first == null) return { ...r, kind: date >= today ? 'waiting' : 'absent', status: date >= today ? 'في الانتظار' : 'غياب' }
    return { ...r, kind: 'present', status: late ? 'حضور متأخر' : 'حضور' }
  },

  evalWindows(base, windows, pool, e, date, today, perms) {
    const left = [...pool].sort((a, b) => a - b)
    const take = (lo, hi, latest) => {
      const c = left.filter((m) => m >= lo && m <= hi)
      if (!c.length) return null
      const m = latest ? c.at(-1) : c[0]
      left.splice(left.indexOf(m), 1)
      return m
    }
    const permRanges = perms.map((p) => [this.toMin(p.from_time), this.toMin(p.to_time)])
    const covered = (a, b) => permRanges.some(([pf, pt]) => pf <= a % 1440 && pt >= b % 1440)
    const r = { ...base, windows: [] }
    let anyIn = false, anyWaiting = false
    for (const w of windows) {
      const wi = take(w.start_in, w.end_in, false)
      const wo = take(w.start_out, w.end_out, true)
      const x = { in: wi, out: wo, late: 0, early: 0 }
      if (wi == null) {
        if (date >= today) anyWaiting = true
      } else {
        anyIn = true
        if (wi > w.check_in + (w.late_min || 0) && !covered(w.check_in, wi)) x.late = wi - w.check_in
        if (wo != null && wo < w.check_out - (w.early_min || 0) && !covered(wo, w.check_out)) x.early = w.check_out - wo
        if (wo == null && !e.no_punch_out && date < today) r.missingOut = true
        if (wo != null) r.worked += Math.max(0, wo - wi)
      }
      r.windows.push(x)
    }
    const first = r.windows.find((x) => x.in != null)
    const lastOut = [...r.windows].reverse().find((x) => x.out != null)
    r.in = first?.in ?? null
    r.out = lastOut?.out ?? null
    r.late = r.windows.reduce((s, x) => s + x.late, 0)
    r.early = r.windows.reduce((s, x) => s + x.early, 0)
    if (!anyIn) return { ...r, kind: anyWaiting ? 'waiting' : 'absent', status: anyWaiting ? 'في الانتظار' : 'غياب' }
    const w0 = windows[0], wl = windows.at(-1)
    const before = e.ot_before && r.in != null ? Math.max(0, w0.check_in - r.in) : 0
    const after = e.ot_after && r.out != null ? Math.max(0, r.out - wl.check_out) : 0
    r.ot = Math.max(0, before + after - (e.ot_deduct_late ? r.late : 0))
    r.in = r.in % 1440
    if (r.out != null) r.out = r.out % 1440
    return { ...r, kind: 'present', status: r.late ? 'حضور متأخر' : 'حضور' }
  },

  evalOpen(base, o, pool, e, date, today) {
    const end = o.extends_next_day ? 1440 + (this.toMin(o.day_end) || 0) : 1440
    const ps = pool.filter((m) => m >= 0 && m < end).sort((a, b) => a - b)
    if (!ps.length) return { ...base, kind: date >= today ? 'waiting' : 'absent', status: date >= today ? 'في الانتظار' : 'غياب' }
    const r = { ...base, in: ps[0], out: ps.length > 1 ? ps.at(-1) : null }
    const req = o.required_min || 0
    if (r.out == null) { r.missingOut = !e.no_punch_out && date < today }
    else {
      r.worked = r.out - r.in
      if (r.worked < req) r.early = req - r.worked
      if (e.ot_after && r.worked > req) r.ot = r.worked - req
    }
    r.in %= 1440
    if (r.out != null) r.out %= 1440
    return { ...r, kind: 'present', status: 'حضور' }
  },

  isPosted(date) {
    return !!DB.one('SELECT 1 FROM posted_periods WHERE from_date <= ? AND to_date >= ? LIMIT 1', [date, date])
  },

  // «ترحيل»: freeze the computed days of a period
  post(from, to) {
    const rows = this.compute({ from, to })
    DB.run('BEGIN')
    for (const r of rows) {
      const { emp, ...data } = r
      DB.run('INSERT OR REPLACE INTO posted_attendance (employee_id, date, data) VALUES (?, ?, ?)', [emp.id, r.date, JSON.stringify(data)])
    }
    DB.run('INSERT INTO posted_periods (from_date, to_date) VALUES (?, ?)', [from, to])
    DB.run('COMMIT')
    return rows.length
  },
  unpost(periodId) {
    const p = DB.one('SELECT * FROM posted_periods WHERE id = ?', [periodId])
    if (!p) return
    DB.run('DELETE FROM posted_attendance WHERE date BETWEEN ? AND ?', [p.from_date, p.to_date])
    DB.run('DELETE FROM posted_periods WHERE id = ?', [periodId])
  },
}
