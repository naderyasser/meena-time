# Server side of the web link

`desktop_sync.py` — endpoint the desktop app uses to upload punches
(`base_meena.biometric_management.desktop_sync.push_checkins`). Stores them like
ADMS device punches (no GPS on a fingerprint reader), idempotent, respects the
caller's permissions. Without it the app falls back to plain REST inserts, which
sites with *Allow Geolocation Tracking* reject.

Install (a new module is picked up on the first call — no restart needed):

    cp /root/meena-time/server/desktop_sync.py /home/frappeuser/frappe-dev/apps/base_meena/base_meena/biometric_management/desktop_sync.py
    chown frappeuser:frappeuser /home/frappeuser/frappe-dev/apps/base_meena/base_meena/biometric_management/desktop_sync.py

Then commit it in the base_meena repo. API user for a site: `tools/create-sync-user.py`.
