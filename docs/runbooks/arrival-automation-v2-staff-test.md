# Arrival Automation V2 — staff-only automation test

## Goal

Prove automatic Cabin/Valley T-3 delivery to `jose@driftdwells.com` without
claiming genuine guest jobs or enabling the global API scheduler.

## Preconditions

- Production SHA includes dedicated worker + ObjectId adapter fix (Phase 12 PR).
- PR1 `ARRIVAL_EMAIL_V2=1` remains on.
- Shared API keeps `ARRIVAL_AUTOMATION_V2=0`, `MESSAGE_SCHEDULER_WORKER_ENABLED=0`,
  `MESSAGE_DISPATCHER_ENABLED=0`, `MESSAGE_ORCHESTRATOR_ENABLED=0`.
- Legacy retirement **not** required for staff-only test if the worker email
  allowlist is set (legacy rows lack V2 payload → never claimed).
- Do **not** run `reconcile --apply` for guests during staff test.

## Worker topology (staff)

PM2 app `driftdwells-arrival-automation-worker` with process-local env:

```text
ARRIVAL_EMAIL_V2=1
ARRIVAL_AUTOMATION_V2=1
ARRIVAL_AUTOMATION_WORKER_MODE=1
ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST=jose@driftdwells.com
MESSAGE_SCHEDULER_WORKER_ENABLED=1
MESSAGE_DISPATCHER_ENABLED=0
MESSAGE_ORCHESTRATOR_ENABLED=0
```

Start only after deploy of Phase 12 code:

```bash
pm2 start ecosystem.config.cjs --only driftdwells-arrival-automation-worker --env production
# then enable claiming via pm2 env set / restart with MESSAGE_SCHEDULER_WORKER_ENABLED=1
```

## Test booking

Create (Ops) a confirmed **staff_stay** reservation:

- Guest email: `jose@driftdwells.com`
- Property: Cabin **and** separately Valley
- Check-in ≥ 4 days out (nominal T-3 @ 17:00 Sofia) **and** one late booking
  (catch-up ~now+5m)

Expected:

1. Confirm/create → `ScheduledMessageJob` with `arrivalAutomationV2: true`
2. Nominal job `scheduledFor` = T-3 calendar day 17:00 Europe/Sofia
3. Worker claims **only** allowlisted email jobs
4. SMTP to jose@; `MessageDispatch` `arrival_v2:email:<id>:initial` accepted
5. Manual Send of same initial → duplicate, no second SMTP
6. Date change → correction schedule / coalesce
7. Cancel → active jobs cancelled; no further SMTP

## Isolation proof

While worker runs, insert or observe a due guest V2 job (or leave guest jobs
absent). Guest rows must remain `scheduled`. Unrelated GMA rule keys must remain
unclaimed.

## Rollback

```bash
pm2 stop driftdwells-arrival-automation-worker
# or MESSAGE_SCHEDULER_WORKER_ENABLED=0 on that app only
```

Do not flip shared API automation flags for this test.

## After staff proof (owner gated — not this phase)

1. Dry-run `retireLegacyArrivalJobs.cjs` → apply with confirm
2. Dry-run reconcile → review catch-up (=2 historically) → apply with worker off
3. Quarantine/cancel catch-up guest jobs before enabling ALLOW_ALL_GUESTS
4. Enable guest scope only with owner GO
