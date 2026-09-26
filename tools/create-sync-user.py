# Creates the API user the desktop app links with, on one Frappe site, and
# prints the three values to paste into «الإعدادات ← الربط بالموقع».
# Run on the server (bench env), e.g. for tamken3:
#   sudo -u frappeuser /home/frappeuser/frappe-dev/env/bin/python tools/create-sync-user.py tamken3 https://tamken3.base.meena.sa
# Roles: HR Manager + HR User (employees, shifts, leaves, checkins) + Projects User (projects).
import os, sys
site, url = sys.argv[1], sys.argv[2]
os.chdir('/home/frappeuser/frappe-dev/sites')
import frappe
frappe.init(site=site, sites_path='.'); frappe.connect()
email = f'desktop.sync@{site}.meena.sa'
if frappe.db.exists('User', email):
    u = frappe.get_doc('User', email)
else:
    u = frappe.get_doc({'doctype': 'User', 'email': email, 'first_name': 'Meena Time', 'last_name': 'Desktop Sync', 'user_type': 'System User', 'send_welcome_email': 0, 'enabled': 1})
    u.flags.no_welcome_mail = True
    u.insert(ignore_permissions=True)
have = {r.role for r in u.roles}
for r in ['HR Manager', 'HR User', 'Projects User']:
    if r not in have: u.append('roles', {'role': r})
secret = frappe.generate_hash(length=15)
u.api_key = u.api_key or frappe.generate_hash(length=15)
u.api_secret = secret
u.save(ignore_permissions=True)
frappe.db.commit()
print(f'رابط الموقع: {url}\nAPI Key:    {u.api_key}\nAPI Secret: {secret}')
