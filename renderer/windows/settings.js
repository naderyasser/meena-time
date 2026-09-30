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

// «بيانات الشركة» — Apex Time's company screen; everything here prints in the report header/footer
const COMPANY_FIELDS = [
  ['company_name', 'اسم الشركة عربى', 'rtl'], ['company_name_en', 'اسم الشركة أجنبى', 'ltr'],
  ['company_activity', 'اسم النشاط عربى', 'rtl'], ['company_activity_en', 'اسم النشاط أجنبى', 'ltr'],
  ['company_address', 'العنوان عربى', 'rtl'], ['company_address_en', 'العنوان أجنبى', 'ltr'],
]
function openCompany() {
  UI.openWindow('company', 'بيانات الشركة', { width: 860, height: 520 }, (body, win) => {
    let logo = meta('company_logo')
    const bar = UI.toolbar([
      { key: 'save', label: 'موافق', icon: 'save', onClick: save },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const inp = (k, dir = 'ltr') => `<input type="text" id="co-${k}" dir="${dir}" value="${UI.esc(meta(k))}">`
    const form = UI.el(`<div class="company">
      <div class="side">بيانات الشركة</div>
      <div class="main">
        ${COMPANY_FIELDS.map(([k, l, d]) => `<label>${l}</label>${inp(k, d)}`).join('')}
        <label>الموقع الالكترونى</label>${inp('company_website')}
        <label>ايميل الشركة</label>${inp('company_email')}
        <label>التليفون</label>${inp('company_phone')}
        <div class="aside">
          <label>الفاكس</label>${inp('company_fax')}
          <label>الشعار</label><label class="upload"><input type="file" id="co-logo" accept="image/*" hidden><span>Upload</span></label>
          <div class="logo" id="co-logo-img">${logo ? `<img src="${logo}" alt="">` : ''}</div>
        </div>
      </div></div>`)
    body.append(bar, form)
    form.querySelector('#co-logo').addEventListener('change', (e) => {
      const f = e.target.files[0]
      if (!f) return
      if (!f.type.startsWith('image/')) return UI.message('الملف ليس صورة صالحة')
      if (f.size > 1024 * 1024) return UI.message('حجم الشعار كبير (الحد 1 ميجابايت)')
      const rd = new FileReader()
      rd.onload = () => { logo = rd.result; form.querySelector('#co-logo-img').innerHTML = `<img src="${logo}" alt="">` }
      rd.readAsDataURL(f)
    })
    async function save() {
      const v = (k) => form.querySelector(`#co-${k}`).value.trim()
      if (!v('company_name')) return UI.message('اسم الشركة مطلوب — يظهر في رأس التقارير')
      if (v('company_email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('company_email'))) return UI.message('البريد الالكتروني غير صحيح')
      for (const k of [...COMPANY_FIELDS.map((f) => f[0]), 'company_website', 'company_email', 'company_phone', 'company_fax']) setMeta(k, v(k))
      setMeta('company_logo', logo || '')
      DB.audit('بيانات الشركة', 'حفظ')
      await DB.flush()
      UI.message('تم حفظ بيانات الشركة')
    }
  })
}

// «إعدادات النظام» — Apex Time's system settings screen: attendance rules (engine.js
// SETTINGS_DEFAULT), the «بيان تأخير الموظفين» report colours, and the daily automatic
// read-and-post schedule. Saved as one JSON row (meta sys_settings).
const SHIFT_COUNT_NAMES = [[1, 'وردية'], [2, 'ورديتان'], [3, 'ثلاث ورديات'], [4, 'أربع ورديات']]
const COLOR_FIELDS = [['holiday', 'عطله رسمية'], ['permission', 'أذن'], ['weekly', 'عطلة أسبوعية'], ['early', 'خروج مبكر'],
  ['leave', 'أجازة'], ['late', 'تأخير'], ['absent', 'غياب'], ['present', 'مداوم']]

function openSystemSettings() {
  UI.openWindow('sys-settings', 'إعدادات النظام', { width: 1000, height: 470 }, (body, win) => {
    const S = Engine.settings()
    const devices = DB.all('SELECT id, name FROM devices ORDER BY name')
    let times = [...(S.auto_times || [])].sort()
    const bar = UI.toolbar([
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const num = (id, v, on = true) => `<input type="text" inputmode="numeric" dir="ltr" class="num" id="${id}" value="${+v || 0}" ${on ? '' : 'disabled'}>`
    const form = UI.el(`<div class="sys-set">
      <fieldset class="rules">
        <div class="row"><label>وقت إهمال الحركات بالدقائق</label>${num('s-ignore', S.ignore_min)}</div>
        <div class="row"><label>عدد الورديات التي تظهر في التقارير</label><select id="s-shifts">${SHIFT_COUNT_NAMES.map(([v, l]) => `<option value="${v}" ${+S.report_shifts === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="row"><label>يحتسب الاضافي قبل الدوام</label>${num('s-otb', S.ot_before_min)}<span>بالدقائق</span></div>
        <div class="row"><label>يحتسب الاضافي بعد الدوام</label>${num('s-ota', S.ot_after_min)}<span>بالدقائق</span></div>
        <div class="row"><label><input type="checkbox" id="s-al" ${S.absent_late_on ? 'checked' : ''}> يتم احتساب اليوم غياب بعد تأخير</label>${num('s-alm', S.absent_late_min, S.absent_late_on)}<span>بالدقائق</span></div>
        <div class="row"><label><input type="checkbox" id="s-ae" ${S.absent_early_on ? 'checked' : ''}> يتم احتساب اليوم غياب بعد انصراف مبكر</label>${num('s-aem', S.absent_early_min, S.absent_early_on)}<span>بالدقائق</span></div>
        <div class="row"><label><input type="checkbox" id="s-fl" ${S.first_last ? 'checked' : ''}> احتساب اول حركة دخول واخر حركة انصراف</label></div>
      </fieldset>
      <fieldset class="auto">
        <div class="row"><label><input type="checkbox" id="s-auto" ${S.auto_read ? 'checked' : ''}> قراءة الحركات اليوميه والترحيل الالي</label></div>
        <div class="row"><label>قراءة بيانات الأجهزة</label><select id="s-dev"><option value="">الكل</option>${devices.map((d) => `<option value="${d.id}" ${String(S.auto_device) === String(d.id) ? 'selected' : ''}>${UI.esc(d.name)}</option>`).join('')}</select></div>
        <div class="row top"><label>مواعيد القراءة</label><div class="times">
          <div class="add"><input type="text" id="s-time" value="00:00:00" dir="ltr" maxlength="8" placeholder="00:00:00"><button type="button" id="s-tadd" title="اضافة موعد">${ICONS.new || '+'}</button><button type="button" id="s-tdel" title="حذف الموعد المحدد">${ICONS.del || '×'}</button></div>
          <select id="s-tlist" size="5" dir="ltr"></select></div></div>
        <div class="note">يعمل أثناء فتح البرنامج: تُقرأ الأجهزة في كل موعد، ويُرحَّل كل يوم منتهٍ لم يُرحَّل بعد.</div>
      </fieldset>
      <fieldset class="colors"><legend>تقرير بيان تأخير الموظفين</legend>
        ${COLOR_FIELDS.map(([k, l]) => `<label class="clr"><input type="color" id="c-${k}" value="${S.colors[k]}"> ${l}</label>`).join('')}
      </fieldset>
    </div>`)
    body.append(bar, form)
    const $ = (id) => form.querySelector(id)
    const toggle = (chk, inp) => $(chk).addEventListener('change', () => { $(inp).disabled = !$(chk).checked })
    toggle('#s-al', '#s-alm'); toggle('#s-ae', '#s-aem')
    const drawTimes = () => { $('#s-tlist').innerHTML = times.map((t) => `<option>${t}</option>`).join('') }
    drawTimes()
    $('#s-tadd').onclick = () => {
      const m = ($('#s-time').value || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
      if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] || 0) > 59) return UI.message('اكتب الموعد بصيغة 24 ساعة: ساعة:دقيقة:ثانية (مثال 22:40:00)')
      const t = `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`
      if (!times.includes(t)) times = [...times, t].sort()
      drawTimes()
    }
    $('#s-tdel').onclick = () => { const t = $('#s-tlist').value; if (t) { times = times.filter((x) => x !== t); drawTimes() } }

    async function save() {
      const n = (id, max = 1440) => {
        const v = $(id).value.trim()
        if (!/^\d{1,4}$/.test(v) || +v > max) throw new Error('القيم بالدقائق: أرقام صحيحة من 0 إلى ' + max)
        return +v
      }
      let next
      try {
        next = {
          ignore_min: n('#s-ignore', 120), report_shifts: +$('#s-shifts').value, ot_before_min: n('#s-otb'), ot_after_min: n('#s-ota'),
          absent_late_on: $('#s-al').checked ? 1 : 0, absent_late_min: n('#s-alm'), absent_early_on: $('#s-ae').checked ? 1 : 0, absent_early_min: n('#s-aem'),
          first_last: $('#s-fl').checked ? 1 : 0,
          colors: Object.fromEntries(COLOR_FIELDS.map(([k]) => [k, $(`#c-${k}`).value])),
          auto_read: $('#s-auto').checked ? 1 : 0, auto_device: $('#s-dev').value, auto_times: times,
        }
      } catch (e) { return UI.message(e.message) }
      if (next.auto_read && !next.auto_times.length) return UI.message('حدد موعداً واحداً على الأقل لقراءة الحركات')
      setMeta('sys_settings', JSON.stringify(next))
      DB.audit('إعدادات النظام', 'حفظ')
      await DB.flush()
      AutoRead.restart()
      UI.message('تم حفظ إعدادات النظام')
    }
  })
}

// «قراءة الحركات اليوميه والترحيل الالي» — while the app is open: at each chosen time read
// the device(s), then post every finished day since the last posted period (never today).
const AutoRead = {
  timer: null, done: new Set(),
  read: (d) => window.bridge.readDevice({ ip: d.ip, port: +d.port || 4370 }),
  restart() {
    clearInterval(this.timer)
    this.timer = null
    if (!Engine.settings().auto_read) return
    this.timer = setInterval(() => this.tick(), 20000)
    this.tick()
  },
  async tick(now = new Date()) {
    const S = Engine.settings()
    if (!S.auto_read) return
    const day = Engine.iso(now), hms = now.toTimeString().slice(0, 8)
    for (const t of S.auto_times || []) {
      const key = `${day} ${t}`
      // due = the time passed within the last 10 minutes and not run yet today
      const late = (Engine.toMin(hms) - Engine.toMin(t)) * 60 + (+hms.slice(6) - +t.slice(6))
      if (late < 0 || late > 600 || this.done.has(key)) continue
      this.done.add(key)
      await this.run(S)
    }
  },
  async run(S = Engine.settings()) {
    const devices = DB.all('SELECT * FROM devices').filter((d) => !S.auto_device || String(d.id) === String(S.auto_device))
    const log = []
    for (const d of devices) {
      const res = await this.read(d)
      log.push(res.ok ? `${d.name}: ${await storePunches(res.punches, 'device', d.id)}` : `${d.name}: ${res.error || 'تعذّر الاتصال'}`)
    }
    const yesterday = Engine.addDays(Engine.today(), -1)
    const lastPosted = DB.one('SELECT MAX(to_date) AS d FROM posted_periods')?.d
    const from = lastPosted ? Engine.addDays(lastPosted, 1) : DB.one('SELECT MIN(substr(ts, 1, 10)) AS d FROM punches')?.d
    if (from && from <= yesterday && !DB.one('SELECT 1 FROM posted_periods WHERE from_date <= ? AND to_date >= ? LIMIT 1', [yesterday, from])) {
      const n = Engine.post(from, yesterday)
      log.push(`ترحيل ${from} → ${yesterday}: ${n} يوم`)
    }
    DB.audit('قراءة وترحيل آلي', log.join(' | ') || 'لا توجد أجهزة')
    await DB.flush()
    return log
  },
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
// ── Apex «صلاحيات المستخدمين» + «إدارة المستخدمين» ──────────────────────────────
// Screens = every menu item (sub-menu items included), keyed "<menu>/<item>", numbered
// like Apex (300 … per menu). English names as Apex shows them.
const SCREEN_EN = {
  'قوائم البرنامج': 'Setup programs', 'الإدارات والأقسام': 'Branches and Departments', 'المشاريع': 'Projects', 'مواعيد العمل': 'Shifts',
  'الموظفين': 'Employees', 'مجموعات الموظفين': 'Groups', 'تعريف الأجهزة': 'Machines', 'العطلات الرسمية': 'Holidays', 'مواعيد رمضان': 'Ramadan timings',
  'قراءة الحركات (شبكة - ملف)': 'Read machines', 'الغاء الحركات المسحوبة خلال فترة': 'Cancel read transactions', 'عرض الحركات': 'Show transactions',
  'إضافة وتعديل الحركات لموظف': 'Add transactions', 'الغاء الحركات المعدلة يدويا': 'Cancel manual transactions', 'إضافة إجازات لموظف': 'Employee vacations',
  'إضافة أذونات لموظف': 'Employee permissions', 'ترحيل الحركات': 'Post transactions', 'الغاء ترحيل الحركات': 'Unpost transactions',
  'الغاء جميع بيانات الموظف بالنظام': 'Delete employee data', 'بيانات المؤسسة': 'Company information', 'لائحة الجزاءات': 'Penalty rules',
  'صلاحيات المستخدمين': 'User permissions', 'إدارة المستخدمين': 'Users', 'اعدادات النظام': 'System settings', 'الربط بالموقع': 'Web link',
  'نسخة احتياطية': 'Backup', 'استرجاع نسخة احتياطية': 'Restore backup', 'سجل الحركات': 'Audit log',
}
const HIDDEN_SCREENS = ['تسجيل المنتج', 'تسجيل خروج']
function screenList() {
  const out = []
  MENUS.filter((m) => m.label !== 'مساعدة').forEach((m, mi) => {
    let n = 0
    const add = (label) => { if (!HIDDEN_SCREENS.includes(label)) out.push({ key: `${m.label}/${label}`, code: (mi + 3) * 100 + n++, ar: label, en: SCREEN_EN[label] || '' }) }
    for (const it of m.items) {
      if (it === '-') continue
      if (Array.isArray(it[1])) it[1].forEach(([l]) => add(l)); else add(it[0])
    }
  })
  return out
}
let permClipboard = null

function openRoles() {
  UI.openWindow('roles', 'صلاحيات المستخدمين', { width: 1000, height: 600 }, (body, win) => {
    const screens = screenList()
    let current = null // role row being edited (null = new)
    const bar = UI.toolbar([
      { key: 'new', label: 'جديد', icon: 'new', onClick: () => pick(null) },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'del', label: 'حذف', icon: 'del', onClick: remove },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const view = UI.el(`<div class="roles">
      <div class="top">
        <fieldset class="info"><legend>صلاحيات الاستخدام</legend><div class="fields" style="grid-template-columns:110px 1fr">
          <label>رقم الصلاحية</label><input type="text" id="ro-id" readonly>
          <label>الاسم العربي</label><input type="text" id="ro-ar">
          <label>الاسم الإنجليزي</label><input type="text" id="ro-en" dir="ltr"></div></fieldset>
        <div class="list"><div class="band">الصلاحيات</div><div class="grid-wrap"><table class="grid"><thead><tr><th style="width:16px"></th><th style="width:90px">رقم الصلاحية</th><th class="sorted">الاسم العربي</th><th>الاسم الانجليزي</th></tr></thead><tbody id="ro-list"></tbody></table></div></div>
      </div>
      <div class="band">شاشات البرنامج</div>
      <div class="grid-wrap screens"><table class="grid"><thead><tr><th style="width:60px" class="sorted">الكود</th><th>اسم الشاشة</th><th>اسم الشاشة إنجليزي</th>${Perm.ACTIONS.map(([, l]) => `<th style="width:56px">${l}</th>`).join('')}</tr></thead>
        <tbody>${screens.map((sc) => `<tr data-key="${UI.esc(sc.key)}"><td class="center">${sc.code}</td><td>${UI.esc(sc.ar)}</td><td dir="ltr">${UI.esc(sc.en)}</td>${Perm.ACTIONS.map(([a]) => `<td class="center"><input type="checkbox" data-a="${a}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="perm-btns"><button id="ro-copy">${ICONS.new || ''}<span>نسخ الصلاحيات</span></button><button id="ro-paste"><span>لصق الصلاحيات</span></button>
        <button id="ro-all"><span>تحديد الكل</span></button><button id="ro-none"><span>إلغاء الكل</span></button></div>
    </div>`)
    body.append(bar, view)
    const $ = (s) => view.querySelector(s)
    const boxes = () => [...view.querySelectorAll('.screens input[data-a]')]
    const readPerms = () => {
      const perms = {}
      for (const tr of view.querySelectorAll('.screens tr[data-key]')) {
        const p = Object.fromEntries([...tr.querySelectorAll('input[data-a]')].filter((i) => i.checked).map((i) => [i.dataset.a, 1]))
        if (Object.keys(p).length) perms[tr.dataset.key] = { ...p, view: 1 } // any action implies seeing the screen
      }
      return perms
    }
    const writePerms = (perms, locked) => {
      for (const tr of view.querySelectorAll('.screens tr[data-key]')) {
        for (const i of tr.querySelectorAll('input[data-a]')) { i.checked = locked || !!perms?.[tr.dataset.key]?.[i.dataset.a]; i.disabled = locked }
      }
    }
    // ticking any action ticks «عرض»; unticking «عرض» clears the row
    view.querySelector('.screens').addEventListener('change', (e) => {
      const i = e.target, tr = i.closest('tr')
      if (i.dataset.a === 'view' && !i.checked) tr.querySelectorAll('input[data-a]').forEach((x) => (x.checked = false))
      else if (i.checked) tr.querySelector('input[data-a=view]').checked = true
    })
    function load(selectId) {
      const tb = $('#ro-list')
      tb.innerHTML = ''
      for (const r of DB.all('SELECT * FROM roles ORDER BY id')) {
        const tr = UI.el(`<tr data-id="${r.id}"><td class="sel"></td><td class="center">${r.id}</td><td>${UI.esc(r.name_ar)}</td><td dir="ltr">${UI.esc(r.name_en)}</td></tr>`)
        tr.onmousedown = () => pick(r)
        tb.appendChild(tr)
      }
      const sel = selectId ? DB.one('SELECT * FROM roles WHERE id = ?', [selectId]) : DB.one('SELECT * FROM roles ORDER BY id LIMIT 1')
      pick(sel)
    }
    function pick(r) {
      current = r
      view.querySelectorAll('#ro-list tr').forEach((tr) => tr.classList.toggle('current', !!r && +tr.dataset.id === r.id))
      $('#ro-id').value = r?.id ?? ''
      $('#ro-ar').value = r?.name_ar ?? ''
      $('#ro-en').value = r?.name_en ?? ''
      const locked = !!r?.builtin
      $('#ro-ar').readOnly = $('#ro-en').readOnly = locked
      writePerms(r ? JSON.parse(r.perms || '{}') : {}, locked)
      ;['#ro-paste', '#ro-all', '#ro-none'].forEach((b) => { $(b).disabled = locked })
      if (!r) $('#ro-ar').focus()
    }
    $('#ro-copy').onclick = () => { permClipboard = current?.builtin ? Object.fromEntries(screenList().map((s) => [s.key, Object.fromEntries(Perm.ACTIONS.map(([a]) => [a, 1]))])) : readPerms(); UI.message('تم نسخ الصلاحيات') }
    $('#ro-paste').onclick = () => { if (!permClipboard) return UI.message('انسخ صلاحيات أولاً'); writePerms(permClipboard, false) }
    $('#ro-all').onclick = () => boxes().forEach((i) => { i.checked = true })
    $('#ro-none').onclick = () => boxes().forEach((i) => { i.checked = false })
    async function save() {
      if (current?.builtin) return UI.message('«مدير النظام» له كل الصلاحيات ولا يمكن تعديله')
      const ar = $('#ro-ar').value.trim(), en = $('#ro-en').value.trim()
      if (!ar) return UI.message('الاسم العربي للصلاحية مطلوب')
      if (DB.one('SELECT 1 FROM roles WHERE name_ar = ? AND id != ?', [ar, current?.id || 0])) return UI.message('يوجد صلاحية بنفس الاسم')
      const perms = JSON.stringify(readPerms())
      let id = current?.id
      if (id) DB.run('UPDATE roles SET name_ar = ?, name_en = ?, perms = ? WHERE id = ?', [ar, en, perms, id])
      else { DB.run('INSERT INTO roles (name_ar, name_en, perms) VALUES (?, ?, ?)', [ar, en, perms]); id = DB.one('SELECT last_insert_rowid() AS id').id }
      DB.audit('تعديل صلاحيات', ar, `${Object.keys(JSON.parse(perms)).length} شاشة`)
      await DB.flush()
      if (id === Session.roleId) Session.rolePerms = JSON.parse(perms)
      load(id)
      UI.message('تم الحفظ')
    }
    async function remove() {
      if (!current) return UI.message('اختر صلاحية')
      if (current.builtin) return UI.message('لا يمكن حذف «مدير النظام»')
      if (DB.one('SELECT 1 FROM users WHERE role_id = ?', [current.id])) return UI.message('لا يمكن حذف صلاحية مرتبطة بمستخدمين')
      if (!(await UI.confirm(`حذف الصلاحية «${current.name_ar}»؟`))) return
      DB.run('DELETE FROM roles WHERE id = ?', [current.id])
      DB.audit('حذف صلاحية', current.name_ar)
      await DB.flush()
      load()
    }
    load()
  })
}

function openUsers() {
  UI.openWindow('users', 'إدارة المستخدمين', { width: 1000, height: 520 }, (body, win) => {
    let current = null
    const bar = UI.toolbar([
      { key: 'new', label: 'جديد', icon: 'new', onClick: () => pick(null) },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'del', label: 'حذف', icon: 'del', onClick: remove },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const roles = () => DB.all('SELECT id, name_ar FROM roles ORDER BY id')
    const view = UI.el(`<div class="users-apex">
      <div class="band">إضافة المستخدمين والصلاحيات</div>
      <div class="fields u-form">
        <label>الكود</label><input type="text" id="us-id" readonly><label>الصلاحية</label><select id="us-role"></select>
        <label>إسم الدخول</label><input type="text" id="us-login"><label>اسم المستخدم</label><input type="text" id="us-name">
        <label>كلمة المرور</label><input type="password" id="us-pw" placeholder="اتركها فارغة لعدم التغيير"><label>تأكيد كلمة المرور</label><input type="password" id="us-pw2">
      </div>
      <div class="band">بيانات المستخدمين</div>
      <div class="grid-wrap"><table class="grid"><thead><tr><th style="width:16px"></th><th style="width:60px" class="sorted">الكود</th><th>إسم الدخول</th><th>كلمة المرور</th><th>الصلاحية</th><th>اسم المستخدم</th></tr></thead><tbody id="us-list"></tbody></table></div>
    </div>`)
    body.append(bar, view)
    const $ = (s) => view.querySelector(s)
    function load(selectId) {
      $('#us-role').innerHTML = roles().map((r) => `<option value="${r.id}">${UI.esc(r.name_ar)}</option>`).join('')
      const tb = $('#us-list')
      tb.innerHTML = ''
      for (const u of DB.all('SELECT u.*, r.name_ar role FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.id')) {
        const tr = UI.el(`<tr data-id="${u.id}"><td class="sel"></td><td class="center">${u.id}</td><td>${UI.esc(u.username)}</td><td>••••••</td><td>${UI.esc(u.role || '')}</td><td>${UI.esc(u.full_name || '')}</td></tr>`)
        tr.onmousedown = () => pick(u)
        tb.appendChild(tr)
      }
      pick(selectId ? DB.one('SELECT * FROM users WHERE id = ?', [selectId]) : null)
    }
    function pick(u) {
      current = u
      view.querySelectorAll('#us-list tr').forEach((tr) => tr.classList.toggle('current', !!u && +tr.dataset.id === u.id))
      $('#us-id').value = u?.id ?? ''
      $('#us-login').value = u?.username ?? ''
      $('#us-name').value = u?.full_name ?? ''
      $('#us-role').value = String(u?.role_id ?? roles().find((r) => r.id !== 1)?.id ?? 1)
      $('#us-pw').value = $('#us-pw2').value = ''
      $('#us-pw').placeholder = u ? 'اتركها فارغة لعدم التغيير' : 'كلمة المرور (4 أحرف على الأقل)'
      if (!u) $('#us-login').focus()
    }
    const adminCount = () => DB.one('SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.builtin = 1').n
    async function save() {
      const login = $('#us-login').value.trim(), name = $('#us-name').value.trim(), role = +$('#us-role').value
      const pw = $('#us-pw').value, pw2 = $('#us-pw2').value
      if (!login) return UI.message('إسم الدخول مطلوب')
      if (DB.one('SELECT 1 FROM users WHERE username = ? AND id != ?', [login, current?.id || 0])) return UI.message('إسم الدخول موجود')
      if (!current && !pw) return UI.message('كلمة المرور مطلوبة للمستخدم الجديد')
      if (pw && pw.length < 4) return UI.message('كلمة المرور 4 أحرف على الأقل')
      if (pw !== pw2) return UI.message('كلمتا المرور غير متطابقتين')
      const wasAdmin = current && DB.one('SELECT builtin FROM roles WHERE id = ?', [current.role_id])?.builtin
      const nowAdmin = DB.one('SELECT builtin FROM roles WHERE id = ?', [role])?.builtin
      if (wasAdmin && !nowAdmin && adminCount() === 1) return UI.message('لا يمكن إزالة صلاحية آخر مدير للنظام')
      let id = current?.id
      if (id) {
        DB.run('UPDATE users SET username = ?, full_name = ?, role_id = ?, is_admin = ? WHERE id = ?', [login, name, role, nowAdmin ? 1 : 0, id])
        if (pw) DB.run('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(pw), id])
      } else {
        DB.run('INSERT INTO users (username, password, full_name, role_id, is_admin) VALUES (?, ?, ?, ?, ?)', [login, await hashPassword(pw), name, role, nowAdmin ? 1 : 0])
        id = DB.one('SELECT last_insert_rowid() AS id').id
      }
      DB.audit(current ? 'تعديل مستخدم' : 'إضافة مستخدم', login)
      await DB.flush()
      load(id)
      UI.message('تم الحفظ')
    }
    async function remove() {
      if (!current) return UI.message('اختر مستخدماً')
      if (current.id === Session.userId) return UI.message('لا يمكن حذف المستخدم الحالي')
      if (DB.one('SELECT builtin FROM roles WHERE id = ?', [current.role_id])?.builtin && adminCount() === 1) return UI.message('لا يمكن حذف آخر مدير للنظام')
      if (!(await UI.confirm(`حذف المستخدم «${current.username}»؟`))) return
      DB.run('DELETE FROM users WHERE id = ?', [current.id])
      DB.audit('حذف مستخدم', current.username)
      await DB.flush()
      load()
    }
    load()
  })
}

function openAuditLog() {
  UI.openWindow('audit', 'سجل الحركات', { width: 900, height: 460 }, (body, win) => {
    const bar = UI.toolbar([
      { key: 'print', label: 'طباعة', icon: 'print', onClick: () => UI.printGrid('سجل الحركات', body) },
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
