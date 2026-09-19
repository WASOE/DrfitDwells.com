# RatePlan activation-lock recovery runbook

**Batch:** RP5
**Script:** `server/scripts/ratePlanActivationLockRecovery.cjs`
**Lock:** collection `rateplanactivationlocks`, `_id` `seasonal-rateplan-activation`

## Authority separation (read first)

- **This runbook does not authorize RatePlan activation.**
- **Successful lock recovery does not authorize production activation enablement.**
- **All production recovery commands require separate explicit authorization** before use against a production database.
- RatePlan production activation remains blocked until an independent go-live decision.

Do **not** enable activation traffic, restart PM2 to “turn on” RatePlans, or mutate RatePlan documents as part of this procedure.

---

## 1. Purpose and default-disabled behavior

The seasonal activation path uses a single global MongoDB lock document (insertOne uniqueness). There is **no TTL**, no automatic cleanup, and no lock stealing in the application path. An orphan lock therefore blocks future activations until an operator runs this **manual, fail-closed** recovery tool.

| Default | Behavior |
|---------|----------|
| Mode env unset / empty | Classification `DISABLED`, exit `0` |
| Side effects | **None** — no mongoose load, no connection, no mutation |

Importing the script module has no Mongo connection or mutation side effects.

---

## 2. Inspection command shape (secrets omitted)

Read-only inspection. Does not delete.

```bash
cd server
RATEPLAN_ACTIVATION_LOCK_RECOVERY_MODE=inspect \
  node scripts/ratePlanActivationLockRecovery.cjs
```

URI is loaded only through the existing server env loader (`server/.env` / process env). **Never** pass the Mongo URI on the command line. **Never** print the URI, owner token, raw lock document, credentials, raw errors, or stacks.

Safe fields only: `classification`, `recoveryEligible`, `lockId`, `acquiredAt`, `ageMs`, `lockFingerprint`.

| Classification | Exit | Meaning |
|----------------|------|---------|
| `NO_LOCK` | 0 | Nothing to recover |
| `LOCK_TOO_YOUNG` | 2 | Lock age &lt; 15 minutes — do not recover |
| `LOCK_RECOVERY_ELIGIBLE` | 2 | Candidate for authorized recovery |
| `LOCK_MALFORMED` / `INSPECTION_FAILED` | 78 | Stop; do not recover |

Retain the inspect JSON (especially `lockFingerprint` and `acquiredAt`) as audit evidence.

---

## 3. Required activation quiescence

**Before** setting the quiescence acknowledgement and running recover:

1. Production (or target) **RatePlan activation traffic must be blocked**.
2. **All in-flight activation work must be stopped** (no concurrent `activateRatePlan` / admin activate calls).
3. Confirm with operators that no activation will start during the observation window.

Only then may you set:

`RATEPLAN_ACTIVATION_LOCK_RECOVERY_QUIESCENT=I_CONFIRM_NO_RATEPLAN_ACTIVATION_IS_RUNNING`

This acknowledgement is an operational assertion, not a technical interlock with the API.

---

## 4. Minimum age and double-read stability

- Minimum lock age: **15 minutes** (`acquiredAt` not in the future).
- Recovery waits a fixed **30-second** observation interval, then re-reads the lock.
- `_id`, owner token, `acquiredAt`, and fingerprint must be **identical** across both reads.
- If the lock changes or disappears: **no delete**; exit `78`; run a fresh inspect.

---

## 5. Exact recovery authorization variables

All of the following must be exact. Validated **before** connecting; missing/invalid → exit `78`, no connection.

| Variable | Exact value |
|----------|-------------|
| `RATEPLAN_ACTIVATION_LOCK_RECOVERY_MODE` | `recover` |
| `RATEPLAN_ACTIVATION_LOCK_RECOVERY_EXECUTE` | `1` |
| `RATEPLAN_ACTIVATION_LOCK_RECOVERY_QUIESCENT` | `I_CONFIRM_NO_RATEPLAN_ACTIVATION_IS_RUNNING` |
| `RATEPLAN_ACTIVATION_LOCK_EXPECTED_FINGERPRINT` | 64 lowercase hex from inspect |
| `RATEPLAN_ACTIVATION_LOCK_EXPECTED_ACQUIRED_AT` | Exact ISO timestamp from inspect (`Date#toISOString()` form) |

