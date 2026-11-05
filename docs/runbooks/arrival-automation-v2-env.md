# Arrival Automation V2 — environment topology and activation

## Flags

| Flag | Production source of truth | Purpose |
|------|---------|---------|
| `ARRIVAL_EMAIL_V2` | API `1`, dedicated worker `1` | Manual Send/Resend and automatic dispatch |
| `ARRIVAL_AUTOMATION_V2` | API `1`, dedicated worker `1` | Automatic T-3 scheduling for every guest |
| `MESSAGE_ORCHESTRATOR_ENABLED` | `0` everywhere | Legacy GMA scheduling stays off |
| `MESSAGE_SCHEDULER_WORKER_ENABLED` | API `0`, dedicated worker `1` | Only the dedicated worker claims due jobs |
| `MESSAGE_DISPATCHER_ENABLED` | `0` everywhere | Legacy GMA dispatcher stays off |
| `ARRIVAL_AUTOMATION_WORKER_MODE` | `1` on the dedicated worker only | Isolates claim/sweep to arrival jobs |
| `ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST` | unset in production | A staff allowlist blocks guest delivery |
| `ARRIVAL_AUTOMATION_WORKER_ALLOW_ALL_GUESTS` | `1` on the dedicated worker | Guest-wide scope |

Unset flags still fail closed. The committed `env_production` block in `ecosystem.config.cjs` is what a production restart applies. Do not put the pre-cutover zeros back into that block. The guarded deploy refuses a candidate whose production block is parked, staff-scoped, or missing the arrival worker, and it refuses a live worker that is parked even when PM2 says online.

## Proven flag topology

| Concern | Behavior |
|---------|----------|
| `MESSAGE_ORCHESTRATOR_ENABLED=0` | Does **not** block V2 scheduling when `ARRIVAL_AUTOMATION_V2=1` (hooks call `fireAndForgetSync` independently). |
| `MESSAGE_DISPATCHER_ENABLED=0` | Does **not** block V2 SMTP. Dedicated worker hands allowlisted V2 jobs to `arrivalAutoDispatchAdapter` → `sendArrivalEmailV2`. |
| Shared API automation OFF | Normal booking hooks do **not** create V2 jobs. Staff jobs are scheduled only via `scheduleStaffArrivalAutomationV2.cjs` (`force: true`). |
| Dedicated worker mode | Claims/sweeps only Cabin/Valley rules with `arrivalAutomationV2: true`, optionally restricted by email allowlist (DB-level filter). |

### Process topology

| Process | Effective flags |
|---------|-----------------|
| Shared API | Email `1`, automation `1`, scheduler `0`, dispatcher `0`, orchestrator `0` |
| Dedicated worker | Email `1`, automation `1`, scheduler `1`, `ALLOW_ALL_GUESTS=1`, no staff allowlist, dispatcher `0`, orchestrator `0` |
| Development PM2 env | Remains parked so a non-production start does not email guests |

Entrypoint: `server/scripts/runArrivalAutomationWorker.js`
PM2 app: `driftdwells-arrival-automation-worker` in `ecosystem.config.cjs`

Allowlisted rules only:

- `arrival_instructions_pre_arrival_cabin`
- `arrival_instructions_pre_arrival_valley`

## MessageDispatch unique index

```js
db.messagedispatches.getIndexes().find((i) => i.name === 'idempotencyKey_1' && i.unique)
```

Required before any SMTP automation. Create via approved index migration if missing.

## Exact activation sequence

Do not skip steps. Do not enable the shared API scheduler. Each “approval” gate is an owner decision.

### 1. Dark deploy

Deploy the release that contains the dedicated worker + isolation fixes.
Shared API must keep:

- `ARRIVAL_AUTOMATION_V2=0`
- `MESSAGE_SCHEDULER_WORKER_ENABLED=0`
- `MESSAGE_DISPATCHER_ENABLED=0`
- `MESSAGE_ORCHESTRATOR_ENABLED=0`
- `ARRIVAL_EMAIL_V2=1` (PR1 remains active)

PM2 arrival worker may be defined but must stay with `MESSAGE_SCHEDULER_WORKER_ENABLED=0` until step 3.

### 2. Staff-only scheduling

Shared API automation stays **OFF**. Create a confirmed staff booking to `jose@driftdwells.com`, then schedule **without** enabling global hooks:

```bash
cd /path/to/release/server
node scripts/scheduleStaffArrivalAutomationV2.cjs \
  --booking-id <BOOKING_OBJECT_ID> \
  --confirm-staff-email jose@driftdwells.com
```

This calls `syncArrivalAutomationForBooking({ force: true })` and refuses non-matching emails.
It does not send SMTP and does not start a worker.

Verify a `ScheduledMessageJob` exists with `payloadSnapshot.arrivalAutomationV2 === true`.

