// Apex Time permissions: a screen key is "<menu>/<item>"; the user's role grants per screen
// view (menu entry) · add · del · edit · print. A window opened from a menu item remembers
// its key and disables the toolbar buttons the role doesn't allow.
const Perm = {
  scope: null,
  ACTIONS: [['view', 'عرض'], ['add', 'إضافة'], ['del', 'حذف'], ['edit', 'تعديل'], ['print', 'طباعة']],
  BUTTONS: { new: ['add'], add: ['add'], save: ['add', 'edit'], del: ['del'], edit: ['edit'], print: ['print'], pdf: ['print'], excel: ['print'] },
  can(key, action = 'view') {
    if (!key || window.Session?.admin) return true
    return !!Session.rolePerms?.[key]?.[action]
  },
  // run a menu action with its screen key in scope (windows opened by it inherit the key)
  run(key, fn) { this.scope = key; try { return fn() } finally { this.scope = null } },
  apply(root, key) {
    if (!key || Session?.admin) return
    for (const b of root.querySelectorAll('.toolbar button[data-key]')) {
      const need = this.BUTTONS[b.dataset.key]
      if (need && !need.some((a) => this.can(key, a))) { b.disabled = true; b.title = 'غير مصرح لك بهذا الإجراء' }
    }
  },
}

