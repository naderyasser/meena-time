// Login → home (4 tiles + trial notice) → Arabic menu bar, as in Apex Time.
const VERSION = '1.2.4'
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
    ['قراءة الحركات (شبكة - ملف)', openReadPunches], ['نقل بصمات الموظفين بين الأجهزة', openTransferFingers], ['الغاء الحركات المسحوبة خلال فترة', () => deletePunchesInPeriod(['device', 'file'], 'الغاء الحركات المسحوبة خلال فترة')],
    ['عرض الحركات', openViewPunches], '-',
    ['إضافة وتعديل الحركات لموظف', openEditPunches], ['الغاء الحركات المعدلة يدويا', () => deletePunchesInPeriod(['manual'], 'الغاء الحركات المعدلة يدويا')], '-',
    ['إضافة إجازات لموظف', openLeaves], ['إضافة أذونات لموظف', openPermissions], '-',
    ['ترحيل الحركات', postPunches], ['الغاء ترحيل الحركات', openUnpost], ['الغاء جميع بيانات الموظف بالنظام', purgeEmployee],
  ] },
  { label: 'التقارير', icon: 'm_rep', items: Object.keys(REPORTS).map((r) => [r, () => openReport(r)]) },
  { label: 'الإعدادات', icon: 'm_set', items: [['بيانات المؤسسة', openCompany], ['لائحة الجزاءات', openPenaltyRules],
    ['اعدادات المستخدمين', [['صلاحيات المستخدمين', openRoles], ['إدارة المستخدمين', openUsers]]], ['اعدادات النظام', openSystemSettings], ['الربط بالموقع', openWebLink]] },
  { label: 'أدوات', icon: 'm_tools', items: [['تسجيل المنتج', () => openRegister()], ['نسخة احتياطية', backupNow], ['استرجاع نسخة احتياطية', restoreBackup], ['انشاء قاعدة بيانات', openCreateDb], ['سجل الحركات', openAuditLog], '-', ['تسجيل خروج', logout]] },
  { label: 'مساعدة', icon: 'm_help', items: [['دليل الاستخدام', openGuide], ['عن البرنامج', async () => { const p = await window.bridge.paths(); UI.message(`Meena Time — الإصدار ${VERSION}\nمجلد البيانات: ${p.data}\nالنسخ الاحتياطية: ${p.backups} (نسخة تلقائية يومياً، آخر 30 نسخة)`) }]] },
]

let licence = { ok: false }
const Session = (window.Session = { userId: null, username: '', admin: false, perms: null })

function setCaption() {
  document.getElementById('caption-text').textContent =
    `Meena Time Ver. ${VERSION} (${licence.ok ? licence.edition : 'Trial'}) ${licence.ok ? 'Registered' : 'Unregistered'}${DB.year !== 'main' ? ` — ${DB.year}` : ''}`
}

