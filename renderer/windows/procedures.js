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

// Store read punches. Like Apex: a punch of an unknown number creates the employee
// («موظف جديد» / New Employee — complete the name and shift in «الموظفين»), except while
// the site owns the employee list (linked) or the trial's employee limit is reached.
// Optional period {from, to} keeps only punches inside it (Apex «الفترة»).
async function storePunches(list, source, deviceId = null, { from = null, to = null, autoCreate = true } = {}) {
  const known = new Set(DB.all('SELECT code FROM employees').map((e) => e.code))
  let added = 0, dup = 0, unknown = 0, posted = 0, outside = 0, created = 0
  const canCreate = autoCreate && !WebSync.linked
  DB.run('BEGIN')
  for (const p of list) {
    const day = p.ts.slice(0, 10)
    if ((from && day < from) || (to && day > to)) { outside++; continue }
    if (!known.has(p.code)) {
      const n = DB.one('SELECT COUNT(*) AS n FROM employees').n
      if (!canCreate || (!licence.ok && n >= Trial.MAX_EMPLOYEES)) { unknown++; continue }
      DB.run("INSERT INTO employees (code, name_ar, name_en, status) VALUES (?, 'موظف جديد', 'New Employee', 'نشط')", [p.code])
      known.add(p.code); created++
    }
    if (Engine.isPosted(day)) { posted++; continue }
    if (DB.one('SELECT 1 FROM web_deleted WHERE emp_code = ? AND ts = ?', [p.code, p.ts])) { dup++; continue } // deleted on the site
    DB.run('INSERT OR IGNORE INTO punches (emp_code, ts, source, device_id) VALUES (?, ?, ?, ?)', [p.code, p.ts, source, deviceId])
    if (DB.one('SELECT changes() AS c').c > 0) added++
    else dup++
  }
  DB.run('COMMIT')
  if (created) DB.audit('موظفين جدد من الحركات', `${created}`, 'أضيفوا تلقائياً عند قراءة الحركات')
  await DB.flush()
  if (added && WebSync.linked) WebSync.sync({ quiet: true }) // send them to the site
  return { added, dup, unknown, posted, outside, created, total: list.length,
    text: `تمت قراءة ${list.length} حركة: جديدة ${added} · مكررة ${dup}` + (created ? ` · موظفين جدد ${created} (أكمل بياناتهم من «الموظفين»)` : '') +
      (unknown ? ` · لأرقام غير معرّفة ${unknown}` : '') + (posted ? ` · في فترة مرحّلة ${posted}` : '') + (outside ? ` · خارج الفترة ${outside}` : '') }
}

