# Architecture Lock: Booking Confirmation Worker Production Readiness

**Status:** BINDING DESIGN — remediation must follow this document
**Amended:** 2026-07-31 (runtime-decision lock)
**Basis commit (unsafe deployed worker):** `98590fd59d98305b94c324f3ee04ccf0307020f5`
**Scope:** Remediation of the booking-confirmation EmailDeliveryState backlog worker only

This document is the single source of truth for the remediation batches. Application code must not diverge from these decisions without an explicit architecture revision.

---

## CURRENT PRODUCTION SAFETY STATE

> **Operational freeze (as of this amendment):**

- Commit `98590fd59d98305b94c324f3ee04ccf0307020f5` is deployed.
- PM2 process `driftdwells-confirmation-worker` has been **stopped**.
- The PM2 process definition remains present; the PM2 dump was saved with the worker status **stopped**.
- The worker **must remain stopped** until Batches 1–3 of this lock are implemented, reviewed, and deployed.
- API, checkout finalization worker, and messaging worker remain online and are out of scope for this freeze.
- Pending confirmation `EmailDeliveryState` rows remain durable while the worker is stopped.
- Production must **not** be declared confirmation-delivery healthy based on an empty backlog alone.
- Manual recovery via `processBookingConfirmationDelivery({ send: true })` from a correctly env-loaded `server/` process remains **emergency-only**.
- This document does not authorize production access or executable production commands from Cursor.

---

## 0. Binding problem statement

The worker at `98590fd` is unsafe because:

1. PM2 runs it with repository-root `cwd` (`ecosystem.config.cjs`: `cwd: __dirname`).
2. Bare `require('dotenv').config()` loads `<cwd>/.env` (root), not `server/.env`.
3. SMTP is therefore unavailable inside the worker process.
4. `emailService.sendEmail` development fallback returns `{ success: true, method: 'logged' }` when transport is missing and `EMAIL_DELIVERY_REQUIRED` is unset (`server/services/emailService.js`).
5. `sendClaimedConfirmationDelivery` treats `outcome.success || outcome.sendStatus === 'success'` as real delivery (`bookingConfirmationDeliveryService.js`).
6. That can mark `EmailDeliveryState.latestStatus = succeeded` and set `Booking.confirmationEmailSentAt` without SMTP.
7. `GET /api/ops/confirmation-delivery-health` reads API-local in-memory worker state and API `process.env`, not durable worker-process evidence.

Messaging already rejects `method === 'logged'` in `server/services/messaging/providers/realEmailProvider.js`. Confirmation delivery must adopt an equivalent contract.

---

## 1. Final target architecture

```text
PM2: driftdwells-confirmation-worker   (STOPPED until Batches 1–3 deploy)
  └─ runBookingConfirmationDeliveryWorker.js
       1) loadServerEnv()
       2) resolve release id once
       3) mongoose.connect (fail closed in production)
       4) require worker / email stack (after env)
       5) emailService.verifyTransportReady()
       6) claim/send only when isBookingConfirmationDeliveryReady()
       7) Batch 2+: WorkerRuntimeHeartbeat upserts

API process (BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED unset/0)
  └─ confirmation-delivery-health (Batch 2+)
       Mongo heartbeat + EmailDeliveryState backlog only
```

**Ownership unchanged:**

| Concern | Owner |
|---------|-------|
| Durable delivery SM | `bookingConfirmationDeliveryService.js` |
| Lifecycle compose/send | `bookingLifecycleEmailService.sendBookingLifecycleEmail` |
| Transport singleton | `emailService` (nodemailer ^7.0.6) |
| Worker orchestration | `bookingConfirmationDeliveryWorker.js` |
| Result classification | `emailDeliveryResultContract.js` (new) |
| Env bootstrap | `loadServerEnv.js` (new) |

No second confirmation email sender. API must not start this worker.

---

## 2. Canonical server environment bootstrap

### 2.1 Module and API

| Item | Locked value |
|------|----------------|
| Location | `server/config/loadServerEnv.js` |
| Primary | `loadServerEnv(options?)` |
| Path helper | `resolveServerEnvPath(options?)` |
| Presence helper | `isNonEmptyEnvValue(value)` → trim length > 0 |
| Idempotency | Module-level `_loadedOnce`; second call no-ops unless `options.forceReload === true` (tests) |
| Test reset | `__resetLoadServerEnvForTesting()` clears idempotency flag |

