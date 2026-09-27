// Login → home (4 tiles + trial notice) → Arabic menu bar, as in Apex Time.
const VERSION = '1.1.5'
const TRIAL_REPORTS = [
  'الحضور والانصراف تفصيلي',
  'الحضور والانصراف إجمالي',
  'حالة اليوم',
  'الحضور والانصراف بالحركات',
]
const soon = (name) => () => UI.message(`«${name}» — قيد الإنشاء`)

// Menu layout transcribed from the client's Apex Time video (2026-09-24).
const MENUS = [
  { label: 'البيانات الأساسية', icon: 'm_base', items: [
    ['قوائم البرنامج', openLists], ['الإدارات والأقسام', openDepartments], ['المشاريع', openProjects],
    ['مواعيد العمل', openShiftGroups], ['الموظفين', openEmployees], ['مجموعات الموظفين', openEmployeeGroups],
    ['تعريف الأجهزة', openDevices], ['العطلات الرسمية', openHolidays], ['مواعيد رمضان', openRamadan],
  ] },
  { label: 'الإجراءات', icon: 'm_proc', items: [
    ['قراءة الحركات (شبكة - ملف)', openReadPunches], ['الغاء الحركات المسحوبة خلال فترة', () => deletePunchesInPeriod(['device', 'file'], 'الغاء الحركات المسحوبة خلال فترة')],
    ['عرض الحركات', openViewPunches], '-',
    ['إضافة وتعديل الحركات لموظف', openEditPunches], ['الغاء الحركات المعدلة يدويا', () => deletePunchesInPeriod(['manual'], 'الغاء الحركات المعدلة يدويا')], '-',
    ['إضافة إجازات لموظف', openLeaves], ['إضافة أذونات لموظف', openPermissions], '-',
    ['ترحيل الحركات', postPunches], ['الغاء ترحيل الحركات', openUnpost], ['الغاء جميع بيانات الموظف بالنظام', purgeEmployee],
  ] },
  { label: 'التقارير', icon: 'm_rep', items: Object.keys(REPORTS).map((r) => [r, () => openReport(r)]) },
  { label: 'الإعدادات', icon: 'm_set', items: [['بيانات المؤسسة', openCompany], ['لائحة الجزاءات', openPenaltyRules], ['اعدادات المستخدمين', openUsers], ['اعدادات النظام', openSystemSettings], ['الربط بالموقع', openWebLink]] },
  { label: 'أدوات', icon: 'm_tools', items: [['تسجيل المنتج', () => openRegister()], ['نسخة احتياطية', backupNow], ['استرجاع نسخة احتياطية', restoreBackup], ['سجل الحركات', openAuditLog], '-', ['تسجيل خروج', logout]] },
  { label: 'مساعدة', icon: 'm_help', items: [['دليل الاستخدام', openGuide], ['عن البرنامج', () => UI.message(`Meena Time — الإصدار ${VERSION}`)]] },
]

let licence = { ok: false }
const Session = (window.Session = { userId: null, username: '', admin: false, perms: null })

function setCaption() {
  document.getElementById('caption-text').textContent =
    `Meena Time Ver. ${VERSION} (${licence.ok ? licence.edition : 'Trial'}) ${licence.ok ? 'Registered' : 'Unregistered'}`
}

function buildMenu() {
  const bar = document.getElementById('menubar')
  bar.innerHTML = ''
  for (const m of MENUS) {
    const menu = UI.el(`<div class="menu"><button>${ICONS[m.icon]}<span>${m.label}</span></button><div class="drop"></div></div>`)
    const drop = menu.querySelector('.drop')
    // permissions are stored as "<menu>/<item>" — the same label can exist in two menus
    const allowed = (label) => Session.admin || ['تسجيل المنتج', 'عن البرنامج', 'دليل الاستخدام', 'تسجيل خروج'].includes(label) || (Session.perms || []).includes(`${m.label}/${label}`)
    const items = m.items.filter((it) => it === '-' || allowed(it[0])).filter((it, i, a) => !(it === '-' && (i === 0 || a[i - 1] === '-' || i === a.length - 1)))
    if (!items.some((it) => it !== '-')) continue
    for (const it of items) {
      if (it === '-') { drop.appendChild(UI.el('<hr>')); continue }
      const [label, fn] = it
      const b = UI.el(`<button>${ICONS.item.replace('<svg', '<svg class="ico"')}<span>${label}</span></button>`)
      b.onclick = () => { closeMenus(); (fn || soon(label))() }
      drop.appendChild(b)
    }
    menu.querySelector(':scope > button').onclick = (e) => {
      e.stopPropagation()
      const was = menu.classList.contains('open')
      closeMenus()
      if (!was) menu.classList.add('open')
    }
    menu.addEventListener('mouseenter', () => { if (bar.querySelector('.menu.open') && !menu.classList.contains('open')) { closeMenus(); menu.classList.add('open') } })
    bar.appendChild(menu)
  }
  bar.hidden = false
}
const closeMenus = () => document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'))
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menubar')) closeMenus() })