Example shape (placeholders only — **requires separate explicit authorization** for production):

```bash
cd server
RATEPLAN_ACTIVATION_LOCK_RECOVERY_MODE=recover \
RATEPLAN_ACTIVATION_LOCK_RECOVERY_EXECUTE=1 \
RATEPLAN_ACTIVATION_LOCK_RECOVERY_QUIESCENT=I_CONFIRM_NO_RATEPLAN_ACTIVATION_IS_RUNNING \
RATEPLAN_ACTIVATION_LOCK_EXPECTED_FINGERPRINT=<64_lowercase_hex_from_inspect> \
RATEPLAN_ACTIVATION_LOCK_EXPECTED_ACQUIRED_AT=<exact_iso_from_inspect> \
  node scripts/ratePlanActivationLockRecovery.cjs
```

Fingerprint = SHA-256 over a domain-separated canonical value of lock id, owner token, and exact `acquiredAt.toISOString()`. The owner token is **never** printed.

Deletion filter (only permitted mutation):

```js
{ _id: 'seasonal-rateplan-activation', ownerToken: <exact>, acquiredAt: <exact Date> }
```

---

## 6. Stop conditions

Stop and do **not** delete when:

- Mode missing/invalid or recover authorization incomplete
- Lock absent, malformed, too young, or future-dated
- Fingerprint or `acquiredAt` mismatch vs operator-supplied values
- Lock changes or disappears during the observation interval
- Native inspection/connection failure before delete

---

## 7. No automatic retry after uncertain or committed-warning outcomes

| Outcome | Exit | Retry? |
|---------|------|--------|
| `RECOVERY_COMPLETE` (including foreign-replacement or verification warnings) | 0 | **Do not** automatically retry — committed deletion is not a retryable failure |
| `RECOVERY_NOT_COMPLETED` | 78 | Investigate; fresh inspect before any new attempt |
| `RECOVERY_OUTCOME_UNCERTAIN` | 78 | **DO_NOT_RETRY_AUTOMATICALLY** — escalate; verify DB state manually |
| `LOCK_CHANGED` / `LOCK_GONE_BEFORE_DELETE` | 78 | Fresh inspect only |

Warnings are allowlisted codes only (`FOREIGN_REPLACEMENT_PRESENT`, `VERIFICATION_UNREADABLE`). Never delete a foreign replacement lock.

---

## 8. Post-recovery inspection

Re-run inspect mode and confirm `NO_LOCK` (or document an intentional foreign replacement if a new activation acquired the lock after your delete). Keep both pre- and post-recovery inspect outputs.

---

## 9. No RatePlan document or index changes

This tool:

- Does **not** load RatePlan (or any) Mongoose models
- Uses native `mongoose.connection.db.collection('rateplanactivationlocks')` only
- Sets `autoIndex`/`autoCreate` false before connect
- Performs **only** the exact conditional `deleteOne` above
- Does **not** insert, update, createIndex, drop, TTL, or open transactions

---

## 10. No production activation enablement

Recovering an orphan lock restores the *ability* for a future authorized activation to proceed. It **does not** enable production activation, change feature flags, or authorize go-live. RatePlan production activation remains blocked until separately approved.

---

## 11. Audit evidence operators must retain

Retain:

1. Pre-recovery inspect output (`classification`, `lockFingerprint`, `acquiredAt`, `ageMs`)
2. Quiescence confirmation record (who confirmed, when, that activation traffic was blocked)
3. Authorization ticket / change record for any production run
4. Recovery command result JSON (classification, booleans, warning codes — no secrets)
5. Post-recovery inspect output
6. Application / ops HEAD SHAs for the release that contains this script

Never store owner tokens, Mongo URIs, or raw driver errors in the ticket.