```js
/**
 * @param {object} [options]
 * @param {string} [options.envPath]  Test-only absolute/relative path override
 * @param {string} [options.nodeEnv]  Defaults to env.NODE_ENV
 * @param {NodeJS.ProcessEnv} [options.env] Injectable process env (default process.env)
 * @param {boolean} [options.forceReload] Test-only bypass of idempotency
 * @param {boolean} [options.allowMissingFile] Test override
 * @returns {{
 *   loaded: boolean,           // file was read and applied
 *   path: string,              // absolute path considered
 *   missing: boolean,          // file absent
 *   keysLoaded: number,        // count of keys newly set from file
 *   skippedNonEmptyProcessEnv: number,
 *   nodeEnv: string|null
 * }}
 * Never returns secret values or full key/value maps.
 */
function loadServerEnv(options = {}) {}
```

### 2.2 Path resolution (cwd-independent)

```text
defaultEnvPath = path.join(__dirname, '..', '.env')  // always <repo>/server/.env
```

- Must not use `process.cwd()`.
- Tests supply `options.envPath` to a fixture under `server/config/__fixtures__/` or `server/scripts/fixtures/`.

### 2.3 Exact environment precedence

```text
1) Existing non-empty process.env values (authoritative)
2) Test-only options.envPath file contents for keys still empty/absent
3) Absolute <repository>/server/.env for keys still empty/absent
4) NO production fallback to repository-root .env
5) Application defaults (EMAIL_FROM hard-code, DEFAULT_MONGO_URI) — never for SMTP secrets
```

| Rule | Lock |
|------|------|
| dotenv options | `{ path, override: false }` |
| Empty `process.env` values | **Treated as absent** for readiness/presence checks via `isNonEmptyEnvValue`. Note: dotenv itself will still not override a key that exists as `""`; operators must unset empty exports. Loader documentation must state this. |
| `server/.env` absent, required values already in process.env | Allowed: `missing: true`, `loaded: false`, continue |
| Both file and process.env missing required SMTP/Mongo in production + worker enabled | Fatal at startup validation (§5, §7, §8) |
| Secrets logged | Forbidden — metadata only (path, booleans, counts) |
| Import order | Loader **before** any email-related `require` |

### 2.4 Exact entrypoint import order

```js
// server/scripts/runBookingConfirmationDeliveryWorker.js
'use strict';
const { loadServerEnv } = require('../config/loadServerEnv');
const envLoad = loadServerEnv(); // FIRST local require with side effects

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
// resolveReleaseId() pure helper may live in loadServerEnv.js or a tiny sibling —
// must not import emailService.

const {
  startBookingConfirmationDeliveryWorkerIfEnabled,
  stopBookingConfirmationDeliveryWorkerForTest
} = require('../services/email/bookingConfirmationDeliveryWorker');
// ↑ transitively constructs emailService AFTER env load
```

### 2.5 Bootstrap adoption scope (unchanged)

**This remediation adopts `loadServerEnv` only on `runBookingConfirmationDeliveryWorker.js`.**

Deferred follow-up (not Batch 1–3): messaging, checkout-finalization, gift-voucher workers, and `server.js`.

---

## 3. Exact SMTP verification API

### 3.1 Evidence

| Source | Behavior |
|--------|----------|
| `emailService.init()` | Creates one nodemailer transporter; in `NODE_ENV=production` calls `this.transporter.verify()`; on failure sets `transporter = null`, `isConfigured = false` |
| `smtpHealthService.verifySmtpTransport` | May create a **second** temporary transporter if singleton unusable; `runSmtpHealthCheck` opens/resolves **ManualReviewItem**s |
| `emailService.sendEmail` success | Returns `{ success: true, method: 'sent', messageId: info.messageId }` only — **does not** expose Nodemailer `accepted` / `rejected` / `pending` / `response` |
| Nodemailer | `server/package.json`: `"nodemailer": "^7.0.6"` |

### 3.2 Authoritative mechanism (locked)

**Module:** `server/services/emailService.js` (minimal additive API on the existing singleton)
**Function:** `emailService.verifyTransportReady(options?)`

Do **not** use `runSmtpHealthCheck` for the confirmation worker (MRI side effects).
Do **not** keep a second long-lived transporter.
Do **not** send mail during readiness.

```js
/**
 * Ensures the singleton transporter exists (rebuild from buildSmtpTransportConfig if needed)
 * and runs transporter.verify() with a timeout. No MRI. No sendMail.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs] default 15_000 (aligned with smtpHealthService DEFAULT_SOCKET_TIMEOUT_MS)
 * @param {function} [options.verifyFn] test injection replacing transporter.verify
 * @returns {Promise<{
 *   ok: boolean,
 *   configured: boolean,
 *   verified: boolean,
 *   error: string|null,          // sanitized message, max 500 chars, no credentials
 *   source: 'SMTP_HOST'|'SMTP_URL'|null,
 *   diagnostics: { configured, host, port, secure, tlsServername, source, hasAuth } // no secrets
 * }>}
 */
async function verifyTransportReady(options = {}) {}
```