function renderHome() {
  const desk = document.getElementById('desktop')
  desk.querySelector('#home')?.remove()
  const trial = licence.ok ? '' : `
    <div class="trial">${ICONS.key.replace('<svg', '<svg class="key"')}
      هذه النسخة تجريبية<br>
      كل مميزات النسخة متاحة ما عدا التقارير إلا التقارير الآتية<br>
      ${TRIAL_REPORTS.map((r, i) => `${i + 1}- ${r} (متاح 3 مرات طباعة فقط)`).join('<br>')}
    </div>`
  const home = UI.el(`<div id="home">
      <div class="title">الرئيسية</div>${trial}
      <div class="tiles">
        <div class="tile" data-t="users">${ICONS.people}<span>المستخدمين</span></div>
        <div class="tile" data-t="reports">${ICONS.reports}<span>التقارير</span></div>
        <div class="tile" data-t="proc">${ICONS.device}<span>الإجراءات</span></div>
        <div class="tile" data-t="setup">${ICONS.tools}<span>التجهيز</span></div>
      </div></div>`)
  const can = (l) => Session.admin || (Session.perms || []).includes(l)  // l = "<menu>/<item>"
  const guard = (l, fn) => () => (can(l) ? fn() : UI.message('ليس لديك صلاحية لهذه الشاشة'))
  home.querySelector('[data-t=setup]').onclick = guard('البيانات الأساسية/مواعيد العمل', openShiftGroups)
  home.querySelector('[data-t=users]').onclick = guard('الإعدادات/اعدادات المستخدمين', openUsers)
  home.querySelector('[data-t=reports]').onclick = guard('التقارير/حالة اليوم', () => openReport('حالة اليوم'))
  home.querySelector('[data-t=proc]').onclick = guard('الإجراءات/قراءة الحركات (شبكة - ملف)', openReadPunches)
  desk.prepend(home)
}

async function openRegister() {
  const st = await window.bridge.licenceStatus()
  await UI.dialog({
    head: 'تسجيل المنتج', width: 520,
    bodyHtml: `
      <div class="fields" style="grid-template-columns:80px 1fr">
        <label>كود الطلب</label><input type="text" id="req" readonly dir="ltr" value="${UI.esc(st.requestCode)}">
        <label>كود الترخيص</label><input type="text" id="lic" dir="ltr" placeholder="${st.ok ? 'البرنامج مسجل' : ''}">
      </div>
      <div style="width:64px;height:64px">${ICONS.lock}</div>`,
    buttons: [
      { label: 'إسترجاع ترخيص', icon: 'restore', onClick: async (d) => {
        const s = await window.bridge.licenceStatus()
        d.error(s.ok ? 'الترخيص الحالي صالح' : 'لا يوجد ترخيص محفوظ على هذا الجهاز')
      } },
      { label: 'تسجيل', icon: 'register', onClick: async (d) => {
        const code = d.root.querySelector('#lic').value.trim()
        if (!code) return d.error('أدخل كود الترخيص')
        const r = await window.bridge.register(code)
        if (!r.ok) return d.error('كود الترخيص غير صحيح لهذا الجهاز')
        licence = r
        setCaption()
        renderHome()
        d.close(true)
        UI.message('تم تسجيل البرنامج بنجاح')
      } },
      { label: 'إغلاق', icon: 'cancel', onClick: (d) => d.close(false) },
    ],
  })
}

