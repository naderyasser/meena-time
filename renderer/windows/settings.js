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
  const res = await window.bridge.backup(DB.year, DB.db.export())
  UI.message(res?.ok ? `تم حفظ النسخة الاحتياطية:\n${res.path}` : res?.error || 'تم إلغاء النسخ الاحتياطي')
}