**Initialization ordering:**

1. `loadServerEnv()`
2. Import worker → constructs `EmailService` → `init()` starts (may verify once in production)
3. Worker readiness calls `verifyTransportReady()` which:
   - `await this.initPromise`
   - If `!transporter` but config present → recreate via existing `buildSmtpTransportConfig` + `nodemailer.createTransport` onto **`this.transporter`** (singleton rebuild, not a parallel sender)
   - `Promise.race([transporter.verify(), timeout])`
   - On failure: set `isConfigured=false`, clear transporter (same as current init failure semantics), return `ok: false`
   - On success: `isConfigured=true`, return `ok: true`

**Sanitized errors:** `err.message` truncated; never include `SMTP_PASS`, URLs with passwords, or raw env.

**Test seam:** `options.verifyFn` and/or `emailService.__setVerifyTransportReadyForTesting(fn)` used only from tests.

**Optional diagnostics reuse:** may call `getSafeSmtpDiagnostics` from `smtpHealthService.js` for the diagnostics object shape; must not call `runSmtpHealthCheck`.

---

## 4. Exact transient verification policy

**Policy name:** Alive-degraded with fixed-interval re-verify (no backoff, no jitter).

| Condition | Behavior |
|-----------|----------|
| Production + worker enabled + SMTP config missing (`SMTP_HOST` and `SMTP_URL` both empty per `isNonEmptyEnvValue`) | **Fatal** structured log → `process.exit(1)` |
| Production + worker enabled + `EMAIL_DELIVERY_REQUIRED` not true | **Fatal** → `process.exit(1)` (§8) |
| SMTP configured, verify fails / times out | State `degraded`; process **stays alive**; **no claims**; **no findDue processing for send** |
| Re-verify succeeds | State `ready`; claims allowed; overdue drain resumes |
| Ready worker later fails periodic verify | Immediate transition to `degraded`; stop claims |

### 4.1 Timing defaults (deterministic)

| Parameter | Default | Env override (optional) |
|-----------|---------|-------------------------|
| Verify timeout | **15_000 ms** | `BOOKING_CONFIRMATION_SMTP_VERIFY_TIMEOUT_MS` |
| Initial verify | **Immediately** after Mongo connect + worker start, **before** first claim tick | — |
| Re-verify while `degraded` | **60_000 ms** (align sweeper default) | `BOOKING_CONFIRMATION_SMTP_REVERIFY_MS` |
| Re-verify while `ready` (health probe) | **300_000 ms** | `BOOKING_CONFIRMATION_SMTP_READY_REVERIFY_MS` |
| Backoff | **None** | — |
| Jitter | **None** | — |
| Degraded log rate limit | At most **one** structured `booking_confirmation_worker_degraded` log per re-verify interval | — |

Pending rows remain durable and untouched for send purposes until `ready`.

---

## 5. Authoritative email-delivery result contract

### 5.1 Module

`server/services/email/emailDeliveryResultContract.js`

`bookingLifecycleEmailService.js` **remains unchanged in Batch 1**. The confirmation SM enforces the contract at `sendClaimedConfirmationDelivery`.

### 5.2 Evidence from `emailService.sendEmail`

| Return | Meaning |
|--------|---------|
| `{ success: true, method: 'sent', messageId }` | Provider-backed SMTP submit (`transporter.sendMail`) |
| `{ success: true, method: 'logged' }` | Dev fallback — **not delivered** |
| `{ success: false, method: 'unavailable', error }` | Transport missing + `EMAIL_DELIVERY_REQUIRED` |
| `{ success: false, method: 'failed', error }` | sendMail threw + required |
| `{ success: false, method: 'logged', error }` | sendMail threw + not required |
| `{ success: true, method: 'skipped-duplicate' }` | In-memory idempotency window |

Nodemailer `info.accepted` / `rejected` / `pending` / `response` are **not** returned by `emailService` and are **not** required.

`messageId` may be null/undefined even on `method: 'sent'` (Nodemailer/provider dependent). **Not required** for authoritative success. Messaging `realEmailProvider` already accepts `result.messageId || null` when `method === 'sent'`.

### 5.3 Classifier contract

