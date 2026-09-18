# Checkout resource-lease production indexes runbook

**Batch:** B8F6A
**Scope:** Every required B8 resource-lease index for public gate readiness on:

| Model | Collection |
|-------|------------|
| `AccommodationCheckoutLease` | `accommodationcheckoutleases` |
| `CheckoutResourceAttempt` | `checkoutresourceattempts` |
| `FacilityReservation` | `facilityreservations` |

**Preflight script:** `server/scripts/checkoutResourceLeaseProductionIndexPreflight.cjs`

## Authority separation (read first)

- **This runbook does not authorize index creation.**
- **Successful index creation does not authorize public gate enablement.**
- **Successful index creation does not authorize changing the expiry worker.**
- Cabin slug remediation (active cabins missing stable `slug`) remains a **separate** blocker from B8F6 and is out of scope here.
- Unit/Cabin night-claim authoritative uniques are already present in production and are **not** part of this inventory.
- The B8F5C cleanup-v2 preflight remains valid for worker-plan proof; this inventory **also** lists cleanup v2 so overall lease-collection readiness is complete.

Do **not** enable `CHECKOUT_RESOURCE_LEASE_ENABLED` or mutate PM2 as part of this procedure.

---

## 1. Preconditions

Confirm all of the following before any production action:

| Check | Expected |
|-------|----------|
| Approved application HEAD | Matches the release authorized for gate readiness work |
| Public resource-lease gate | `CHECKOUT_RESOURCE_LEASE_ENABLED` unset or not `1` on every PM2 process |
| Expiry worker | Remains under its own prior authorization; this runbook does not change it |
| Target database | Operator confirms exact MongoDB deployment and database name |
| Backup / restore point | Recent backup or restore point confirmed and known-good |
| Replica / disk / monitoring | Replica set healthy; free disk sufficient for index builds; alerts watched |
| Duplicate readiness | Preflight duplicate probes report `0` blocking groups (empty collections still need indexes) |
| MongoDB server version | Recorded (affects index-build behavior) |

`autoIndex` is **false** on lease and attempt models. FacilityReservation must **not** rely on silent mongoose auto-index on first load — create required indexes explicitly via an authorized procedure.

---

## 2. Required index inventory

### 2.1 AccommodationCheckoutLease — `accommodationcheckoutleases`

| Severity | Name | Keys (order) | Options |
|----------|------|--------------|---------|
| critical | `leaseId_1` | `{ leaseId: 1 }` | `unique: true` |
| critical | `checkoutId_1_generation_1` | `{ checkoutId: 1, generation: 1 }` | `unique: true` |
| critical | `accommodationCheckoutLease_checkoutId_live_unique` | `{ checkoutId: 1 }` | `unique: true`, `partialFilterExpression: { isLive: true }` |
| performance | `expiresAt_1` | `{ expiresAt: 1 }` | none |
| performance | `conversionBookingId_1` | `{ conversionBookingId: 1 }` | none |
| cleanup | `accommodationCheckoutLease_released_cleanup_v2` | `{ status: 1, isLive: 1, checkoutClaimCleanupStatus: 1, checkoutClaimCleanupNextAttemptAt: 1, leaseId: 1 }` | none |

`hidden` must be **missing** or exact boolean `false` on every index above.

### 2.2 CheckoutResourceAttempt — `checkoutresourceattempts`

| Severity | Name | Keys (order) | Options |
|----------|------|--------------|---------|
| critical | `attemptId_1` | `{ attemptId: 1 }` | `unique: true` |
| critical | `checkoutId_1_generation_1` | `{ checkoutId: 1, generation: 1 }` | `unique: true` |
| critical | `checkoutResourceAttempt_checkoutId_live_unique` | `{ checkoutId: 1 }` | `unique: true`, `partialFilterExpression: { isLive: true }` |
| performance | `status_1_bundleValidUntil_1` | `{ status: 1, bundleValidUntil: 1 }` | none |
| performance | `checkoutId_1_generation_-1` | `{ checkoutId: 1, generation: -1 }` | none |

Collection may be **absent** in production today. Absence is creation-eligible for a **later reviewed** createIndex (which creates an empty collection). It is **not** gate readiness.

### 2.3 FacilityReservation — `facilityreservations`

