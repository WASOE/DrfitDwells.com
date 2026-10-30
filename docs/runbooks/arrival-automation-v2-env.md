# Arrival Automation V2 — environment topology (PR2)

## Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `ARRIVAL_EMAIL_V2` | unset/OFF | PR1 manual Send/Resend + confirmation prep |
| `ARRIVAL_AUTOMATION_V2` | unset/OFF | PR2 automatic T-3 schedule + allowlisted dispatch |
| `MESSAGE_ORCHESTRATOR_ENABLED` | should be `0` | Full GMA rule scheduling (keep off unless intentionally enabling broader GMA) |
| `MESSAGE_SCHEDULER_WORKER_ENABLED` | `0` | Claims due `ScheduledMessageJob` rows |
| `MESSAGE_DISPATCHER_ENABLED` | **must be `0` in shared `.env`** | Legacy GMA dispatcher (WhatsApp/templates) |

Automation dispatch for allowlisted arrival rules uses the PR1 `sendArrivalEmailV2` path when
`ARRIVAL_AUTOMATION_V2=1` **and** `ARRIVAL_EMAIL_V2=1`, even if `MESSAGE_DISPATCHER_ENABLED=0`.
Unrelated GMA rules are not sent.

## Shared `.env` inconsistency (known)

Production shared release `.env` historically had `MESSAGE_DISPATCHER_ENABLED=1` while the
API PM2 process forced `0`. A naive restart that reloads `.env` into a process without the
PM2 override can accidentally enable unrelated messaging.

### Safe correction (do **not** apply during PR2 implementation)

1. Set in shared release `server/.env`:
   - `MESSAGE_DISPATCHER_ENABLED=0`
   - `MESSAGE_ORCHESTRATOR_ENABLED=0`
   - `MESSAGE_SCHEDULER_WORKER_ENABLED=0` (unless a dedicated worker config sets `1`)
2. When activating PR2 automation, enable on a **dedicated** messaging/scheduler worker config only:
   - `ARRIVAL_EMAIL_V2=1`
   - `ARRIVAL_AUTOMATION_V2=1`
   - `MESSAGE_SCHEDULER_WORKER_ENABLED=1`
   - keep `MESSAGE_DISPATCHER_ENABLED=0`
3. API process retains disabled worker flags via guarded deploy `DISABLED_API_FLAGS`.

## Allowlist

- `arrival_instructions_pre_arrival_cabin`
- `arrival_instructions_pre_arrival_valley`

Day-before access rules remain independently disabled.

## MessageDispatch unique index (required for SMTP single-flight)

Production API sets `autoIndex: false`. Arrival initial/resend/correction
idempotency depends on the unique index declared on `MessageDispatch.idempotencyKey`.

Before enabling automation (and as a PR1 production health check), verify:

```js
db.messagedispatches.getIndexes().find((i) => i.name === 'idempotencyKey_1' && i.unique)
```

If missing, create it via the project's approved index migration path (do not
rely on runtime `syncIndexes` in the API process).

## Enablement order (required)

1. Keep the scheduler worker from claiming until reconcile apply is reviewed
   (`MESSAGE_SCHEDULER_WORKER_ENABLED=0`).
2. Run `node scripts/reconcileArrivalAutomationV2.cjs` (dry-run default) and review
   classification counts. Dry-run does not require automation flags.
3. After owner approval, run apply on a one-off process with flags set but worker still off:
   - `ARRIVAL_EMAIL_V2=1`
   - `ARRIVAL_AUTOMATION_V2=1`
   - `MESSAGE_SCHEDULER_WORKER_ENABLED=0`
   - `node scripts/reconcileArrivalAutomationV2.cjs --apply`
   This writes **schedule rows only**. In-window bookings without a V2 initial become
   catch-up schedules (now+5m). Do **not** enable the worker until that backlog is
   reviewed — otherwise those jobs will SMTP once claimed.
4. Only then enable claim/dispatch on the dedicated scheduler worker:
   - `MESSAGE_SCHEDULER_WORKER_ENABLED=1`
   - keep `MESSAGE_DISPATCHER_ENABLED=0`
5. Legacy PR1 manual sends without `arrivalCommsV2.lastCommunicatedStateKey` are baselined
   to the *current* itinerary on first sync (no retrospective correction for
   pre-enablement changes).