```js
/**
 * @param {object|null} result  emailService result and/or lifecycle outcome fields
 * @param {object} [context]
 * @param {boolean} [context.hasDefinitivePriorDelivery] booking.confirmationEmailSentAt or EDS succeeded
 * @returns {{
 *   classification:
 *     | 'provider_sent'
 *     | 'logged_fallback'
 *     | 'unavailable'
 *     | 'smtp_rejected'
 *     | 'skipped_duplicate'
 *     | 'retryable_failure'
 *     | 'ambiguous'
 *     | 'unknown',
 *   authoritativeDelivered: boolean,
 *   retryable: boolean,
 *   ambiguous: boolean,
 *   method: string|null,
 *   providerMessageId: string|null,
 *   reason: string
 * }}
 */
function classifyEmailDeliveryResult(result, context = {}) {}
```

**Authoritative delivery rule (locked):**

```text
authoritativeDelivered ⇔
  result.success === true
  && result.method === 'sent'          // lifecycle: also accept sendResult.method === 'sent'
```

No production success may rely only on a generic boolean (`success` / `sendStatus === 'success'`) without `method === 'sent'`.

Test-injected `sendFn` must return a provider-shaped fixture:

```js
{ success: true, method: 'sent', messageId: 'msg_test_…', sendStatus: 'success',
  sendResult: { success: true, method: 'sent', messageId: 'msg_test_…' } }
```

### 5.4 Classification → state-machine transitions

`markSmtpAttemptStarted` runs **before** the send runner today. That fact is binding for ambiguity.

| Classified / situation | Transition owner | Result |
|------------------------|------------------|--------|
| `provider_sent` | `markConfirmationDeliverySucceeded` | **succeeded**; set `confirmationEmailSentAt`; store `providerMessageId` if present; link EmailEvent if present |
| `logged_fallback` | `markConfirmationDeliveryFailedRetryable` (`LOGGED_FALLBACK`) | **retryable failed** — never succeeded stamps |
| `unavailable` | `markConfirmationDeliveryFailedRetryable` (`SMTP_UNAVAILABLE`) | **retryable failed** |
| `smtp_rejected` / `method: 'failed'` | `markConfirmationDeliveryFailedRetryable` (`SMTP_FAILURE`) | **retryable** (or terminal failed at maxAttempts) |
| Thrown error **before** `markSmtpAttemptStarted` | retryable failed (if ever reachable) | **retryable** |
| Thrown error **after** `markSmtpAttemptStarted` | `markConfirmationDeliveryAmbiguous` (`AMBIGUOUS_SEND_THROW`) | **ambiguous** — may have reached provider |
| Timeout before claim / during verify | readiness `degraded` only | **no row mutation** |
| Timeout after claim + after `markSmtpAttemptStarted` with uncertain handoff | `markConfirmationDeliveryAmbiguous` | **ambiguous** |
| `skipped_duplicate` + `hasDefinitivePriorDelivery` | `markConfirmationDeliverySucceeded` (adoption) | **succeeded** (no new SMTP) |
| `skipped_duplicate` without definitive prior delivery | `markConfirmationDeliveryFailedRetryable` (`SKIPPED_WITHOUT_EVIDENCE`) | **retryable** — never blind succeed |
| Max attempts exceeded | existing terminal branch in `markConfirmationDeliveryFailedRetryable` | **terminal failed** |
| Missing / cancelled / recipient mismatch | `markConfirmationDeliveryAbandoned` | **terminal abandoned** |

**Forbidden on logged / unavailable / non-authoritative paths:**

- `latestStatus = succeeded`
- `Booking.confirmationEmailSentAt`
- `providerMessageId` stamped as success evidence
- Treating lifecycle EmailEvent with `deliveryMethod: 'logged'` as proof of SMTP send

EmailEvent rows may still be written by lifecycle code if invoked; they are **not** sole proof. SM success requires classifier `authoritativeDelivered` (or definitive prior-delivery adoption).

---

## 6. Exact worker ready gate

### 6.1 Predicate

```js
// bookingConfirmationDeliveryWorker.js (process-local state)
function isBookingConfirmationDeliveryReady() {
  return (
    state.enabled === true &&
    state.readinessState === 'ready' &&
    state.stopping !== true &&
    state.mongoConnected === true &&
    state.smtpConfigured === true &&
    state.smtpVerified === true &&
    featureFlags.isBookingConfirmationDeliveryWorkerEnabled()
  );
}
```

`state` is the existing in-process worker state object (extended with readiness fields). Batch 1 does not require Mongo heartbeat for the gate.

