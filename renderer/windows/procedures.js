// «الإجراءات» — punches in/out of the system, leaves, permissions, posting.
const monthStart = () => Engine.today().slice(0, 8) + '01'
const empOptions = () => DB.all("SELECT id, code, name_ar FROM employees ORDER BY CAST(code AS INTEGER), code").map((e) => [e.id, `${e.code} — ${e.name_ar}`])
const yesNo = (head, text) => UI.dialog({ head, bodyHtml: `<div>${text}</div>`, width: 380,
  buttons: [{ label: 'نعم', icon: 'ok', onClick: (d) => d.close(true) }, { label: 'لا', icon: 'cancel', onClick: (d) => d.close(false) }] })

// A small modal with a date range (+ optional extra fields) — resolves {from, to, ...} or null.
function periodDialog(head, { extra = '', read = () => ({}) } = {}) {
  return UI.dialog({
    head, width: 440,
    bodyHtml: `<div class="fields" style="grid-template-columns:90px 1fr">
      <label>من تاريخ</label><input type="date" id="pd-from" value="${monthStart()}">
      <label>إلى تاريخ</label><input type="date" id="pd-to" value="${Engine.today()}">${extra}</div>`,
    buttons: [
      { label: 'موافق', icon: 'ok', onClick: (d) => {
        const from = d.root.querySelector('#pd-from').value, to = d.root.querySelector('#pd-to').value
        if (!from || !to || from > to) return d.error('فترة غير صحيحة')
        const more = read(d.root)
        if (more === false) return
        d.close({ from, to, ...more })
      } },
      { label: 'الغاء', icon: 'cancel', onClick: (d) => d.close(null) },
    ],
  })
}

// ── import ─────────────────────────────────────────────────
// Accepts ZKTeco attlog/.dat ("  1001\t2026-09-24 08:01:02\t1\t0…"), CSV
// ("1001,2026-09-24 08:01") and dd/mm/yyyy variants. Returns [{code, ts}].
function parsePunchFile(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const code = line.match(/^\s*"?(\d{1,9})"?[\s,;\t]/)?.[1]
    let m = line.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
    let y, mo, d, h, mi, s
    if (m) [, y, mo, d, h, mi, s] = m
    else if ((m = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/))) [, d, mo, y, h, mi, s] = m
    if (!code || !m) continue
    const p2 = (x) => String(x || 0).padStart(2, '0')
    out.push({ code, ts: `${y}-${p2(mo)}-${p2(d)} ${p2(h)}:${p2(mi)}:${p2(s)}` })
  }
  return out
}

async function storePunches(list, source, deviceId = null) {
  const known = new Set(DB.all('SELECT code FROM employees').map((e) => e.code))
  let added = 0, dup = 0, unknown = 0, posted = 0
  DB.run('BEGIN')
  for (const p of list) {
    if (!known.has(p.code)) { unknown++; continue }
    if (Engine.isPosted(p.ts.slice(0, 10))) { posted++; continue }
    DB.run('INSERT OR IGNORE INTO punches (emp_code, ts, source, device_id) VALUES (?, ?, ?, ?)', [p.code, p.ts, source, deviceId])
    if (DB.one('SELECT changes() AS c').c > 0) added++
    else dup++
  }
  DB.run('COMMIT')
  await DB.flush()
  if (added && WebSync.linked) WebSync.sync({ quiet: true }) // send them to the site
  return `تمت قراءة ${list.length} حركة: جديدة ${added} · مكررة ${dup}` +
    (unknown ? ` · لموظفين غير معرّفين ${unknown}` : '') + (posted ? ` · في فترة مرحّلة ${posted}` : '')
}

