// Login → home (4 tiles + trial notice) → Arabic menu bar, as in Apex Time.
const VERSION = '0.1.0'
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
    ['قوائم البرنامج'], ['الإدارات والأقسام'], ['المشاريع'], ['مواعيد العمل', openShiftGroups], ['الموظفين'],
    ['مجموعات الموظفين'], ['تعريف الأجهزة'], ['العطلات الرسمية'],
  ] },
  { label: 'الإجراءات', icon: 'm_proc', items: [
    ['قراءة الحركات (شبكة - ملف)'], ['الغاء الحركات المسحوبة خلال فترة'], ['عرض الحركات'], '-',
    ['إضافة وتعديل الحركات لموظف'], ['الغاء الحركات المعدلة يدويا'], '-',
    ['إضافة إجازات لموظف'], ['إضافة أذونات لموظف'], '-',
    ['ترحيل الحركات'], ['الغاء ترحيل الحركات'], ['الغاء جميع بيانات الموظف بالنظام'],
  ] },
  { label: 'التقارير', icon: 'm_rep', items: [
    ['مواعيد العمل'], ['الموظفين'], ['الحركات الغير مكتملة'], ['التأخير عن بداية الدوام اليومي'],
    ['التأخير عن الدوام خلال فترة'], ['إجازات الموظفين'], ['الحضور والانصراف تفصيلي'],
    ['الحضور والانصراف إجمالي'], ['الغياب خلال فترة'], ['حالة اليوم'],
  ] },
  { label: 'الإعدادات', icon: 'm_set', items: [['بيانات المؤسسة'], ['اعدادات المستخدمين'], ['اعدادات النظام']] },
  { label: 'أدوات', icon: 'm_tools', items: [['تسجيل المنتج', () => openRegister()], ['نسخة احتياطية']] },
  { label: 'مساعدة', icon: 'm_help', items: [['عن البرنامج', () => UI.message(`Meena Time — الإصدار ${VERSION}`)]] },
]

let licence = { ok: false }

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
    for (const it of m.items) {
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
  home.querySelector('[data-t=setup]').onclick = openShiftGroups
  home.querySelector('[data-t=users]').onclick = soon('المستخدمين')
  home.querySelector('[data-t=reports]').onclick = soon('التقارير')
  home.querySelector('[data-t=proc]').onclick = soon('الإجراءات')
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
  const years = await window.bridge.listDbs()
  const thisYear = String(new Date().getFullYear())
  if (!years.includes(thisYear)) years.push(thisYear)
  years.sort().reverse()
  return UI.dialog({
    winbar: 'تسجيل الدخول | برنامج الحضور والانصراف',
    head: 'شاشة الدخول', width: 470,
    bodyHtml: `
      <div class="fields">
        <label>قاعدة البيانات</label><select id="year">${years.map((y) => `<option>${y}</option>`).join('')}</select>
        <label>اسم المستخدم</label><input type="text" id="user" value="أ">
        <label>كلمة المرور</label><input type="password" id="pass">
        <label>الواجهة</label>
        <div class="lang"><label style="color:inherit;font-weight:normal"><input type="radio" name="lang" checked> عربي</label>
          <label style="color:inherit;font-weight:normal"><input type="radio" name="lang" disabled> English</label></div>
      </div>
      <div class="avatar">${ICONS.avatar}</div>`,
    buttons: [
      { label: 'موافق', icon: 'ok', onClick: async (d) => {
        const year = d.root.querySelector('#year').value
        const user = d.root.querySelector('#user').value.trim()
        const pass = d.root.querySelector('#pass').value
        await DB.open(year)
        const u = DB.one('SELECT id FROM users WHERE username = ? AND password = ?', [user, pass])
        if (!u) return d.error('اسم المستخدم أو كلمة المرور غير صحيحة')
        d.close(true)
      } },
      { label: 'الغاء', icon: 'cancel', onClick: () => window.close() },
    ],
  })
}

;(async function start() {
  await DB.init()
  licence = await window.bridge.licenceStatus()
  setCaption()
  await login()
  buildMenu()
  renderHome()
})()