### 6.2 Tick behavior

Before **any** due-row query intended for send/claim:

1. If `!isBookingConfirmationDeliveryReady()` → log skip (rate-limited) → return without `findDueConfirmationDeliveries` / claim / send.
2. **Stale-lease reclaim while not ready:** **allowed** (SM safety for expired `sending` leases). Reclaim does not send. Implement by calling `reclaimStaleSendingConfirmationDeliveries` from the sweeper even when degraded.
3. **Claim while not ready:** **forbidden**.
4. Worker must not claim a row and then discover SMTP unavailable — verify/ready gate runs first; send path still runs classifier (defense-in-depth).

### 6.3 Readiness states

`starting → configured → verifying → ready ⇄ degraded → stopping → stopped`

---

## 7. Exact Mongo configuration source

Evidence: `database.js` / worker entrypoints use:

```text
process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI
```

`DEFAULT_MONGO_URI` = `mongodb://127.0.0.1:27017/drift-dwells-booking` (`dbDefaults.js`).
`validateProductionEnv` rejects default localhost URI in production unless `ALLOW_DEFAULT_LOCAL_MONGO_IN_PRODUCTION=1`.

| Rule | Lock |
|------|------|
| Accepted names | `MONGODB_URI`, then `MONGO_URI` (no new names) |
| Empty values | Treated as absent |
| Production + worker enabled + URI absent | **Fatal** `process.exit(1)` |
| Production + URI equals `DEFAULT_MONGO_URI` without `ALLOW_DEFAULT_LOCAL_MONGO_IN_PRODUCTION=1` | **Fatal** `process.exit(1)` |
| Dev/test | Default localhost allowed |
| Loader metadata | Report `mongoUriPresent: boolean` and `mongoUriSource: 'MONGODB_URI'|'MONGO_URI'|'default'|'missing'` — **never** URI contents |
| ecosystem.config.cjs | No Mongo secrets |

---

## 8. EMAIL_DELIVERY_REQUIRED policy

| Rule | Lock |
|------|------|
| Production confirmation-worker PM2 | **`EMAIL_DELIVERY_REQUIRED=1` mandatory** (Batch 3 `env_production`) |
| Role | Defense-in-depth only — SM classifier remains primary correctness |
| Startup | Production + worker enabled + flag not true → **fatal** `process.exit(1)` |
| Batch 1 API behavior | **Unchanged** unless a shared helper is read-only reused |
| Secrets in ecosystem | **Forbidden** |

### Batch 3 PM2 non-secret flags (planned)

```text
NODE_ENV=production
BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED=1
EMAIL_DELIVERY_REQUIRED=1
restart_delay=5000
```

SMTP/Mongo/EMAIL_FROM remain in `server/.env` or host-injected process env, not in ecosystem secrets.

---

## 9. Release identifier source

Evidence: `paymentPreparationObservability.applicationRelease()` uses `APP_RELEASE || RELEASE_VERSION || npm_package_version`. Checkout adapter also references `FRONTEND_RELEASE` (frontend-only). No server helper shells out to git on a timer.

**Resolve once at worker startup:**

```text
APP_RELEASE
  || RELEASE_VERSION
  || RELEASE_SHA
  || GIT_COMMIT
  || process.env.npm_package_version
  || null
```

| Rule | Lock |
|------|------|
| Git shell on heartbeat | **Forbidden** |
| Null/unknown | Allowed; does not block delivery |
| Storage | Sanitized string ≤ 64 chars (trim; if longer, store short prefix) |
| Deployment responsibility | Set `APP_RELEASE` or `RELEASE_SHA` to the deployed git SHA when starting/reloading PM2 |

---

## 10. Durable heartbeat (Batch 2 design — locked now)

No existing worker-runtime heartbeat model exists. Create generic model in Batch 2.

### 10.1 Identity

| Item | Lock |
|------|------|
| Model file | `server/models/WorkerRuntimeHeartbeat.js` |
| Collection | `worker_runtime_heartbeats` |
| Document granularity | **One document per `workerType + instanceId`** |
| Unique index | `{ workerType: 1, instanceId: 1 }` |
| `workerType` | `'booking_confirmation_delivery'` |
| `instanceId` | Existing `buildWorkerId('confirmation-worker')` / `BOOKING_CONFIRMATION_DELIVERY_WORKER_ID` or `hostname#pid#random` |

### 10.2 Fields