// «قراءة الحركات (شبكة - ملف)» — Apex's window: الفترة, the devices (tick several, status
// light), punch files (several at once), «عدد الحركات».
function openReadPunches() {
  UI.openWindow('read-punches', 'قراءة الحركات من جهاز بالشبكة', { width: 900, height: 470 }, (body, win) => {
    const devices = DB.all('SELECT * FROM devices ORDER BY id')
    let files = []
    const bar = UI.toolbar([{ key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() }])
    const view = UI.el(`<div class="read-punches">
      <fieldset class="per"><legend>الفتـــرة</legend><label>مـــن</label><input type="date" id="rp-from" value="${monthStart()}"><label>إلـــى</label><input type="date" id="rp-to" value="${Engine.today()}"></fieldset>
      <div class="cols">
        <fieldset class="devs"><legend>سـحب بيانـات الاجـهزة بالـشبكة</legend>
          <div class="grid-wrap"><table class="grid"><thead><tr><th style="width:28px"><input type="checkbox" id="rp-all"></th><th style="width:50px">الرقم</th><th>الجهاز</th><th style="width:40px"></th></tr></thead>
          <tbody>${devices.map((d) => `<tr data-id="${d.id}"><td class="center"><input type="checkbox" class="rp-dev" value="${d.id}"></td><td class="center">${d.id}</td><td>${UI.esc(d.name)} <span class="ip" dir="ltr">${UI.esc(d.ip || '')}</span></td><td class="center st" title="جاري الفحص…">…</td></tr>`).join('')
            || '<tr><td colspan="4" class="empty">عرّف الجهاز أولاً من «البيانات الأساسية ← تعريف الأجهزة»</td></tr>'}</tbody></table></div>
          <button id="rp-read-dev">${ICONS.save || ''}<span>قراءة بيانات الجهاز</span></button>
        </fieldset>
        <fieldset class="files"><legend>قراءة البيانات من ملفات الحركات</legend>
          <div class="file-box"><div class="fbtns"><label class="fadd" title="اضافة ملف">${ICONS.new || '+'}<input type="file" id="rp-file" accept=".txt,.dat,.csv,.log" multiple hidden></label><button id="rp-frem" title="حذف الملف المحدد">${ICONS.del || '×'}</button></div>
            <div class="grid-wrap"><table class="grid"><thead><tr><th>المسار</th></tr></thead><tbody id="rp-flist"></tbody></table></div></div>
          <button id="rp-read-file">${ICONS.save || ''}<span>قراءة ملف الحركات</span></button>
        </fieldset>
      </div>
      <fieldset class="count"><label>عدد الحركات</label><input type="text" id="rp-count" readonly><span id="rp-msg"></span></fieldset>
    </div>`)
    body.append(bar, view)
    const $ = (s) => view.querySelector(s)
    const period = () => {
      const from = $('#rp-from').value, to = $('#rp-to').value
      if (!from || !to || from > to) { UI.message('فترة غير صحيحة'); return null }
      return { from, to }
    }
    const show = (res) => { $('#rp-count').value = res.added; $('#rp-msg').textContent = res.text }
    // status lights: green = reachable on the network, red = not
    for (const d of devices) window.bridge.pingDevice?.({ ip: d.ip, port: +d.port || 4370 }).then((ok) => {
      const td = view.querySelector(`tr[data-id="${d.id}"] .st`)
      if (td) { td.innerHTML = ok ? '<span class="dot on">✔</span>' : '<span class="dot off">✖</span>'; td.title = ok ? 'الجهاز متصل' : 'الجهاز غير متصل' }
    })
    $('#rp-all')?.addEventListener('change', (e) => view.querySelectorAll('.rp-dev').forEach((c) => { c.checked = e.target.checked }))
    $('#rp-read-dev').onclick = async () => {
      const per = period(); if (!per) return
      const ids = [...view.querySelectorAll('.rp-dev:checked')].map((c) => +c.value)
      if (!ids.length) return UI.message(devices.length ? 'حدد جهازاً واحداً على الأقل' : 'عرّف الجهاز أولاً من «البيانات الأساسية ← تعريف الأجهزة»')
      const total = { added: 0, texts: [] }
      for (const id of ids) {
        const dev = devices.find((x) => x.id === id)
        $('#rp-msg').textContent = `جاري الاتصال بالجهاز ${dev.name}…`
        const res = await window.bridge.readDevice({ ip: dev.ip, port: +dev.port || 4370 })
        if (!res.ok) { total.texts.push(`${dev.name}: ${res.error || 'تعذّر الاتصال بالجهاز'}`); continue }
        const r = await storePunches(res.punches, 'device', id, per)
        total.added += r.added; total.texts.push(`${dev.name}: ${r.text}`)
      }
      show({ added: total.added, text: total.texts.join(' — ') })
      DB.audit('قراءة الحركات', 'أجهزة', total.texts.join(' | '))
    }
    const drawFiles = () => { $('#rp-flist').innerHTML = files.map((f, i) => `<tr data-i="${i}"><td dir="ltr">${UI.esc(f.name)}</td></tr>`).join('') }
    $('#rp-file').addEventListener('change', (e) => { files = [...files, ...e.target.files]; e.target.value = ''; drawFiles() })
    $('#rp-flist').addEventListener('mousedown', (e) => { const tr = e.target.closest('tr'); if (!tr) return; $('#rp-flist').querySelectorAll('tr').forEach((x) => x.classList.toggle('current', x === tr)) })
    $('#rp-frem').onclick = () => { const tr = $('#rp-flist tr.current'); if (!tr) return UI.message('حدد ملفاً من القائمة'); files.splice(+tr.dataset.i, 1); drawFiles() }
    $('#rp-read-file').onclick = async () => {
      const per = period(); if (!per) return
      if (!files.length) return UI.message('اختر ملف الحركات')
      const list = []
      for (const f of files) list.push(...parsePunchFile(await f.text()))
      if (!list.length) return UI.message('لم يتم التعرف على أي حركة في الملف')
      const r = await storePunches(list, 'file', null, per)
      show(r)
      DB.audit('قراءة الحركات', `${files.length} ملف`, r.text)
    }
  })
}

