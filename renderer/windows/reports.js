// «التقارير». Each report = filters → Engine rows → an HTML table that is shown
// in the window and printed with the company header («بيانات المؤسسة»).
// Trial: only TRIAL_REPORTS open, each printable 3 times (Apex Time's rule).
const H = Engine.hm
const empCols = [['الكود', (r) => r.emp.code], ['الموظف', (r) => r.emp.name_ar]]
const sum = (rows, f) => rows.reduce((s, r) => s + (r[f] || 0), 0)
const byEmp = (rows) => {
  const m = new Map()
  for (const r of rows) { if (!m.has(r.emp.id)) m.set(r.emp.id, []); m.get(r.emp.id).push(r) }
  return [...m.values()]
}
const DAY_NAMES = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']

const REPORTS = {
  'مواعيد العمل': { noPeriod: true, build: () => {
    const rows = []
    const kind = (g) => (g.rotational ? 'ورديات متغيرة' : g.open_shift ? 'دوام مفتوح' : 'دوام عادي')
    for (const g of DB.all('SELECT * FROM shift_groups ORDER BY id')) {
      const ws = DB.all("SELECT * FROM shift_windows WHERE group_id = ? AND calendar = 'Y' ORDER BY slot, window_no", [g.id])
      const blocks = Object.fromEntries(DB.all("SELECT * FROM rotation_blocks WHERE group_id = ? AND calendar = 'Y'", [g.id]).map((b) => [b.idx, b]))
      if (!ws.length) rows.push([g.name_ar, kind(g), '—', '', '', '', ''])
      for (const w of ws) {
        const slot = g.rotational ? `مجموعة ${w.slot + 1} (${blocks[w.slot]?.work_days ?? ''} دوام / ${blocks[w.slot]?.rest_days ?? ''} عطلة)` : DAY_NAMES[w.slot]
        if (w.is_off) rows.push([g.name_ar, kind(g), slot, 'عطلة', '', '', ''])
        else if (g.open_shift) rows.push([g.name_ar, kind(g), slot, `${H(w.required_min)} ساعة`, '', '', w.extends_next_day ? `يمتد حتى ${w.day_end}` : ''])
        else rows.push([g.name_ar, kind(g), slot, `${WIN_NAMES[w.window_no - 1]}`, w.check_in, w.check_out, `${w.late_min} / ${w.early_min}${w.extended ? ' · ممتد' : ''}`])
      }
    }
    return { head: ['المجموعة', 'النوع', 'اليوم / المجموعة', 'الوردية', 'الحضور', 'الانصراف', 'تأخير / انصراف مبكر'], rows }
  } },
  'الموظفين': { noPeriod: true, build: () => ({
    head: ['الكود', 'الاسم', 'الإدارة', 'القسم', 'الدوام', 'تاريخ التعيين', 'الحالة'],
    rows: DB.all(`SELECT e.*, d.name_ar dep, s.name_ar sec, g.name_ar shift FROM employees e LEFT JOIN departments d ON d.id=e.department_id
      LEFT JOIN departments s ON s.id=e.section_id LEFT JOIN shift_groups g ON g.id=e.shift_group_id ORDER BY CAST(e.code AS INTEGER)`)
      .map((e) => [e.code, e.name_ar, e.dep, e.sec, e.shift, e.hire_date, e.status]),
  }) },
  'الحركات الغير مكتملة': { build: (f) => ({
    head: [...empCols.map((c) => c[0]), 'التاريخ', 'الحضور', 'الانصراف'],
    rows: Engine.compute(f).filter((r) => r.missingOut).map((r) => [r.emp.code, r.emp.name_ar, r.date, H(r.in), 'لا يوجد']),
  }) },
  'التأخير عن بداية الدوام اليومي': { singleDay: true, build: (f) => ({
    head: [...empCols.map((c) => c[0]), 'الإدارة', 'وقت الحضور', 'مدة التأخير'],
    rows: Engine.compute(f).filter((r) => r.late).map((r) => [r.emp.code, r.emp.name_ar, r.emp.dep, H(r.in), H(r.late)]),
  }) },
  'التأخير عن الدوام خلال فترة': { build: (f) => ({
    head: [...empCols.map((c) => c[0]), 'أيام التأخير', 'إجمالي التأخير', 'أيام الانصراف المبكر', 'إجمالي الانصراف المبكر'],
    rows: byEmp(Engine.compute(f)).map((rs) => [rs[0].emp.code, rs[0].emp.name_ar, rs.filter((r) => r.late).length, H(sum(rs, 'late')), rs.filter((r) => r.early).length, H(sum(rs, 'early'))])
      .filter((r) => r[2] || r[4]),
  }) },
  'إجازات الموظفين': { build: (f) => ({
    head: ['الكود', 'الموظف', 'نوع الإجازة', 'من', 'إلى', 'ملاحظات'],
    rows: DB.all(`SELECT e.code, e.name_ar, t.name_ar type, l.from_date, l.to_date, l.notes FROM leaves l JOIN employees e ON e.id = l.employee_id
      LEFT JOIN lists t ON t.id = l.type_id WHERE l.to_date >= ? AND l.from_date <= ? ORDER BY l.from_date`, [f.from, f.to]).map((x) => Object.values(x)),
  }) },
  'الحضور والانصراف تفصيلي': { build: (f) => ({
    grouped: true,
    head: ['التاريخ', 'اليوم', 'الحضور', 'الانصراف', 'التأخير', 'الانصراف المبكر', 'الإضافي', 'ساعات العمل', 'الحالة'],
    groups: byEmp(Engine.compute(f)).map((rs) => ({
      title: `${rs[0].emp.code} — ${rs[0].emp.name_ar}${rs[0].emp.dep ? ' — ' + rs[0].emp.dep : ''}`,
      rows: rs.map((r) => [r.date, DAY_NAMES[r.day], H(r.in), H(r.out), r.late ? H(r.late) : '', r.early ? H(r.early) : '', r.ot ? H(r.ot) : '', r.worked ? H(r.worked) : '', r.status]),
      foot: ['الإجمالي', '', '', '', H(sum(rs, 'late')), H(sum(rs, 'early')), H(sum(rs, 'ot')), H(sum(rs, 'worked')), ''],
    })),
  }) },
  'الحضور والانصراف إجمالي': { build: (f) => ({
    head: ['الكود', 'الموظف', 'أيام الحضور', 'أيام الغياب', 'الإجازات', 'العطلات', 'إجمالي التأخير', 'إجمالي الانصراف المبكر', 'الإضافي', 'ساعات العمل'],
    rows: byEmp(Engine.compute(f)).map((rs) => [rs[0].emp.code, rs[0].emp.name_ar, rs.filter((r) => r.kind === 'present').length,
      rs.filter((r) => r.kind === 'absent').length, rs.filter((r) => r.kind === 'leave').length, rs.filter((r) => r.kind === 'holiday' || r.kind === 'off').length,
      H(sum(rs, 'late')), H(sum(rs, 'early')), H(sum(rs, 'ot')), H(sum(rs, 'worked'))]),
  }) },
  'الغياب خلال فترة': { build: (f) => ({
    head: ['الكود', 'الموظف', 'الإدارة', 'التاريخ', 'اليوم'],
    rows: Engine.compute(f).filter((r) => r.kind === 'absent').map((r) => [r.emp.code, r.emp.name_ar, r.emp.dep, r.date, DAY_NAMES[r.day]]),
  }) },
  'حالة اليوم': { singleDay: true, build: (f) => ({
    head: ['الكود', 'الموظف', 'الإدارة', 'الدوام', 'الحضور', 'الانصراف', 'التأخير', 'الحالة'],
    rows: Engine.compute(f).map((r) => [r.emp.code, r.emp.name_ar, r.emp.dep, r.shift, H(r.in), H(r.out), r.late ? H(r.late) : '', r.status]),
  }) },
  'الحضور والانصراف بالحركات': { build: (f) => ({
    head: ['الكود', 'الموظف', 'التاريخ', 'اليوم', 'الحركات', 'الحالة'],
    rows: Engine.compute(f).filter((r) => r.punches.length || r.kind === 'absent')
      .map((r) => [r.emp.code, r.emp.name_ar, r.date, DAY_NAMES[r.day], r.punches.map(H).join('  ·  '), r.status]),
  }) },
}

