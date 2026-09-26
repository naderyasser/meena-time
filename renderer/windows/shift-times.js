// «المواعيد» of a shift group — three editors, one per kind, each with the
// «أيام السنة» / «أيام رمضان» tabs:
//  • normal:   7 days × up to 4 «ورديات» × the 8 terms (+ «شفت ممتد» on the last)
//  • open:     7 days × required hours (+ «يمتد لليوم التالي» until «نهاية اليوم»)
//  • rotating: ordered blocks «عدد أيام الدوام» / «عدد أيام العطله» × up to 4 ورديات
const DAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']
const WIN_NAMES = ['الوردية الاولي', 'الوردية الثانية', 'الوردية الثالثة', 'الوردية الرابعة']
const TIME_FIELDS = [
  ['start_in', 'بداية الحضور'], ['check_in', 'الحضور'], ['late_min', 'التأخير المسموح'], ['end_in', 'نهاية الحضور'],
  ['start_out', 'بداية الانصراف'], ['early_min', 'الانصراف المبكر'], ['check_out', 'الانصراف'], ['end_out', 'نهاية الانصراف'],
]
const ORDER = ['start_in', 'check_in', 'end_in', 'start_out', 'check_out', 'end_out']
const LABEL = Object.fromEntries(TIME_FIELDS)
const isHHMM = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '')
const toMin = (t) => (isHHMM(t) ? +t.slice(0, 2) * 60 + +t.slice(3) : null)
const CAL_TABS = [['Y', 'أيام السنة'], ['R', 'أيام رمضان']]

// Validate an ordered list of ورديات of one day/block. Returns an error or null.
// Times may only go past midnight inside the last وردية when it is «شفت ممتد».
function validateWindows(list, where) {
  let last = -1
  for (let i = 0; i < list.length; i++) {
    const w = list[i], name = `${where} — ${WIN_NAMES[i]}`
    for (const [f, l] of TIME_FIELDS) {
      if (f.endsWith('_min')) { if (!/^\d{0,3}$/.test(String(w[f] ?? ''))) return `${name}: ${l} بالدقائق` }
      else if (!isHHMM(w[f])) return `${name}: ${l} مطلوب بصيغة HH:MM`
    }
    if (w.extended && i !== list.length - 1) return `${name}: «شفت ممتد» مسموح في آخر وردية فقط`
    const abs = {}
    for (const f of ORDER) {
      let m = toMin(w[f])
      if (m < last) {
        if (!w.extended) return `${name}: «${LABEL[f]}» لا يمكن أن يكون قبل الوقت السابق له — فعّل «شفت ممتد» إذا كانت الوردية تمتد لليوم التالي`
        m += 1440
        if (m < last) return `${name}: «${LABEL[f]}» غير صحيح`
      }
      abs[f] = last = m
    }
    if (abs.check_in + (+w.late_min || 0) > abs.end_in) return `${name}: التأخير المسموح يتجاوز نهاية الحضور`
    if (abs.check_out - (+w.early_min || 0) < abs.start_out) return `${name}: الانصراف المبكر يسبق بداية الانصراف`
    if (abs.end_out - abs.start_in >= 1440) return `${name}: مدة الوردية أطول من يوم`
  }
  return null
}
const dayMinutes = (list) => { const r = Engine.resolveWindows(list); return r.reduce((s, w) => s + (w.check_out - w.check_in), 0) }
const windowCells = (w, disabled, attrs = '') => TIME_FIELDS.map(([f]) => {
  const isMin = f.endsWith('_min')
  return `<td><input type="text" data-f="${f}" ${attrs} dir="ltr" class="center" ${disabled ? 'disabled' : ''} placeholder="${disabled ? '_' : isMin ? '0' : '00:00'}"
    maxlength="${isMin ? 3 : 5}" value="${UI.esc(disabled ? '' : w?.[f] ?? '')}"></td>`
}).join('')
const readWindow = (tr) => { const w = {}; tr.querySelectorAll('[data-f]').forEach((i) => (w[i.dataset.f] = i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.value.trim())); return w }

function openShiftTimes(group, onSaved) {
  const g = DB.one('SELECT * FROM shift_groups WHERE id = ?', [group.id])
  if (g.rotational) return openRotationTimes(g, onSaved)
  if (g.open_shift) return openOpenTimes(g, onSaved)
  return openNormalTimes(g, onSaved)
}

