// «الإعدادات»: بيانات المؤسسة · اعدادات المستخدمين · اعدادات النظام, plus backup.
const meta = (k) => DB.one('SELECT value FROM meta WHERE key = ?', [k])?.value || ''
const setMeta = (k, v) => DB.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v])

// Passwords: "sha256$<salt>$<hex>" (legacy plain text accepted once, then upgraded on login)
async function hashPassword(pw, salt = crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pw}`))
  return `sha256$${salt}$${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
async function checkPassword(stored, pw) {
  if (!stored?.startsWith('sha256$')) return (stored || '') === pw
  return (await hashPassword(pw, stored.split('$')[1])) === stored
}

function openCompany() {
  UI.dialog({
    head: 'بيانات المؤسسة', width: 520,
    bodyHtml: `<div class="fields" style="grid-template-columns:110px 1fr">
      <label>اسم المؤسسة</label><input type="text" id="co-name" value="${UI.esc(meta('company_name'))}">
      <label>الاسم بالانجليزية</label><input type="text" id="co-name-en" dir="ltr" value="${UI.esc(meta('company_name_en'))}">
      <label>العنوان</label><input type="text" id="co-addr" value="${UI.esc(meta('company_address'))}">
      <label>الهاتف</label><input type="text" id="co-phone" dir="ltr" value="${UI.esc(meta('company_phone'))}"></div>`,
    buttons: [
      { label: 'حفظ', icon: 'save', onClick: async (d) => {
        const v = (id) => d.root.querySelector(id).value.trim()
        if (!v('#co-name')) return d.error('اسم المؤسسة مطلوب — يظهر في رأس التقارير')
        setMeta('company_name', v('#co-name')); setMeta('company_name_en', v('#co-name-en'))
        setMeta('company_address', v('#co-addr')); setMeta('company_phone', v('#co-phone'))
        await DB.flush()
        d.close(true)
      } },
      { label: 'إغلاق', icon: 'cancel', onClick: (d) => d.close(false) },
    ],
  })
}

function openUsers() {
  UI.openWindow('users', 'اعدادات المستخدمين', { width: 520, height: 360 }, (body, win) => {
    let current = null
    const bar = UI.toolbar([
      { key: 'new', label: 'مستخدم جديد', icon: 'new', onClick: () => edit(null) },
      { key: 'pw', label: 'تغيير كلمة المرور', icon: 'register', onClick: () => (current ? edit(current) : UI.message('اختر مستخدماً')) },
      { key: 'perm', label: 'الصلاحيات', icon: 'm_set', onClick: () => {
        if (!current) return UI.message('اختر مستخدماً')
        if (current.is_admin) return UI.message('مدير النظام له كل الصلاحيات')
        editPermissions(current).then(load)
      } },
      { key: 'del', label: 'حذف', icon: 'del', onClick: remove },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const wrap = UI.el('<div class="grid-wrap"><table class="grid"><thead><tr><th style="width:16px"></th><th class="sorted">اسم المستخدم</th><th style="width:90px">مدير النظام</th></tr></thead><tbody></tbody></table></div>')
    body.append(bar, wrap)
    const load = () => {
      const tb = wrap.querySelector('tbody')
      tb.innerHTML = ''
      current = null
      for (const u of DB.all('SELECT * FROM users ORDER BY id')) {
        const tr = UI.el(`<tr><td class="sel"></td><td>${UI.esc(u.username)}</td><td class="center">${u.is_admin ? '✔' : ''}</td></tr>`)
        tr.onmousedown = () => { tb.querySelectorAll('tr').forEach((x) => x.classList.remove('current')); tr.classList.add('current'); current = u }
        tb.appendChild(tr)
      }
    }
    async function edit(u) {
      await UI.dialog({
        head: u ? `كلمة مرور ${u.username}` : 'مستخدم جديد', width: 420,
        bodyHtml: `<div class="fields" style="grid-template-columns:100px 1fr">
          ${u ? '' : '<label>اسم المستخدم</label><input type="text" id="u-name"><label>مدير النظام</label><input type="checkbox" id="u-admin" style="justify-self:start">'}
          <label>كلمة المرور</label><input type="password" id="u-pw"><label>تأكيد</label><input type="password" id="u-pw2"></div>`,
        buttons: [
          { label: 'حفظ', icon: 'save', onClick: async (d) => {
            const pw = d.root.querySelector('#u-pw').value
            if (pw !== d.root.querySelector('#u-pw2').value) return d.error('كلمتا المرور غير متطابقتين')
            if (pw.length < 4) return d.error('كلمة المرور 4 أحرف على الأقل')
            const h = await hashPassword(pw)
            try {
              if (u) DB.run('UPDATE users SET password = ? WHERE id = ?', [h, u.id])
              else {
                const name = d.root.querySelector('#u-name').value.trim()
                if (!name) return d.error('اسم المستخدم مطلوب')
                DB.run('INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)', [name, h, d.root.querySelector('#u-admin').checked ? 1 : 0])
              }
            } catch { return d.error('اسم المستخدم موجود') }
            await DB.flush()
            d.close(true)
            load()
          } },
          { label: 'إغلاق', icon: 'cancel', onClick: (d) => d.close(false) },
        ],
      })
    }
    async function remove() {
      if (!current) return UI.message('اختر مستخدماً')
      if (current.is_admin && DB.one('SELECT COUNT(*) n FROM users WHERE is_admin = 1').n === 1) return UI.message('لا يمكن حذف آخر مدير للنظام')
      if (current.id === Session.userId) return UI.message('لا يمكن حذف المستخدم الحالي')
      if (!(await yesNo('تأكيد', `حذف المستخدم «${UI.esc(current.username)}»؟`))) return
      DB.run('DELETE FROM users WHERE id = ?', [current.id])
      await DB.flush()
      load()
    }
    load()
  })
}

async function openSystemSettings() {
  const p = await window.bridge.paths()
  UI.dialog({
    head: 'اعدادات النظام', width: 560,
    bodyHtml: `<div class="fields" style="grid-template-columns:150px 1fr">
      <label>مجلد البيانات</label><input type="text" readonly dir="ltr" value="${UI.esc(p.data)}">
      <label>النسخ الاحتياطية</label><input type="text" readonly dir="ltr" value="${UI.esc(p.backups)}">
      <label></label><div style="font-size:12px">يتم أخذ نسخة احتياطية تلقائية يومياً عند فتح البرنامج، والاحتفاظ بآخر 30 نسخة.</div></div>`,
    buttons: [{ label: 'إغلاق', icon: 'cancel', onClick: (d) => d.close() }],
  })
}

async function backupNow() {
  const res = await window.bridge.backup('main', DB.db.export())
  UI.message(res?.ok ? `تم حفظ النسخة الاحتياطية:\n${res.path}` : res?.error || 'تم إلغاء النسخ الاحتياطي')
}

function openPenaltyRules() {
  openGridWindow({
    id: 'penalty-rules', title: 'لائحة الجزاءات', table: 'penalty_rules', orderBy: 'violation, occurrence', width: 860,
    help: 'لكل مخالفة حدد الجزاء حسب مرة تكرارها خلال الشهر. قاعدة «التكرار 4» تُطبَّق على المرة الرابعة وما بعدها. «أقل مدة» تتجاهل التأخير/الانصراف الأقصر منها.',
    columns: [
      { field: 'violation', label: 'المخالفة', type: 'select', width: 150, options: () => Object.entries(VIOLATIONS), required: true },
      { field: 'min_minutes', label: 'أقل مدة (دقائق)', type: 'en', width: 110 },
      { field: 'occurrence', label: 'التكرار', type: 'select', width: 110, options: () => [[1, 'المرة الأولى'], [2, 'الثانية'], [3, 'الثالثة'], [4, 'الرابعة فأكثر']], required: true },
      { field: 'action', label: 'الجزاء', type: 'select', width: 120, options: () => Object.entries(ACTIONS), required: true },
      { field: 'amount', label: 'القيمة', type: 'en', width: 80 },
      { field: 'notes', label: 'ملاحظات' },
    ],
    validate: (r) => {
      if (r.min_minutes !== '' && r.min_minutes != null && !/^\d{1,4}$/.test(String(r.min_minutes))) return 'أقل مدة: رقم صحيح بالدقائق'
      if (r.action !== 'warning' && !(+r.amount > 0)) return 'القيمة مطلوبة للخصم (دقائق أو أيام)'
      if (r.action === 'days' && +r.amount > 30) return 'خصم الأيام لا يتجاوز 30'
      return null
    },
  })
}

// Screens a non-admin user may be granted (menu item labels)
const PERMISSION_ITEMS = () => MENUS.filter((m) => !['مساعدة'].includes(m.label))
  .map((m) => [m.label, m.items.filter((it) => it !== '-').map(([l]) => l).filter((l) => !['اعدادات المستخدمين', 'تسجيل المنتج', 'تسجيل خروج', 'استرجاع نسخة احتياطية'].includes(l))])

async function editPermissions(u) {
  const current = new Set(JSON.parse(u.permissions || '[]'))
  const groups = PERMISSION_ITEMS()
  await UI.dialog({
    head: `صلاحيات المستخدم ${u.username}`, width: 720,
    bodyHtml: `<div class="perm-grid">${groups.map(([m, items]) => `<fieldset><legend><label><input type="checkbox" class="all"> ${m}</label></legend>
      ${items.map((it) => `<label class="chk"><input type="checkbox" value="${UI.esc(`${m}/${it}`)}" ${current.has(`${m}/${it}`) ? 'checked' : ''}> ${UI.esc(it)}</label>`).join('')}</fieldset>`).join('')}</div>`,
    buttons: [
      { label: 'حفظ', icon: 'save', onClick: async (d) => {
        const list = [...d.root.querySelectorAll('.perm-grid input[value]:checked')].map((i) => i.value)
        DB.run('UPDATE users SET permissions = ? WHERE id = ?', [JSON.stringify(list), u.id])
        DB.audit('تعديل صلاحيات', u.username, `${list.length} شاشة`)
        await DB.flush()
        d.close(true)
      } },
      { label: 'إغلاق', icon: 'cancel', onClick: (d) => d.close(false) },
    ],
  })
}
// «تحديد الكل» per menu group (the dialog is in the DOM while open)
document.addEventListener('change', (e) => {
  if (!e.target.matches('.perm-grid .all')) return
  e.target.closest('fieldset').querySelectorAll('input[value]').forEach((i) => (i.checked = e.target.checked))
})

function openAuditLog() {
  UI.openWindow('audit', 'سجل الحركات', { width: 900, height: 460 }, (body, win) => {
    const bar = UI.toolbar([
      { key: 'print', label: 'طباعة', icon: 'print', onClick: () => window.print() },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const users = DB.all('SELECT DISTINCT username FROM audit_log ORDER BY username').map((r) => r.username)
    const filters = UI.el(`<div class="filters">
      <label>من</label><input type="date" id="al-from" value="${Engine.addDays(Engine.today(), -30)}">
      <label>إلى</label><input type="date" id="al-to" value="${Engine.today()}">
      <label>المستخدم</label><select id="al-user"><option value="">الكل</option>${users.map((u) => `<option>${UI.esc(u)}</option>`).join('')}</select>
      <button id="al-go">عرض</button></div>`)
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr><th style="width:140px">الوقت</th><th style="width:90px">المستخدم</th>
      <th class="sorted" style="width:150px">العملية</th><th>على</th><th>تفاصيل</th></tr></thead><tbody></tbody></table></div>`)
    const count = UI.el('<div style="padding:2px 8px;font-size:12px"></div>')
    body.append(bar, filters, wrap, count)
    const run = () => {
      const u = filters.querySelector('#al-user').value
      const rows = DB.all(`SELECT * FROM audit_log WHERE ts BETWEEN ? AND ? ${u ? 'AND username = ?' : ''} ORDER BY id DESC LIMIT 2000`,
        [filters.querySelector('#al-from').value, filters.querySelector('#al-to').value + ' 99', ...(u ? [u] : [])])
      wrap.querySelector('tbody').innerHTML = rows.map((r) => `<tr><td class="center" dir="ltr">${UI.esc(r.ts)}</td><td class="center">${UI.esc(r.username)}</td>
        <td>${UI.esc(r.action)}</td><td>${UI.esc(r.target)}</td><td>${UI.esc(r.details)}</td></tr>`).join('')
      count.textContent = `عدد العمليات: ${rows.length}`
    }
    filters.querySelector('#al-go').onclick = run
    run()
  })
}
