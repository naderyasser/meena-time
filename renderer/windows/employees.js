// «الموظفين»: a read-only list (search + toolbar) and the employee form window,
// fields taken from Apex's employee form (تعريف الموظف · معلومات الموظف ·
// معلومات شخصية · إعدادات إحتساب الإضافي). «كود الموظف» is also the employee's
// number on the fingerprint device.
const EMP_STATUSES = ['نشط', 'غير نشط', 'موقوف', 'منتهي']

function openEmployees() {
  UI.openWindow('employees', 'الموظفين', { width: 860, height: 420 }, (body, win) => {
    let current = null
    let q = ''
    const bar = UI.toolbar([
      { key: 'help', label: 'مساعدة', icon: 'help', onClick: () => UI.message('«جديد» لإضافة موظف، واضغط مرتين على الموظف لتعديله.') },
      { key: 'new', label: 'جديد', icon: 'new', onClick: () => openEmployeeForm(null, load) },
      { key: 'edit', label: 'تعديل', icon: 'undo', onClick: () => (current ? openEmployeeForm(current, load) : UI.message('اختر موظفاً')) },
      { key: 'del', label: 'حذف', icon: 'del', onClick: remove },
      { key: 'print', label: 'طباعة', icon: 'print', onClick: () => UI.printGrid('الموظفين', body) },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const search = UI.el('<input type="text" placeholder="بحث بالكود أو الاسم" style="margin-inline-start:auto;width:220px;font:inherit;padding:3px 6px;border:1px solid #aeb7c0">')
    search.addEventListener('input', () => { q = search.value.trim(); load() })
    bar.appendChild(search)
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr><th style="width:16px"></th>
      <th style="width:70px">الكود</th><th class="sorted">اسم الموظف</th><th>الإدارة</th><th>القسم</th>
      <th>الدوام</th><th style="width:70px">الحالة</th></tr></thead><tbody></tbody></table></div>`)
    const count = UI.el('<div style="padding:2px 8px;font-size:12px;color:#333"></div>')
    body.append(bar, wrap, count)
    const tbody = wrap.querySelector('tbody')

    function load() {
      const like = `%${q}%`
      const rows = DB.all(`SELECT e.*, d.name_ar AS dep, s.name_ar AS sec, g.name_ar AS shift
        FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN departments s ON s.id = e.section_id
        LEFT JOIN shift_groups g ON g.id = e.shift_group_id
        WHERE (? = '' OR e.code LIKE ? OR e.name_ar LIKE ? OR e.name_en LIKE ?) ORDER BY CAST(e.code AS INTEGER), e.code`, [q, like, like, like])
      tbody.innerHTML = ''
      current = null
      for (const r of rows) {
        const tr = UI.el(`<tr><td class="sel"></td><td class="center">${UI.esc(r.code)}</td><td>${UI.esc(r.name_ar)}</td>
          <td>${UI.esc(r.dep)}</td><td>${UI.esc(r.sec)}</td><td>${UI.esc(r.shift)}</td><td class="center">${UI.esc(r.status)}</td></tr>`)
        tr.addEventListener('mousedown', () => { tbody.querySelectorAll('tr').forEach((x) => x.classList.remove('current')); tr.classList.add('current'); current = r })
        tr.addEventListener('dblclick', () => openEmployeeForm(r, load))
        tbody.appendChild(tr)
      }
      count.textContent = `عدد الموظفين: ${rows.length}`
    }

    async function remove() {
      if (!current) return UI.message('اختر موظفاً')
      const ok = await UI.dialog({ head: 'تأكيد الحذف', bodyHtml: `<div>حذف الموظف «${UI.esc(current.name_ar)}»؟</div>`, width: 340,
        buttons: [{ label: 'نعم', icon: 'ok', onClick: (d) => d.close(true) }, { label: 'لا', icon: 'cancel', onClick: (d) => d.close(false) }] })
      if (!ok) return
      if (DB.one('SELECT 1 FROM punches WHERE emp_code = ? LIMIT 1', [current.code]) || DB.one('SELECT 1 FROM posted_attendance WHERE employee_id = ? LIMIT 1', [current.id]))
        return UI.message('للموظف حركات مسجلة — غيّر حالته إلى «منتهي»، أو استخدم «الغاء جميع بيانات الموظف بالنظام»')
      DB.run('DELETE FROM employee_shifts WHERE employee_id = ?', [current.id])
      DB.run('DELETE FROM employees WHERE id = ?', [current.id])
      DB.audit('حذف موظف', `${current.code} — ${current.name_ar}`)
      await DB.flush()
      load()
    }
    load()
  })
}

function openEmployeeForm(emp, onSaved) {
  const isNew = !emp
  const e = emp ? { ...emp } : { status: 'نشط', hire_date: new Date().toISOString().slice(0, 10) }
  const sel = (field, options) => `<select data-f="${field}"><option value=""></option>${options.map(([v, l]) =>
    `<option value="${UI.esc(v)}" ${String(v) === String(e[field] ?? '') ? 'selected' : ''}>${UI.esc(l)}</option>`).join('')}</select>`
  const txt = (field, attrs = '') => `<input type="text" data-f="${field}" value="${UI.esc(e[field] ?? '')}" ${attrs}>`
  const date = (field) => `<input type="date" data-f="${field}" value="${UI.esc(e[field] ?? '')}">`
  const chk = (field, label) => `<label class="chk"><input type="checkbox" data-f="${field}" ${e[field] ? 'checked' : ''}> ${label}</label>`
  const deps = opts('departments', 'WHERE parent_id IS NULL OR parent_id = ""')()
  const secs = opts('departments', 'WHERE parent_id IS NOT NULL AND parent_id <> ""')()

  UI.openWindow(`emp-${emp?.id || 'new'}`, isNew ? 'اضافة موظف' : `تعديل موظف — ${emp.name_ar}`, { width: 820, height: 520 }, (body, win) => {
    const bar = UI.toolbar([
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const form = UI.el(`<div class="form">
      <fieldset><legend>تعريف الموظف</legend><div class="with-photo"><div class="grid2">
        <label>كود الموظف (رقم الموظف على جهاز البصمة) *</label>${txt('code', 'dir="ltr"')}
        <label>حالة الموظف</label>${sel('status', EMP_STATUSES.map((s) => [s, s]))}
        <label>اسم الموظف بالعربية *</label>${txt('name_ar')}
        <label>اسم الموظف بالانجليزية</label>${txt('name_en', 'dir="ltr"')}
        <label>طريقة الحضور</label>${sel('attendance_method', [['بصمة', 'بصمة'], ['بصمة وجه', 'بصمة وجه'], ['بطاقة', 'بطاقة'], ['يدوي', 'يدوي']])}
      </div><div class="photo" title="اضغط لاختيار صورة">${e.photo ? `<img src="${e.photo}">` : '<span>صورة الموظف</span>'}
        <input type="file" accept="image/*" hidden><button type="button" class="rm" ${e.photo ? '' : 'hidden'}>إزالة</button></div></div></fieldset>
      <fieldset><legend>معلومات الموظف</legend><div class="grid2">
        <label>الوظيفة</label>${sel('job_id', listOptions('job')())}
        <label>تاريخ التعيين</label>${date('hire_date')}
        <label>الإدارة</label>${sel('department_id', deps)}
        <label>القسم</label>${sel('section_id', secs)}
        <label>المجموعة</label>${sel('group_id', opts('employee_groups')())}
        <label>المشروع</label>${sel('project_id', opts('projects')())}
        <label>الدوام *</label>${sel('shift_group_id', opts('shift_groups')())}
      </div>${emp ? `<div class="hist"><b>سجل الدوام:</b> ${DB.all('SELECT s.from_date, g.name_ar FROM employee_shifts s LEFT JOIN shift_groups g ON g.id = s.group_id WHERE s.employee_id = ? ORDER BY s.from_date', [emp.id])
        .map((h) => `${UI.esc(h.name_ar)} من ${h.from_date}`).join(' ← ') || '—'}</div>` : ''}</fieldset>
      <fieldset><legend>معلومات شخصية</legend><div class="grid2">
        <label>الجنس</label>${sel('gender', [['ذكر', 'ذكر'], ['أنثى', 'أنثى']])}
        <label>الجنسية</label>${sel('nationality_id', listOptions('nationality')())}
        <label>رقم الهوية</label>${txt('national_id', 'dir="ltr"')}
        <label>الديانة</label>${sel('religion', [['مسلم', 'مسلم'], ['غير مسلم', 'غير مسلم']])}
        <label>تاريخ الميلاد</label>${date('birth_date')}
        <label>رقم الجوال</label>${txt('mobile', 'dir="ltr"')}
        <label>البريد الالكتروني</label>${txt('email', 'dir="ltr"')}
        <label>العنوان</label>${txt('address')}
      </div></fieldset>
      <fieldset><legend>إعدادات إحتساب الإضافي</legend><div class="checks">
        ${chk('ot_deduct_late', 'خصم التأخير من الوقت الإضافي')}
        ${chk('ot_before', 'حساب الوقت الإضافي قبل الدوام')}
        ${chk('ot_after', 'حساب الوقت الإضافي بعد الدوام')}
        ${chk('ot_holidays', 'إضافة ساعات العمل أيام الأجازات')}
        ${chk('no_punch_out', 'تسجيل خروج بدون بصمة')}
      </div></fieldset>
    </div>`)
    body.append(bar, form)
    // photo: resized to 240px JPEG and stored inline with the employee
    let photo = e.photo || null
    const box = form.querySelector('.photo'), fileIn = box.querySelector('input[type=file]'), rm = box.querySelector('.rm')
    const showPhoto = () => { box.querySelector('img, span')?.remove(); box.prepend(photo ? Object.assign(document.createElement('img'), { src: photo }) : Object.assign(document.createElement('span'), { textContent: 'صورة الموظف' })); rm.hidden = !photo }
    box.addEventListener('click', (ev) => { if (ev.target !== rm) fileIn.click() })
    rm.addEventListener('click', () => { photo = null; showPhoto() })
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]
      if (!f) return
      if (f.size > 8 * 1024 * 1024) return UI.message('حجم الصورة كبير (الحد 8 ميجابايت)')
      // read as a data: URL — the page's CSP allows data: images, not blob:
      const src = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(f) })
      const img = src && (await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src }))
      if (!img) return UI.message('الملف ليس صورة صالحة')
      const k = Math.min(1, 240 / Math.max(img.width, img.height))
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) })
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      photo = c.toDataURL('image/jpeg', 0.85)
      showPhoto()
    })

    async function save() {
      const v = { ...e }
      form.querySelectorAll('[data-f]').forEach((i) => (v[i.dataset.f] = i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.value.trim()))
      if (!v.code) return UI.message('كود الموظف مطلوب')
      if (!/^\d{1,9}$/.test(v.code)) return UI.message('كود الموظف يجب أن يكون أرقاماً فقط (نفس رقمه على جهاز البصمة)')
      if (!v.name_ar) return UI.message('اسم الموظف بالعربية مطلوب')
      if (!v.shift_group_id) return UI.message('الدوام مطلوب')
      if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return UI.message('البريد الالكتروني غير صحيح')
      if (!emp && !(await Trial.canAddEmployee())) return
      // a shift change applies from a chosen date; earlier days keep the old shift
      let shiftFrom = null
      if (emp && String(v.shift_group_id) !== String(emp.shift_group_id)) {
        shiftFrom = await UI.dialog({
          head: 'تغيير الدوام', width: 420,
          bodyHtml: `<div class="fields" style="grid-template-columns:150px 1fr"><label>يبدأ الدوام الجديد من</label><input type="date" id="sf" value="${Engine.today()}"></div>
            <div style="font-size:12px;padding:0 4px">الأيام قبل هذا التاريخ تُحسب على الدوام السابق.</div>`,
          buttons: [{ label: 'موافق', icon: 'ok', onClick: (d) => { const x = d.root.querySelector('#sf').value; x ? d.close(x) : d.error('اختر التاريخ') } },
            { label: 'الغاء', icon: 'cancel', onClick: (d) => d.close(null) }],
        })
        if (!shiftFrom) return
        if (Engine.isPosted(shiftFrom)) return UI.message('هذا التاريخ داخل فترة مرحّلة — اختر تاريخاً بعدها')
      }
      v.photo = photo
      const F = ['code', 'name_ar', 'name_en', 'status', 'job_id', 'department_id', 'section_id', 'group_id', 'project_id', 'shift_group_id',
        'hire_date', 'gender', 'nationality_id', 'national_id', 'religion', 'birth_date', 'mobile', 'email', 'address',
        'ot_deduct_late', 'ot_before', 'ot_after', 'ot_holidays', 'no_punch_out', 'attendance_method', 'photo']
      const vals = F.map((f) => (v[f] === '' ? null : v[f]))
      try {
        DB.run('BEGIN')
        if (emp) {
          DB.run(`UPDATE employees SET ${F.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [...vals, emp.id])
          if (shiftFrom) DB.run('INSERT OR REPLACE INTO employee_shifts (employee_id, group_id, from_date) VALUES (?, ?, ?)', [emp.id, +v.shift_group_id, shiftFrom])
        } else {
          DB.run(`INSERT INTO employees (${F.join(', ')}) VALUES (${F.map(() => '?').join(', ')})`, vals)
          const id = DB.one('SELECT last_insert_rowid() AS id').id
          DB.run('INSERT INTO employee_shifts (employee_id, group_id, from_date) VALUES (?, ?, ?)', [id, +v.shift_group_id, v.hire_date || '2000-01-01'])
        }
        DB.run('COMMIT')
      } catch (err) {
        DB.run('ROLLBACK')
        return UI.message(/UNIQUE/.test(err.message) ? `كود الموظف ${v.code} مستخدم لموظف آخر` : `تعذّر الحفظ: ${err.message}`)
      }
      DB.audit(emp ? 'تعديل موظف' : 'إضافة موظف', `${v.code} — ${v.name_ar}`, shiftFrom ? `دوام جديد من ${shiftFrom}` : '')
      await DB.flush()
      onSaved?.()
      win.close()
      UI.message(emp ? 'تم الحفظ' : 'تمت إضافة الموظف')
    }
  })
}