// «الجزاءات»: each violation's n-th occurrence in the calendar month picks the rule
// with the highest «التكرار» ≤ n (so a «4» rule covers the 4th and later ones).
const VIOLATIONS = { late: 'تأخير', early: 'انصراف مبكر', absent: 'غياب', missing_out: 'عدم تسجيل انصراف' }
const ACTIONS = { warning: 'إنذار', minutes: 'خصم دقائق', days: 'خصم أيام' }
function penaltyRows(f) {
  const rules = DB.all('SELECT * FROM penalty_rules ORDER BY occurrence')
  const out = []
  for (const rs of byEmp(Engine.compute(f))) {
    const counts = {}
    for (const r of rs) {
      const found = []
      if (r.kind === 'absent') found.push(['absent', 0])
      if (r.late) found.push(['late', r.late])
      if (r.early) found.push(['early', r.early])
      if (r.missingOut) found.push(['missing_out', 0])
      for (const [v, mins] of found) {
        const eligible = rules.filter((x) => x.violation === v && mins >= (x.min_minutes || 0))
        if (!eligible.length) continue
        const key = `${v}:${r.date.slice(0, 7)}`
        const n = (counts[key] = (counts[key] || 0) + 1)
        const rule = eligible.filter((x) => x.occurrence <= n).at(-1)
        if (!rule) continue
        out.push({ emp: r.emp, date: r.date, v, mins, n, rule })
      }
    }
  }
  return out
}
REPORTS['الجزاءات'] = { build: (f) => {
  const rows = penaltyRows(f)
  const totals = {}
  for (const x of rows) {
    const t = (totals[x.emp.id] ||= { emp: x.emp, minutes: 0, days: 0, warnings: 0 })
    if (x.rule.action === 'minutes') t.minutes += x.rule.amount
    else if (x.rule.action === 'days') t.days += x.rule.amount
    else t.warnings++
  }
  return {
    grouped: true,
    head: ['التاريخ', 'المخالفة', 'المدة', 'التكرار', 'الجزاء', 'القيمة'],
    groups: Object.values(totals).map((t) => ({
      title: `${t.emp.code} — ${t.emp.name_ar}`,
      rows: rows.filter((x) => x.emp.id === t.emp.id).map((x) => [x.date, VIOLATIONS[x.v], x.mins ? H(x.mins) : '', x.n, ACTIONS[x.rule.action], x.rule.action === 'warning' ? '' : x.rule.amount]),
      foot: ['الإجمالي', '', '', '', `إنذارات ${t.warnings}`, `${t.minutes} دقيقة · ${t.days} يوم`],
    })),
  }
} }

