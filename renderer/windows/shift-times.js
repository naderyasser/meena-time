// «المواعيد» of one shift group: a row per weekday with the 8 attendance terms
// (بداية الحضور · الحضور · التأخير المسموح · نهاية الحضور · بداية الانصراف ·
// الانصراف المبكر · الانصراف · نهاية الانصراف) and «عطلة». Same order rule as
// the cloud version: each time must be ≥ the one before it.
const DAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']
const TIME_FIELDS = [
  ['start_in', 'بداية الحضور'], ['check_in', 'الحضور'], ['late_min', 'التأخير المسموح'], ['end_in', 'نهاية الحضور'],
  ['start_out', 'بداية الانصراف'], ['early_min', 'الانصراف المبكر'], ['check_out', 'الانصراف'], ['end_out', 'نهاية الانصراف'],
]
const toMin = (t) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(t || '') ? +t.slice(0, 2) * 60 + +t.slice(3) : null)

function openShiftTimes(group, onSaved) {
  UI.openWindow(`shift-times-${group.id}`, `المواعيد — ${group.name_ar}`, { width: 900, height: 330 }, (body, win) => {
    const saved = Object.fromEntries(DB.all('SELECT * FROM shift_times WHERE group_id = ?', [group.id]).map((r) => [r.day, r]))
    const rows = DAYS.map((_, d) => saved[d] || { day: d, is_off: d === 6 ? 1 : 0, late_min: 0, early_min: 0 })

    const copyFirst = () => {
      const src = rows.find((r) => !r.is_off)
      if (!src) return
      rows.forEach((r) => { if (!r.is_off) TIME_FIELDS.forEach(([f]) => (r[f] = src[f])) })
      draw()
    }
    const bar = UI.toolbar([
      { key: 'help', label: 'مساعدة', icon: 'help', onClick: () => UI.message('أدخل الأوقات بصيغة 24 ساعة (HH:MM) والتأخير/الانصراف المبكر بالدقائق. علّم «عطلة» لأيام الراحة الأسبوعية.') },
      { key: 'copy', label: 'نسخ لكل الأيام', icon: 'new', onClick: copyFirst },
      { key: 'save', label: 'حفظ', icon: 'save', onClick: save },
      { key: 'close', label: 'إغلاق', icon: 'close', onClick: () => win.close() },
    ])
    const wrap = UI.el(`<div class="grid-wrap"><table class="grid"><thead><tr>
        <th class="sorted" style="width:80px">اليوم</th>${TIME_FIELDS.map(([, l]) => `<th>${l}</th>`).join('')}<th style="width:50px">عطلة</th>
      </tr></thead><tbody></tbody></table></div>`)
    body.append(bar, wrap)
    const tbody = wrap.querySelector('tbody')

    function draw() {
      tbody.innerHTML = ''
      rows.forEach((r) => {
        const tr = UI.el(`<tr><td class="center"><b>${DAYS[r.day]}</b></td>${TIME_FIELDS.map(([f]) => {
          const isMin = f.endsWith('_min')
          return `<td><input type="text" data-f="${f}" dir="ltr" class="center" ${r.is_off ? 'disabled' : ''}
            placeholder="${isMin ? '0' : '00:00'}" maxlength="${isMin ? 3 : 5}" value="${UI.esc(r.is_off ? '' : r[f] ?? '')}"></td>`
        }).join('')}<td class="center"><input type="checkbox" data-f="is_off" ${r.is_off ? 'checked' : ''}></td></tr>`)
        tr.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
          r[inp.dataset.f] = inp.type === 'checkbox' ? (inp.checked ? 1 : 0) : inp.value.trim()
          if (inp.type === 'checkbox') draw()
        }))
        tbody.appendChild(tr)
      })
    }

    function validate(r) {
      const t = (f) => toMin(r[f])
      for (const [f, l] of TIME_FIELDS) {
        if (f.endsWith('_min')) {
          if (!/^\d{0,3}$/.test(String(r[f] ?? ''))) return `${DAYS[r.day]}: ${l} يجب أن يكون بالدقائق`
        } else if (t(f) === null) return `${DAYS[r.day]}: ${l} مطلوب بصيغة HH:MM`
      }
      const order = ['start_in', 'check_in', 'end_in', 'start_out', 'check_out', 'end_out']
      for (let i = 1; i < order.length; i++) {
        if (t(order[i]) < t(order[i - 1])) {
          const lab = Object.fromEntries(TIME_FIELDS)
          return `${DAYS[r.day]}: «${lab[order[i]]}» لا يمكن أن يكون قبل «${lab[order[i - 1]]}»`
        }
      }
      if (t('check_in') + (+r.late_min || 0) > t('end_in')) return `${DAYS[r.day]}: التأخير المسموح يتجاوز نهاية الحضور`
      if (t('check_out') - (+r.early_min || 0) < t('start_out')) return `${DAYS[r.day]}: الانصراف المبكر يسبق بداية الانصراف`
      return null
    }

    async function save() {
      for (const r of rows) {
        if (r.is_off) continue
        const err = validate(r)
        if (err) return UI.message(err)
      }
      const total = rows.filter((r) => !r.is_off).reduce((s, r) => s + (toMin(r.check_out) - toMin(r.check_in)), 0)
      DB.run('BEGIN')
      DB.run('DELETE FROM shift_times WHERE group_id = ?', [group.id])
      for (const r of rows) {
        DB.run(`INSERT INTO shift_times (group_id, day, is_off, start_in, check_in, late_min, end_in, start_out, early_min, check_out, end_out)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [group.id, r.day, r.is_off ? 1 : 0, ...TIME_FIELDS.map(([f]) => (r.is_off ? null : f.endsWith('_min') ? +r[f] || 0 : r[f]))])
      }
      DB.run('UPDATE shift_groups SET total_minutes = ? WHERE id = ?', [total, group.id])
      DB.run('COMMIT')
      await DB.flush()
      onSaved?.()
      UI.message('تم حفظ المواعيد')
    }

    draw()
  })
}