As previously specified: `hostname`, `pid`, `release`, `startedAt`, `heartbeatAt`, `lastTickAt`, `lastSuccessfulTickAt`, `state`, `enabled`, `smtpConfigured`, `smtpVerified`, `smtpVerifiedAt`, `lastErrorAt`, sanitized `lastError`, counters, `stoppingAt`, `stoppedAt`.

**Counters:** process-lifetime totals (reset on process start), updated each tick. Also store `lastTick*` deltas optionally inside the same counters object as `lastTickProcessed` etc. if already mirrored from worker state.

**Forbidden:** guest PII, SMTP secrets, authoritative stored `running: true`.

### 10.3 Overlap / selection

- PM2 reload may briefly yield two fresh instance docs.
- Health selects freshest by `heartbeatAt` for `workerType`.
- Prefer freshest with `state === 'ready'`; else report freshest non-stopped.
- **Multiple fresh ready instances:** configuration **warning** (`multiple_fresh_instances`); delivery remains safe via atomic claims.
- Stale docs expire via TTL on `heartbeatAt`: **7 days**.
- Stopped records remain until TTL.
- Startup: upsert current instance; do not delete other instances.

### 10.4 Write behavior

| Item | Lock |
|------|------|
| Method | `findOneAndUpdate` upsert on `{ workerType, instanceId }` |
| Frequency | Every tick + every readiness state transition + shutdown |
| Heartbeat write failure | Log structured error; **does not block claims** in Batch 1/2 (delivery safety > telemetry). Health will eventually go stale if writes keep failing. |

### 10.5 Freshness timing (tied to intervals)

| Parameter | Default |
|-----------|---------|
| Worker tick | 30_000 ms |
| Sweeper / degraded re-verify | 60_000 ms |
| Ready re-verify | 300_000 ms |
| Heartbeat write | each tick (≤ 30s when running) |
| Freshness threshold | `max(3 * tickMs, 90_000)` = **90_000 ms** |
| Stale = not fresh | same |
| Startup grace (health) | **120_000 ms** after `startedAt` before “enabled but not ready” is unhealthy |
| TTL | 7 days |

Normal event-loop delay within one tick must not mark the worker dead (3× tick margin).

---

## 11. Health status algorithm (Batch 2)

Ops endpoint only — **must not** gate main `/api/health` / LB readiness.

```text
function evaluateConfirmationDeliveryHealth({ now, heartbeats, backlog, apiFlag }):
  fresh = heartbeats.filter(h => now - h.heartbeatAt <= FRESH_MS && h.state != 'stopped')
  primary = pickPrimary(fresh)  // freshest ready, else freshest

  if fresh.length == 0:
    return unhealthy('worker_heartbeat_stale_or_missing')

  if primary.smtpConfigured == false:
    return unhealthy('worker_smtp_not_configured')

  if primary.state == 'degraded' or primary.smtpVerified == false:
    status = degraded('worker_smtp_unverified')
  else if primary.state == 'ready' and primary.enabled and primary.smtpVerified:
    status = healthy_candidate
  else if within_startup_grace(primary):
    status = degraded('worker_starting')
  else:
    status = unhealthy('worker_not_ready')

  if backlog.ambiguousCount > 0:
    return unhealthy('ambiguous_confirmation_present')

  if backlog.pendingDueCount > 0:
    return unhealthy('overdue_confirmation_backlog')

  if fresh.filter(ready).length > 1:
    status = degraded('multiple_fresh_instances')  // warning, not send-blocking

  if backlog.failedRetryableCount > RETRY_WARN_THRESHOLD:  // default 25
    status = min(status, degraded('elevated_retry_backlog'))

  if backlog.totalPendingCount > 0 and backlog.pendingDueCount == 0:
    status = min(status, degraded('pending_not_yet_due'))  // optional soft signal

  if status == healthy_candidate:
    return healthy
  return status
```

### Backlog counting (model-aligned)

| Count | Query |
|-------|-------|
| `pendingDueCount` | `pending\|failed`, confirmation templates, `nextAttemptAt` null or ≤ now |
| `totalPendingCount` | `latestStatus=pending` |
| `sendingCount` | `latestStatus=sending` |
| `failedRetryableCount` | `latestStatus=failed` AND `nextAttemptAt != null` |
| `abandonedCount` | `latestStatus=failed` AND `nextAttemptAt == null` (includes abandon + maxAttempts terminal) |
| `ambiguousCount` | `latestStatus=ambiguous` |

API SMTP / API feature flag appear under `apiProcess.*` only and never imply worker readiness.

Ops UI must use heartbeat `enabled`/`ready`/`state`, not “Disabled” solely because API flag is off.

---

