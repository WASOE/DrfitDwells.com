# Arrival Automation V2 — staff-only test (detail)

Canonical activation order lives in `arrival-automation-v2-env.md` (steps 1–5).
This page expands the staff SMTP proof only.

## Why a separate schedule CLI?

Shared API keeps `ARRIVAL_AUTOMATION_V2=0` during staff testing, so normal booking
hooks do **not** create V2 jobs. Use:

```bash
node scripts/scheduleStaffArrivalAutomationV2.cjs \
  --booking-id <BOOKING_OBJECT_ID> \
  --confirm-staff-email jose@driftdwells.com
```

Requirements:

- Booking `guestInfo.email` must equal `--confirm-staff-email`
- Address must be on `ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST` (defaults to the confirm address)
- Uses `force: true` — works with shared automation OFF
- Never sends SMTP; never starts a worker; refuses guest emails

After authorized production activation (`ARRIVAL_AUTOMATION_V2=1` on the API),
normal confirm/date/cancel hooks schedule automatically via `fireAndForgetSync`
(even with `MESSAGE_ORCHESTRATOR_ENABLED=0`).

## Staff worker env

```text
ARRIVAL_EMAIL_V2=1
ARRIVAL_AUTOMATION_V2=1
ARRIVAL_AUTOMATION_WORKER_MODE=1
ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST=jose@driftdwells.com
MESSAGE_SCHEDULER_WORKER_ENABLED=1
MESSAGE_DISPATCHER_ENABLED=0
MESSAGE_ORCHESTRATOR_ENABLED=0
```

Claim and sweep are DB-scoped to V2 Cabin/Valley jobs for allowlisted emails only.

## Checklist

1. Dark deploy (API automation OFF).
2. Create confirmed staff booking → `jose@driftdwells.com` (Cabin and/or Valley).
3. Run `scheduleStaffArrivalAutomationV2.cjs` for that booking.
4. Activate dedicated worker with allowlist.
5. Verify SMTP + `MessageDispatch` accepted; guest/GMA jobs untouched.
6. `pm2 stop driftdwells-arrival-automation-worker`.
7. Stop — further steps require separate owner approvals (legacy retire, reconcile, guest GO).