// Tiny window manager + dialogs reproducing Apex Time's MDI desktop.
const UI = {
  wins: new Map(),
  z: 10,

  el(html) {
    const t = document.createElement('template')
    t.innerHTML = html.trim()
    return t.content.firstElementChild
  },
  esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  },

  // Open (or focus) a child window. `render(body, win)` fills it.
  openWindow(id, title, { width = 560, height = 340 } = {}, render) {
    if (this.wins.has(id)) return this.focus(id)
    const desk = document.getElementById('desktop')
    const n = this.wins.size
    const win = this.el(`
      <section class="win" style="width:${width}px;height:${height}px;left:${Math.max(40, (innerWidth - width) / 2 - 60 + n * 24)}px;top:${Math.max(70, (innerHeight - height) / 2 + n * 24)}px">
        <div class="cap"><button class="x" title="إغلاق">✕</button>${this.esc(title)}</div>
        <div class="body" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>
      </section>`)
    desk.appendChild(win)
    win.querySelector('.x').onclick = () => this.close(id)
    win.addEventListener('mousedown', () => this.focus(id))
    this.drag(win, win.querySelector('.cap'))
    const permKey = Perm.scope
    this.wins.set(id, { win, title, permKey })
    this.focus(id)
    this.renderStrip()
    render(win.querySelector('.body'), { close: () => this.close(id), permKey })
    Perm.apply(win, permKey)
  },
  focus(id) {
    const w = this.wins.get(id)
    if (!w) return
    w.win.style.zIndex = ++this.z
    this.active = id
    this.renderStrip()
  },
  close(id) {
    const w = this.wins.get(id)
    if (!w) return
    w.win.remove()
    this.wins.delete(id)
    this.renderStrip()
  },
  renderStrip() {
    const strip = document.getElementById('taskstrip')
    strip.innerHTML = ''
    for (const [id, w] of this.wins) {
      const b = this.el(`<button class="${id === this.active ? 'active' : ''}">${this.esc(w.title)}</button>`)
      b.onclick = () => this.focus(id)
      strip.appendChild(b)
    }
  },
  drag(win, handle) {
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return
      const sx = e.clientX, sy = e.clientY, ox = win.offsetLeft, oy = win.offsetTop
      const move = (ev) => { win.style.left = ox + ev.clientX - sx + 'px'; win.style.top = Math.max(46, oy + ev.clientY - sy) + 'px' }
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up) }
      addEventListener('mousemove', move)
      addEventListener('mouseup', up)
    })
  },

  // Toolbar button row — `buttons` = [{key, label, icon, onClick}]
  toolbar(buttons) {
    const bar = this.el('<div class="toolbar"></div>')
    for (const b of buttons) {
      const btn = this.el(`<button data-key="${b.key}">${ICONS[b.icon] || ''}<span>${this.esc(b.label)}</span></button>`)
      btn.onclick = b.onClick
      bar.appendChild(btn)
    }
    return bar
  },

  // Modal dialog in Apex's style; resolves when closed.
  dialog({ winbar, head, bodyHtml, buttons, width = 440, onOpen = null }) {
    return new Promise((resolve) => {
      const back = this.el(`
        <div class="dlg-backdrop"><div class="dlg" style="width:${width}px">
          ${winbar ? `<div class="winbar">${this.esc(winbar)}</div>` : ''}
          <div class="head">${this.esc(head)}</div>
          <div class="body">${bodyHtml}</div>
          <div class="err"></div>
          <div class="btns"></div>
          <div class="foot"></div>
        </div></div>`)
      const done = (v) => { back.remove(); resolve(v) }
      const api = { root: back, error: (m) => (back.querySelector('.err').textContent = m || ''), close: done }
      for (const b of buttons) {
        const btn = this.el(`<button>${ICONS[b.icon] || ''}<span>${this.esc(b.label)}</span></button>`)
        btn.onclick = () => b.onClick(api)
        back.querySelector('.btns').appendChild(btn)
      }
      document.body.appendChild(back)
      onOpen?.(api)
      back.querySelector('input:not([type=radio])')?.focus()
    })
  },

  // Apex Time report header: Arabic company name + activity (right, cyan box) · logo
  // (centre) · English name + activity (left, cyan box), then the title bar
  meta(k) { return DB.one('SELECT value FROM meta WHERE key = ?', [k])?.value || '' },
  letterhead(title, sub = '') {
    const m = (k) => this.meta(k)
    const logo = m('company_logo')
    return `<div class="rep-head apex">
        <div class="box r"><div class="co">${this.esc(m('company_name'))}</div><div>${this.esc(m('company_activity'))}</div></div>
        <div class="logo">${logo ? `<img src="${logo}" alt="">` : ''}</div>
        <div class="box l" dir="ltr"><div class="co">${this.esc(m('company_name_en'))}</div><div>${this.esc(m('company_activity_en'))}</div></div>
      </div>
      <div class="rep-title">${this.esc(title)}</div>${sub ? `<div class="rep-sub">${sub}</div>` : ''}`
  },
  // Apex report footer: user + print time, then website / phone / fax / email
  reportFoot() {
    const m = (k) => this.esc(this.meta(k))
    const now = new Date()
    return `<div class="rep-foot"><div class="u"><span>اسم المستخدم : ${this.esc(Session.username)}</span><span dir="ltr">${Engine.iso(now)} ${Engine.hm(now.getHours() * 60 + now.getMinutes())}</span></div>
      <div class="c" dir="ltr"><span>Website: ${m('company_website')}</span><span>Phone: ${m('company_phone')}</span><span>Fax: ${m('company_fax')}</span><span>Email: ${m('company_email')}</span></div></div>`
  },
  // standalone document (app CSS inlined) for printing / PDF
  docHtml(inner) {
    const css = [...document.styleSheets].map((ss) => { try { return [...ss.cssRules].map((r) => r.cssText).join('\n') } catch { return '' } }).join('\n')
    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>${css}</style></head>
      <body class="printing pdf"><div id="print-area" style="display:block">${inner}</div></body></html>`
  },
  async print(inner) {
    if (window.bridge.printHtml) {
      const res = await window.bridge.printHtml(this.docHtml(inner))
      if (res?.error) this.message(res.error)
      return
    }
    const area = document.getElementById('print-area')
    area.innerHTML = inner
    document.body.classList.add('printing')
    window.print()
    document.body.classList.remove('printing')
  },

  // Print what a list window shows: its grid as a report table under the letterhead
  printGrid(title, root) {
    const t = root.querySelector('table.grid')?.cloneNode(true)
    if (!t) return
    t.className = 'rep'
    t.querySelectorAll('tr.new').forEach((tr) => tr.remove()) // the blank entry row
    t.querySelectorAll('select').forEach((x) => x.replaceWith(x.selectedIndex > 0 ? x.options[x.selectedIndex].text : ''))
    t.querySelectorAll('input[type=checkbox]').forEach((x) => x.replaceWith(x.checked ? '✓' : ''))
    t.querySelectorAll('input').forEach((x) => x.replaceWith(x.value))
    // drop the row-pointer column (empty header)
    const first = t.querySelector('thead th')
    if (first && !first.textContent.trim()) t.querySelectorAll('tr').forEach((tr) => tr.firstElementChild?.remove())
    if (!t.querySelector('tbody tr')) return this.message('لا توجد بيانات للطباعة')
    return this.print(this.letterhead(title) + t.outerHTML)
  },

  // Our own drop-down list for <select>: the native popup doesn't open reliably
  // inside the MDI windows on Windows. The <select> keeps its value and fires
  // the usual input/change events; keyboard (arrows) still works natively.
  openSelect(sel) {
    this.closeSelect()
    const r = sel.getBoundingClientRect()
    const list = this.el('<div class="sel-pop" role="listbox"></div>')
    ;[...sel.options].forEach((o, i) => {
      const it = this.el(`<div class="sel-opt${i === sel.selectedIndex ? ' on' : ''}" role="option">${this.esc(o.text) || '&nbsp;'}</div>`)
      it.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.closeSelect()
        if (sel.selectedIndex !== i) {
          sel.selectedIndex = i
          sel.dispatchEvent(new Event('input', { bubbles: true }))
          sel.dispatchEvent(new Event('change', { bubbles: true }))
        }
        sel.focus()
      })
      list.appendChild(it)
    })
    document.body.appendChild(list)
    const h = Math.min(list.scrollHeight, 240)
    const below = innerHeight - r.bottom > h + 4
    Object.assign(list.style, { left: r.left + 'px', minWidth: r.width + 'px', top: (below ? r.bottom : r.top - h) + 'px', maxHeight: '240px' })
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
    this.selPop = list
  },
  closeSelect() {
    this.selPop?.remove()
    this.selPop = null
  },

  // Apex's «الاقسام» tree: departments with their sections; «الكل» on top. onSelect(id|null)
  deptTree(onSelect, { title = 'الاقسام', all = true } = {}) {
    const deps = DB.all('SELECT id, name_ar, parent_id FROM departments ORDER BY name_ar')
    const node = (d) => {
      const kids = deps.filter((x) => x.parent_id === d.id)
      return `<li><span class="tn" data-id="${d.id}">${this.esc(d.name_ar)}</span>${kids.length ? `<ul>${kids.map(node).join('')}</ul>` : ''}</li>`
    }
    const el = this.el(`<div class="dept-tree"><div class="tt">${this.esc(title)}</div><ul>${all ? '<li><span class="tn on" data-id="">الكل</span></li>' : ''}${deps.filter((d) => !d.parent_id).map(node).join('')}</ul></div>`)
    el.addEventListener('click', (e) => {
      const t = e.target.closest('.tn')
      if (!t) return
      el.querySelectorAll('.tn').forEach((x) => x.classList.toggle('on', x === t))
      onSelect(t.dataset.id ? +t.dataset.id : null, t.textContent)
    })
    return el
  },
  // a department id → itself + its sections (for filtering employees)
  deptIds(id) { return id ? [id, ...DB.all('SELECT id FROM departments WHERE parent_id = ?', [id]).map((d) => d.id)] : null },
  confirm(text, head = 'تأكيد') {
    return this.dialog({ head, bodyHtml: `<div style="padding:4px 2px">${this.esc(text)}</div>`, width: 380,
      buttons: [{ label: 'نعم', icon: 'ok', onClick: (d) => d.close(true) }, { label: 'لا', icon: 'cancel', onClick: (d) => d.close(false) }] })
  },
  message(text) {
    return this.dialog({ head: 'تنبيه', bodyHtml: `<div style="padding:4px 2px">${this.esc(text)}</div>`, width: 360,
      buttons: [{ label: 'موافق', icon: 'ok', onClick: (d) => d.close(true) }] })
  },
}

document.addEventListener('mousedown', (e) => {
  const sel = e.target.closest?.('select')
  if (sel && !sel.multiple && !sel.disabled && sel.size <= 1) {
    e.preventDefault() // no native popup
    sel.focus()
    if (UI.selPop) UI.closeSelect()
    else UI.openSelect(sel)
  } else if (!e.target.closest?.('.sel-pop')) UI.closeSelect()
}, true)
addEventListener('keydown', (e) => { if (e.key === 'Escape') UI.closeSelect() })
addEventListener('blur', () => UI.closeSelect())
addEventListener('scroll', (e) => { if (e.target !== UI.selPop) UI.closeSelect() }, true)
