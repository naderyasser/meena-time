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
    this.wins.set(id, { win, title })
    this.focus(id)
    this.renderStrip()
    render(win.querySelector('.body'), { close: () => this.close(id) })
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
  dialog({ winbar, head, bodyHtml, buttons, width = 440 }) {
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
      back.querySelector('input:not([type=radio])')?.focus()
    })
  },

  message(text) {
    return this.dialog({ head: 'تنبيه', bodyHtml: `<div style="padding:4px 2px">${this.esc(text)}</div>`, width: 360,
      buttons: [{ label: 'موافق', icon: 'ok', onClick: (d) => d.close(true) }] })
  },
}
