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

## Flag topology (proven)

| Flag | Shared API `.env` | Dedicated arrival worker |
|------|-------------------|--------------------------|
| `ARRIVAL_EMAIL_V2` | `1` (PR1) | `1` |
| `ARRIVAL_AUTOMATION_V2` | `0` until cutover | `1` (process-local) |
| `MESSAGE_ORCHESTRATOR_ENABLED` | `0` | `0` (required) |
| `MESSAGE_SCHEDULER_WORKER_ENABLED` | `0` | `1` only when testing/live |
| `MESSAGE_DISPATCHER_ENABLED` | `0` | `0` (required) |
| `ARRIVAL_AUTOMATION_WORKER_MODE` | unset | `1` |
| `ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST` | unset | staff emails for test; empty only with `ALLOW_ALL_GUESTS=1` |

**Orchestrator OFF does not block V2 scheduling.** Booking/reservation hooks call
`fireAndForgetSync` independently of `MESSAGE_ORCHESTRATOR_ENABLED`. GMA rule
scheduling stays disabled; arrival V2 sync still runs when automation is authorized.

**Dispatcher OFF does not block V2 SMTP.** With `ARRIVAL_AUTOMATION_V2=1` +
`ARRIVAL_EMAIL_V2=1`, the scheduler hands allowlisted V2 jobs to
`arrivalAutoDispatchAdapter` → `sendArrivalEmailV2` even when
`MESSAGE_DISPATCHER_ENABLED=0`. Unrelated GMA rules are not dispatched.

Dedicated process: `server/scripts/runArrivalAutomationWorker.js` /
PM2 app `driftdwells-arrival-automation-worker`.

## Enablement order (required)

1. Keep the scheduler worker from claiming until reconcile apply is reviewed
   (`MESSAGE_SCHEDULER_WORKER_ENABLED=0` on API **and** dedicated worker).
2. Run `node scripts/reconcileArrivalAutomationV2.cjs` (dry-run default) and review
   classification counts. Dry-run does not require automation flags.
3. Prove staff path with email allowlist (`jose@driftdwells.com`) on the dedicated
   worker only — never enable the global API scheduler for testing.
4. Retire legacy pre-V2 arrival jobs (dry-run first):
   `node scripts/retireLegacyArrivalJobs.cjs`
   Apply only after owner approval: `--apply --confirm-retire-legacy`.
5. After owner approval, run reconcile apply on a one-off process with flags set but worker still off:
   - `ARRIVAL_EMAIL_V2=1`
   - `ARRIVAL_AUTOMATION_V2=1`
   - `MESSAGE_SCHEDULER_WORKER_ENABLED=0`
   - `node scripts/reconcileArrivalAutomationV2.cjs --apply --confirm-schedule-only`
   This writes **schedule rows only**. In-window bookings without a V2 initial become
   catch-up schedules (now+5m). Do **not** enable the worker until that backlog is
   reviewed — otherwise those jobs will SMTP once claimed.
6. Staff-scoped enable: set `MESSAGE_SCHEDULER_WORKER_ENABLED=1` **only** on
   `driftdwells-arrival-automation-worker` with email allowlist set. Keep
   `MESSAGE_DISPATCHER_ENABLED=0`.
7. Guest cutover: after staff proof, retire allowlist via
   `ARRIVAL_AUTOMATION_WORKER_ALLOW_ALL_GUESTS=1` (owner gated) and clear catch-up risk.
8. Legacy PR1 manual sends without `arrivalCommsV2.lastCommunicatedStateKey` are baselined
   to the *current* itinerary on first sync (no retrospective correction for
   pre-enablement changes).

## Rollback

1. `pm2 stop driftdwells-arrival-automation-worker` (or set its
   `MESSAGE_SCHEDULER_WORKER_ENABLED=0` and restart).
2. Keep/set `ARRIVAL_AUTOMATION_V2=0` on API shared env.
3. Cancel any due V2 `scheduled`/`claimed` jobs if needed (audited).
4. PR1 manual Send/Resend remains available while `ARRIVAL_EMAIL_V2=1`.
