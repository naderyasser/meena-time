// «البيانات الأساسية» screens built on openGridWindow — one config each.
const opts = (table, where = '') => () =>
  DB.all(`SELECT id, name_ar FROM ${table} ${where} ORDER BY name_ar`).map((r) => [r.id, r.name_ar])
const inUse = (table, field, id, what) =>
  DB.one(`SELECT 1 FROM ${table} WHERE ${field} = ? LIMIT 1`, [id]) ? `لا يمكن الحذف: مستخدم في ${what}` : null

// Apex «نوع القائمة»: الوظائف · المهام · الديانة · ملاحظات الحضور · نوع الاجازة (+ ours: الجنسيات، أنواع الأذونات)
const LIST_TYPES = [['job', 'الوظائف'], ['task', 'المهام'], ['religion', 'الديانة'], ['nationality', 'الجنسيات'], ['att_note', 'ملاحظات الحضور'], ['leave', 'نوع الاجازة'], ['permission', 'أنواع الأذونات']]
const listOptions = (type) => () => DB.all('SELECT id, name_ar FROM lists WHERE list_type = ? ORDER BY name_ar', [type]).map((r) => [r.id, r.name_ar])
const hhmm = (m) => `${String(Math.floor((m || 0) / 60)).padStart(2, '0')}:${String((m || 0) % 60).padStart(2, '0')}`

function openLists() {
  let type = 'job'
  openGridWindow({
    id: 'lists', title: 'قوائم البرنامج', table: 'lists', orderBy: 'id', width: 950, height: 440,
    help: 'اختر نوع القائمة من «نوع القائمة» ثم أدخل الاسم (عربي أو انجليزي) واضغط «حفظ».',
    scope: () => ({ where: 'list_type = ?', params: [type], fixed: { list_type: type } }),
    caption: () => LIST_TYPES.find(([k]) => k === type)[1],
    side: (ctx) => {
      const el = UI.el(`<fieldset class="list-types"><legend>نوع القائمة</legend>${LIST_TYPES.map(([k, l]) => `<div class="lt ${k === type ? 'on' : ''}" data-k="${k}">${l}</div>`).join('')}</fieldset>`)
      el.addEventListener('click', (e) => {
        const t = e.target.closest('.lt'); if (!t) return
        type = t.dataset.k
        el.querySelectorAll('.lt').forEach((x) => x.classList.toggle('on', x === t))
        ctx.reload()
      })
      return el
    },
    columns: [
      { field: 'name_ar', label: 'اسم البند عربي', required: true },
      { field: 'name_en', label: 'اسم البند انجليزي', type: 'en' },
    ],
    beforeDelete: (r) => {
      if (type === 'religion') return DB.one('SELECT 1 FROM employees WHERE religion = ? LIMIT 1', [r.name_ar]) ? 'لا يمكن الحذف: مستخدم في بيانات الموظفين' : null
      const use = { job: ['employees', 'job_id'], nationality: ['employees', 'nationality_id'], leave: ['leaves', 'type_id'], permission: ['permissions', 'type_id'] }[type]
      return use ? inUse(use[0], use[1], r.id, use[0] === 'employees' ? 'بيانات الموظفين' : 'الإجازات/الأذونات') : null
    },
  })
}