// Tabs strip shared by the three editors
function calTabs(onSwitch) {
  const tabs = UI.el(`<div class="tabs">${CAL_TABS.map(([k, l], i) => `<button data-cal="${k}" class="${i === 0 ? 'active' : ''}">${l}</button>`).join('')}</div>`)
  tabs.querySelectorAll('button').forEach((b) => (b.onclick = () => { tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); onSwitch(b.dataset.cal) }))
  return tabs
}

// ── normal ────────────────────────────────────────────────
function openNormalTimes(g, onSaved) {
  UI.openWindow(`shift-times-${g.id}`, `المواعيد — ${g.name_ar}`, { width: 1040, height: 520 }, (body, win) => {
    const load = (cal) => DAYS.map((_, d) => {
      const rows = DB.all('SELECT * FROM shift_windows WHERE group_id = ? AND calendar = ? AND slot = ? ORDER BY window_no', [g.id, cal, d])
      return { day: d, is_off: rows.length ? rows[0].is_off : cal === 'Y' && d === 6 ? 1 : cal === 'R' ? 1 : 0, windows: rows.filter((r) => !r.is_off).length ? rows : [{ late_min: 0, early_min: 0 }] }
    })
    const state = { Y: load('Y'), R: load('R') }
    let cal = 'Y'
    const bar = UI.toolbar([
      { key: 'help', label: 'مساعدة', icon: 'help', onClick: () => UI.message('أدخل الأوقات بنظام 24 ساعة (HH:MM). يمكن إضافة حتى 4 ورديات لليوم من «عدد الورديات»، وآخر وردية يمكن أن تكون «شفت ممتد» لليوم التالي. تبويب «أيام رمضان» يُطبَّق خلال فترات رمضان المعرّفة؛ اتركه عطلة كاملاً لاستخدام مواعيد السنة.') },
      { key: 'copy', label: 'نسخ لكل الأيام', icon: 'new', onClick: () => { sync(); const src = state[cal].find((r) => !r.is_off); if (src) state[cal].forEach((r) => { if (!r.is_off) r.windows = src.windows.map((w) => ({ ...w })) }); draw() } },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const tabs = calTabs((c) => { sync(); cal = c; draw() })
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr>
      <th class="sorted" style="width:74px">اليوم</th><th style="width:60px">الورديات</th><th style="width:96px">الوردية</th>
      ${TIME_FIELDS.map(([, l]) => `<th>${l}</th>`).join('')}<th style="width:46px">شفت ممتد</th><th style="width:40px">عطلة</th></tr></thead><tbody></tbody></table></div>`)
    body.append(bar, tabs, wrap)
    const tbody = wrap.querySelector('tbody')
    function sync() {
      for (const r of state[cal]) {
        const trs = tbody.querySelectorAll(`tr[data-day="${r.day}"]`)
        if (!trs.length || r.is_off) continue
        r.windows = [...trs].map((tr) => readWindow(tr))
      }
    }
    function draw() {
      tbody.innerHTML = ''
      for (const r of state[cal]) {
        const n = r.is_off ? 1 : r.windows.length
        for (let i = 0; i < n; i++) {
          const w = r.windows[i] || {}
          const tr = UI.el(`<tr data-day="${r.day}">
            ${i === 0 ? `<td class="center" rowspan="${n}"><b>${DAYS[r.day]}</b></td>
              <td class="center" rowspan="${n}"><select class="cnt" ${r.is_off ? 'disabled' : ''}>${[1, 2, 3, 4].map((k) => `<option ${k === n ? 'selected' : ''}>${k}</option>`).join('')}</select></td>` : ''}
            <td class="center">${WIN_NAMES[i]}</td>
            ${windowCells(w, r.is_off)}
            <td class="center"><input type="checkbox" data-f="extended" ${w.extended ? 'checked' : ''} ${r.is_off || i !== n - 1 ? 'disabled' : ''}></td>
            ${i === 0 ? `<td class="center" rowspan="${n}"><input type="checkbox" class="off" ${r.is_off ? 'checked' : ''}></td>` : ''}</tr>`)
          tr.querySelector('.cnt')?.addEventListener('change', (e) => { sync(); const k = +e.target.value; while (r.windows.length < k) r.windows.push({ late_min: 0, early_min: 0 }); r.windows.length = k; draw() })
          tr.querySelector('.off')?.addEventListener('change', (e) => { sync(); r.is_off = e.target.checked ? 1 : 0; draw() })
          tbody.appendChild(tr)
        }
      }
    }
    async function save() {
      if (WebSync.blocks('shift_groups')) return
      sync()
      for (const c of ['Y', 'R']) for (const r of state[c]) {
        if (r.is_off) continue
        const err = validateWindows(r.windows, `${c === 'R' ? 'رمضان — ' : ''}${DAYS[r.day]}`)
        if (err) return UI.message(err)
      }
      DB.run('BEGIN')
      DB.run('DELETE FROM shift_windows WHERE group_id = ?', [g.id])
      for (const c of ['Y', 'R']) {
        if (c === 'R' && state.R.every((r) => r.is_off)) continue // no Ramadan timings → year's apply
        for (const r of state[c]) {
          const list = r.is_off ? [{}] : r.windows
          list.forEach((w, i) => DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out, extended)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [g.id, c, r.day, i + 1, r.is_off ? 1 : 0, ...TIME_FIELDS.map(([f]) => (r.is_off ? null : f.endsWith('_min') ? +w[f] || 0 : w[f])), w.extended ? 1 : 0]))
        }
      }
      const total = state.Y.filter((r) => !r.is_off).reduce((s, r) => s + dayMinutes(r.windows), 0)
      DB.run('UPDATE shift_groups SET total_minutes = ? WHERE id = ?', [total, g.id])
      DB.run('COMMIT')
      DB.audit('حفظ المواعيد', g.name_ar)
      await DB.flush()
      onSaved?.()
      UI.message('تم حفظ المواعيد')
    }
    draw()
  })
}

// ── open ──────────────────────────────────────────────────
function openOpenTimes(g, onSaved) {
  UI.openWindow(`shift-times-${g.id}`, `المواعيد — ${g.name_ar} (دوام مفتوح)`, { width: 720, height: 420 }, (body, win) => {
    const load = (cal) => DAYS.map((_, d) => {
      const r = DB.one('SELECT * FROM shift_windows WHERE group_id = ? AND calendar = ? AND slot = ? AND window_no = 1', [g.id, cal, d])
      return r ? { day: d, is_off: r.is_off, required: r.required_min != null ? Engine.hm(r.required_min) : '', ext: r.extends_next_day, day_end: r.day_end || '' }
        : { day: d, is_off: cal === 'R' || d === 6 ? 1 : 0, required: '', ext: 0, day_end: '' }
    })
    const state = { Y: load('Y'), R: load('R') }
    let cal = 'Y'
    const bar = UI.toolbar([
      { key: 'help', label: 'مساعدة', icon: 'help', onClick: () => UI.message('الدوام المفتوح: يُحسب عدد ساعات العمل بين أول وآخر بصمة في اليوم مقارنةً بالساعات المطلوبة. «يمتد لليوم التالي» يسمح باحتساب بصمات بعد منتصف الليل حتى «نهاية اليوم».') },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const tabs = calTabs((c) => { sync(); cal = c; draw() })
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr><th class="sorted" style="width:90px">اليوم</th>
      <th>ساعات العمل المطلوبة</th><th>يمتد لليوم التالي</th><th>نهاية اليوم</th><th style="width:50px">عطلة</th></tr></thead><tbody></tbody></table></div>`)
    body.append(bar, tabs, wrap)
    const tbody = wrap.querySelector('tbody')
    const sync = () => tbody.querySelectorAll('tr').forEach((tr, i) => {
      const r = state[cal][i]
      r.required = tr.querySelector('.req').value.trim(); r.ext = tr.querySelector('.ext').checked ? 1 : 0
      r.day_end = tr.querySelector('.de').value.trim(); r.is_off = tr.querySelector('.off').checked ? 1 : 0
    })
    function draw() {
      tbody.innerHTML = state[cal].map((r) => `<tr><td class="center"><b>${DAYS[r.day]}</b></td>
        <td><input type="text" class="req center" dir="ltr" maxlength="5" placeholder="08:00" value="${UI.esc(r.required)}" ${r.is_off ? 'disabled' : ''}></td>
        <td class="center"><input type="checkbox" class="ext" ${r.ext ? 'checked' : ''} ${r.is_off ? 'disabled' : ''}></td>
        <td><input type="text" class="de center" dir="ltr" maxlength="5" placeholder="04:00" value="${UI.esc(r.day_end)}" ${r.is_off || !r.ext ? 'disabled' : ''}></td>
        <td class="center"><input type="checkbox" class="off" ${r.is_off ? 'checked' : ''}></td></tr>`).join('')
      tbody.querySelectorAll('.off, .ext').forEach((x) => x.addEventListener('change', () => { sync(); draw() }))
    }
    async function save() {
      if (WebSync.blocks('shift_groups')) return
      sync()
      for (const c of ['Y', 'R']) for (const r of state[c]) {
        if (r.is_off) continue
        const where = `${c === 'R' ? 'رمضان — ' : ''}${DAYS[r.day]}`
        if (!isHHMM(r.required) || toMin(r.required) === 0) return UI.message(`${where}: ساعات العمل المطلوبة بصيغة HH:MM`)
        if (r.ext && !isHHMM(r.day_end)) return UI.message(`${where}: نهاية اليوم بصيغة HH:MM`)
      }
      DB.run('BEGIN')
      DB.run('DELETE FROM shift_windows WHERE group_id = ?', [g.id])
      for (const c of ['Y', 'R']) {
        if (c === 'R' && state.R.every((r) => r.is_off)) continue
        for (const r of state[c]) DB.run('INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, required_min, extends_next_day, day_end) VALUES (?,?,?,1,?,?,?,?)',
          [g.id, c, r.day, r.is_off ? 1 : 0, r.is_off ? null : toMin(r.required), r.ext ? 1 : 0, r.ext ? r.day_end : null])
      }
      DB.run('UPDATE shift_groups SET total_minutes = ? WHERE id = ?', [state.Y.filter((r) => !r.is_off).reduce((s, r) => s + toMin(r.required), 0), g.id])
      DB.run('COMMIT')
      DB.audit('حفظ المواعيد', g.name_ar)
      await DB.flush()
      onSaved?.()
      UI.message('تم حفظ المواعيد')
    }
    draw()
  })
}

// ── rotating (Apex «ورديات متغيرة») ─────────────────────────
function openRotationTimes(g, onSaved) {
  UI.openWindow(`shift-times-${g.id}`, `المواعيد — ${g.name_ar} (ورديات متغيرة)`, { width: 1060, height: 560 }, (body, win) => {
    const load = (cal) => {
      const blocks = DB.all('SELECT * FROM rotation_blocks WHERE group_id = ? AND calendar = ? ORDER BY idx', [g.id, cal])
      return blocks.map((b) => ({
        work: b.work_days, rest: b.rest_days,
        slots: [0, 1, 2, 3].map((i) => DB.one('SELECT * FROM shift_windows WHERE group_id = ? AND calendar = ? AND slot = ? AND window_no = ?', [g.id, cal, b.idx, i + 1])),
      }))
    }
    const blank = () => ({ work: '', rest: '', slots: [{ late_min: 0, early_min: 0 }, null, null, null] })
    const state = { Y: load('Y'), R: load('R') }
    if (!state.Y.length) state.Y.push(blank())
    if (!state.R.length) state.R.push(blank())
    let cal = 'Y'
    const bar = UI.toolbar([
      { key: 'help', label: 'مساعدة', icon: 'help', onClick: () => UI.message('كل «مجموعة مواعيد» = عدد أيام دوام بمواعيدها ثم عدد أيام عطلة. تتكرر المجموعات بالترتيب بدءاً من «تاريخ بدء العمل بالدوام». مواعيد رمضان تبدأ دورتها من أول يوم في رمضان؛ اتركها فارغة لاستخدام مواعيد السنة.') },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const tabs = calTabs((c) => { sync(); cal = c; draw() })
    const area = UI.el('<div class="blocks"></div>')
    body.append(bar, tabs, area)
    function sync() {
      area.querySelectorAll('.block').forEach((el, bi) => {
        const b = state[cal][bi]
        b.work = el.querySelector('.work').value.trim(); b.rest = el.querySelector('.rest').value.trim()
        el.querySelectorAll('tbody tr').forEach((tr, i) => { if (b.slots[i]) b.slots[i] = readWindow(tr) })
      })
    }
    function draw() {
      area.innerHTML = ''
      state[cal].forEach((b, bi) => {
        const el = UI.el(`<div class="block"><div class="block-head"><b>مجموعة مواعيد ${bi + 1}</b>
          <label>عدد أيام الدوام <input type="text" class="work num" dir="ltr" maxlength="3" value="${UI.esc(b.work)}"></label>
          <label>عدد أيام العطله <input type="text" class="rest num" dir="ltr" maxlength="3" value="${UI.esc(b.rest)}"></label></div>
          <table class="grid"><thead><tr><th style="width:26px"></th><th class="sorted" style="width:110px">الوردية</th>${TIME_FIELDS.map(([, l]) => `<th>${l}</th>`).join('')}<th style="width:46px">شفت ممتد</th></tr></thead>
          <tbody>${[0, 1, 2, 3].map((i) => {
            const on = !!b.slots[i]
            return `<tr><td class="center">${i === 0 ? '' : `<input type="checkbox" class="en" data-i="${i}" ${on ? 'checked' : ''} ${i > 1 && !b.slots[i - 1] ? 'disabled' : ''}>`}</td>
              <td class="center">${WIN_NAMES[i]}</td>${windowCells(b.slots[i], !on)}
              <td class="center"><input type="checkbox" data-f="extended" ${b.slots[i]?.extended ? 'checked' : ''} ${on ? '' : 'disabled'}></td></tr>`
          }).join('')}</tbody></table></div>`)
        el.querySelectorAll('.en').forEach((cb) => cb.addEventListener('change', () => {
          sync()
          const i = +cb.dataset.i
          if (cb.checked) b.slots[i] = { late_min: 0, early_min: 0 }
          else for (let k = i; k < 4; k++) b.slots[k] = null
          draw()
        }))
        area.appendChild(el)
      })
      const btns = UI.el(`<div class="block-btns"><button class="add">إضافة مجموعة مواعيد</button>${state[cal].length > 1 ? '<button class="del">حذف مجموعة مواعيد</button>' : ''}</div>`)
      btns.querySelector('.add').onclick = () => { sync(); state[cal].push(blank()); draw() }
      btns.querySelector('.del')?.addEventListener('click', () => { sync(); state[cal].pop(); draw() })
      area.appendChild(btns)
    }
    const blankBlock = (b) => !b.work && !b.rest && !b.slots.some((s) => s && ORDER.some((f) => s[f]))
    async function save() {
      if (WebSync.blocks('shift_groups')) return
      sync()
      const out = {}
      for (const c of ['Y', 'R']) {
        const list = state[c].filter((b) => !(c === 'R' && blankBlock(b)))
        if (c === 'Y' && !list.length) return UI.message('أضف مجموعة مواعيد واحدة على الأقل')
        for (const [bi, b] of list.entries()) {
          const where = `${c === 'R' ? 'رمضان — ' : ''}مجموعة مواعيد ${bi + 1}`
          if (!/^\d{1,3}$/.test(b.work) || !/^\d{0,3}$/.test(b.rest)) return UI.message(`${where}: عدد أيام الدوام والعطلة أرقام صحيحة`)
          if (+b.work + +(b.rest || 0) === 0) return UI.message(`${where}: عدد الأيام لا يمكن أن يكون صفراً`)
          if (+b.work > 0) {
            const err = validateWindows(b.slots.filter(Boolean), where)
            if (err) return UI.message(err)
          }
        }
        out[c] = list
      }
      if (out.Y.reduce((s, b) => s + +b.work + +(b.rest || 0), 0) > 366) return UI.message('طول الدورة لا يتجاوز 366 يوماً')
      DB.run('BEGIN')
      DB.run('DELETE FROM shift_windows WHERE group_id = ?', [g.id])
      DB.run('DELETE FROM rotation_blocks WHERE group_id = ?', [g.id])
      for (const c of ['Y', 'R']) out[c].forEach((b, bi) => {
        DB.run('INSERT INTO rotation_blocks (group_id, calendar, idx, work_days, rest_days) VALUES (?,?,?,?,?)', [g.id, c, bi, +b.work, +(b.rest || 0)])
        if (+b.work > 0) b.slots.filter(Boolean).forEach((w, i) => DB.run(`INSERT INTO shift_windows (group_id, calendar, slot, window_no, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out, extended)
          VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?)`, [g.id, c, bi, i + 1, ...TIME_FIELDS.map(([f]) => (f.endsWith('_min') ? +w[f] || 0 : w[f])), w.extended ? 1 : 0]))
      })
      const total = out.Y.reduce((s, b) => s + (+b.work > 0 ? +b.work * dayMinutes(b.slots.filter(Boolean)) : 0), 0)
      DB.run('UPDATE shift_groups SET total_minutes = ? WHERE id = ?', [total, g.id])
      DB.run('COMMIT')
      DB.audit('حفظ المواعيد', g.name_ar)
      await DB.flush()
      onSaved?.()
      UI.message('تم حفظ المواعيد')
    }
    draw()
  })
}