| Severity | Name | Keys (order) | Options |
|----------|------|--------------|---------|
| performance | `facilityCode_1` | `{ facilityCode: 1 }` | none (path-level lookup; non-unique) |
| performance | `status_1` | `{ status: 1 }` | none (path-level lookup; non-unique) |
| performance | `checkoutSessionId_1` | `{ checkoutSessionId: 1 }` | none (path-level lookup; non-unique) |
| critical | `facilityReservation_facility_slot_lane_unique` | `{ facilityCode: 1, slotStart: 1, capacityLane: 1 }` | `unique: true` |
| performance | `facilityCode_1_startTime_1_endTime_1_status_1` | `{ facilityCode: 1, startTime: 1, endTime: 1, status: 1 }` | none |
| performance | `holdExpiresAt_1` | `{ holdExpiresAt: 1 }` | `sparse: true` |
| performance | `checkoutSessionId_1_status_1` | `{ checkoutSessionId: 1, status: 1 }` | none |
| performance | `status_1_holdExpiresAt_1` | `{ status: 1, holdExpiresAt: 1 }` | none |
| performance | `bookingId_1` | `{ bookingId: 1 }` | none |
| performance | `facilityCode_1_slotStart_1_status_1` | `{ facilityCode: 1, slotStart: 1, status: 1 }` | none |
| performance | `facilityReservation_acquisitionAttemptId_sparse` | `{ acquisitionAttemptId: 1 }` | `sparse: true` |

Total required inventory across all three collections: **22** indexes.

`facilityCode_1`, `status_1`, and `checkoutSessionId_1` are non-unique FacilityReservation lookup/performance indexes from path-level `index: true`. They are required for schema parity and must not receive `unique`, `sparse`, partial, TTL, collation, or `hidden: true`.

Collection may be **absent**. Do not depend on mongoose default `autoIndex` to create these in production.

---

## 3. Read-only preflight

### Exact command

```bash
# From repository root, against the operator-confirmed URI only when authorized to inspect:
CHECKOUT_RESOURCE_LEASE_PRODUCTION_INDEX_PREFLIGHT_EXECUTE=1 \
MONGODB_URI='<operator-confirmed-uri>' \
node server/scripts/checkoutResourceLeaseProductionIndexPreflight.cjs
```

### Connection behavior (Correction 1)

The standalone preflight is intentionally model-free:

1. Sets `mongoose.set('autoIndex', false)` and `mongoose.set('autoCreate', false)` **before** connect
2. Connects with `{ autoIndex: false, autoCreate: false }`
3. Resolves collections only via `mongoose.connection.db.collection(name)`
4. Does **not** import or initialize `AccommodationCheckoutLease`, `CheckoutResourceAttempt`, or `FacilityReservation`

FacilityReservation may still default `autoIndex` in its schema; this preflight must not load that model and therefore cannot trigger schema auto-index.

Any value other than exact `CHECKOUT_RESOURCE_LEASE_PRODUCTION_INDEX_PREFLIGHT_EXECUTE=1` (including missing, empty, `0`, `true`) exits `0` with **no** Mongo connection.

### What the preflight does

1. Resolves each of the three collections (absence is recorded, not fatal by itself).
2. Lists indexes (read-only).
3. Classifies every required index: exact name, key order/direction, and options.
4. Runs read-only duplicate aggregation probes for every critical unique (counts only; no document values logged).
5. Emits a JSON summary with classifications and counts only (URI redacted).

### Classifications

| Classification | Meaning |
|----------------|---------|
| `MATCH` | Exact name + key order/direction + required options; no forbidden extras |
| `ABSENT` | Required name not present; no same-key alias |
| `COLLECTION_ABSENT` | Parent collection missing (createIndex later would create it) |
| `NAME_CONFLICT` | Required name present with wrong key definition |
| `KEY_CONFLICT` | Exact keys exist under another name (not silently accepted) |
| `OPTION_CONFLICT` | Name + keys match but options differ (unique/sparse/partial/TTL/collation/hidden) |
| `DUPLICATE_BLOCKER` | Duplicate groups would prevent a unique index build |
| `INSPECTION_FAILED` | List/resolve/duplicate probe failed |
| `DISABLED` | Execute flag not exact `1` |

### Exit codes