function buildMenu() {
  const bar = document.getElementById('menubar')
  bar.innerHTML = ''
  for (const m of MENUS) {
    const menu = UI.el(`<div class="menu"><button>${ICONS[m.icon]}<span>${m.label}</span></button><div class="drop"></div></div>`)
    const drop = menu.querySelector('.drop')
    // screen keys are "<menu>/<item>" — the same label can exist in two menus; a sub-menu
    // (Apex's «اعدادات المستخدمين ▸») shows when any of its items is allowed
    const open = ['تسجيل المنتج', 'عن البرنامج', 'دليل الاستخدام', 'تسجيل خروج']
    const allowed = (label, fn) => Array.isArray(fn) ? fn.some(([l]) => allowed(l)) : open.includes(label) || Perm.can(`${m.label}/${label}`)
    const items = m.items.filter((it) => it === '-' || allowed(it[0], it[1])).filter((it, i, a) => !(it === '-' && (i === 0 || a[i - 1] === '-' || i === a.length - 1)))
    if (!items.some((it) => it !== '-')) continue
    const itemButton = (label, fn) => {
      const b = UI.el(`<button>${ICONS.item.replace('<svg', '<svg class="ico"')}<span>${label}</span></button>`)
      b.onclick = () => { closeMenus(); Perm.run(`${m.label}/${label}`, fn || soon(label)) }
      return b
    }
    for (const it of items) {
      if (it === '-') { drop.appendChild(UI.el('<hr>')); continue }
      const [label, fn] = it
      if (Array.isArray(fn)) {
        const sub = UI.el(`<div class="sub"><button class="has-sub">${ICONS.item.replace('<svg', '<svg class="ico"')}<span>${label}</span><i>◂</i></button><div class="drop sub-drop"></div></div>`)
        for (const [l, f] of fn.filter(([l]) => allowed(l))) sub.querySelector('.sub-drop').appendChild(itemButton(l, f))
        drop.appendChild(sub)
      } else drop.appendChild(itemButton(label, fn))
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
  const guard = (l, fn) => () => (Perm.can(l) ? Perm.run(l, fn) : UI.message('ليس لديك صلاحية لهذه الشاشة'))
  home.querySelector('[data-t=setup]').onclick = guard('البيانات الأساسية/مواعيد العمل', openShiftGroups)
  home.querySelector('[data-t=users]').onclick = guard('الإعدادات/إدارة المستخدمين', openUsers)
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
  const names = (await window.bridge.dbNames?.()) || ['main']
  const last = localStorage.getItem('mt-last-user') || 'أ'
  return UI.dialog({
    winbar: 'تسجيل الدخول | برنامج الحضور والانصراف',
    head: 'شاشة الدخول', width: 470,
    // another database: remember the choice and restart on it (each database has its own users)
    onOpen: (d) => d.root.querySelector('#year').addEventListener('change', async (e) => {
      if (await window.bridge.useDb(e.target.value)) window.bridge.relaunch()
    }),
    bodyHtml: `
      <div class="fields">
        <label>قاعدة البيانات</label><select id="year" ${names.length > 1 ? '' : 'disabled'}>${names.map((n) => `<option value="${UI.esc(n)}" ${n === DB.year ? 'selected' : ''}>${UI.esc(dbLabel(n))}</option>`).join('')}</select>
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
        // «admin» (any case) also signs in as the built-in administrator «أ», as in Apex Time
        const u = DB.one('SELECT * FROM users WHERE username = ?', [user])
          || (user.toLowerCase() === 'admin' ? DB.one("SELECT * FROM users WHERE username = 'أ'") : null)
        if (!u || !(await checkPassword(u.password, pass))) {
          DB.audit('محاولة دخول فاشلة', user)
          return d.error('اسم المستخدم أو كلمة المرور غير صحيحة')
        }
        Session.userId = u.id
        Session.username = u.username
        const role = DB.one('SELECT * FROM roles WHERE id = ?', [u.role_id]) || {}
        Session.roleId = role.id || null
        Session.admin = !!role.builtin
        Session.rolePerms = JSON.parse(role.perms || '{}')
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

const dbLabel = (n) => (n === 'main' ? 'قاعدة البيانات الرئيسية' : n)

// Apex «إنشاء قاعدة البيانات»: a new, empty copy of the program's database next to the
// current one; pick it later from «قاعدة البيانات» on the login screen.
function openCreateDb() {
  if (!Session.admin) return UI.message('انشاء قواعد البيانات لمدير النظام فقط')
  if (!licence.ok) return UI.message('انشاء أكثر من قاعدة بيانات متاح في النسخة المسجلة فقط')
  UI.openWindow('create-db', 'إنشاء قاعدة البيانات', { width: 760, height: 360 }, (body, win) => {
    const bar = UI.toolbar([{ key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() }])
    const view = UI.el(`<div class="create-db"><div class="side">إنشاء قاعدة بيانات جديدة</div>
      <fieldset><legend>قاعدة بيانات جديدة</legend>
        <div class="warn">هذه العملية ستؤدي إلى إنشاء نسخة جديدة من قاعدة البيانات</div>
        <div class="fields"><label>قاعدة البيانات الحالية</label><input type="text" id="cd-cur" readonly value="${UI.esc(dbLabel(DB.year))}">
          <label>قاعدة البيانات الجديدة</label><input type="text" id="cd-name" maxlength="40">
          <label>كلمة مرور مدير النظام</label><input type="password" id="cd-pw"></div>
        <button id="cd-go">${ICONS.save || ''}<span>إنشاء</span></button></fieldset></div>`)
    body.append(bar, view)
    const $ = (s) => view.querySelector(s)
    $('#cd-go').onclick = async () => {
      const name = $('#cd-name').value.trim()
      if (!name) return UI.message('اكتب اسم قاعدة البيانات الجديدة')
      if (/[\\/:*?"<>|.]/.test(name) || /^\d{4}$/.test(name) || name === 'main') return UI.message('اسم قاعدة البيانات غير صالح (لا يحتوي على \\ / : * ? " < > | . وليس سنة من 4 أرقام فقط)')
      const u = DB.one('SELECT password FROM users WHERE id = ?', [Session.userId])
      if (!u || !(await checkPassword(u.password, $('#cd-pw').value))) return UI.message('كلمة مرور مدير النظام غير صحيحة')
      const res = await window.bridge.createDb(name, new Uint8Array(0))
      if (!res.ok) return UI.message(res.error)
      DB.audit('انشاء قاعدة بيانات', name)
      await DB.flush()
      $('#cd-pw').value = ''
      const go = await UI.confirm(`تم انشاء قاعدة البيانات «${name}» بنجاح. الانتقال إليها الآن؟ (اسم المستخدم «أ» بدون كلمة مرور)`)
      if (go && (await window.bridge.useDb(name))) window.bridge.relaunch()
    }
  })
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
  AutoRead.restart()
})()
