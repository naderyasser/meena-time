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
    const groups = DB.all('SELECT * FROM shift_groups ORDER BY id')
    const t = DB.all('SELECT * FROM shift_times ORDER BY group_id, day')
    const rows = []
    for (const g of groups) for (const x of t.filter((x) => x.group_id === g.id))
      rows.push([g.name_ar, DAY_NAMES[x.day], x.is_off ? 'عطلة' : x.check_in, x.is_off ? '' : x.check_out, x.is_off ? '' : x.late_min, x.is_off ? '' : x.early_min])
    return { head: ['المجموعة', 'اليوم', 'الحضور', 'الانصراف', 'التأخير المسموح', 'الانصراف المبكر'], rows }
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
    rows: Engine.compute(f).map((r) => [r.emp.code, r.emp.name_ar, r.emp.dep, r.emp.shift, H(r.in), H(r.out), r.late ? H(r.late) : '', r.status]),
  }) },
  'الحضور والانصراف بالحركات': { build: (f) => ({
    head: ['الكود', 'الموظف', 'التاريخ', 'اليوم', 'الحركات', 'الحالة'],
    rows: Engine.compute(f).filter((r) => r.punches.length || r.kind === 'absent')
      .map((r) => [r.emp.code, r.emp.name_ar, r.date, DAY_NAMES[r.day], r.punches.map(H).join('  ·  '), r.status]),
  }) },
}

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
      { key: 'print', label: 'طباعة', icon: 'print', onClick: print },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    body.append(bar, filters, out)
    let html = ''
    const note = () => {
      if (licence.ok) return
      const n = DB.one('SELECT n FROM print_counts WHERE report = ?', [name])?.n || 0
      filters.querySelector('.trial-note').textContent = `نسخة تجريبية — متبقي ${Math.max(0, 3 - n)} مرات طباعة`
    }
    function show() {
      const v = (id) => filters.querySelector(id)?.value || ''
      const from = v('#r-from'), to = def.singleDay ? from : v('#r-to')
      if (!def.noPeriod && (!from || !to || from > to)) return UI.message('فترة غير صحيحة')
      const f = { from, to, departmentId: +v('#r-dep') || null, employeeIds: v('#r-emp') ? [+v('#r-emp')] : null }
      const res = def.build(f)
      const company = DB.one("SELECT value FROM meta WHERE key = 'company_name'")?.value || ''
      const period = def.noPeriod ? '' : def.singleDay ? `التاريخ: ${from}` : `من ${from} إلى ${to}`
      html = `<div class="rep-head"><div class="co">${UI.esc(company)}</div><h2>${UI.esc(name)}</h2><div class="per">${period}</div></div>` +
        (res.grouped ? res.groups.map((g) => `<div class="rep-group">${UI.esc(g.title)}</div>${table(res.head, g.rows, g.foot)}`).join('') || '<p class="empty">لا توجد بيانات</p>'
          : table(res.head, res.rows))
      out.innerHTML = html
    }
    async function print() {
      if (!html) show()
      if (!licence.ok) {
        const n = DB.one('SELECT n FROM print_counts WHERE report = ?', [name])?.n || 0
        if (n >= 3) return UI.message('انتهت مرات الطباعة المتاحة لهذا التقرير في النسخة التجريبية')
        DB.run('INSERT INTO print_counts (report, n) VALUES (?, 1) ON CONFLICT(report) DO UPDATE SET n = n + 1', [name])
        await DB.flush()
        note()
      }
      const area = document.getElementById('print-area')
      area.innerHTML = html
      document.body.classList.add('printing')
      window.print()
      document.body.classList.remove('printing')
    }
    note()
    show()
  })
}
