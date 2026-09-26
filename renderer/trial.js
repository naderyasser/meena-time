// Trial limits while the product is unregistered. The client asked for
// "3 employees + simple reports"; Apex Time's own banner also caps 4 reports
// at 3 prints each (enforced when the reports are built).
const Trial = {
  MAX_EMPLOYEES: 3,
  async canAddEmployee() {
    if (licence.ok) return true
    const n = DB.one('SELECT COUNT(*) AS n FROM employees').n
    if (n < this.MAX_EMPLOYEES) return true
    await UI.message(`النسخة التجريبية تسمح بـ ${this.MAX_EMPLOYEES} موظفين فقط. سجّل البرنامج من «أدوات ← تسجيل المنتج» لإضافة المزيد.`)
    return false
  },
}