## 12. SMTP sender identity

Exact code (`emailService.sendEmail`):

```js
from: process.env.EMAIL_FROM || 'Drift & Dwells <bookings@driftdwells.com>',
```

| Decision | Lock |
|----------|------|
| Preferred variable | `EMAIL_FROM` |
| Fallback chain | `EMAIL_FROM` → hard-coded `Drift & Dwells <bookings@driftdwells.com>` |
| `SMTP_FROM` | Not used — **not required** |
| `SMTP_USER` as From | Not used |
| Startup validation | Syntactic presence of From **not** a ready-gate failure; hard-coded fallback is acceptable for Batch 1–3 |
| Domain alignment checks | Out of scope (not required here) |

---

## 13. Defense-in-depth (all three required)

| Layer | Mechanism |
|-------|-----------|
| A | `loadServerEnv` → correct SMTP env before `emailService` init |
| B | `isBookingConfirmationDeliveryReady()` before claim/send |
| C | `classifyEmailDeliveryResult` inside `sendClaimedConfirmationDelivery` |

`EMAIL_DELIVERY_REQUIRED=1` is additional production armor only.

---

## 14. Batch boundaries

Separate commits. No unrelated dashboard/payment/messaging/voucher/checkout refactors.

### Batch 1 — Critical send-path safety

Exact file list:

1. `server/config/loadServerEnv.js` (**create**)
2. `server/scripts/runBookingConfirmationDeliveryWorker.js`
3. `server/services/emailService.js` (**minimal** `verifyTransportReady` + test seam — essential: singleton rebuild/verify; cannot reuse MRI health check)
4. `server/services/email/emailDeliveryResultContract.js` (**create**)
5. `server/services/email/bookingConfirmationDeliveryService.js`
6. `server/services/email/bookingConfirmationDeliveryWorker.js`
7. `server/scripts/loadServerEnv.test.cjs` (**create**)
8. `server/scripts/emailDeliveryResultContract.test.cjs` (**create**)
9. `server/scripts/bookingConfirmationDeliveryWorker.test.cjs`

**Explicitly excluded from Batch 1:**

- `bookingLifecycleEmailService.js` (unchanged)
- heartbeat model / health service / Ops UI
- `ecosystem.config.cjs`
- other worker entrypoints

### Batch 2 — Durable heartbeat + Ops health

- `WorkerRuntimeHeartbeat` model
- worker heartbeat writes
- `bookingConfirmationDeliveryHealthService.js` + routes + Ops UI/read model
- tests L–O style

### Batch 3 — PM2 + docs + full verification

- `ecosystem.config.cjs`: `EMAIL_DELIVERY_REQUIRED=1`, `restart_delay: 5000`, existing flags
- audit/architecture doc status updates
- full regression + builds

---

## 15. Batch 1 acceptance criteria

### 15.1 Commands

```bash
cd server

# New / extended Batch 1 suites
node --test --test-concurrency=1 scripts/loadServerEnv.test.cjs
node --test --test-concurrency=1 scripts/emailDeliveryResultContract.test.cjs
npm run test:booking-confirmation-delivery-worker

# Existing confirmation / finalize / delivery regressions (must stay green)
node --test --test-concurrency=1 scripts/checkoutFinalizeSideEffects.batch6.test.cjs
npm run test:email-delivery
npm run test:lifecycle-email
```

(Also keep reconcile / feature-flag coverage used in prior worker delivery if present in CI locally.)

Repo root (Batch 1 optional but recommended before merge):

```bash
npm run build
npm run verify:checkout-payment-prep-build
```

### 15.2 Required test coverage (Batch 1)

| ID | Assertion | Primary file |
|----|-----------|--------------|
| B1-A | Loader path-independent: cwd=repo root still loads fixture `server/.env` | `loadServerEnv.test.cjs` |
| B1-B | Non-empty `process.env` wins over file (`override: false`) | `loadServerEnv.test.cjs` |
| B1-C | No root `.env` fallback when `nodeEnv=production` | `loadServerEnv.test.cjs` |
| B1-D | Entrypoint source order: `loadServerEnv` before email worker require | `loadServerEnv.test.cjs` or worker test |
| B1-E | Production + enabled + missing SMTP → fatal / no claims | worker test |
| B1-F | Production + enabled + missing/false `EMAIL_DELIVERY_REQUIRED` → fatal | worker / entrypoint test |
| B1-G | Configured + verify fails → `degraded`, zero claims | worker test |
| B1-H | Later verify success → `ready`, drains overdue pending once | worker test |
| B1-I | `method: 'logged'` never → `succeeded` / no `confirmationEmailSentAt` | contract + SM/worker test |
| B1-J | `method: 'unavailable'` never → succeeded | contract + SM/worker test |
| B1-K | Provider-shaped `method: 'sent'` succeeds exactly once | worker test |
| B1-L | Existing concurrency (two ticks → one send) | `bookingConfirmationDeliveryWorker.test.cjs` |
| B1-M | Existing lease pre-SMTP reclaim + deliver | same |
| B1-N | Existing post-SMTP stale → ambiguous, no resend | same |
| B1-O | Existing retryable failure + later success | same |
| B1-P | Existing cancelled / missing booking abandon | same |
| B1-Q | Shutdown stops timers cleanly | worker test |
| B1-R | No real SMTP / no production Mongo / no live guest addresses | all |