const table = (head, rows, foot) => `<table class="rep"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${UI.esc(c ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="empty">لا توجد بيانات</td></tr>`}</tbody>
  ${foot ? `<tfoot><tr>${foot.map((c) => `<td>${UI.esc(c)}</td>`).join('')}</tr></tfoot>` : ''}</table>`

function openReport(name) {
  const def = REPORTS[name]
  if (!licence.ok && !TRIAL_REPORTS.includes(name)) return UI.message('هذا التقرير متاح في النسخة المسجلة فقط — سجّل البرنامج من «أدوات ← تسجيل المنتج»')
  UI.openWindow(`rep-${name}`, name, { width: 980, height: 540 }, (body, win) => {
    const deps = DB.all('SELECT id, name_ar FROM departments ORDER BY name_ar')
    const today = Engine.today()
    const filters = UI.el(`<div class="filters">
      ${def.noPeriod ? '' : def.singleDay
        ? `<label>التاريخ</label><input type="date" id="r-from" value="${today}">`
        : `<label>من</label><input type="date" id="r-from" value="${monthStart()}"><label>إلى</label><input type="date" id="r-to" value="${today}">`}
      ${def.noPeriod ? '' : `<label>الإدارة/القسم</label><select id="r-dep"><option value="">الكل</option>${deps.map((d) => `<option value="${d.id}">${UI.esc(d.name_ar)}</option>`).join('')}</select>
      <label>الموظف</label><select id="r-emp"><option value="">الكل</option>${empOptions().map(([v, l]) => `<option value="${v}">${UI.esc(l)}</option>`).join('')}</select>`}
      <span class="trial-note"></span></div>`)
    const out = UI.el('<div class="report-out"></div>')
    const bar = UI.toolbar([
      { key: 'show', label: 'عرض', icon: 'reports', onClick: show },
      { key: 'print', label: 'طباعة', icon: 'print', onClick: () => output('print') },
      { key: 'pdf', label: 'PDF', icon: 'pdf', onClick: () => output('pdf') },
      { key: 'excel', label: 'Excel', icon: 'excel', onClick: () => output('excel') },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    body.append(bar, filters, out)
    let html = ''
    const note = () => {
      if (licence.ok) return
      const n = DB.one('SELECT n FROM print_counts WHERE report = ?', [name])?.n || 0
      filters.querySelector('.trial-note').textContent = `نسخة تجريبية — متبقي ${Math.max(0, 3 - n)} مرات طباعة`
    }
    // long periods can take a few seconds: paint «جاري الحساب…» before computing
    function show() {
      out.innerHTML = '<p class="empty">جاري الحساب…</p>'
      return new Promise((done) => setTimeout(() => { compute(); done() }, 30))
    }
    function compute() {
      const v = (id) => filters.querySelector(id)?.value || ''
      const from = v('#r-from'), to = def.singleDay ? from : v('#r-to')
      if (!def.noPeriod && (!from || !to || from > to)) return UI.message('فترة غير صحيحة')
      const f = { from, to, departmentId: +v('#r-dep') || null, employeeIds: v('#r-emp') ? [+v('#r-emp')] : null }
      const res = def.build(f)
      const period = def.noPeriod ? '' : def.singleDay ? `التاريخ: ${from}` : `من ${from} إلى ${to}`
      html = UI.letterhead(name, period) +
        (res.grouped ? res.groups.map((g) => `<div class="rep-group">${UI.esc(g.title)}</div>${table(res.head, g.rows, g.foot)}`).join('') || '<p class="empty">لا توجد بيانات</p>'
          : table(res.head, res.rows))
      out.innerHTML = html
    }
    // print / PDF / Excel all count as one «طباعة» against the trial allowance
    async function output(kind) {
      if (!html) await show()
      if (!licence.ok) {
        const n = DB.one('SELECT n FROM print_counts WHERE report = ?', [name])?.n || 0
        if (n >= 3) return UI.message('انتهت مرات الطباعة المتاحة لهذا التقرير في النسخة التجريبية')
        DB.run('INSERT INTO print_counts (report, n) VALUES (?, 1) ON CONFLICT(report) DO UPDATE SET n = n + 1', [name])
        await DB.flush()
        note()
      }
      const file = `${name} ${Engine.today()}`
      if (kind === 'excel') {
        const wb = XLSX.utils.book_new()
        out.querySelectorAll('table.rep').forEach((t, i) => {
          const title = out.querySelectorAll('.rep-group')[i]?.textContent || name
          const ws = XLSX.utils.table_to_sheet(t, { raw: true })
          ws['!RTL'] = true
          XLSX.utils.book_append_sheet(wb, ws, title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `ورقة ${i + 1}`)
        })
        if (!wb.SheetNames.length) return UI.message('لا توجد بيانات للتصدير')
        wb.Workbook = { Views: [{ RTL: true }] }
        const res = await window.bridge.saveFile(`${file}.xlsx`, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), 'xlsx')
        if (res?.ok) UI.message(`تم الحفظ: ${res.path}`)
        return
      }
      if (kind === 'pdf') {
        const res = await window.bridge.savePdf(`${file}.pdf`, UI.docHtml(html))
        if (res?.ok) UI.message(`تم الحفظ: ${res.path}`)
        else if (res?.error) UI.message(res.error)
        return
      }
      await UI.print(html)
    }
    note()
    show()
  })
}