function openReadPunches() {
  const devices = DB.all('SELECT * FROM devices ORDER BY name')
  UI.dialog({
    head: 'قراءة الحركات (شبكة - ملف)', width: 520,
    bodyHtml: `<div class="fields" style="grid-template-columns:110px 1fr">
      <label>من الجهاز</label><select id="rp-dev">${devices.map((d) => `<option value="${d.id}">${UI.esc(d.name)} — ${UI.esc(d.ip)}</option>`).join('') || '<option value="">لا توجد أجهزة معرّفة</option>'}</select>
      <label>أو من ملف</label><input type="file" id="rp-file" accept=".txt,.dat,.csv,.log">
    </div>`,
    buttons: [
      { label: 'قراءة من الجهاز', icon: 'device', onClick: async (d) => {
        const id = +d.root.querySelector('#rp-dev').value
        if (!id) return d.error('عرّف الجهاز أولاً من «البيانات الأساسية ← تعريف الأجهزة»')
        const dev = devices.find((x) => x.id === id)
        d.error('جاري الاتصال بالجهاز…')
        const res = await window.bridge.readDevice({ ip: dev.ip, port: +dev.port || 4370 })
        if (!res.ok) return d.error(res.error || 'تعذّر الاتصال بالجهاز')
        d.error(await storePunches(res.punches, 'device', id))
      } },
      { label: 'قراءة من الملف', icon: 'new', onClick: async (d) => {
        const f = d.root.querySelector('#rp-file').files[0]
        if (!f) return d.error('اختر ملف الحركات')
        const list = parsePunchFile(await f.text())
        if (!list.length) return d.error('لم يتم التعرف على أي حركة في الملف')
        d.error(await storePunches(list, 'file'))
      } },
      { label: 'إغلاق', icon: 'cancel', onClick: (d) => d.close() },
    ],
  })
}