| Exit | When |
|-----:|------|
| `0` | Preflight disabled, or **all** required indexes `MATCH` and no duplicate blockers |
| `2` | One or more `ABSENT` / `COLLECTION_ABSENT`, and no conflicts / inspection failures / duplicate blockers (eligible for **later reviewed** creation) |
| `78` | Any conflict, duplicate blocker, or inspection failure |

### Stop conditions

**Stop** (do not create indexes) on:

- `NAME_CONFLICT`, `KEY_CONFLICT`, `OPTION_CONFLICT`
- `DUPLICATE_BLOCKER` (remediate duplicates under a separate authorization first)
- `INSPECTION_FAILED`
- Malformed or unexpected `hidden` values (`true`, `null`, `0`, `1`, strings, objects)
- Same keys under another name (do not “accept” aliases)
- Unexpected `unique`, `sparse`, TTL (`expireAfterSeconds`), `partialFilterExpression`, or `collation` on indexes that must not have them
- Missing required `unique` / `sparse` / `partialFilterExpression` on indexes that require them

Empty collections with `0` duplicate groups are **not** readiness — indexes are still required before gate enablement.

---

## 4. Creation commands (documentation only — not authorized by this runbook)

**Do not execute the following unless a separate, explicit production authorization is issued.**

Prefer creating **critical** uniques first (after duplicate probes are clear), then performance indexes. `createIndex` on a missing collection creates an empty collection.

### 4.0 Document counts (required before and after any authorized create)

Record document counts for **all three** target collections **before** any index creation:

```javascript
// DOCUMENTATION ONLY — read counts; not an authorization to mutate
db.accommodationcheckoutleases.countDocuments({})
db.checkoutresourceattempts.countDocuments({})
db.facilityreservations.countDocuments({})
```

After authorized index creation completes, **recount all three** collections with the same commands and **require every count unchanged**. If any count differs, stop and escalate — do not enable the public gate.

### 4.1 AccommodationCheckoutLease

```javascript
// DOCUMENTATION ONLY — not authorized by B8F6A
db.accommodationcheckoutleases.createIndex(
  { leaseId: 1 },
  { name: 'leaseId_1', unique: true }
);

db.accommodationcheckoutleases.createIndex(
  { checkoutId: 1, generation: 1 },
  { name: 'checkoutId_1_generation_1', unique: true }
);

db.accommodationcheckoutleases.createIndex(
  { checkoutId: 1 },
  {
    name: 'accommodationCheckoutLease_checkoutId_live_unique',
    unique: true,
    partialFilterExpression: { isLive: true }
  }
);

db.accommodationcheckoutleases.createIndex(
  { expiresAt: 1 },
  { name: 'expiresAt_1' }
);

db.accommodationcheckoutleases.createIndex(
  { conversionBookingId: 1 },
  { name: 'conversionBookingId_1' }
);

// Cleanup v2 — skip if already present/MATCH from B8F5G
db.accommodationcheckoutleases.createIndex(
  {
    status: 1,
    isLive: 1,
    checkoutClaimCleanupStatus: 1,
    checkoutClaimCleanupNextAttemptAt: 1,
    leaseId: 1
  },
  { name: 'accommodationCheckoutLease_released_cleanup_v2' }
);
```

### 4.2 CheckoutResourceAttempt

```javascript
// DOCUMENTATION ONLY — not authorized by B8F6A
db.checkoutresourceattempts.createIndex(
  { attemptId: 1 },
  { name: 'attemptId_1', unique: true }
);

db.checkoutresourceattempts.createIndex(
  { checkoutId: 1, generation: 1 },
  { name: 'checkoutId_1_generation_1', unique: true }
);

db.checkoutresourceattempts.createIndex(
  { checkoutId: 1 },
  {
    name: 'checkoutResourceAttempt_checkoutId_live_unique',
    unique: true,
    partialFilterExpression: { isLive: true }
  }
);

db.checkoutresourceattempts.createIndex(
  { status: 1, bundleValidUntil: 1 },
  { name: 'status_1_bundleValidUntil_1' }
);

db.checkoutresourceattempts.createIndex(
  { checkoutId: 1, generation: -1 },
  { name: 'checkoutId_1_generation_-1' }
);
```

### 4.3 FacilityReservation

