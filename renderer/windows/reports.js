// «التقارير» — Apex Time's report set and layouts (help manual 22–25, 34, 35 + its report
// templates). Every report: filter window (الفترة · الموظفون: قسم أو إدارة / أوقات عمل
// محددة / مجموعة محددة / أرقام الموظفين) → Engine rows → HTML under the company header,
// printed / saved as PDF / Excel. Trial: only TRIAL_REPORTS open, each printable 3 times.
const H = Engine.hm
const sum = (rows, f) => rows.reduce((s, r) => s + (r[f] || 0), 0)
const byEmp = (rows) => {
  const m = new Map()
  for (const r of rows) { if (!m.has(r.emp.id)) m.set(r.emp.id, []); m.get(r.emp.id).push(r) }
  return [...m.values()]
}
const DAY_NAMES = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']
const PERIOD_NAMES = ['الفترة الأولى', 'الفترة الثانية', 'الفترة الثالثة', 'الفترة الرابعة']
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const esc = (v) => UI.esc(v ?? '')
const hmOrBlank = (m) => (m ? H(m) : '')

// employee details the Apex layouts print (job, department / section, project, shift)
function empInfo() {
  const lists = Object.fromEntries(DB.all('SELECT id, name_ar FROM lists').map((l) => [l.id, l.name_ar]))
  const deps = Object.fromEntries(DB.all('SELECT id, name_ar FROM departments').map((d) => [d.id, d.name_ar]))
  const projects = Object.fromEntries(DB.all('SELECT id, name_ar FROM projects').map((p) => [p.id, p.name_ar]))
  const shifts = Object.fromEntries(DB.all('SELECT id, name_ar FROM shift_groups').map((g) => [g.id, g.name_ar]))
  return (e) => ({ job: lists[e.job_id] || '', dep: deps[e.department_id] || '', sec: deps[e.section_id] || '', project: projects[e.project_id] || '', shift: shifts[e.shift_group_id] || '' })
}
// Apex «حالة اليوم» wording
function dayStatus(r, present = '') {
  if (r.kind === 'present') return present
  if (r.kind === 'absent') return 'غائب'
  if (r.kind === 'waiting') return 'في الانتظار'
  if (r.kind === 'leave') return r.status.replace('إجازة', 'أجازة')
  if (r.kind === 'holiday') return 'عطلة رسمية'
  return 'عطلة أسبوعية'
}
const redKinds = new Set(['absent', 'off', 'holiday'])
// «عدد ساعات الدوام» = time worked inside the schedule (total worked minus overtime)
const dutyMin = (r) => Math.max(0, (r.worked || 0) - (r.ot || 0))
const periodsOf = (r) => (r.windows?.length ? r.windows : r.in != null ? [{ in: r.in, out: r.out }] : [])