// Apex asks for a password before touching punches / deleting data. We ask for the
// signed-in user's own password (the cloud version's «كلمة مرور المسؤول»).
async function askPassword(head = 'كلمة المرور') {
  return UI.dialog({
    head, width: 380,
    bodyHtml: '<div class="fields" style="grid-template-columns:90px 1fr"><label>كلمة المرور</label><input type="password" id="ap-pw"></div>',
    buttons: [
      { label: 'موافق', icon: 'ok', onClick: async (d) => {
        const u = DB.one('SELECT password FROM users WHERE id = ?', [Session.userId])
        if (!u || !(await checkPassword(u.password, d.root.querySelector('#ap-pw').value))) return d.error('كلمة المرور غير صحيحة')
        d.close(true)
      } },
      { label: 'الغاء', icon: 'cancel', onClick: (d) => d.close(false) },
    ],
  })
}
const DAY_AR = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']

// «عرض الحركات» — Apex's «استعراض بيانات آله الحضور و الانصراف»: one day, departments
// tree, السابق / التاريخ / التالي, حضور · انصراف · مرحل · معدل · مضاف; double-click edits.
function openViewPunches() {
  UI.openWindow('view-punches', 'عرض الحركات', { width: 980, height: 520 }, (body, win) => {
    let date = Engine.today(), dep = null, q = '', current = null
    const bar = UI.toolbar([
      { key: 'search', label: 'بحـث', icon: 'undo', onClick: () => search.focus() },
      { key: 'add', label: 'إضافة حركة', icon: 'new', onClick: () => openEditPunches({ empId: current?.id, date }, load) },
      { key: 'undo', label: 'إهمال', icon: 'cancel', onClick: () => { q = ''; search.value = ''; load() } },
      { key: 'print', label: 'طباعة', icon: 'print', onClick: () => UI.printGrid(`عرض الحركات — ${date}`, body) },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const search = UI.el('<input type="text" placeholder="بحث برقم الموظف أو اسمه" class="bar-search">')
    search.addEventListener('input', () => { q = search.value.trim(); load() })
    bar.appendChild(search)
    const tree = UI.deptTree((id, name) => { dep = id; band.textContent = id ? name : 'كل الأقسام'; load() })
    const band = UI.el('<div class="band">كل الأقسام</div>')
    const nav = UI.el(`<div class="day-nav"><span id="vp-day"></span>
      <button id="vp-prev">➜ <span>السابق</span></button><input type="date" id="vp-date"><button id="vp-next"><span>التالي</span> ⬅</button></div>`)
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr><th style="width:16px"></th><th style="width:90px" class="sorted">رقم الموظف</th><th>اسم الموظف</th>
      <th style="width:80px">حضور</th><th style="width:80px">انصراف</th><th style="width:55px">مرحل</th><th style="width:55px">معدل</th><th style="width:55px">مضاف</th></tr></thead><tbody></tbody></table></div>`)
    const main = UI.el('<div class="main-col"></div>')
    main.append(band, nav, wrap)
    const layout = UI.el('<div class="with-tree"></div>')
    layout.append(main, tree)
    body.append(bar, layout)
    const tb = wrap.querySelector('tbody'), $ = (s) => nav.querySelector(s)
    const go = (n) => { date = Engine.addDays(date, n); load() }
    $('#vp-prev').onclick = () => go(-1); $('#vp-next').onclick = () => go(1)
    $('#vp-date').addEventListener('change', (e) => { if (e.target.value) { date = e.target.value; load() } })
    function load() {
      $('#vp-date').value = date
      $('#vp-day').textContent = `${DAY_AR[Engine.DAY_INDEX(date)]} ${date}`
      const ids = UI.deptIds(dep), like = `%${q}%`
      const emps = DB.all(`SELECT * FROM employees WHERE status = 'نشط' ${ids ? `AND (department_id IN (${ids}) OR section_id IN (${ids}))` : ''}
        AND (? = '' OR code LIKE ? OR name_ar LIKE ?) ORDER BY CAST(code AS INTEGER), code`, [q, like, like])
      const posted = Engine.isPosted(date)
      const byCode = {}
      for (const p of DB.all('SELECT * FROM punches WHERE ts >= ? AND ts < ? ORDER BY ts', [date, Engine.addDays(date, 1)])) (byCode[p.emp_code] ||= []).push(p)
      const chk = (on) => `<input type="checkbox" disabled ${on ? 'checked' : ''}>`
      tb.innerHTML = ''
      current = null
      for (const e of emps) {
        const ps = byCode[e.code] || []
        const tr = UI.el(`<tr><td class="sel"></td><td class="center">${UI.esc(e.code)}</td><td>${UI.esc(e.name_ar)}</td>
          <td class="center">${ps[0]?.ts.slice(11, 16) || ''}</td><td class="center">${ps.length > 1 ? ps.at(-1).ts.slice(11, 16) : ''}</td>
          <td class="center">${chk(posted)}</td><td class="center">${chk(ps.some((p) => p.orig_ts))}</td><td class="center">${chk(ps.some((p) => p.source === 'manual' && !p.orig_ts))}</td></tr>`)
        tr.addEventListener('mousedown', () => { tb.querySelectorAll('tr').forEach((x) => x.classList.remove('current')); tr.classList.add('current'); current = e })
        tr.addEventListener('dblclick', () => openEditPunches({ empId: e.id, date }, load))
        tb.appendChild(tr)
      }
    }
    load()
  })
}

// «إضافة وتعديل حركات موظف» (Apex): كلمة السر · employee by number or name · date · notes ·
// «مواعيد الحضور» as حضور/انصراف pairs with مرحل / معدل / مضاف. Editing a time keeps the
// device time it replaced (orig_ts → «معدل»); a new pair is «مضاف». Posted days are locked.
function openEditPunches({ empId = null, date = Engine.today() } = {}, onDone = null) {
  UI.openWindow('edit-punches', 'إضافة وتعديل حركات موظف', { width: 720, height: 560 }, (body, win) => {
    let rows = [], selected = -1
    const bar = UI.toolbar([
      { key: 'add', label: 'إضافة', icon: 'new', onClick: () => { rows.push({ in: '', out: '', new: true }); draw(); } },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'del', label: 'حذف', icon: 'del', onClick: delRow },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const emps = DB.all("SELECT id, code, name_ar FROM employees ORDER BY CAST(code AS INTEGER), code")
    const view = UI.el(`<div class="edit-punches">
      <fieldset class="pw"><label>كلمة السر</label><input type="password" id="ep-pw"></fieldset>
      <fieldset><legend>بيانات الموظف</legend><div class="fields" style="grid-template-columns:110px 110px 1fr">
        <label>رقم الموظف</label><input type="text" id="ep-code" dir="ltr"><select id="ep-emp"><option value=""></option>${emps.map((e) => `<option value="${e.id}">${UI.esc(e.name_ar)}</option>`).join('')}</select>
        <label>التاريخ</label><input type="date" id="ep-date" value="${date}"><span></span>
        <label>ملاحظات</label><input type="text" id="ep-notes" style="grid-column: span 2"></div></fieldset>
      <fieldset class="times"><legend>مواعيد الحضور</legend><div class="grid-wrap"><table class="grid"><thead><tr><th style="width:16px"></th><th class="sorted">حضور</th><th>انصراف</th><th style="width:60px">مرحل</th><th style="width:60px">معدل</th><th style="width:60px">مضاف</th></tr></thead><tbody></tbody></table></div></fieldset>
    </div>`)
    body.append(bar, view)
    const $ = (s) => view.querySelector(s), tb = view.querySelector('tbody')
    const emp = () => emps.find((e) => e.id === +$('#ep-emp').value)
    $('#ep-code').addEventListener('change', () => { const e = emps.find((x) => x.code === $('#ep-code').value.trim()); $('#ep-emp').value = e ? e.id : ''; load() })
    $('#ep-emp').addEventListener('change', () => { $('#ep-code').value = emp()?.code || ''; load() })
    $('#ep-date').addEventListener('change', load)
    function load() {
      const e = emp(), d = $('#ep-date').value
      rows = []; selected = -1
      if (e && d) {
        const ps = DB.all('SELECT * FROM punches WHERE emp_code = ? AND ts >= ? AND ts < ? ORDER BY ts', [e.code, d, Engine.addDays(d, 1)])
        for (let i = 0; i < ps.length; i += 2) rows.push({ in: ps[i].ts.slice(11, 16), out: ps[i + 1]?.ts.slice(11, 16) || '', pin: ps[i], pout: ps[i + 1] })
        $('#ep-notes').value = DB.one('SELECT notes FROM punch_notes WHERE emp_code = ? AND date = ?', [e.code, d])?.notes || ''
      }
      draw()
    }
    function draw() {
      const posted = Engine.isPosted($('#ep-date').value)
      const flag = (on) => `<input type="checkbox" disabled ${on ? 'checked' : ''}>`
      tb.innerHTML = rows.map((r, i) => `<tr data-i="${i}" class="${i === selected ? 'current' : ''}"><td class="sel"></td>
        <td class="center"><input type="text" class="t-in" dir="ltr" maxlength="5" value="${r.in}" ${posted ? 'disabled' : ''}></td>
        <td class="center"><input type="text" class="t-out" dir="ltr" maxlength="5" value="${r.out}" ${posted ? 'disabled' : ''}></td>
        <td class="center">${flag(posted)}</td><td class="center">${flag(r.pin?.orig_ts || r.pout?.orig_ts)}</td>
        <td class="center">${flag(r.new || (r.pin?.source === 'manual' && !r.pin?.orig_ts))}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">لا توجد حركات — «إضافة» لإدخال حضور وانصراف</td></tr>'
      tb.querySelectorAll('tr[data-i]').forEach((tr) => tr.addEventListener('mousedown', () => { selected = +tr.dataset.i; tb.querySelectorAll('tr').forEach((x) => x.classList.toggle('current', x === tr)) }))
      tb.querySelectorAll('.t-in, .t-out').forEach((inp) => inp.addEventListener('input', () => { rows[+inp.closest('tr').dataset.i][inp.classList.contains('t-in') ? 'in' : 'out'] = inp.value.trim() }))
    }
    const okTime = (t) => !t || /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
    async function checkPw() {
      const u = DB.one('SELECT password FROM users WHERE id = ?', [Session.userId])
      if (u && (await checkPassword(u.password, $('#ep-pw').value))) return true
      UI.message('كلمة السر غير صحيحة'); return false
    }
    async function save() {
      const e = emp(), d = $('#ep-date').value
      if (!e) return UI.message('اختر الموظف')
      if (!d) return UI.message('حدد التاريخ')
      if (Engine.isPosted(d)) return UI.message('الحركات مرحّلة — الغِ الترحيل أولاً من «الغاء ترحيل الحركات»')
      if (rows.some((r) => !okTime(r.in) || !okTime(r.out))) return UI.message('الوقت بصيغة HH:MM')
      if (!(await checkPw())) return
      DB.run('BEGIN')
      const put = (old, t) => {
        const ts = t ? `${d} ${t}:00` : null
        if (old && (!ts || old.ts.slice(0, 16) === ts.slice(0, 16))) { if (!ts) DB.run('DELETE FROM punches WHERE id = ?', [old.id]); return }
        if (old) { // edited: keep the time it replaced (first edit only)
          DB.run("UPDATE punches SET ts = ?, source = 'manual', orig_ts = COALESCE(orig_ts, ?) WHERE id = ?", [ts, old.ts, old.id])
        } else if (ts) {
          DB.run("INSERT OR IGNORE INTO punches (emp_code, ts, source) VALUES (?, ?, 'manual')", [e.code, ts])
          DB.run('DELETE FROM web_deleted WHERE emp_code = ? AND ts = ?', [e.code, ts]) // entered by hand on purpose
        }
      }
      try {
        for (const r of rows) { put(r.pin, r.in); put(r.pout, r.out) }
        DB.run('INSERT INTO punch_notes (emp_code, date, notes) VALUES (?, ?, ?) ON CONFLICT(emp_code, date) DO UPDATE SET notes = excluded.notes', [e.code, d, $('#ep-notes').value.trim()])
        DB.run('COMMIT')
      } catch (err) { DB.run('ROLLBACK'); return UI.message(`تعذّر الحفظ: ${err.message}`) }
      DB.audit('تعديل حركات موظف', `${e.code} — ${e.name_ar}`, d)
      await DB.flush()
      if (WebSync.linked) WebSync.sync({ quiet: true })
      load(); onDone?.()
      UI.message('تم الحفظ')
    }
    async function delRow() {
      const e = emp(), d = $('#ep-date').value
      if (selected < 0 || !rows[selected]) return UI.message('اختر الحركة')
      if (Engine.isPosted(d)) return UI.message('الحركات مرحّلة — الغِ الترحيل أولاً')
      const r = rows[selected]
      if (WebSync.linked && [r.pin, r.pout].some((x) => x?.web_id && x.web_id !== 'dup')) return UI.message('هذه الحركة موجودة على الموقع — احذفها من الموقع وستُحذف هنا عند المزامنة')
      if (!(await checkPw())) return
      if (!(await yesNo('تأكيد', 'حذف الحضور والانصراف المحددين؟'))) return
      for (const x of [r.pin, r.pout]) if (x) DB.run('DELETE FROM punches WHERE id = ?', [x.id])
      DB.audit('حذف حركة', `${e.code} — ${e.name_ar}`, d)
      await DB.flush()
      load(); onDone?.()
    }
    if (empId) { $('#ep-emp').value = empId; $('#ep-code').value = emp()?.code || '' }
    load()
  })
}

async function deletePunchesInPeriod(sources, title) {
  const p = await periodDialog(title, {
    extra: `<label>من رقم موظف</label><input type="text" id="pd-cf" dir="ltr" placeholder="الكل"><label>إلى رقم موظف</label><input type="text" id="pd-ct" dir="ltr" placeholder="الكل">`,
    read: (root) => {
      const cf = root.querySelector('#pd-cf').value.trim(), ct = root.querySelector('#pd-ct').value.trim()
      if ((cf && !/^\d+$/.test(cf)) || (ct && !/^\d+$/.test(ct))) { UI.message('أرقام الموظفين: أرقام فقط'); return false }
      return { cf, ct }
    },
  })
  if (!p) return
  if (DB.one('SELECT 1 FROM posted_periods WHERE from_date <= ? AND to_date >= ? LIMIT 1', [p.to, p.from])) return UI.message('الفترة تتداخل مع فترة مرحّلة — الغِ الترحيل أولاً')
  // while linked, punches already on the site are deleted there (they follow here on the next sync)
  const codes = (p.cf ? ` AND CAST(emp_code AS INTEGER) >= ${+p.cf}` : '') + (p.ct ? ` AND CAST(emp_code AS INTEGER) <= ${+p.ct}` : '')
  const where = `ts BETWEEN ? AND ? AND source IN (${sources.map(() => '?').join(',')})${codes}${WebSync.linked ? " AND (web_id IS NULL OR web_id = 'dup')" : ''}`
  const n = DB.one(`SELECT COUNT(*) AS n FROM punches WHERE ${where}`, [p.from, p.to + ' 99', ...sources]).n
  if (!n) return UI.message('لا توجد حركات في هذه الفترة')
  if (!(await askPassword(title))) return
  if (!(await yesNo('تأكيد', `سيتم حذف ${n} حركة. متابعة؟`))) return
  DB.run(`DELETE FROM punches WHERE ${where}`, [p.from, p.to + ' 99', ...sources])
  DB.audit(title, `${p.from} → ${p.to}${p.cf || p.ct ? ` · أرقام ${p.cf || '…'}–${p.ct || '…'}` : ''}`, `${n} حركة`)
  await DB.flush()
  UI.message(`تم حذف ${n} حركة`)
}

function openLeaves() {
  openGridWindow({
    id: 'leaves', title: 'إضافة إجازات لموظف', table: 'leaves', orderBy: 'from_date DESC', width: 780,
    // Apex: a leave can be given to a whole «مجموعة موظفين» at once
    extraButtons: [{ key: 'group', label: 'إجازة لمجموعة', icon: 'people', onClick: (ctx) => groupLeave(ctx) }],
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
  const range = await UI.dialog({
    head: 'الغاء جميع بيانات الموظف بالنظام', width: 460,
    bodyHtml: `<div class="fields" style="grid-template-columns:110px 1fr"><label>من رقم موظف</label><input type="text" id="pe-from" dir="ltr">
      <label>إلى رقم موظف</label><input type="text" id="pe-to" dir="ltr" placeholder="نفس الرقم لموظف واحد"></div>`,
    buttons: [
      { label: 'الغاء البيانات', icon: 'del', onClick: (d) => {
        const f = d.root.querySelector('#pe-from').value.trim(), t = d.root.querySelector('#pe-to').value.trim() || f
        if (!/^\d+$/.test(f) || !/^\d+$/.test(t) || +t < +f) return d.error('أدخل رقم الموظف (أو من رقم إلى رقم)')
        d.close({ f: +f, t: +t })
      } },
      { label: 'الغاء', icon: 'cancel', onClick: (d) => d.close(null) },
    ],
  })
  if (!range) return
  const emps = DB.all('SELECT * FROM employees WHERE CAST(code AS INTEGER) BETWEEN ? AND ? ORDER BY CAST(code AS INTEGER)', [range.f, range.t])
  if (!emps.length) return UI.message('لا يوجد موظفين بهذه الأرقام')
  if (!(await askPassword('الغاء بيانات موظف'))) return
  if (!(await yesNo('تأكيد نهائي', `سيتم حذف ${emps.length} موظف (${emps.slice(0, 5).map((e) => UI.esc(e.name_ar)).join('، ')}${emps.length > 5 ? '…' : ''}) وكل حركاتهم وإجازاتهم وأذوناتهم نهائياً. هل انت متأكد؟`))) return
  DB.run('BEGIN')
  for (const e of emps) {
    DB.run('DELETE FROM punches WHERE emp_code = ?', [e.code])
    DB.run('DELETE FROM punch_notes WHERE emp_code = ?', [e.code])
    DB.run('DELETE FROM leaves WHERE employee_id = ?', [e.id])
    DB.run('DELETE FROM permissions WHERE employee_id = ?', [e.id])
    DB.run('DELETE FROM employee_shifts WHERE employee_id = ?', [e.id])
    DB.run('DELETE FROM posted_attendance WHERE employee_id = ?', [e.id])
    DB.run('DELETE FROM employees WHERE id = ?', [e.id])
  }
  DB.run('COMMIT')
  DB.audit('الغاء جميع بيانات الموظف', emps.map((e) => `${e.code} — ${e.name_ar}`).join('، '))
  await DB.flush()
  UI.message(`تم حذف جميع بيانات ${emps.length} موظف`)
}

async function groupLeave(ctx) {
  if (WebSync.blocks('leaves')) return
  const groups = DB.all('SELECT id, name_ar FROM employee_groups ORDER BY name_ar')
  if (!groups.length) return UI.message('عرّف مجموعات الموظفين أولاً من «البيانات الأساسية ← مجموعات الموظفين»')
  const types = listOptions('leave')()
  const r = await UI.dialog({
    head: 'إجازة لمجموعة موظفين', width: 460,
    bodyHtml: `<div class="fields" style="grid-template-columns:110px 1fr">
      <label>المجموعة</label><select id="gl-g">${groups.map((g) => `<option value="${g.id}">${UI.esc(g.name_ar)}</option>`).join('')}</select>
      <label>نوع الإجازة</label><select id="gl-t"><option value=""></option>${types.map(([v, l]) => `<option value="${v}">${UI.esc(l)}</option>`).join('')}</select>
      <label>من تاريخ</label><input type="date" id="gl-f" value="${Engine.today()}"><label>إلى تاريخ</label><input type="date" id="gl-to" value="${Engine.today()}">
      <label>ملاحظات</label><input type="text" id="gl-n"></div>`,
    buttons: [
      { label: 'حفظ', icon: 'save', onClick: (d) => {
        const v = (id) => d.root.querySelector(id).value
        if (!v('#gl-f') || !v('#gl-to') || v('#gl-f') > v('#gl-to')) return d.error('فترة غير صحيحة')
        d.close({ g: +v('#gl-g'), t: +v('#gl-t') || null, f: v('#gl-f'), to: v('#gl-to'), n: v('#gl-n').trim() })
      } },
      { label: 'الغاء', icon: 'cancel', onClick: (d) => d.close(null) },
    ],
  })
  if (!r) return
  const emps = DB.all("SELECT id FROM employees WHERE group_id = ? AND status = 'نشط'", [r.g])
  if (!emps.length) return UI.message('لا يوجد موظفين نشطين في هذه المجموعة')
  DB.run('BEGIN')
  for (const e of emps) DB.run('INSERT INTO leaves (employee_id, type_id, from_date, to_date, notes) VALUES (?, ?, ?, ?, ?)', [e.id, r.t, r.f, r.to, r.n])
  DB.run('COMMIT')
  DB.audit('إجازة لمجموعة', `${emps.length} موظف`, `${r.f} → ${r.to}`)
  await DB.flush()
  ctx.reload()
  UI.message(`تمت إضافة الإجازة لـ ${emps.length} موظف`)
}