```javascript
// DOCUMENTATION ONLY — not authorized by B8F6A

// Non-unique path-level lookup/performance indexes
db.facilityreservations.createIndex(
  { facilityCode: 1 },
  { name: 'facilityCode_1' }
);

db.facilityreservations.createIndex(
  { status: 1 },
  { name: 'status_1' }
);

db.facilityreservations.createIndex(
  { checkoutSessionId: 1 },
  { name: 'checkoutSessionId_1' }
);

db.facilityreservations.createIndex(
  { facilityCode: 1, slotStart: 1, capacityLane: 1 },
  { name: 'facilityReservation_facility_slot_lane_unique', unique: true }
);

db.facilityreservations.createIndex(
  { facilityCode: 1, startTime: 1, endTime: 1, status: 1 },
  { name: 'facilityCode_1_startTime_1_endTime_1_status_1' }
);

db.facilityreservations.createIndex(
  { holdExpiresAt: 1 },
  { name: 'holdExpiresAt_1', sparse: true }
);

db.facilityreservations.createIndex(
  { checkoutSessionId: 1, status: 1 },
  { name: 'checkoutSessionId_1_status_1' }
);

db.facilityreservations.createIndex(
  { status: 1, holdExpiresAt: 1 },
  { name: 'status_1_holdExpiresAt_1' }
);

db.facilityreservations.createIndex(
  { bookingId: 1 },
  { name: 'bookingId_1' }
);

db.facilityreservations.createIndex(
  { facilityCode: 1, slotStart: 1, status: 1 },
  { name: 'facilityCode_1_slotStart_1_status_1' }
);

db.facilityreservations.createIndex(
  { acquisitionAttemptId: 1 },
  { name: 'facilityReservation_acquisitionAttemptId_sparse', sparse: true }
);
```

### Version-specific build notes

- Do **not** set obsolete `background: true` blindly on modern MongoDB (4.2+).
- Prefer a rolling / replica-aware build strategy appropriate to the recorded server version.
- Watch `db.currentOp()` (or Atlas performance advisor) for build progress.
- Do **not** enable the public gate during index builds.

---

## 5. Post-creation verification

After an **authorized** create completes successfully:

1. Recount `accommodationcheckoutleases`, `checkoutresourceattempts`, and `facilityreservations` — every count must equal the pre-create count (§4.0).
2. `getIndexes()` / `listIndexes` on each collection — confirm exact names, key order/direction, and options for all **22** indexes.
3. Re-run the read-only preflight (§3) — expect overall `MATCH`, `ready: true`, exit `0`.
4. Confirm duplicate probes still report `0` blocking groups.
5. Confirm **public gate still disabled**: `CHECKOUT_RESOURCE_LEASE_ENABLED` unset/`0` on every PM2 process.
6. Confirm this procedure did **not** change expiry-worker execute state (worker remains under its prior authorization).
7. Monitoring: disk, replication lag, slow queries — before any **later** gate-enablement batch.
8. Reminder: active cabin slug gaps from B8F6 remain a separate enablement blocker.

---

## 6. Failure and rollback

- Do **not** enable the public gate after a failed or interrupted index build.
- Capture MongoDB build status and error text for the incident record.
- Do **not** automatically drop conflicting or legacy indexes.
- Do **not** automatically retry repeated builds without operator review.
- Dropping any unique in this inventory requires a **separate** operator decision and must keep the public gate off first.

---

## 7. Related but separate work

| Topic | Status relative to this runbook |
|-------|----------------------------------|
| B8F5C / B8F5G cleanup v2 index + worker plan proof | Separate; v2 already MATCH in production after B8F5G |
| B8F5H expiry worker execute | Separate prior authorization — do not change here |
| Public `CHECKOUT_RESOURCE_LEASE_ENABLED` | Separate enablement batch after indexes + cabin slug fixes |
| Active cabin missing `slug` | Separate data remediation |
| Unit/Cabin night-claim uniques | Already present — out of inventory |

---

## Approved definition cross-check

| Source | Definition |
|--------|------------|
| `AccommodationCheckoutLease` model indexes + `autoIndex: false` | Same names/keys/options as §2.1 |
| `CheckoutResourceAttempt` model indexes + `autoIndex: false` | Same as §2.2 |
| `FacilityReservation` model indexes + authoritative unique spec | Same as §2.3 |
| This runbook / preflight | Same |

Collection names are Mongoose defaults: **`accommodationcheckoutleases`**, **`checkoutresourceattempts`**, **`facilityreservations`**.