---

## 16. Deployment gates (all batches)

1. Targeted Batch tests pass.
2. Confirmation/finalize/email regression suites pass.
3. Client build + `verify:checkout-payment-prep-build` pass before production.
4. Diff review: no unrelated refactors.
5. Bootstrap test reproduces repo-root cwd.
6. Logged-fallback regression green.
7. After Batch 2: health reads durable heartbeat.
8. After Batch 3: PM2 non-secret flags present; secrets still from env file/host.
9. Worker remains stopped in production until all three batches are deployed.
10. Deployment procedure reviewed separately — not executed from Cursor.

---

## 17. Rollback

| Action | Guarantee |
|--------|-----------|
| Keep / return worker to PM2 stopped or flag `0` | No claims |
| Bookings / payments / PaymentIntents / refunds | Unaffected |
| Pending EDS rows | Durable; no reset required |
| Ambiguous | Not auto-retried |
| API worker flag | Remains disabled |
| Historical EmailEvents | Unchanged |

---

## 18. Risks

| Risk | Mitigation |
|------|------------|
| Empty-string process.env blocks dotenv fill | Document unset-vs-empty; readiness treats empty as absent |
| Throw after `markSmtpAttemptStarted` | Ambiguous (not retry) under this lock |
| Heartbeat write failures | Do not block send; Ops sees stale |
| Other workers still cwd-dotenv | Deferred audit |
| Lifecycle may still persist logged EmailEvents | SM ignores them as success proof |

---

## 19. Explicitly deferred follow-ups

1. Migrate other standalone workers + `server.js` to `loadServerEnv`.
2. Optionally tighten `resolveSendStatus` for all lifecycle mail (not required for Batch 1).
3. Unrelated Ops dashboard alert-suppression defects.
4. Global production default `EMAIL_DELIVERY_REQUIRED=1` for API process (separate change control).

---

## 20. Previously open questions — resolution status

| Former open question | Resolution |
|----------------------|------------|
| SMTP verify API vs MRI health | Locked: `emailService.verifyTransportReady`; no `runSmtpHealthCheck` |
| Transient verify exit vs degraded | Locked: degraded + fixed re-verify; fatal only if SMTP config missing |
| messageId / accepted required? | Locked: `method==='sent'` required; messageId optional; accepted not used |
| Reclaim while degraded | Locked: reclaim allowed; claim forbidden |
| Empty process.env | Locked: absent for presence checks; dotenv empty-key caveat documented |
| Mongo localhost in prod worker | Locked: fatal without allow flag |
| EMAIL_DELIVERY_REQUIRED | Locked: mandatory fatal for prod enabled worker |
| Release variable | Locked: APP_RELEASE → … → npm_package_version; no git spawn |
| Heartbeat identity | Locked: per workerType+instanceId; freshest ready; multi-instance warning |
| lifecycle service change | Locked: **no** Batch 1 change |
| emailService.js in Batch 1 | Locked: **yes** (verify API essential) |

### Genuinely repository-unanswerable (ops facts only)

1. Whether the production host injects SMTP/Mongo via systemd/PM2 dump **in addition to** `server/.env` (does not change loader design).
2. Whether operators will set `APP_RELEASE` at deploy time (null release allowed).
3. Exact production nodemailer `messageId` shape from the local relay (optional field remains optional).

These do **not** block Batch 1 implementation.

---

## Document control

| Field | Value |
|-------|-------|
| Binding | Yes |
| Amendment | Runtime decisions locked 2026-07-31 |
| Implementation | Not started |
| Production worker | Must remain **stopped** until Batches 1–3 deploy |
| Forbidden without revision | Second email sender; API-started confirmation worker; success on logged/unavailable; health truth from API memory alone; root `.env` fallback in production |
