// «مجموعات أوقات الدوام» — the Apex Time screen shown in the client's video:
// toolbar مساعدة · المواعيد · جديد · حفظ · إهمال · حذف · طباعة · إغلاق and a grid
// # · الاسم العربي · الاسم الأجنبي · الإجمالي · دوام مفتوح. Edits are made in the
// grid and committed with «حفظ»; «إهمال» discards them.
function openShiftGroups() {
  UI.openWindow('shift-groups', 'مجموعات أوقات الدوام', { width: 640, height: 330 }, (body, win) => {
    let rows = []
    let dirty = false
    let current = 0

    const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const load = () => {
      rows = DB.all('SELECT id, name_ar, name_en, total_minutes, open_shift FROM shift_groups ORDER BY id')
        .map((r) => ({ ...r, _state: 'clean' }))
      dirty = false
      current = Math.min(current, rows.length)
      draw()
    }

    const bar = UI.toolbar([
      { key: 'help', label: 'مساعدة', icon: 'help', onClick: () => UI.message('أدخل اسم المجموعة في السطر الفارغ ثم اضغط «حفظ». المواعيد تُحدَّد من زر «المواعيد».') },
      { key: 'times', label: 'المواعيد', icon: 'clock', onClick: () => UI.message('شاشة المواعيد — قيد الإنشاء') },
      { key: 'new', label: 'جديد', icon: 'new', onClick: () => { current = rows.length; draw(); focusName() } },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'undo', label: 'إهمال', icon: 'undo', onClick: load },
      { key: 'del', label: 'حذف', icon: 'del', onClick: remove },
      { key: 'print', label: 'طباعة', icon: 'print', onClick: () => window.print() },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: async () => {
        if (dirty && !(await confirmDiscard())) return
        win.close()
      } },
    ])
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr>
        <th style="width:16px"></th><th style="width:34px">#</th><th class="sorted">الاسم العربي</th>
        <th>الاسم الأجنبي</th><th style="width:80px">الإجمالي</th><th style="width:70px">دوام مفتوح</th>
      </tr></thead><tbody></tbody></table></div>`)
    body.append(bar, wrap)
    const tbody = wrap.querySelector('tbody')

    function draw() {
      tbody.innerHTML = ''
      const all = [...rows.filter((r) => r._state !== 'deleted'), { _state: 'blank', name_ar: '', name_en: '', total_minutes: 0, open_shift: 0 }]
      all.forEach((r, i) => {
        const tr = UI.el(`<tr class="${i === current ? 'current' : ''} ${r._state === 'blank' ? 'new' : ''}">
          <td class="sel"></td><td class="center">${r.id ?? ''}</td>
          <td><input type="text" data-f="name_ar" value="${UI.esc(r.name_ar)}"></td>
          <td><input type="text" data-f="name_en" dir="ltr" value="${UI.esc(r.name_en)}"></td>
          <td class="center">${r._state === 'blank' ? '' : fmt(r.total_minutes)}</td>
          <td class="center"><input type="checkbox" data-f="open_shift" ${r.open_shift ? 'checked' : ''}></td></tr>`)
        tr.addEventListener('mousedown', () => { if (current !== i) { current = i; tbody.querySelectorAll('tr').forEach((x, j) => x.classList.toggle('current', j === i)) } })
        tr.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('input', () => {
          const f = inp.dataset.f
          const v = inp.type === 'checkbox' ? (inp.checked ? 1 : 0) : inp.value
          if (r._state === 'blank') { r._state = 'new'; rows.push(r) }
          else if (r._state === 'clean') r._state = 'changed'
          r[f] = v
          dirty = true
        }))
        tbody.appendChild(tr)
      })
    }
    const focusName = () => tbody.querySelectorAll('tr')[current]?.querySelector('[data-f=name_ar]')?.focus()

    async function save() {
      const bad = rows.find((r) => r._state !== 'deleted' && !String(r.name_ar || '').trim())
      if (bad) return UI.message('الاسم العربي مطلوب')
      for (const r of rows) {
        if (r._state === 'new') DB.run('INSERT INTO shift_groups (name_ar, name_en, open_shift) VALUES (?, ?, ?)', [r.name_ar.trim(), (r.name_en || '').trim(), r.open_shift ? 1 : 0])
        else if (r._state === 'changed') DB.run('UPDATE shift_groups SET name_ar = ?, name_en = ?, open_shift = ? WHERE id = ?', [r.name_ar.trim(), (r.name_en || '').trim(), r.open_shift ? 1 : 0, r.id])
        else if (r._state === 'deleted' && r.id) DB.run('DELETE FROM shift_groups WHERE id = ?', [r.id])
      }
      await DB.flush()
      load()
    }

    async function remove() {
      const visible = rows.filter((r) => r._state !== 'deleted')
      const r = visible[current]
      if (!r) return
      const ok = await UI.dialog({ head: 'تأكيد الحذف', bodyHtml: `<div>هل تريد حذف «${UI.esc(r.name_ar)}»؟</div>`, width: 340,
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