const table = (head, rows, foot) => `<table class="rep"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="empty">لا توجد بيانات</td></tr>`}</tbody>
  ${foot ? `<tfoot><tr>${foot.map((c) => `<td>${esc(c)}</td>`).join('')}</tr></tfoot>` : ''}</table>`
const period = (f) => `<span>خلال الفترة من: <b dir="ltr">${f.from}</b></span><span>إلى: <b dir="ltr">${f.to}</b></span>`
const empSub = (e, I, f) => `<div class="rep-sub"><span>رقم الموظف: <b>${esc(e.code)}</b></span><span>اسم الموظف: <b>${esc(e.name_ar)}</b></span>
  <span>الوظيفه: <b>${esc(I.job)}</b></span><span>الـــدوام: <b>${esc(I.shift)}</b></span><span>الإدارة: <b>${esc(I.dep)}</b></span><span>القســـم: <b>${esc(I.sec)}</b></span>${period(f)}</div>`

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
  'الموظفين': { noPeriod: true, build: () => {
    const I = empInfo()
    const emps = DB.all('SELECT * FROM employees ORDER BY CAST(code AS INTEGER), code')
    return { head: ['م', 'كود الموظف', 'إسم الموظف', 'الوظيفه', 'الإدارة', 'القسم', 'المشروع', 'الدوام', 'تاريخ التعيين', 'الحالة'],
      rows: emps.map((e, i) => { const x = I(e); return [i + 1, e.code, e.name_ar, x.job, x.dep, x.sec, x.project, x.shift, e.hire_date, e.status] }) }
  } },
  'الحركات الغير مكتملة': { build: (f) => {
    const rows = Engine.compute(f).filter((r) => r.missingOut)
    const byDay = new Map()
    for (const r of rows) (byDay.get(r.date) || byDay.set(r.date, []).get(r.date)).push(r)
    return { html: `<div class="rep-sub">${period(f)}</div>` + ([...byDay].map(([d, rs]) => `<table class="rep"><tbody><tr class="day-head"><td colspan="5">${DAY_NAMES[rs[0].day]} ${d}</td></tr>
      <tr><th>كود الموظف</th><th>إسم الموظف</th><th>القســـم</th><th>حضــور</th><th>إنصــراف</th></tr>
      ${rs.map((r) => `<tr><td>${esc(r.emp.code)}</td><td>${esc(r.emp.name_ar)}</td><td>${esc(r.emp.sec || r.emp.dep)}</td><td>${H(r.in)}</td><td class="red">لا يوجد</td></tr>`).join('')}</tbody></table>`).join('') || '<p class="empty">لا توجد بيانات</p>') }
  } },
  'التأخير عن بداية الدوام اليومي': { singleDay: true, build: (f) => {
    const rs = Engine.compute(f).filter((r) => r.late)
    return { html: `<div class="rep-sub"><span>تأخير يوم: <b>${DAY_NAMES[Engine.DAY_INDEX(f.from)]} ${f.from}</b></span></div>` +
      table(['م', 'كود الموظف', 'إسم الموظف', 'القسم', 'بداية الدوام', 'وقت الحضور', 'التأخير'],
        rs.map((r, i) => [i + 1, r.emp.code, r.emp.name_ar, r.emp.sec || r.emp.dep, r.windows?.[0]?.check_in != null ? H(r.windows[0].check_in % 1440) : '', H(r.in), H(r.late)])) }
  } },
  'التأخير عن الدوام خلال فترة': { build: (f) => {
    const groups = byEmp(Engine.compute(f)).filter((rs) => rs.some((r) => r.late || r.early))
    return { html: `<div class="rep-sub">${period(f)}</div>` + table(['م', 'كود الموظف', 'إسم الموظف', 'القسم', 'أيام التأخير', 'التأخير', 'أيام الخروج المبكر', 'الخروج المبكر', 'الإجمـــــــالي'],
      groups.map((rs, i) => [i + 1, rs[0].emp.code, rs[0].emp.name_ar, rs[0].emp.sec || rs[0].emp.dep, rs.filter((r) => r.late).length, H(sum(rs, 'late')), rs.filter((r) => r.early).length, H(sum(rs, 'early')), H(sum(rs, 'late') + sum(rs, 'early'))])) }
  } },
  'إجازات الموظفين': { build: (f) => {
    const rows = DB.all(`SELECT e.code, e.name_ar, t.name_ar type, l.from_date, l.to_date, l.notes FROM leaves l JOIN employees e ON e.id = l.employee_id
      LEFT JOIN lists t ON t.id = l.type_id WHERE l.to_date >= ? AND l.from_date <= ? ${f.employeeIds ? `AND e.id IN (${f.employeeIds.join(',') || 0})` : ''} ORDER BY l.from_date`, [f.from, f.to])
    return { html: `<div class="rep-sub">${period(f)}</div>` + table(['م', 'كود الموظف', 'إسم الموظف', 'الأجازات', 'البداية', 'النهاية', 'المدة', 'الوصف'],
      rows.map((x, i) => [i + 1, x.code, x.name_ar, x.type, x.from_date, x.to_date, Engine.diffDays(x.from_date, x.to_date) + 1, x.notes])) }
  } },
  // Apex «تقرير الحضور والانصراف التفصيلي»: one page per employee, a حضور/انصراف pair per period
  'الحضور والانصراف تفصيلي': { build: (f, S) => {
    const n = +S.report_shifts || 4, I = empInfo()
    const blocks = byEmp(Engine.compute(f)).map((rs) => {
      const e = rs[0].emp
      const head = `<tr><th rowspan="2">اليوم</th><th rowspan="2">التاريخ</th>${PERIOD_NAMES.slice(0, n).map((p) => `<th colspan="2">${p}</th>`).join('')}
        <th rowspan="2">عدد ساعات الدوام</th><th rowspan="2">عدد ساعات التأخير</th><th rowspan="2">عدد ساعات الإضافي</th><th rowspan="2">ساعات العمل</th><th rowspan="2">حالة اليوم</th></tr>
        <tr>${'<th>حضور</th><th>انصراف</th>'.repeat(n)}</tr>`
      const body = rs.map((r) => {
        const ps = periodsOf(r)
        // data-* = the engine's values for the day (exports / tests read these, not cell positions)
        const data = `data-emp="${esc(e.code)}" data-date="${r.date}" data-in="${H(r.in)}" data-out="${H(r.out)}" data-late="${hmOrBlank(r.late)}" data-early="${hmOrBlank(r.early)}" data-ot="${hmOrBlank(r.ot)}" data-worked="${hmOrBlank(r.worked)}" data-status="${esc(r.status)}"`
        return `<tr ${data}><td>${DAY_NAMES[r.day]}</td><td dir="ltr">${r.date}</td>${Array.from({ length: n }, (_, k) => `<td>${H(ps[k]?.in != null ? ps[k].in % 1440 : null)}</td><td>${H(ps[k]?.out != null ? ps[k].out % 1440 : null)}</td>`).join('')}
          <td>${hmOrBlank(dutyMin(r))}</td><td>${hmOrBlank(r.late + r.early)}</td><td>${hmOrBlank(r.ot)}</td><td>${hmOrBlank(r.worked)}</td><td class="${redKinds.has(r.kind) ? 'red' : ''}">${esc(dayStatus(r))}</td></tr>`
      }).join('')
      const foot = `<tr><td colspan="${2 + 2 * n}">الإجمالي</td><td>${H(rs.reduce((s, r) => s + dutyMin(r), 0))}</td><td>${H(sum(rs, 'late') + sum(rs, 'early'))}</td><td>${H(sum(rs, 'ot'))}</td><td>${H(sum(rs, 'worked'))}</td><td></td></tr>`
      return `<div class="rep-emp">${empSub(e, I(e), f)}<table class="rep"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`
    })
    return { html: blocks.join('') || '<p class="empty">لا توجد بيانات</p>' }
  } },
  // Apex «تقرير الحضور والانصراف الإجمالي»: ساعات العمل · التأخير · الغياب (hours) · الإضافي
  'الحضور والانصراف إجمالي': { build: (f) => {
    const I = empInfo()
    const groups = byEmp(Engine.compute(f))
    const absentMin = (rs) => rs.filter((r) => r.kind === 'absent').reduce((s, r) => s + (r.scheduled || 0), 0)
    const rows = groups.map((rs, i) => { const e = rs[0].emp, x = I(e); return [i + 1, e.code, e.name_ar, x.job, x.sec || x.dep, H(sum(rs, 'worked')), hmOrBlank(sum(rs, 'late') + sum(rs, 'early')), hmOrBlank(absentMin(rs)), hmOrBlank(sum(rs, 'ot'))] })
    const all = groups.flat()
    return { html: `<div class="rep-sub">${period(f)}</div>` + table(['م', 'رقم الموظف', 'إسم الموظف', 'الوظيفة', 'القسم', 'ساعات العمل', 'التأخير', 'الغياب', 'الإضافي'], rows,
      ['', '', 'الإجمالي', '', '', H(sum(all, 'worked')), H(sum(all, 'late') + sum(all, 'early')), H(groups.reduce((s, rs) => s + absentMin(rs), 0)), H(sum(all, 'ot'))]) }
  } },
  // Apex «تقرير الغياب»: grouped by day
  'الغياب خلال فترة': { build: (f) => {
    const I = empInfo()
    const rows = Engine.compute(f).filter((r) => r.kind === 'absent')
    const byDay = new Map()
    for (const r of rows) (byDay.get(r.date) || byDay.set(r.date, []).get(r.date)).push(r)
    return { html: `<div class="rep-sub"><span>الغياب خلال الفترة من <b dir="ltr">${f.from}</b></span><span>إلى <b dir="ltr">${f.to}</b></span></div>` +
      ([...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([d, rs]) => `<table class="rep"><tbody><tr class="day-head"><td colspan="6">الغياب يوم ${DAY_NAMES[rs[0].day]} — ${d}</td></tr>
        <tr><th>كود الموظف</th><th>إسم الموظف</th><th>الإدارة</th><th>القسم</th><th>المشروع</th><th>الدوام</th></tr>
        ${rs.map((r) => { const x = I(r.emp); return `<tr><td>${esc(r.emp.code)}</td><td>${esc(r.emp.name_ar)}</td><td>${esc(x.dep)}</td><td>${esc(x.sec)}</td><td>${esc(x.project)}</td><td>${esc(r.shift || x.shift)}</td></tr>` }).join('')}</tbody></table>`).join('') || '<p class="empty">لا يوجد غياب</p>') }
  } },
  // Apex «تقرير حالة اليوم»: مواعيد العمل + حضور/انصراف per period + مداوم / غائب
  'حالة اليوم': { singleDay: true, build: (f, S) => {
    const n = +S.report_shifts || 4, I = empInfo()
    const rows = Engine.compute(f)
    const head = `<tr><th rowspan="2">م</th><th rowspan="2">رقم الموظف</th><th rowspan="2">اسم الموظف</th><th rowspan="2">الوظيفة</th><th rowspan="2">القسم</th><th rowspan="2">مواعيد العمل</th>
      ${PERIOD_NAMES.slice(0, n).map((p) => `<th colspan="2">${p}</th>`).join('')}<th rowspan="2">الدوام</th><th rowspan="2">التأخير</th><th rowspan="2">الإضافي</th><th rowspan="2">ساعات العمل</th><th rowspan="2">حالة اليوم</th></tr>
      <tr>${'<th>حضور</th><th>انصراف</th>'.repeat(n)}</tr>`
    const body = rows.map((r, i) => {
      const x = I(r.emp), ps = periodsOf(r)
      const status = dayStatus(r, 'مداوم')
      return `<tr><td>${i + 1}</td><td>${esc(r.emp.code)}</td><td>${esc(r.emp.name_ar)}</td><td>${esc(x.job)}</td><td>${esc(x.sec || x.dep)}</td><td>${esc(r.shift || x.shift)}</td>
        ${Array.from({ length: n }, (_, k) => `<td>${H(ps[k]?.in != null ? ps[k].in % 1440 : null)}</td><td>${H(ps[k]?.out != null ? ps[k].out % 1440 : null)}</td>`).join('')}
        <td>${hmOrBlank(dutyMin(r))}</td><td>${hmOrBlank(r.late + r.early)}</td><td>${hmOrBlank(r.ot)}</td><td>${hmOrBlank(r.worked)}</td><td class="${r.kind === 'absent' ? 'red' : ''}">${esc(status)}</td></tr>`
    }).join('')
    return { html: `<div class="rep-sub"><span><b>${DAY_NAMES[Engine.DAY_INDEX(f.from)]}</b></span><span dir="ltr"><b>${f.from}</b></span></div>` +
      `<table class="rep"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${11 + 2 * n}" class="empty">لا توجد بيانات</td></tr>`}</tbody></table>` }
  } },
  // Apex «بيان تأخير الموظفين»: a month, one coloured cell per day (colours from «إعدادات النظام»)
  'بيان تأخير الموظفين': { month: true, build: (f, S) => {
    const days = Engine.dates(f.from, f.to)
    const C = S.colors
    const perms = new Set(DB.all('SELECT employee_id, date FROM permissions WHERE date BETWEEN ? AND ?', [f.from, f.to]).map((p) => `${p.employee_id}|${p.date}`))
    const colour = (r) => r.kind === 'absent' ? C.absent : r.kind === 'leave' ? C.leave : r.kind === 'holiday' ? C.holiday : r.kind === 'off' ? C.weekly
      : perms.has(`${r.emp.id}|${r.date}`) ? C.permission : r.late ? C.late : r.early ? C.early : C.present
    const rows = byEmp(Engine.compute(f)).map((rs) => {
      const byD = Object.fromEntries(rs.map((r) => [r.date, r]))
      return `<tr><td>${esc(rs[0].emp.code)}</td><td class="nm">${esc(rs[0].emp.name_ar)}</td>${days.map((d) => { const r = byD[d]; return `<td class="c" style="background:${r ? colour(r) : '#fff'}"></td>` }).join('')}<td class="sig"></td></tr>`
    }).join('')
    const legend = [['holiday', 'عطلة رسمية'], ['permission', 'أذن'], ['leave', 'أجازة'], ['late', 'تأخير'], ['weekly', 'عطلة أسبوعية'], ['early', 'خروج مبكر'], ['absent', 'غياب']]
    return { html: `<table class="rep month-grid"><thead><tr><th>الرقم</th><th>الاسم</th>${days.map((d) => `<th>${+d.slice(8)}</th>`).join('')}<th>التوقيع</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${days.length + 3}" class="empty">لا توجد بيانات</td></tr>`}</tbody></table>
      <div class="legend">${legend.map(([k, l]) => `<span><i style="background:${C[k]}"></i>${l}</span>`).join('')}</div>`,
      title: `بيان تأخير الموظفين لشهر ${MONTHS[+f.from.slice(5, 7) - 1]} ${f.from.slice(0, 4)} م` }
  } },
  // Apex «تقرير تأخير وإضافي الشفتات»: per employee, late (red) and overtime (green) of every period
  'تأخير وإضافي الشفتات': { build: (f, S) => {
    const n = +S.report_shifts || 4, I = empInfo()
    const shiftNames = ['الشفت الأول', 'الشفت الثاني', 'الشفت الثالث', 'الشفت الرابع']
    const blocks = byEmp(Engine.compute(f)).map((rs) => {
      const e = rs[0].emp
      const tot = Array.from({ length: n }, () => ({ late: 0, ot: 0 }))
      const body = rs.map((r, i) => {
        const ps = r.windows || []
        return `<tr><td>${i + 1}</td><td dir="ltr">${r.date}</td>${Array.from({ length: n }, (_, k) => {
          const w = ps[k] || {}
          const late = (w.late || 0) + (w.early || 0), ot = w.ot || 0
          tot[k].late += late; tot[k].ot += ot
          return `<td class="red">${hmOrBlank(late)}</td><td class="green">${hmOrBlank(ot)}</td>`
        }).join('')}<td>${hmOrBlank(r.worked)}</td></tr>`
      }).join('')
      return `<div class="rep-emp">${empSub(e, I(e), f)}<table class="rep"><thead><tr><th rowspan="2">م</th><th rowspan="2">التاريخ</th>${shiftNames.slice(0, n).map((s) => `<th colspan="2">${s}</th>`).join('')}<th rowspan="2">ساعات العمل</th></tr>
        <tr>${'<th>التأخير</th><th>الإضافي</th>'.repeat(n)}</tr></thead><tbody>${body}</tbody>
        <tfoot><tr><td colspan="2">الإجمالي</td>${tot.map((t) => `<td>${H(t.late)}</td><td>${H(t.ot)}</td>`).join('')}<td>${H(sum(rs, 'worked'))}</td></tr></tfoot></table></div>`
    })
    return { html: blocks.join('') || '<p class="empty">لا توجد بيانات</p>' }
  } },
  'الحضور والانصراف بالحركات': { build: (f) => ({
    html: `<div class="rep-sub">${period(f)}</div>` + table(['كود الموظف', 'إسم الموظف', 'التاريخ', 'اليوم', 'الحركات', 'حالة اليوم'],
      Engine.compute(f).filter((r) => r.punches.length || r.kind === 'absent').map((r) => [r.emp.code, r.emp.name_ar, r.date, DAY_NAMES[r.day], r.punches.map(H).join('  ·  '), dayStatus(r, r.status)])),
  }) },
  // Apex «تقرير أذونات الموظفين»
  'أذونات الموظفين': { build: (f) => {
    const I = empInfo()
    const rows = DB.all(`SELECT p.*, e.code, e.name_ar, e.job_id, e.department_id, e.section_id, e.project_id, e.shift_group_id, t.name_ar type FROM permissions p
      JOIN employees e ON e.id = p.employee_id LEFT JOIN lists t ON t.id = p.type_id WHERE p.date BETWEEN ? AND ? ${f.employeeIds ? `AND e.id IN (${f.employeeIds.join(',') || 0})` : ''} ORDER BY p.date, CAST(e.code AS INTEGER)`, [f.from, f.to])
    return { html: `<div class="rep-sub">${period(f)}</div>` + table(['م', 'رقم الموظف', 'اسم الموظف', 'القســـم', 'الـــدوام', 'الإذن', 'التاريخ', 'اليوم', 'البدايه', 'النهايه', 'المدة'],
      rows.map((p, i) => { const x = I(p); const a = Engine.toMin(p.from_time), b = Engine.toMin(p.to_time); return [i + 1, p.code, p.name_ar, x.sec || x.dep, x.shift, p.type || 'إذن', p.date, DAY_NAMES[Engine.DAY_INDEX(p.date)], p.from_time, p.to_time, H(b >= a ? b - a : b + 1440 - a)] })) }
  } },
  // Apex «تقرير حركات الأبواب»: every raw punch with the device it came from
  'حركات الأبواب': { build: (f) => {
    const I = empInfo()
    const rows = DB.all(`SELECT p.ts, p.source, d.name dev, e.* FROM punches p JOIN employees e ON e.code = p.emp_code LEFT JOIN devices d ON d.id = p.device_id
      WHERE p.ts >= ? AND p.ts < ? ${f.employeeIds ? `AND e.id IN (${f.employeeIds.join(',') || 0})` : ''} ORDER BY p.ts`, [f.from, Engine.addDays(f.to, 1)])
    const src = { file: 'ملف', manual: 'يدوي', web: 'الموقع' }
    return { html: `<div class="rep-sub">${period(f)}</div>` + table(['م', 'كود الموظف', 'إسم الموظف', 'القســـم', 'التاريخ', 'اليوم', 'الوقت', 'الجهاز'],
      rows.map((p, i) => { const x = I(p); return [i + 1, p.code, p.name_ar, x.sec || x.dep, p.ts.slice(0, 10), DAY_NAMES[Engine.DAY_INDEX(p.ts.slice(0, 10))], p.ts.slice(11, 19), p.dev || src[p.source] || ''] })) }
  } },
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

// «الموظفون» filter of every Apex report: any combination of department/section, shift,
// employee group and an employee-number range → the matching employee ids (null = all)
function reportEmployeeIds(q) {
  if (!q.dep && !q.shift && !q.group && !q.codeFrom && !q.codeTo) return null
  const where = [], args = []
  if (q.dep) {
    const ids = [q.dep, ...DB.all('SELECT id FROM departments WHERE parent_id = ?', [q.dep]).map((d) => d.id)]
    where.push(`(department_id IN (${ids.join(',')}) OR section_id IN (${ids.join(',')}))`)
  }
  if (q.shift) { where.push('shift_group_id = ?'); args.push(q.shift) }
  if (q.group) { where.push('group_id = ?'); args.push(q.group) }
  if (q.codeFrom) { where.push('CAST(code AS INTEGER) >= ?'); args.push(+q.codeFrom) }
  if (q.codeTo) { where.push('CAST(code AS INTEGER) <= ?'); args.push(+q.codeTo) }
  return DB.all(`SELECT id FROM employees WHERE ${where.join(' AND ')}`, args).map((e) => e.id)
}
function depOptions() {
  const all = DB.all('SELECT id, name_ar, parent_id FROM departments ORDER BY name_ar')
  const out = []
  for (const d of all.filter((x) => !x.parent_id)) {
    out.push([d.id, d.name_ar])
    for (const s of all.filter((x) => x.parent_id === d.id)) out.push([s.id, `— ${s.name_ar}`])
  }
  return out
}

function openReport(name) {
  const def = REPORTS[name]
  if (!licence.ok && !TRIAL_REPORTS.includes(name)) return UI.message('هذا التقرير متاح في النسخة المسجلة فقط — سجّل البرنامج من «أدوات ← تسجيل المنتج»')
  UI.openWindow(`rep-${name}`, name, { width: 1060, height: 600 }, (body, win) => {
    const today = Engine.today()
    const opt = (rows) => rows.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')
    const periodHtml = def.noPeriod ? '' : def.month
      ? `<fieldset class="fl-per"><legend>الفتـــرة</legend><label>شهر</label><select id="r-month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i === +today.slice(5, 7) - 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>
          <label>السنة</label><input type="text" id="r-year" dir="ltr" value="${today.slice(0, 4)}" maxlength="4"></fieldset>`
      : `<fieldset class="fl-per"><legend>الفتـــرة</legend><label>مـــن</label><input type="date" id="r-from" value="${def.singleDay ? today : monthStart()}">
          <label>إلـــى</label><input type="date" id="r-to" value="${today}"></fieldset>`
    const empHtml = def.noPeriod ? '' : `<fieldset class="fl-emp"><legend>الموظفـــون</legend>
        <label><input type="checkbox" id="rf-dep"> قســـم أو إدارة</label><select id="r-dep" disabled>${opt(depOptions())}</select>
        <label><input type="checkbox" id="rf-shift"> أوقات عمل محددة</label><select id="r-shift" disabled>${opt(DB.all('SELECT id, name_ar FROM shift_groups ORDER BY name_ar').map((g) => [g.id, g.name_ar]))}</select>
        <label><input type="checkbox" id="rf-group"> مجموعة محـددة</label><select id="r-group" disabled>${opt(DB.all('SELECT id, name_ar FROM employee_groups ORDER BY name_ar').map((g) => [g.id, g.name_ar]))}</select>
        <label><input type="checkbox" id="rf-codes"> أرقـام الموظفيـن</label><span class="codes"><span>مـن</span><input type="text" id="r-code-from" dir="ltr" disabled><span>إلـى</span><input type="text" id="r-code-to" dir="ltr" disabled></span>
      </fieldset>`
    const filters = UI.el(`<div class="rep-filters">${periodHtml}${empHtml}<span class="trial-note"></span></div>`)
    const out = UI.el('<div class="report-out"></div>')
    const bar = UI.toolbar([
      { key: 'show', label: 'موافق', icon: 'ok', onClick: show },
      { key: 'print', label: 'طباعة', icon: 'print', onClick: () => output('print') },
      { key: 'pdf', label: 'PDF', icon: 'pdf', onClick: () => output('pdf') },
      { key: 'excel', label: 'Excel', icon: 'excel', onClick: () => output('excel') },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    body.append(bar, filters, out)
    for (const [chk, ...inputs] of [['#rf-dep', '#r-dep'], ['#rf-shift', '#r-shift'], ['#rf-group', '#r-group'], ['#rf-codes', '#r-code-from', '#r-code-to']]) {
      const c = filters.querySelector(chk)
      c?.addEventListener('change', () => inputs.forEach((i) => { filters.querySelector(i).disabled = !c.checked }))
    }
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
      const v = (id) => filters.querySelector(id)?.value?.trim() || ''
      const on = (id) => !!filters.querySelector(id)?.checked
      let from = v('#r-from'), to = def.singleDay ? v('#r-to') || from : v('#r-to')
      if (def.month) {
        const y = +v('#r-year'), m = +v('#r-month')
        if (!(y >= 2000 && y <= 2100)) { out.innerHTML = ''; return UI.message('سنة غير صحيحة') }
        from = `${y}-${String(m).padStart(2, '0')}-01`
        to = Engine.addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1)
      }
      if (!def.noPeriod && (!from || !to || from > to)) { out.innerHTML = ''; return UI.message('فترة غير صحيحة') }
      if (on('#rf-codes') && ((v('#r-code-from') && !/^\d+$/.test(v('#r-code-from'))) || (v('#r-code-to') && !/^\d+$/.test(v('#r-code-to'))))) { out.innerHTML = ''; return UI.message('أرقام الموظفين: أرقام فقط') }
      const q = { dep: on('#rf-dep') && +v('#r-dep'), shift: on('#rf-shift') && +v('#r-shift'), group: on('#rf-group') && +v('#r-group'),
        codeFrom: on('#rf-codes') && v('#r-code-from'), codeTo: on('#rf-codes') && v('#r-code-to') }
      const f = { from, to, employeeIds: def.noPeriod ? null : reportEmployeeIds(q) }
      const S = Engine.settings()
      const res = def.build(f, S)
      html = UI.letterhead(res.title || name) +
        (res.html ?? (res.grouped ? res.groups.map((g) => `<div class="rep-group">${esc(g.title)}</div>${table(res.head, g.rows, g.foot)}`).join('') || '<p class="empty">لا توجد بيانات</p>'
          : table(res.head, res.rows))) + UI.reportFoot()
      out.innerHTML = html
    }
    // print / PDF / Excel all count as one «طباعة» against the trial allowance
    async function output(kind) {
      if (!html) await show()
      if (!html) return
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
          const ws = XLSX.utils.table_to_sheet(t, { raw: true })
          ws['!RTL'] = true
          // one sheet per table; names must be unique and ≤ 31 characters
          let title = (out.querySelectorAll('.rep-group')[i]?.textContent || name).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 26)
          if (wb.SheetNames.includes(title)) title = `${title.slice(0, 22)} (${i + 1})`
          XLSX.utils.book_append_sheet(wb, ws, title || `ورقة ${i + 1}`)
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