function openViewPunches() {
  UI.openWindow('view-punches', 'عرض الحركات', { width: 720, height: 440 }, (body, win) => {
    const bar = UI.toolbar([
      { key: 'print', label: 'طباعة', icon: 'print', onClick: () => UI.printGrid('عرض الحركات', body) },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const filters = UI.el(`<div class="filters">
      <label>من</label><input type="date" id="vp-from" value="${monthStart()}">
      <label>إلى</label><input type="date" id="vp-to" value="${Engine.today()}">
      <label>الموظف</label><select id="vp-emp"><option value="">الكل</option>${empOptions().map(([v, l]) => `<option value="${v}">${UI.esc(l)}</option>`).join('')}</select>
      <button id="vp-go">عرض</button></div>`)
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr><th style="width:70px">الكود</th><th class="sorted">الموظف</th>
      <th style="width:100px">التاريخ</th><th style="width:70px">الوقت</th><th style="width:80px">المصدر</th></tr></thead><tbody></tbody></table></div>`)
    const count = UI.el('<div style="padding:2px 8px;font-size:12px"></div>')
    body.append(bar, filters, wrap, count)
    const SRC = { device: 'جهاز', file: 'ملف', manual: 'يدوي', web: 'الموقع' }
    const run = () => {
      const from = filters.querySelector('#vp-from').value, to = filters.querySelector('#vp-to').value, emp = filters.querySelector('#vp-emp').value
      const rows = DB.all(`SELECT p.*, e.name_ar FROM punches p LEFT JOIN employees e ON e.code = p.emp_code
        WHERE p.ts BETWEEN ? AND ? ${emp ? 'AND e.id = ?' : ''} ORDER BY p.ts`, emp ? [from, to + ' 99', emp] : [from, to + ' 99'])
      wrap.querySelector('tbody').innerHTML = rows.map((r) => `<tr><td class="center">${UI.esc(r.emp_code)}</td><td>${UI.esc(r.name_ar || '—')}</td>
        <td class="center">${r.ts.slice(0, 10)}</td><td class="center">${r.ts.slice(11, 16)}</td><td class="center">${SRC[r.source] || r.source}</td></tr>`).join('')
      count.textContent = `عدد الحركات: ${rows.length}`
    }
    filters.querySelector('#vp-go').onclick = run
    run()
  })
}

function openEditPunches() {
  UI.openWindow('edit-punches', 'إضافة وتعديل الحركات لموظف', { width: 560, height: 420 }, (body, win) => {
    const bar = UI.toolbar([
      { key: 'add', label: 'إضافة حركة', icon: 'new', onClick: add },
      { key: 'del', label: 'حذف الحركة', icon: 'del', onClick: del },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const filters = UI.el(`<div class="filters">
      <label>الموظف</label><select id="ep-emp">${empOptions().map(([v, l]) => `<option value="${v}">${UI.esc(l)}</option>`).join('')}</select>
      <label>التاريخ</label><input type="date" id="ep-date" value="${Engine.today()}">
      <label>الوقت</label><input type="text" id="ep-time" dir="ltr" placeholder="HH:MM" maxlength="5" style="width:60px"></div>`)
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr><th style="width:16px"></th><th class="sorted">الوقت</th><th>المصدر</th></tr></thead><tbody></tbody></table></div>`)
    body.append(bar, filters, wrap)
    let current = null
    const emp = () => DB.one('SELECT * FROM employees WHERE id = ?', [+filters.querySelector('#ep-emp').value])
    const date = () => filters.querySelector('#ep-date').value
    const load = () => {
      const e = emp()
      current = null
      const rows = e ? DB.all('SELECT * FROM punches WHERE emp_code = ? AND ts LIKE ? ORDER BY ts', [e.code, date() + '%']) : []
      const tb = wrap.querySelector('tbody')
      tb.innerHTML = ''
      for (const r of rows) {
        const tr = UI.el(`<tr><td class="sel"></td><td class="center">${r.ts.slice(11, 16)}</td><td class="center">${{ device: 'جهاز', file: 'ملف', manual: 'يدوي', web: 'الموقع' }[r.source]}</td></tr>`)
        tr.onmousedown = () => { tb.querySelectorAll('tr').forEach((x) => x.classList.remove('current')); tr.classList.add('current'); current = r }
        tb.appendChild(tr)
      }
    }
    filters.querySelectorAll('select, input[type=date]').forEach((x) => x.addEventListener('change', load))
    async function add() {
      const e = emp(), t = filters.querySelector('#ep-time').value.trim()
      if (!e) return UI.message('اختر موظفاً')
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return UI.message('الوقت بصيغة HH:MM')
      if (Engine.isPosted(date())) return UI.message('هذا اليوم مرحّل — الغِ الترحيل أولاً')
      DB.run("INSERT OR IGNORE INTO punches (emp_code, ts, source) VALUES (?, ?, 'manual')", [e.code, `${date()} ${t}:00`])
      await DB.flush()
      filters.querySelector('#ep-time').value = ''
      load()
    }
    async function del() {
      if (!current) return UI.message('اختر الحركة')
      if (Engine.isPosted(date())) return UI.message('هذا اليوم مرحّل — الغِ الترحيل أولاً')
      if (!(await yesNo('تأكيد', 'حذف الحركة المحددة؟'))) return
      DB.run('DELETE FROM punches WHERE id = ?', [current.id])
      await DB.flush()
      load()
    }
    load()
  })
}

async function deletePunchesInPeriod(sources, title) {
  const p = await periodDialog(title)
  if (!p) return
  if (DB.one('SELECT 1 FROM posted_periods WHERE from_date <= ? AND to_date >= ? LIMIT 1', [p.to, p.from])) return UI.message('الفترة تتداخل مع فترة مرحّلة — الغِ الترحيل أولاً')
  const where = `ts BETWEEN ? AND ? AND source IN (${sources.map(() => '?').join(',')})`
  const n = DB.one(`SELECT COUNT(*) AS n FROM punches WHERE ${where}`, [p.from, p.to + ' 99', ...sources]).n
  if (!n) return UI.message('لا توجد حركات في هذه الفترة')
  if (!(await yesNo('تأكيد', `سيتم حذف ${n} حركة. متابعة؟`))) return
  DB.run(`DELETE FROM punches WHERE ${where}`, [p.from, p.to + ' 99', ...sources])
  await DB.flush()
  UI.message(`تم حذف ${n} حركة`)
}

function openLeaves() {
  openGridWindow({
    id: 'leaves', title: 'إضافة إجازات لموظف', table: 'leaves', orderBy: 'from_date DESC', width: 780,
    columns: [
      { field: 'employee_id', label: 'الموظف', type: 'select', options: empOptions, required: true },
      { field: 'type_id', label: 'نوع الإجازة', type: 'select', width: 150, options: listOptions('leave') },
      { field: 'from_date', label: 'من تاريخ', type: 'date', width: 130, required: true },
      { field: 'to_date', label: 'إلى تاريخ', type: 'date', width: 130, required: true },
      { field: 'notes', label: 'ملاحظات' },
    ],
  })
}

function openPermissions() {
  openGridWindow({
    id: 'permissions', title: 'إضافة أذونات لموظف', table: 'permissions', orderBy: 'date DESC', width: 800,
    help: 'الإذن يلغي التأخير أو الانصراف المبكر الواقع داخل وقته.',
    columns: [
      { field: 'employee_id', label: 'الموظف', type: 'select', options: empOptions, required: true },
      { field: 'type_id', label: 'نوع الإذن', type: 'select', width: 130, options: listOptions('permission') },
      { field: 'date', label: 'التاريخ', type: 'date', width: 130, required: true },
      { field: 'from_time', label: 'من', type: 'time', width: 70, required: true },
      { field: 'to_time', label: 'إلى', type: 'time', width: 70, required: true },
      { field: 'notes', label: 'ملاحظات' },
    ],
  })
}

async function postPunches() {
  const p = await periodDialog('ترحيل الحركات')
  if (!p) return
  if (p.to >= Engine.today()) return UI.message('لا يمكن ترحيل اليوم الحالي أو أيام قادمة')
  if (DB.one('SELECT 1 FROM posted_periods WHERE from_date <= ? AND to_date >= ? LIMIT 1', [p.to, p.from])) return UI.message('الفترة تتداخل مع فترة مرحّلة سابقاً')
  const n = Engine.post(p.from, p.to)
  DB.audit('ترحيل الحركات', `${p.from} → ${p.to}`, `${n} يوم`)
  await DB.flush()
  UI.message(`تم ترحيل الحركات من ${p.from} إلى ${p.to}`)
}

function openUnpost() {
  openGridWindow({
    id: 'unpost', title: 'الغاء ترحيل الحركات', table: 'posted_periods', orderBy: 'from_date DESC', width: 520,
    deleteOnly: true,
    onDeleteRow: (r) => { Engine.unpost(r.id); DB.audit('الغاء ترحيل', `${r.from_date} → ${r.to_date}`) },
    help: 'احذف الفترة المرحّلة (زر «حذف») للسماح بتعديل حركاتها.',
    columns: [
      { field: 'from_date', label: 'من تاريخ', type: 'readonly' },
      { field: 'to_date', label: 'إلى تاريخ', type: 'readonly' },
      { field: 'posted_at', label: 'تاريخ الترحيل', type: 'readonly' },
    ],
  })
}

async function purgeEmployee() {
  if (WebSync.blocks('employees')) return
  const emps = empOptions()
  const id = await UI.dialog({
    head: 'الغاء جميع بيانات الموظف بالنظام', width: 460,
    bodyHtml: `<div class="fields" style="grid-template-columns:70px 1fr"><label>الموظف</label>
      <select id="pe-emp">${emps.map(([v, l]) => `<option value="${v}">${UI.esc(l)}</option>`).join('')}</select></div>`,
    buttons: [
      { label: 'حذف', icon: 'del', onClick: (d) => d.close(+d.root.querySelector('#pe-emp').value || null) },
      { label: 'الغاء', icon: 'cancel', onClick: (d) => d.close(null) },
    ],
  })
  if (!id) return
  const e = DB.one('SELECT * FROM employees WHERE id = ?', [id])
  if (!(await yesNo('تأكيد نهائي', `سيتم حذف الموظف «${UI.esc(e.name_ar)}» وكل حركاته وإجازاته وأذوناته نهائياً. متابعة؟`))) return
  DB.run('BEGIN')
  DB.run('DELETE FROM punches WHERE emp_code = ?', [e.code])
  DB.run('DELETE FROM leaves WHERE employee_id = ?', [id])
  DB.run('DELETE FROM permissions WHERE employee_id = ?', [id])
  DB.run('DELETE FROM employee_shifts WHERE employee_id = ?', [id])
  DB.run('DELETE FROM posted_attendance WHERE employee_id = ?', [id])
  DB.run('DELETE FROM employees WHERE id = ?', [id])
  DB.run('COMMIT')
  DB.audit('الغاء جميع بيانات الموظف', `${e.code} — ${e.name_ar}`)
  await DB.flush()
  UI.message('تم حذف جميع بيانات الموظف')
}
