// Minimal stand-in for the web version's Frappe REST API (synthetic data), used
// by tools/sync-test.mjs. Token auth "token k:s". Also importable: start(port).
import http from 'http'

export function start(port = 8765) {
  const db = {
    Department: [
      { name: 'All Departments', department_name: 'All Departments', parent_department: null, is_group: 1 },
      { name: 'الحسابات - T', department_name: 'الحسابات', parent_department: 'All Departments', is_group: 0 },
      { name: 'المبيعات - T', department_name: 'المبيعات', parent_department: 'All Departments', is_group: 1 },
      { name: 'مبيعات الجملة - T', department_name: 'مبيعات الجملة', parent_department: 'المبيعات - T', is_group: 0 },
    ],
    Designation: [{ name: 'محاسب' }, { name: 'مندوب مبيعات' }],
    'Leave Type': [{ name: 'إجازة سنوية' }, { name: 'إجازة مرضية' }],
    Project: [{ name: 'PROJ-0001', project_name: 'فرع بريدة' }],
    'Employee Group': [{ name: 'الإداريين' }],
    'Holiday List': [{ name: 'إجازات 2026', weekly_off: 'Friday', holidays: [
      { holiday_date: '2026-09-23', description: 'اليوم الوطني', weekly_off: 0 },
      { holiday_date: '2026-09-04', description: 'Friday', weekly_off: 1 },
    ] }],
    'Shift Type': [
      { name: 'دوام صباحي', custom_shift_kind: 'Normal', start_time: '8:00:00', end_time: '16:00:00', holiday_list: 'إجازات 2026', custom_day_windows: [0, 1, 2, 3, 4, 5].map((d) => ({
        calendar_type: 'Year', day: ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'][d], window_no: 1,
        start_in: '7:00:00', check_in: '8:00:00', late_allowance_min: 10, end_in: '10:00:00', start_out: '14:00:00', early_out_min: 10, check_out: '16:00:00', end_out: '17:00:00', extended: 0 })) },
      { name: 'دوام بسيط', custom_shift_kind: 'Normal', start_time: '9:00:00', end_time: '17:00:00', late_entry_grace_period: 15, early_exit_grace_period: 5, holiday_list: 'إجازات 2026', custom_day_windows: [] },
      { name: 'دوام مفتوح', custom_shift_kind: 'Open', start_time: '0:00:00', end_time: '23:59:00', custom_open_hours: 8, custom_day_windows: [] },
      { name: 'ورديات', custom_shift_kind: 'Rotational', start_time: '0:00:00', end_time: '0:01:00', custom_day_windows: [] },
    ],
    Employee: [
      { name: 'HR-EMP-00001', employee_name: 'موظف تجربة أول', attendance_device_id: '1001', status: 'Active', gender: 'Male', date_of_joining: '2025-01-01', department: 'الحسابات - T', designation: 'محاسب', default_shift: 'دوام صباحي', custom_project: 'PROJ-0001', custom_employee_group: 'الإداريين', custom_nationality: 'Saudi Arabia', custom_ot_after_shift: 1 },
      { name: 'HR-EMP-00002', employee_name: 'موظف تجربة ثاني', attendance_device_id: '1002', status: 'Active', gender: 'Male', date_of_joining: '2025-01-01', department: 'مبيعات الجملة - T', designation: 'مندوب مبيعات', default_shift: 'دوام بسيط' },
      { name: 'HR-EMP-00003', employee_name: 'موظف تجربة ثالث', attendance_device_id: '', status: 'Inactive', gender: 'Male', date_of_joining: '2025-01-01', default_shift: 'دوام مفتوح' },
    ],
    'Shift Assignment': [
      { name: 'SA-1', employee: 'HR-EMP-00002', shift_type: 'دوام صباحي', start_date: '2026-09-01', end_date: '2026-09-10', docstatus: 1, status: 'Active' },
      { name: 'SA-2', employee: 'HR-EMP-00002', shift_type: 'دوام بسيط', start_date: '2026-09-13', end_date: null, docstatus: 1, status: 'Active' },
    ],
    'Leave Application': [
      { name: 'LA-1', employee: 'HR-EMP-00001', leave_type: 'إجازة سنوية', from_date: '2026-09-14', to_date: '2026-09-15', description: 'x', docstatus: 1, status: 'Approved' },
      { name: 'LA-2', employee: 'HR-EMP-00001', leave_type: 'إجازة مرضية', from_date: '2026-09-16', to_date: '2026-09-16', docstatus: 1, status: 'Open' },
    ],
    'Permission Request': [{ name: 'PR-1', employee: 'HR-EMP-00002', permission_date: '2026-09-15', from_time: '10:00:00', to_time: '12:00:00', reason: 'y', docstatus: 1, status: 'Approved' }],
    'Employee Checkin': [
      { name: 'CHK-1', employee: 'HR-EMP-00001', time: '2026-09-20 07:55:10.000000' },
      { name: 'CHK-2', employee: 'HR-EMP-00001', time: '2026-09-20 16:05:00' },
    ],
  }
  let seq = 100
  const posted = []
  const server = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization !== 'token k:s') return send(401, { exc_type: 'AuthenticationError' })
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/api/method/frappe.auth.get_logged_user') return send(200, { message: 'sync@test' })
    const m = u.pathname.match(/^\/api\/resource\/([^/]+)(?:\/(.+))?$/)
    if (!m) return send(404, {})
    const dt = decodeURIComponent(m[1]), name = m[2] && decodeURIComponent(m[2])
    const rows = db[dt] || []
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const doc = JSON.parse(body)
        if (dt === 'Employee Checkin' && rows.some((r) => r.employee === doc.employee && String(r.time).slice(0, 19) === doc.time))
          return send(417, { exception: 'frappe.exceptions.ValidationError: This employee already has a log with the same timestamp.' })
        const row = { ...doc, name: `CHK-${++seq}` }
        rows.push(row); posted.push(row)
        send(200, { data: row })
      })
      return
    }
    if (name) { const r = rows.find((x) => x.name === name); return r ? send(200, { data: r }) : send(404, {}) }
    const filters = JSON.parse(u.searchParams.get('filters') || '[]')
    const fields = JSON.parse(u.searchParams.get('fields') || '["name"]')
    const ok = (r) => filters.every(([f, op, v]) => op === '=' ? r[f] === v : op === '>=' ? String(r[f]) >= v : true)
    send(200, { data: rows.filter(ok).map((r) => Object.fromEntries(fields.map((f) => [f, r[f] ?? null]))) })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, db, posted })))
}

if (process.argv[1]?.endsWith('mock-frappe.mjs')) start(+process.argv[2] || 8765).then(() => console.log('mock frappe on', process.argv[2] || 8765))
