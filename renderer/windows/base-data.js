// «البيانات الأساسية» screens built on openGridWindow — one config each.
const opts = (table, where = '') => () =>
  DB.all(`SELECT id, name_ar FROM ${table} ${where} ORDER BY name_ar`).map((r) => [r.id, r.name_ar])
const inUse = (table, field, id, what) =>
  DB.one(`SELECT 1 FROM ${table} WHERE ${field} = ? LIMIT 1`, [id]) ? `لا يمكن الحذف: مستخدم في ${what}` : null

const LIST_TYPES = [['job', 'الوظائف'], ['nationality', 'الجنسيات'], ['leave', 'أنواع الإجازات'], ['permission', 'أنواع الأذونات']]
const listOptions = (type) => () => DB.all('SELECT id, name_ar FROM lists WHERE list_type = ? ORDER BY name_ar', [type]).map((r) => [r.id, r.name_ar])
const hhmm = (m) => `${String(Math.floor((m || 0) / 60)).padStart(2, '0')}:${String((m || 0) % 60).padStart(2, '0')}`

function openLists() {
  openGridWindow({
    id: 'lists', title: 'قوائم البرنامج', table: 'lists', orderBy: 'list_type, name_ar', width: 600,
    help: 'القوائم المستخدمة في شاشة الموظف: الوظائف والجنسيات وأنواع الإجازات والأذونات.',
    columns: [
      { field: 'list_type', label: 'القائمة', type: 'select', width: 150, options: () => LIST_TYPES, required: true },
      { field: 'name_ar', label: 'الاسم العربي', required: true },
      { field: 'name_en', label: 'الاسم الأجنبي', type: 'en' },
    ],
    beforeDelete: (r) => {
      const field = { job: 'job_id', nationality: 'nationality_id' }[r.list_type]
      return field ? inUse('employees', field, r.id, 'بيانات الموظفين') : null
    },
  })
}

function openDepartments() {
  openGridWindow({
    id: 'departments', title: 'الإدارات والأقسام', table: 'departments', width: 620,
    help: 'الإدارة: اترك «تابع لـ» فارغاً. القسم: اختر الإدارة التي يتبعها.',
    columns: [
      { field: 'name_ar', label: 'الاسم العربي', required: true },
      { field: 'name_en', label: 'الاسم الأجنبي', type: 'en' },
      { field: 'parent_id', label: 'تابع لـ (الإدارة)', type: 'select', width: 170, options: opts('departments', 'WHERE parent_id IS NULL OR parent_id = ""') },
    ],
    beforeDelete: (r) =>
      DB.one('SELECT 1 FROM departments WHERE parent_id = ? LIMIT 1', [r.id]) ? 'لا يمكن الحذف: توجد أقسام تابعة لهذه الإدارة'
        : DB.one('SELECT 1 FROM employees WHERE department_id = ? OR section_id = ? LIMIT 1', [r.id, r.id]) ? 'لا يمكن الحذف: مستخدم في بيانات الموظفين' : null,
  })
}

function openProjects() {
  openGridWindow({
    id: 'projects', title: 'المشاريع', table: 'projects',
    columns: [{ field: 'name_ar', label: 'الاسم العربي', required: true }, { field: 'name_en', label: 'الاسم الأجنبي', type: 'en' }],
    beforeDelete: (r) => inUse('employees', 'project_id', r.id, 'بيانات الموظفين'),
  })
}

function openEmployeeGroups() {
  openGridWindow({
    id: 'employee-groups', title: 'مجموعات الموظفين', table: 'employee_groups',
    columns: [{ field: 'name_ar', label: 'الاسم العربي', required: true }, { field: 'name_en', label: 'الاسم الأجنبي', type: 'en' }],
    beforeDelete: (r) => inUse('employees', 'group_id', r.id, 'بيانات الموظفين'),
  })
}

function openHolidays() {
  openGridWindow({
    id: 'holidays', title: 'العطلات الرسمية', table: 'holidays', orderBy: 'from_date', width: 600,
    columns: [
      { field: 'name_ar', label: 'اسم العطلة', required: true },
      { field: 'from_date', label: 'من تاريخ', type: 'date', width: 140, required: true },
      { field: 'to_date', label: 'إلى تاريخ', type: 'date', width: 140, required: true },
    ],
  })
}

function openDevices() {
  openGridWindow({
    id: 'devices', title: 'تعريف الأجهزة', table: 'devices', width: 700,
    help: 'بيانات جهاز البصمة على الشبكة المحلية: عنوان IP والمنفذ (الافتراضي 4370) وكلمة الاتصال إن وُجدت.',
    columns: [
      { field: 'name', label: 'اسم الجهاز', required: true },
      { field: 'ip', label: 'عنوان IP', type: 'en', width: 130, required: true },
      { field: 'port', label: 'المنفذ', type: 'en', width: 70 },
      { field: 'serial', label: 'الرقم التسلسلي', type: 'en', width: 140 },
      { field: 'comm_key', label: 'كلمة الاتصال', type: 'en', width: 90 },
    ],
  })
}

function openShiftGroups() {
  openGridWindow({
    id: 'shift-groups', title: 'مجموعات أوقات الدوام', table: 'shift_groups',
    help: 'أدخل اسم المجموعة ثم «حفظ»، وحدد مواعيدها من زر «المواعيد».',
    columns: [
      { field: 'name_ar', label: 'الاسم العربي', required: true },
      { field: 'name_en', label: 'الاسم الأجنبي', type: 'en' },
      { field: 'total_minutes', label: 'الإجمالي', type: 'readonly', width: 80, format: hhmm },
      { field: 'open_shift', label: 'دوام مفتوح', type: 'check', width: 70 },
    ],
    extraButtons: [{ key: 'times', label: 'المواعيد', icon: 'clock', onClick: (ctx) => {
      const r = ctx.currentRow
      if (!r || !r.id) return UI.message('اختر مجموعة محفوظة أولاً')
      openShiftTimes(r, ctx.reload)
    } }],
    onRowOpen: (r, ctx) => r.id && openShiftTimes(r, ctx.reload),
    beforeDelete: (r) => inUse('employees', 'shift_group_id', r.id, 'بيانات الموظفين'),
  })
}
