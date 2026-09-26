// Attendance engine — the same rules the cloud version uses (tamken3
// shift_rules): per weekday window start_in · check_in(+late grace) · end_in ·
// start_out · check_out(−early grace) · end_out.
//  • in  = earliest punch in [start_in, end_in]; out = latest punch in [start_out, end_out]
//  • late: once past the grace, counted from the official check_in (threshold rule)
//  • early leave: once before check_out − grace, counted to the official check_out
//  • no in-punch → «غياب» for past days, «في الانتظار» for today (Apex keeps the day
//    waiting until it is posted); holidays / leaves / weekly offs never count as absent
//  • a permission (إذن) covering the late/early gap cancels it
const Engine = {
  DAY_INDEX: (d) => (new Date(d + 'T00:00:00').getDay() + 1) % 7, // JS Sun=0 → our Sat=0
  toMin: (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null),
  hm: (m) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`),
  dates(from, to) {
    const out = []
    for (let d = new Date(from + 'T00:00:00'); d <= new Date(to + 'T00:00:00'); d.setDate(d.getDate() + 1))
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    return out
  },
  today() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },

  // rows: one per employee per date → {emp, date, day, status, kind, in, out, late, early, ot, worked, punches}
  compute({ from, to, employeeIds = null, departmentId = null }) {
    const emps = DB.all(`SELECT e.*, d.name_ar AS dep, s.name_ar AS sec, g.name_ar AS shift, g.open_shift
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN departments s ON s.id = e.section_id
      LEFT JOIN shift_groups g ON g.id = e.shift_group_id WHERE e.status = 'نشط'
      ${departmentId ? 'AND (e.department_id = ? OR e.section_id = ?)' : ''} ORDER BY CAST(e.code AS INTEGER), e.code`,
      departmentId ? [departmentId, departmentId] : [])
      .filter((e) => !employeeIds || employeeIds.includes(e.id))
    const times = {}
    for (const t of DB.all('SELECT * FROM shift_times')) (times[t.group_id] ||= {})[t.day] = t
    const holidays = DB.all('SELECT * FROM holidays WHERE to_date >= ? AND from_date <= ?', [from, to])
    const leaves = DB.all('SELECT l.*, t.name_ar AS type FROM leaves l LEFT JOIN lists t ON t.id = l.type_id WHERE to_date >= ? AND from_date <= ?', [from, to])
    const perms = DB.all('SELECT * FROM permissions WHERE date BETWEEN ? AND ?', [from, to])
    const punches = {}
    // include the day after `to` so an out-punch after midnight is still visible to the last day
    for (const p of DB.all('SELECT emp_code, ts FROM punches WHERE ts >= ? AND ts < ? ORDER BY ts', [from, to + ' 99'])) {
      ;(punches[p.emp_code] ||= []).push(p.ts)
    }
    const today = this.today()
    const rows = []
    for (const e of emps) {
      const empPunches = punches[e.code] || []
      for (const date of this.dates(from, to)) {
        const day = this.DAY_INDEX(date)
        const t = times[e.shift_group_id]?.[day]
        const dayPunches = empPunches.filter((ts) => ts.startsWith(date)).map((ts) => this.toMin(ts.slice(11, 16)))
        const base = { emp: e, date, day, punches: dayPunches, in: null, out: null, late: 0, early: 0, ot: 0, worked: 0 }
        const holiday = holidays.find((h) => h.from_date <= date && h.to_date >= date)
        const leave = leaves.find((l) => l.employee_id === e.id && l.from_date <= date && l.to_date >= date)
        if (e.hire_date && date < e.hire_date) continue
        if (leave) { rows.push({ ...base, kind: 'leave', status: `إجازة${leave.type ? ' — ' + leave.type : ''}` }); continue }
        if (holiday) { rows.push({ ...base, kind: 'holiday', status: `عطلة رسمية — ${holiday.name_ar}` }); continue }
        if (!t || t.is_off) {
          const r = { ...base, kind: 'off', status: 'عطلة إسبوعية' }
          if (dayPunches.length && e.ot_holidays) { r.in = dayPunches[0]; r.out = dayPunches.at(-1); r.worked = r.ot = Math.max(0, r.out - r.in) }
          rows.push(r)
          continue
        }
        const w = Object.fromEntries(['start_in', 'check_in', 'end_in', 'start_out', 'check_out', 'end_out'].map((k) => [k, this.toMin(t[k])]))
        const ins = dayPunches.filter((m) => m >= w.start_in && m <= w.end_in)
        const outs = dayPunches.filter((m) => m >= w.start_out && m <= w.end_out)
        const r = { ...base, in: ins[0] ?? null, out: outs.at(-1) ?? null }
        if (r.in == null) {
          const waiting = date >= today
          rows.push({ ...r, kind: waiting ? 'waiting' : 'absent', status: waiting ? 'في الانتظار' : 'غياب' })
          continue
        }
        const perm = perms.filter((p) => p.employee_id === e.id && p.date === date).map((p) => [this.toMin(p.from_time), this.toMin(p.to_time)])
        const covered = (a, b) => perm.some(([pf, pt]) => pf <= a && pt >= b)
        if (r.in > w.check_in + (t.late_min || 0) && !covered(w.check_in, r.in)) r.late = r.in - w.check_in
        if (r.out != null && r.out < w.check_out - (t.early_min || 0) && !covered(r.out, w.check_out)) r.early = w.check_out - r.out
        if (r.out != null) {
          r.worked = Math.max(0, r.out - r.in)
          const before = e.ot_before ? Math.max(0, w.check_in - r.in) : 0
          const after = e.ot_after ? Math.max(0, r.out - w.check_out) : 0
          r.ot = Math.max(0, before + after - (e.ot_deduct_late ? r.late : 0))
        }
        r.missingOut = r.out == null && !e.no_punch_out && (date < today)
        r.kind = 'present'
        r.status = r.late ? 'حضور متأخر' : 'حضور'
        rows.push(r)
      }
    }
    return rows
  },

  isPosted(date) {
    return !!DB.one('SELECT 1 FROM posted_periods WHERE from_date <= ? AND to_date >= ? LIMIT 1', [date, date])
  },
}