### 3. Staff-only worker activation

Start/enable **only** the dedicated worker with process-local env:

```text
ARRIVAL_EMAIL_V2=1
ARRIVAL_AUTOMATION_V2=1
ARRIVAL_AUTOMATION_WORKER_MODE=1
ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST=jose@driftdwells.com
MESSAGE_SCHEDULER_WORKER_ENABLED=1
MESSAGE_DISPATCHER_ENABLED=0
MESSAGE_ORCHESTRATOR_ENABLED=0
```

```bash
pm2 start ecosystem.config.cjs --only driftdwells-arrival-automation-worker --env production
# Ensure MESSAGE_SCHEDULER_WORKER_ENABLED=1 on that app only (pm2 env / restart).
```

Do **not** set `MESSAGE_SCHEDULER_WORKER_ENABLED=1` on the API process.

### 4. Staff SMTP verification

Confirm for the staff booking:

- Worker claims only the allowlisted job
- `MessageDispatch` `arrival_v2:email:<id>:initial` → `accepted`
- SMTP delivered to `jose@driftdwells.com`
- Guest / GMA due jobs remain untouched
- Manual Send of the same initial is a duplicate (no second SMTP)

Optional: date change + cancel on the staff booking; re-run staff schedule CLI after edits if needed while API automation is still OFF.

### 5. Stop staff worker

```bash
pm2 stop driftdwells-arrival-automation-worker
# or set MESSAGE_SCHEDULER_WORKER_ENABLED=0 on that app and restart
```

Leave shared API automation OFF.

### 6. Legacy-job retirement (separate approval)

Dry-run first:

```bash
node scripts/retireLegacyArrivalJobs.cjs
```

After owner approval only:

```bash
node scripts/retireLegacyArrivalJobs.cjs --apply --confirm-retire-legacy
```

Preserves history (`status → cancelled`). Does **not** create V2 replacements.

### 7. Reconciliation dry-run

```bash
node scripts/reconcileArrivalAutomationV2.cjs
```

Review catch-up vs nominal counts. No writes.

### 8. Controlled schedule-only apply (after approval)

One-off process with automation authorized and worker **still off**:

```bash
ARRIVAL_EMAIL_V2=1 ARRIVAL_AUTOMATION_V2=1 MESSAGE_SCHEDULER_WORKER_ENABLED=0 \
  node scripts/reconcileArrivalAutomationV2.cjs --apply --confirm-schedule-only
```

Writes schedule rows only. Review catch-up jobs (historically ~2) before any worker enablement. Quarantine/cancel unexpected guest catch-ups if needed.

### 9. Guest activation (explicit approval)

Only after catch-up review:

1. Set dedicated worker to guest scope: `ARRIVAL_AUTOMATION_WORKER_ALLOW_ALL_GUESTS=1` (clear or keep staff allowlist per owner decision).
2. Enable `MESSAGE_SCHEDULER_WORKER_ENABLED=1` on the dedicated worker only.
3. Enable shared API `ARRIVAL_AUTOMATION_V2=1` so normal booking hooks schedule automatically going forward.
4. Keep `MESSAGE_DISPATCHER_ENABLED=0` and `MESSAGE_ORCHESTRATOR_ENABLED=0` everywhere.

### 10. Monitoring and rollback

Read-only health is the deploy gate, not a catch-up send. Count overdue, due, claimed, and failed arrival jobs. Do not run `reconcileArrivalAutomationV2.cjs --apply` as part of a deploy. A deploy must not emit a second copy of a message Postmark already accepted.

The guarded deploy fails before cutover when:

- the arrival worker is missing, offline, or duplicated
- PM2 reports online while the worker flags are parked or staff-scoped
- the scheduler health log has no tick in the last 5 minutes, including when the queue is idle
- due, overdue, or failed counts were not actually read; a missing count is not zero
- overdue jobs are past the 5-minute grace period, or any arrival job is `failed`
- the API release `.env` does not keep guest scheduling on and legacy workers off
- the candidate or rollback tree omits an arrival, booking, or payment file, or its `env_production` block would park the worker

An idle queue passes only after a health-log tick and a read-only count of due, overdue, and failed jobs. PM2 `online` and enabled flags are not that evidence. The deploy reads the worker stdout tail and counts `scheduledmessagejobs`; it does not claim or send.

Rollback of a bad API release restores the previous API release. It does not rewrite the committed production arrival block back to zeros. Stopping the dedicated worker is an incident pause; the next production start must come back guest-wide. Cancel due V2 jobs only under a separate audited instruction.

## Shared `.env` note

Historically `MESSAGE_DISPATCHER_ENABLED` could be `1` in shared `.env` while API PM2 forced `0`. Keep shared `.env` at `0`. Never enable the GMA dispatcher for Arrival V2.