// Apex «قوائم الأقسام والإدارات»: tree on one side, the record form on the other.
// «رئيسي» = new إدارة, «جديد» = new قسم under the selected إدارة.
function openDepartments() {
  UI.openWindow('departments', 'قوائم الأقسام والإدارات', { width: 800, height: 420 }, (body, win) => {
    let cur = null // {id?, parent_id}
    const bar = UI.toolbar([
      { key: 'main', label: 'رئيسي', icon: 'item', onClick: () => edit({ parent_id: null }) },
      { key: 'new', label: 'جديد', icon: 'new', onClick: () => {
        const sel = cur?.id ? DB.one('SELECT * FROM departments WHERE id = ?', [cur.id]) : null
        if (!sel) return UI.message('حدد الإدارة التي يتبعها القسم من الشجرة، أو اضغط «رئيسي» لإدارة جديدة')
        edit({ parent_id: sel.parent_id || sel.id })
      } },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'undo', label: 'إهمال', icon: 'undo', onClick: () => (cur?.id ? pick(cur.id) : edit(null)) },
      { key: 'del', label: 'حذف', icon: 'del', onClick: remove },
      { key: 'print', label: 'طباعه', icon: 'print', onClick: print },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const view = UI.el(`<div class="dept-win"><div class="dw-tree"></div>
      <div class="fields dw-form"><label>رقم القسم أو الإدارة</label><input type="text" id="dw-id" readonly>
        <label>الإسم العربي</label><input type="text" id="dw-ar"><label>الإسم الأجنبي</label><input type="text" id="dw-en" dir="ltr">
        <label>تابع لـ</label><input type="text" id="dw-parent" readonly></div></div>`)
    body.append(bar, view)
    const $ = (s) => view.querySelector(s)
    function tree(selId) {
      const t = UI.deptTree((id) => id && pick(id), { title: 'الإدارات والأقسام', all: false })
      $('.dw-tree').replaceChildren(t)
      t.querySelector(`.tn[data-id="${selId}"]`)?.classList.add('on')
    }
    function edit(r) {
      cur = r
      $('#dw-id').value = r?.id || ''
      $('#dw-ar').value = r?.name_ar || ''
      $('#dw-en').value = r?.name_en || ''
      $('#dw-parent').value = r?.parent_id ? DB.one('SELECT name_ar FROM departments WHERE id = ?', [r.parent_id])?.name_ar || '' : r ? '— إدارة رئيسية —' : ''
      $('#dw-ar').disabled = $('#dw-en').disabled = !r
      if (r && !r.id) $('#dw-ar').focus()
    }
    const pick = (id) => edit(DB.one('SELECT * FROM departments WHERE id = ?', [id]))
    async function save() {
      if (!cur) return UI.message('اختر إدارة أو قسماً، أو اضغط «رئيسي» / «جديد»')
      if (WebSync.blocks('departments')) return
      const ar = $('#dw-ar').value.trim(), en = $('#dw-en').value.trim()
      if (!ar) return UI.message('الإسم العربي مطلوب')
      if (DB.one("SELECT 1 FROM departments WHERE name_ar = ? AND COALESCE(parent_id, 0) = COALESCE(?, 0) AND id <> ?", [ar, cur.parent_id || null, cur.id || 0]))
        return UI.message('الاسم مكرر في نفس المستوى')
      if (cur.id) DB.run('UPDATE departments SET name_ar = ?, name_en = ? WHERE id = ?', [ar, en, cur.id])
      else { DB.run('INSERT INTO departments (name_ar, name_en, parent_id) VALUES (?, ?, ?)', [ar, en, cur.parent_id || null]); cur.id = DB.one('SELECT last_insert_rowid() AS id').id }
      DB.audit('الأقسام والإدارات', ar)
      await DB.flush()
      tree(cur.id); pick(cur.id)
      UI.message('تم الحفظ')
    }
    async function remove() {
      if (!cur?.id) return UI.message('حدد الإدارة أو القسم من الشجرة')
      if (WebSync.blocks('departments')) return
      if (DB.one('SELECT 1 FROM departments WHERE parent_id = ? LIMIT 1', [cur.id])) return UI.message('لا يمكن الحذف: توجد أقسام تابعة لهذه الإدارة')
      if (DB.one('SELECT 1 FROM employees WHERE department_id = ? OR section_id = ? LIMIT 1', [cur.id, cur.id])) return UI.message('لا يمكن حذف السجل لانه مرتبط بعمليات اخري (موظفين)')
      if (DB.one('SELECT 1 FROM devices WHERE department_id = ? LIMIT 1', [cur.id])) return UI.message('لا يمكن حذف السجل لانه مرتبط بعمليات اخري (أجهزة)')
      if (!(await UI.confirm(`حذف «${cur.name_ar}»؟`))) return
      DB.run('DELETE FROM departments WHERE id = ?', [cur.id])
      DB.audit('حذف قسم/إدارة', cur.name_ar)
      await DB.flush()
      tree(null); edit(null)
    }
    function print() {
      const deps = DB.all('SELECT * FROM departments ORDER BY name_ar')
      const rows = deps.filter((d) => !d.parent_id).flatMap((d) => [d, ...deps.filter((x) => x.parent_id === d.id)])
      UI.print(UI.letterhead('الأقسام والإدارات') + `<table class="grid"><thead><tr><th>الرقم</th><th>الإسم العربي</th><th>الإسم الأجنبي</th><th>تابع لـ</th></tr></thead><tbody>${
        rows.map((d) => `<tr><td>${d.id}</td><td>${d.parent_id ? '&nbsp;&nbsp;&nbsp;' : ''}${UI.esc(d.name_ar)}</td><td>${UI.esc(d.name_en || '')}</td><td>${UI.esc(deps.find((x) => x.id === d.parent_id)?.name_ar || '')}</td></tr>`).join('')}</tbody></table>`)
    }
    tree(null); edit(null)
  })
}

function openProjects() {
  openGridWindow({
    id: 'projects', title: 'المشاريع', table: 'projects',
    columns: [{ field: 'name_ar', label: 'الاسم العربي', required: true }, { field: 'name_en', label: 'الاسم الأجنبي', type: 'en' }],
    beforeDelete: (r) => inUse('employees', 'project_id', r.id, 'بيانات الموظفين'),
  })
}

function openEmployeeGroups() {
  openGridWindow({
    id: 'employee-groups', title: 'مجموعات الموظفين', table: 'employee_groups',
    // Apex: «الموظفون» (or double-click) opens the members screen
    extraButtons: [{ key: 'members', label: 'الموظفون', icon: 'people', onClick: (ctx) => {
      const r = ctx.currentRow
      if (!r || !r.id) return UI.message('اختر مجموعة محفوظة أولاً')
      openGroupMembers(r)
    } }],
    onRowOpen: (r) => r.id && openGroupMembers(r),
    columns: [{ field: 'name_ar', label: 'الاسم العربي', required: true }, { field: 'name_en', label: 'الاسم الأجنبي', type: 'en' }],
    beforeDelete: (r) => inUse('employees', 'group_id', r.id, 'بيانات الموظفين'),
  })
}

// Apex «الموظفون لمجموعة محددة»: employees without a group ⇄ this group's members.
// Double-click moves a row; إضافة / إضافة الكل / حذف / حذف الكل / بحث below.
function openGroupMembers(group) {
  UI.openWindow('group-members', 'الموظفون لمجموعة محددة', { width: 900, height: 520 }, (body, win) => {
    let q = ''
    const bar = UI.toolbar([{ key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() }])
    const list = (id, head) => `<div class="gm-list"><div class="gm-head">${UI.esc(head)}</div><div class="grid-wrap"><table class="grid">
      <thead><tr><th style="width:110px">رقم الموظف</th><th>اسم الموظف</th></tr></thead><tbody id="${id}"></tbody></table></div></div>`
    const view = UI.el(`<div class="group-members"><div class="gm-cols">${list('gm-free', 'الموظفون')}${list('gm-in', group.name_ar)}</div>
      <div class="gm-btns">
        <button data-a="add">${ICONS.new || ''}<span>إضافة</span></button><button data-a="addall">${ICONS.people || ''}<span>إضافة الكل</span></button>
        <button data-a="del">${ICONS.del || ''}<span>حذف</span></button><button data-a="delall">${ICONS.del || ''}<span>حذف الكل</span></button>
        <button data-a="find">${ICONS.search || ''}<span>بحث</span></button><span class="gm-q"></span></div></div>`)
    body.append(bar, view)
    const $ = (s) => view.querySelector(s)
    const sel = { free: null, in: null }
    const set = (ids, gid) => {
      if (!ids.length || WebSync.blocks('employees')) return
      DB.run(`UPDATE employees SET group_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [gid, ...ids])
      DB.audit(gid ? 'إضافة لمجموعة موظفين' : 'حذف من مجموعة موظفين', group.name_ar, `${ids.length} موظف`)
      DB.flush(); load()
    }
    function fill(tb, rows, key) {
      tb.innerHTML = rows.map((e) => `<tr data-id="${e.id}"><td class="center">${UI.esc(e.code)}</td><td class="center">${UI.esc(e.name_ar)}</td></tr>`).join('')
        || '<tr><td colspan="2" class="empty">لا يوجد</td></tr>'
      tb.querySelectorAll('tr[data-id]').forEach((tr) => {
        tr.addEventListener('mousedown', () => { sel[key] = +tr.dataset.id; tb.querySelectorAll('tr').forEach((x) => x.classList.toggle('current', x === tr)) })
        tr.addEventListener('dblclick', () => set([+tr.dataset.id], key === 'free' ? group.id : null))
      })
    }
    const ids = (tb) => [...$(tb).querySelectorAll('tr[data-id]')].map((tr) => +tr.dataset.id)
    function load() {
      const like = `%${q}%`, flt = "AND (? = '' OR code LIKE ? OR name_ar LIKE ?) ORDER BY CAST(code AS INTEGER), code"
      sel.free = sel.in = null
      fill($('#gm-free'), DB.all(`SELECT id, code, name_ar FROM employees WHERE (group_id IS NULL OR group_id = '') AND status = 'نشط' ${flt}`, [q, like, like]), 'free')
      fill($('#gm-in'), DB.all(`SELECT id, code, name_ar FROM employees WHERE group_id = ? ${flt}`, [group.id, q, like, like]), 'in')
      $('.gm-q').textContent = q ? `بحث: ${q}` : ''
    }
    view.querySelector('.gm-btns').addEventListener('click', async (e) => {
      const a = e.target.closest('button')?.dataset.a
      if (a === 'add') sel.free ? set([sel.free], group.id) : UI.message('حدد الموظف من قائمة «الموظفون»')
      else if (a === 'del') sel.in ? set([sel.in], null) : UI.message('حدد الموظف من قائمة المجموعة')
      else if (a === 'addall') set(ids('#gm-free'), group.id)
      else if (a === 'delall') set(ids('#gm-in'), null)
      else if (a === 'find') {
        const v = await UI.dialog({ head: 'بحث', width: 360, bodyHtml: '<div class="fields" style="grid-template-columns:110px 1fr"><label>رقم أو اسم الموظف</label><input type="text" id="gm-s"></div>',
          buttons: [{ label: 'موافق', icon: 'ok', onClick: (d) => d.close(d.root.querySelector('#gm-s').value.trim()) }, { label: 'الغاء', icon: 'cancel', onClick: (d) => d.close(null) }] })
        if (v !== null) { q = v; load() }
      }
    })
    load()
  })
}

function openHolidays() {
  openGridWindow({
    id: 'holidays', title: 'العطلات الرسمية', table: 'holidays', orderBy: 'from_date', width: 600,
    columns: [
      { field: 'name_ar', label: 'اسم العطلة', required: true },
      { field: 'from_date', label: 'من تاريخ', type: 'date', width: 140, required: true },
      { field: 'to_date', label: 'إلى تاريخ', type: 'date', width: 140, required: true },
    ],
  })
}

// Apex «اعدادات الجهاز»: record form (كود · القسم · اسم الجهاز · نوع الاتصال | IP · Port) above the device grid.
function openDevices() {
  UI.openWindow('devices', 'اعدادات الجهاز', { width: 840, height: 520 }, (body, win) => {
    let cur = null
    const deps = () => DB.all('SELECT id, name_ar FROM departments ORDER BY name_ar')
    const bar = UI.toolbar([
      { key: 'new', label: 'جديد', icon: 'new', onClick: () => { edit({}); $('#dv-name').focus() } },
      { key: 'del', label: 'حذف', icon: 'del', onClick: remove },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const view = UI.el(`<div class="dev-win"><fieldset><legend>إعدادات الجهاز</legend>
      <div class="fields dv-main"><label>كود الجهاز <b class="req">*</b></label><input type="text" id="dv-id" readonly>
        <label>القسم</label><div class="dv-dep"><input type="text" id="dv-dep" readonly><button id="dv-pick" title="اختيار القسم">…</button></div>
        <label>اسم الجهاز <b class="req">*</b></label><input type="text" id="dv-name">
        <label>نوع الاتصال</label><select id="dv-conn"><option>TCP / IP</option></select></div>
      <div class="fields dv-net"><label>IP</label><input type="text" id="dv-ip" dir="ltr"><label>Port</label><input type="text" id="dv-port" dir="ltr">
        <label>كلمة الاتصال</label><input type="text" id="dv-key" dir="ltr"><label>الرقم التسلسلي</label><input type="text" id="dv-serial" dir="ltr"></div>
    </fieldset>
    <div class="grid-wrap"><table class="grid"><thead><tr><th style="width:18px"></th><th style="width:90px">الكود</th><th>اسم الجهاز</th><th>القسم</th></tr></thead><tbody></tbody></table></div></div>`)
    body.append(bar, view)
    const $ = (s) => view.querySelector(s)
    const tb = view.querySelector('tbody')
    function edit(d) {
      cur = d
      $('#dv-id').value = d.id || ''
      $('#dv-dep').value = d.department_id ? `${deps().find((x) => x.id === d.department_id)?.name_ar || ''}:${d.department_id}` : ''
      $('#dv-dep').dataset.id = d.department_id || ''
      $('#dv-name').value = d.name || ''
      $('#dv-ip').value = d.ip || ''
      $('#dv-port').value = d.port || (d.id ? '' : 4370)
      $('#dv-key').value = d.comm_key ?? (d.id ? '' : '0')
      $('#dv-serial').value = d.serial || ''
      tb.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('current', +tr.dataset.id === d.id))
    }
    function load(selId) {
      const list = DB.all('SELECT v.*, d.name_ar AS dep FROM devices v LEFT JOIN departments d ON d.id = v.department_id ORDER BY v.id')
      tb.innerHTML = list.map((d) => `<tr data-id="${d.id}"><td class="sel"></td><td class="center">${d.id}</td><td class="center">${UI.esc(d.name)}</td><td class="center">${UI.esc(d.dep || '')}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">لا توجد أجهزة — «جديد» لإضافة جهاز</td></tr>'
      tb.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('mousedown', () => edit(list.find((d) => d.id === +tr.dataset.id))))
      edit(list.find((d) => d.id === selId) || list[0] || {})
    }
    $('#dv-pick').onclick = async () => {
      const r = await UI.dialog({ head: 'القسم', width: 320, bodyHtml: '<div class="dv-tree"></div>',
        buttons: [{ label: 'بدون قسم', icon: 'cancel', onClick: (d) => d.close({ id: null }) }],
        onOpen: (d) => d.root.querySelector('.dv-tree').append(UI.deptTree((id, name) => id && d.close({ id, name }), { title: 'الاقسام', all: false })) })
      if (r) { $('#dv-dep').value = r.id ? `${r.name}:${r.id}` : ''; $('#dv-dep').dataset.id = r.id || '' }
    }
    async function save() {
      if (!cur) return
      const name = $('#dv-name').value.trim(), ip = $('#dv-ip').value.trim(), port = $('#dv-port').value.trim() || '4370'
      if (!name) return UI.message('اسم الجهاز مطلوب')
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return UI.message('أدخل عنوان IP صحيح للجهاز (مثال 192.168.1.201)')
      if (!/^\d+$/.test(port)) return UI.message('Port: أرقام فقط')
      const v = [name, ip, +port, $('#dv-serial').value.trim(), $('#dv-key').value.trim() || '0', +$('#dv-dep').dataset.id || null, $('#dv-conn').value]
      if (cur.id) DB.run('UPDATE devices SET name = ?, ip = ?, port = ?, serial = ?, comm_key = ?, department_id = ?, conn_type = ? WHERE id = ?', [...v, cur.id])
      else { DB.run('INSERT INTO devices (name, ip, port, serial, comm_key, department_id, conn_type) VALUES (?, ?, ?, ?, ?, ?, ?)', v); cur.id = DB.one('SELECT last_insert_rowid() AS id').id }
      DB.audit('تعريف الأجهزة', name, ip)
      await DB.flush()
      load(cur.id)
      UI.message('تم الحفظ')
    }
    async function remove() {
      if (!cur?.id) return UI.message('حدد الجهاز من الجدول')
      if (!(await UI.confirm(`حذف الجهاز «${cur.name}»؟`))) return
      DB.run('DELETE FROM devices WHERE id = ?', [cur.id])
      DB.audit('حذف جهاز', cur.name)
      await DB.flush()
      load(null)
    }
    load(null)
  })
}

function openShiftGroups() {
  openGridWindow({
    id: 'shift-groups', title: 'مجموعات أوقات الدوام', table: 'shift_groups',
    help: 'أدخل اسم المجموعة ثم «حفظ»، وحدد مواعيدها من زر «المواعيد».',
    columns: [
      { field: 'name_ar', label: 'الاسم العربي', required: true },
      { field: 'name_en', label: 'الاسم الأجنبي', type: 'en' },
      { field: 'total_minutes', label: 'الإجمالي', type: 'readonly', width: 80, format: hhmm },
      { field: 'open_shift', label: 'دوام مفتوح', type: 'check', width: 70 },
      { field: 'rotational', label: 'ورديات متغيرة', type: 'check', width: 80 },
      { field: 'start_date', label: 'تاريخ بدء العمل بالدوام', type: 'date', width: 140 },
    ],
    width: 860,
    validate: (r) => r.open_shift && r.rotational ? `«${r.name_ar}»: اختر دوام مفتوح أو ورديات متغيرة، وليس الاثنين`
      : r.rotational && !r.start_date ? `«${r.name_ar}»: تاريخ بدء العمل بالدوام مطلوب للورديات المتغيرة` : null,
    extraButtons: [{ key: 'times', label: 'المواعيد', icon: 'clock', onClick: (ctx) => {
      const r = ctx.currentRow
      if (!r || !r.id) return UI.message('اختر مجموعة محفوظة أولاً')
      openShiftTimes(r, ctx.reload)
    } }],
    onRowOpen: (r, ctx) => r.id && openShiftTimes(r, ctx.reload),
    beforeDelete: (r) => inUse('employee_shifts', 'group_id', r.id, 'بيانات الموظفين (حالياً أو سابقاً)'),
    onDeleteRow: (r) => {
      DB.run('DELETE FROM shift_windows WHERE group_id = ?', [r.id])
      DB.run('DELETE FROM rotation_blocks WHERE group_id = ?', [r.id])
      DB.run('DELETE FROM shift_groups WHERE id = ?', [r.id])
    },
  })
}

function openRamadan() {
  openGridWindow({
    id: 'ramadan', title: 'مواعيد رمضان', table: 'ramadan_periods', orderBy: 'from_date DESC', width: 520,
    help: 'حدد بداية ونهاية شهر رمضان لكل سنة. خلال هذه الفترة تُطبَّق «أيام رمضان» في مواعيد كل دوام (إن وُجدت).',
    columns: [
      { field: 'from_date', label: 'من تاريخ', type: 'date', required: true },
      { field: 'to_date', label: 'إلى تاريخ', type: 'date', required: true },
    ],
    validate: (r) => r.from_date > r.to_date ? 'تاريخ البداية بعد النهاية' : null,
  })
}
