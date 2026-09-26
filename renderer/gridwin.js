// Generic Apex-Time-style editable grid window (the «مجموعات أوقات الدوام»
// pattern): toolbar مساعدة · [extra] · جديد · حفظ · إهمال · حذف · طباعة · إغلاق,
// rows edited in place, committed with «حفظ», discarded with «إهمال».
//
// cfg = {
//   id, title, table, width?, height?, help?, orderBy?,
//   columns: [{ field, label, width?, type: 'text'|'en'|'check'|'select'|'date'|'time'|'readonly',
//               options?: () => [[value, label]], format?: (v,row) => string, required? }],
//   extraButtons?: [{ key, label, icon, onClick(ctx) }],   // placed after «مساعدة»
//   beforeDelete?: (row) => string|null,                    // return a message to block
//   onRowOpen?: (row) => void,                              // double-click
//   deleteOnly?: true,                                      // list with «حذف» only (no new/edit)
// }
function openGridWindow(cfg) {
  UI.openWindow(cfg.id, cfg.title, { width: cfg.width || 640, height: cfg.height || 360 }, (body, win) => {
    const cols = cfg.columns
    const editable = cols.filter((c) => c.type !== 'readonly')
    let rows = []
    let dirty = false
    let current = 0

    const blankRow = () => Object.fromEntries([['_state', 'blank'], ...cols.map((c) => [c.field, c.type === 'check' ? 0 : ''])])
    const load = () => {
      const fields = ['id', ...new Set(cols.filter((c) => !c.virtual).map((c) => c.field))].join(', ')
      rows = DB.all(`SELECT ${fields} FROM ${cfg.table} ORDER BY ${cfg.orderBy || 'id'}`).map((r) => ({ ...r, _state: 'clean' }))
      dirty = false
      current = Math.min(current, rows.length)
      draw()
    }
    const ctx = {
      get currentRow() { return rows.filter((r) => r._state !== 'deleted')[current] || null },
      reload: load,
      win,
    }

    const bar = UI.toolbar([
      { key: 'help', label: 'مساعدة', icon: 'help', onClick: () => UI.message(cfg.help || 'أدخل البيانات في السطر الفارغ ثم اضغط «حفظ».') },
      ...(cfg.extraButtons || []).map((b) => ({ ...b, onClick: () => b.onClick(ctx) })),
      ...(cfg.deleteOnly ? [] : [
        { key: 'new', label: 'جديد', icon: 'new', onClick: () => { current = rows.filter((r) => r._state !== 'deleted').length; draw(); focusFirst() } },
        { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
        { key: 'undo', label: 'إهمال', icon: 'undo', onClick: load },
      ]),
      { key: 'del', label: 'حذف', icon: 'del', onClick: remove },
      { key: 'print', label: 'طباعة', icon: 'print', onClick: () => window.print() },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: async () => { if (!dirty || (await confirmDiscard())) win.close() } },
    ])
    const head = cols.map((c, i) => `<th ${i === 0 ? 'class="sorted"' : ''} style="${c.width ? `width:${c.width}px` : ''}">${UI.esc(c.label)}</th>`).join('')
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr>
        <th style="width:16px"></th><th style="width:34px">#</th>${head}</tr></thead><tbody></tbody></table></div>`)
    body.append(bar, wrap)
    const tbody = wrap.querySelector('tbody')

    function cell(c, r) {
      const v = r[c.field]
      switch (c.type) {
        case 'readonly': return `<td class="center">${r._state === 'blank' ? '' : UI.esc(c.format ? c.format(v, r) : v)}</td>`
        case 'check': return `<td class="center"><input type="checkbox" data-f="${c.field}" ${v ? 'checked' : ''}></td>`
        case 'select': {
          const opts = (c.options?.() || []).map(([val, lab]) => `<option value="${UI.esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${UI.esc(lab)}</option>`).join('')
          return `<td><select data-f="${c.field}" class="cell-select"><option value=""></option>${opts}</select></td>`
        }
        case 'date': return `<td><input type="date" data-f="${c.field}" value="${UI.esc(v)}" class="cell-date"></td>`
        case 'time': return `<td><input type="text" data-f="${c.field}" dir="ltr" placeholder="00:00" maxlength="5" value="${UI.esc(v)}" class="center"></td>`
        default: return `<td><input type="text" data-f="${c.field}" ${c.type === 'en' ? 'dir="ltr"' : ''} value="${UI.esc(v)}"></td>`
      }
    }

    function draw() {
      tbody.innerHTML = ''
      const all = [...rows.filter((r) => r._state !== 'deleted'), ...(cfg.deleteOnly ? [] : [blankRow()])]
      all.forEach((r, i) => {
        const tr = UI.el(`<tr class="${i === current ? 'current' : ''} ${r._state === 'blank' ? 'new' : ''}">
          <td class="sel"></td><td class="center">${r.id ?? ''}</td>${cols.map((c) => cell(c, r)).join('')}</tr>`)
        tr.addEventListener('mousedown', () => {
          if (current === i) return
          current = i
          tbody.querySelectorAll('tr').forEach((x, j) => x.classList.toggle('current', j === i))
        })
        if (cfg.onRowOpen && r._state !== 'blank') tr.addEventListener('dblclick', () => cfg.onRowOpen(r, ctx))
        tr.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'checkbox' || inp.type === 'date' ? 'change' : 'input', () => {
          const v = inp.type === 'checkbox' ? (inp.checked ? 1 : 0) : inp.value
          if (r._state === 'blank') { r._state = 'new'; rows.push(r) }
          else if (r._state === 'clean') r._state = 'changed'
          r[inp.dataset.f] = v
          dirty = true
        }))
        tbody.appendChild(tr)
      })
    }
    const focusFirst = () => tbody.querySelectorAll('tr')[current]?.querySelector('[data-f]')?.focus()

    async function save() {
      for (const r of rows) {
        if (r._state === 'deleted') continue
        for (const c of cols) {
          if (c.required && !String(r[c.field] ?? '').trim()) return UI.message(`${c.label} مطلوب`)
          if (c.type === 'time' && r[c.field] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r[c.field])) return UI.message(`${c.label}: الوقت يجب أن يكون بصيغة HH:MM`)
        }
      }
      const val = (c, r) => (c.type === 'check' ? (r[c.field] ? 1 : 0) : typeof r[c.field] === 'string' ? r[c.field].trim() : r[c.field] ?? '')
      const saveCols = editable.filter((c) => !c.virtual)
      try {
        DB.run('BEGIN')
        for (const r of rows) {
          if (r._state === 'new') DB.run(`INSERT INTO ${cfg.table} (${saveCols.map((c) => c.field).join(', ')}) VALUES (${saveCols.map(() => '?').join(', ')})`, saveCols.map((c) => val(c, r)))
          else if (r._state === 'changed') DB.run(`UPDATE ${cfg.table} SET ${saveCols.map((c) => `${c.field} = ?`).join(', ')} WHERE id = ?`, [...saveCols.map((c) => val(c, r)), r.id])
          else if (r._state === 'deleted' && r.id) DB.run(`DELETE FROM ${cfg.table} WHERE id = ?`, [r.id])
        }
        DB.run('COMMIT')
      } catch (e) {
        DB.run('ROLLBACK')
        return UI.message(/UNIQUE/.test(e.message) ? 'القيمة مكررة — يوجد سجل بنفس البيانات' : `تعذّر الحفظ: ${e.message}`)
      }
      await DB.flush()
      load()
    }

    async function remove() {
      const r = ctx.currentRow
      if (!r) return
      const block = cfg.beforeDelete?.(r)
      if (block) return UI.message(block)
      const ok = await UI.dialog({ head: 'تأكيد الحذف', bodyHtml: `<div>هل تريد حذف السجل المحدد؟</div>`, width: 340,
        buttons: [{ label: 'نعم', icon: 'ok', onClick: (d) => d.close(true) }, { label: 'لا', icon: 'cancel', onClick: (d) => d.close(false) }] })
      if (!ok) return
      if (r._state === 'new') rows.splice(rows.indexOf(r), 1)
      else r._state = 'deleted'
      await save()
    }

    const confirmDiscard = () => UI.dialog({ head: 'تنبيه', bodyHtml: '<div>توجد تعديلات لم تُحفظ. إغلاق بدون حفظ؟</div>', width: 340,
      buttons: [{ label: 'نعم', icon: 'ok', onClick: (d) => d.close(true) }, { label: 'لا', icon: 'cancel', onClick: (d) => d.close(false) }] })

    load()
  })
}
