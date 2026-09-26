"""Punch upload for the Meena Time desktop app (linked mode).

Install into the base_meena app on the Frappe bench as
base_meena/biometric_management/desktop_sync.py (see server/README.md), then
restart the bench workers. The desktop app finds it automatically.

The desktop app reads punches off a ZKTeco device on the client's LAN (or a
file / by hand) and sends them here. They are device punches, so they are
stored exactly like ADMS ones (adms.py): a fingerprint reader has no GPS, so
the geolocation check is skipped the same way (`ignore_validate`) — otherwise
sites with geolocation tracking reject every punch. Mobile / self-service
check-ins keep their geolocation check; only this endpoint is exempt, and it
needs the right to create Employee Checkin plus read access to each employee.

Idempotent: each punch carries `custom_client_ref = meena-time:<employee>:<stamp>`;
a punch already on the site (same ref, or same employee + time from any other
source) is reported back with its existing name instead of duplicated.
"""
import json

import frappe
from frappe.utils import get_datetime

MAX_BATCH = 500
DEVICE_ID = "Meena Time"


def _client_ref(employee, stamp):
    return f"meena-time:{employee}:{stamp:%Y%m%d%H%M%S}"


@frappe.whitelist(methods=["POST"])
def push_checkins(punches):
    """punches = [{"employee": "HR-EMP-00001", "time": "2026-09-21 08:01:00"}, …]
    → same order: {"employee", "time", "name"} or {"employee", "time", "error"}."""
    if not frappe.has_permission("Employee Checkin", "create"):
        frappe.throw("Not permitted", frappe.PermissionError)
    if isinstance(punches, str):
        punches = json.loads(punches)
    if not isinstance(punches, list) or len(punches) > MAX_BATCH:
        frappe.throw(f"punches must be a list of at most {MAX_BATCH}")

    out = []
    for p in punches:
        employee, raw = (p or {}).get("employee"), (p or {}).get("time")
        row = {"employee": employee, "time": raw}
        try:
            stamp = get_datetime(raw)
            # the caller's row-level rights (company isolation) decide whose punches it may write
            if not employee or not frappe.db.exists("Employee", employee) or not frappe.has_permission("Employee", "read", doc=employee):
                row["error"] = "employee not found"
                out.append(row)
                continue
            ref = _client_ref(employee, stamp)
            existing = frappe.db.get_value("Employee Checkin", {"custom_client_ref": ref}, "name") or frappe.db.get_value(
                "Employee Checkin", {"employee": employee, "time": stamp}, "name"
            )
            if existing:
                row["name"] = existing
                out.append(row)
                continue
            frappe.db.savepoint("desktop_push")
            doc = frappe.new_doc("Employee Checkin")
            doc.employee = employee
            doc.time = stamp
            doc.device_id = DEVICE_ID
            doc.log_type = ""
            doc.biometric_verified = 1
            doc.custom_client_ref = ref
            # same as ADMS device punches: a fingerprint reader has no GPS
            doc.flags.ignore_validate = True
            doc.insert(ignore_permissions=True)
            row["name"] = doc.name
        except Exception as e:  # one bad row must not lose the rest of the batch
            frappe.db.rollback(save_point="desktop_push")
            row["error"] = str(e)[:200]
        out.append(row)
    return out