async function login() {
  const company = DB.one("SELECT value FROM meta WHERE key = 'company_name'")?.value || 'قاعدة البيانات الرئيسية'
  const last = localStorage.getItem('mt-last-user') || 'أ'
  return UI.dialog({
    winbar: 'تسجيل الدخول | برنامج الحضور والانصراف',
    head: 'شاشة الدخول', width: 470,
    bodyHtml: `
      <div class="fields">
        <label>قاعدة البيانات</label><select id="year" disabled><option>${UI.esc(company)}</option></select>
        <label>اسم المستخدم</label><input type="text" id="user" value="${UI.esc(last)}">
        <label>كلمة المرور</label><input type="password" id="pass">
        <label>الواجهة</label>
        <div class="lang"><label style="color:inherit;font-weight:normal"><input type="radio" name="lang" checked> عربي</label>
          <label style="color:inherit;font-weight:normal"><input type="radio" name="lang" disabled> English</label></div>
      </div>
      <div class="avatar">${ICONS.avatar}</div>`,
    buttons: [
      { label: 'موافق', icon: 'ok', onClick: async (d) => {
        const user = d.root.querySelector('#user').value.trim()
        const pass = d.root.querySelector('#pass').value
        const u = DB.one('SELECT * FROM users WHERE username = ?', [user])
        if (!u || !(await checkPassword(u.password, pass))) {
          DB.audit('محاولة دخول فاشلة', user)
          return d.error('اسم المستخدم أو كلمة المرور غير صحيحة')
        }
        Session.userId = u.id
        Session.username = u.username
        Session.admin = !!u.is_admin
        Session.perms = JSON.parse(u.permissions || '[]')
        try { localStorage.setItem('mt-last-user', u.username) } catch {}
        // an empty password (first start) must be changed before going on
        if (!pass) {
          d.root.style.display = 'none'
          const ok = await forcePasswordChange(u)
          if (!ok) { d.root.style.display = ''; return d.error('يجب تعيين كلمة مرور للمتابعة') }
        } else if (!u.password?.startsWith('sha256$')) DB.run('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(pass), u.id])
        DB.audit('تسجيل دخول', u.username)
        await DB.flush()
        d.close(true)
      } },
      { label: 'الغاء', icon: 'cancel', onClick: () => window.close() },
    ],
  })
}

function forcePasswordChange(u) {
  return UI.dialog({
    head: 'تعيين كلمة مرور جديدة', width: 430,
    bodyHtml: `<div style="flex:1;display:flex;flex-direction:column;gap:8px"><div style="font-size:12px">لحماية بياناتك، عيّن كلمة مرور للمستخدم «${UI.esc(u.username)}» قبل المتابعة.</div>
      <div class="fields" style="grid-template-columns:110px 1fr"><label>كلمة المرور</label><input type="password" id="np1"><label>تأكيد</label><input type="password" id="np2"></div></div>`,
    buttons: [
      { label: 'حفظ', icon: 'save', onClick: async (d) => {
        const a = d.root.querySelector('#np1').value, b = d.root.querySelector('#np2').value
        if (a.length < 4) return d.error('كلمة المرور 4 أحرف على الأقل')
        if (a !== b) return d.error('كلمتا المرور غير متطابقتين')
        DB.run('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(a), u.id])
        DB.audit('تعيين كلمة مرور', u.username)
        await DB.flush()
        d.close(true)
      } },
      { label: 'الغاء', icon: 'cancel', onClick: (d) => d.close(false) },
    ],
  })
}

async function logout() {
  DB.audit('تسجيل خروج', Session.username)
  await DB.flush()
  location.reload()
}

async function restoreBackup() {
  if (!Session.admin) return UI.message('استرجاع النسخ الاحتياطية لمدير النظام فقط')
  const ok = await UI.dialog({ head: 'استرجاع نسخة احتياطية', width: 440,
    bodyHtml: '<div>سيتم استبدال كل البيانات الحالية بمحتوى النسخة الاحتياطية المختارة. يُنصح بأخذ نسخة احتياطية من البيانات الحالية أولاً. متابعة؟</div>',
    buttons: [{ label: 'نعم', icon: 'ok', onClick: (d) => d.close(true) }, { label: 'لا', icon: 'cancel', onClick: (d) => d.close(false) }] })
  if (!ok) return
  const bytes = await window.bridge.pickDb()
  if (!bytes) return
  if (!(await DB.restore(bytes))) return UI.message('الملف ليس نسخة احتياطية صالحة من البرنامج')
  await UI.message('تم استرجاع النسخة الاحتياطية — سيتم إعادة تشغيل البرنامج')
  window.bridge.relaunch()
}

;(async function start() {
  await DB.init()
  await DB.open()
  licence = await window.bridge.licenceStatus()
  setCaption()
  await login()
  buildMenu()
  renderHome()
  WebSync.init()
})()
