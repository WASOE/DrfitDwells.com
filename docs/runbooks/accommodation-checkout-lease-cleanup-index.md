# AccommodationCheckoutLease released-cleanup index (v2) runbook

**Batch:** B8F5C
**Index name:** `accommodationCheckoutLease_released_cleanup_v2`
**Collection:** `accommodationcheckoutleases`
**Model:** `AccommodationCheckoutLease`

## Authority separation (read first)

- **This runbook does not authorize index creation.**
- **Successful index creation does not authorize worker enablement.**
- **Successful worker enablement does not authorize public gate enablement.**
- Resource-lease reconciliation scheduling remains separate.
- Broader B8F3/B8F4 index inventory remains separate unless explicitly listed here.

Do **not** enable the expiry worker execute flag or the public resource-lease gate as part of this procedure.

---

## 1. Preconditions

Confirm all of the following before any production action:

| Check | Expected |
|-------|----------|
| Approved application hashes | Worker / model / hold-service hashes match the approved B8F5A + B8F5B Correction 1 set |
| Public resource-lease gate | `CHECKOUT_RESOURCE_LEASE_ENABLED` unset or not `1` |
| Expiry worker execute flag | `ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE` unset or `0` |
| Worker process | `driftdwells-accommodation-hold-expiry-worker` **stopped** (not running under PM2) |
| Staging / dirty tree | Irrelevant to the production database procedure; do not use a dirty tree as authorization |
| Target database | Operator confirms exact MongoDB deployment, database name, and collection `accommodationcheckoutleases` |
| Backup / restore point | Recent backup or restore point confirmed and known-good |
| Replica / disk / monitoring | Replica set healthy; free disk sufficient for index build; alerts/monitoring watched |
| MongoDB server version | Recorded (affects index-build behavior; see §3) |

Required index definition (must match model + worker):

```js
{
  status: 1,
  isLive: 1,
  checkoutClaimCleanupStatus: 1,
  checkoutClaimCleanupNextAttemptAt: 1,
  leaseId: 1
}
```

Name: `accommodationCheckoutLease_released_cleanup_v2`
Options: **none** of `unique`, `sparse`, TTL (`expireAfterSeconds`), `partialFilterExpression`, `collation`, or `hidden: true`.
`hidden` must be **missing** or exact boolean `false`. Any other value (`true`, `null`, `0`, `1`, strings, objects, arrays) is `OPTION_CONFLICT`.

An older `accommodationCheckoutLease_released_cleanup_v1` (if present) is **informational only** and does **not** satisfy v2 readiness. Do not assume it should be dropped.

---

## 2. Read-only preflight

Script: `server/scripts/accommodationCheckoutLeaseIndexPreflight.cjs`

### Exact command

```bash
# From repository root, against the operator-confirmed URI only when authorized to inspect:
ACCOMMODATION_CHECKOUT_INDEX_PREFLIGHT_EXECUTE=1 \
MONGODB_URI='<operator-confirmed-uri>' \
node server/scripts/accommodationCheckoutLeaseIndexPreflight.cjs
```

Any value other than exact `ACCOMMODATION_CHECKOUT_INDEX_PREFLIGHT_EXECUTE=1` (including missing, empty, `0`, `true`) exits `0` with **no** Mongo connection.

### Readiness requirements

Readiness (`MATCH`, exit `0`) requires **all** of:

1. Exact index name and definition match (keys, order, direction; no forbidden options; `hidden` missing or exact `false`)
2. Successful **hinted** explain by exact name `accommodationCheckoutLease_released_cleanup_v2`
3. Winning plan verified to use **only** that v2 index, including SBE **`queryPlan`** wrappers (`winningPlan.queryPlan`, nested `inputStage` / `inputStages` / `children`, and `shards[*].winningPlan.queryPlan`)
4. Explain metrics are **native JavaScript numbers**: finite and nonnegative; count metrics (`nReturned`, `totalKeysExamined`, `totalDocsExamined`) are integers; `executionTimeMillis` is a nonnegative finite number
5. When per-shard execution metrics are present, **every** shard’s metrics must pass the same rules (no silent fallback to top-level zeros)

`listIndexes` agreement alone is **not** readiness. `slotBasedPlan` text is **not** index proof.

### Classifications

| Classification | Meaning |
|----------------|---------|
| `MATCH` | Exact definition **and** hinted explain proved required index only |
| `ABSENT` | Required v2 name not present; no same-key alias |
| `NAME_CONFLICT` | Required name present with wrong key definition |
| `KEY_CONFLICT` | Exact keys exist under another name (not silently accepted) |
| `OPTION_CONFLICT` | Name + keys match but unique/sparse/TTL/partial/collation present, or `hidden` is present and not exact `false` |
| `COLLECTION_ABSENT` | Collection `accommodationcheckoutleases` missing |
| `INSPECTION_FAILED` | Index list failed, explain failed, wrong/missing IXSCAN, or malformed explain |

When definition matches but explain fails, output may include `definitionClassification: MATCH` while top-level `classification` is `INSPECTION_FAILED`, `ready: false`, exit `78`.

### Exit codes

| Exit | When |
|-----:|------|
| `0` | Preflight disabled, or full readiness `MATCH` |
| `2` | Classification `ABSENT` (eligible for **later reviewed** creation) |
| `78` | Conflicts, collection absent, inspection/explain failure |

### Stop conditions

**Stop** the procedure (do not create the index) on:

- `NAME_CONFLICT`
- `KEY_CONFLICT`
- `OPTION_CONFLICT` (including **hidden index** / malformed hidden)
- `COLLECTION_ABSENT`
- `INSPECTION_FAILED`
- **Explain failure** (find/sort/limit/hint/explain throws or result missing)
- **Wrong winning index** (foreign IXSCAN), including inside SBE `queryPlan`
- **Mixed winning indexes** (v2 plus another winning IXSCAN branch)
- **No IXSCAN** in the winning plan / empty `queryPlan`
- **Malformed explain** output, or any metric that is missing, negative, non-finite, non-integer (for counts), string, boolean, object, or otherwise non-native
- **Malformed per-shard metrics** when shard stats are present

Legacy v1 reported alone still yields `ABSENT` (exit `2`) — v1 is not v2 readiness.

Do **not** treat a different unhinted planner preference as readiness. Hinted plan proof is mandatory.

---

## 3. Creation command (documentation only — not authorized by this runbook)

**Do not execute the following unless a separate, explicit production authorization is issued.**

Exact creation shape (no unique/sparse/TTL/partial/collation):

```javascript
// DOCUMENTATION ONLY — not authorized by B8F5C
db.accommodationcheckoutleases.createIndex(
  {
    status: 1,
    isLive: 1,
    checkoutClaimCleanupStatus: 1,
    checkoutClaimCleanupNextAttemptAt: 1,
    leaseId: 1
  },
  {
    name: 'accommodationCheckoutLease_released_cleanup_v2'
  }
)
```

### Version-specific build notes

- **Do not** set obsolete `background: true` blindly. On modern MongoDB (4.2+), index builds are generally optimized/hybrid; `background` is ignored or removed.
- Prefer a rolling / replica-aware build strategy appropriate to the recorded server version.
- Watch `db.currentOp()` (or Atlas performance advisor) for build progress; do not enable the worker during a build.
- Foreground vs concurrent build behavior depends on version and replica-set topology — record the version and follow that version’s index-build guidance.

---

## 4. Post-creation verification

After an **authorized** create completes successfully:

1. `db.accommodationcheckoutleases.getIndexes()` (or `listIndexes`) — confirm exact name and key order/direction; confirm no unexpected options.
2. Re-run the read-only preflight (§2) — expect classification `MATCH`, exit `0`.
3. Confirm explain reports winning index `accommodationCheckoutLease_released_cleanup_v2` for the released-cleanup selector (status released, isLive false, cleanup pending/null/missing, nextAttempt due/null/missing, sort `checkoutClaimCleanupNextAttemptAt` then `leaseId`, limit 100).
4. Confirm **worker still disabled**: `ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE` unset/`0`; PM2 app not started for enablement.
5. Confirm **public gate still disabled**: `CHECKOUT_RESOURCE_LEASE_ENABLED` unset/`0`.
6. Monitoring: disk, replication lag, slow queries — before any **later** worker-enablement batch.

---

## 5. Failure and rollback

- Do **not** enable the worker after a failed or interrupted index build.
- Capture MongoDB build status and error text for the incident record.
- Do **not** automatically drop `accommodationCheckoutLease_released_cleanup_v1` (or any other index).
- Do **not** automatically retry repeated builds without operator review.
- Dropping v2 requires a **separate** operator decision.
- If v2 must be dropped: stop the expiry worker (if ever started) and keep the public gate off **first**.

---

## 6. Related but separate work

| Topic | Status relative to this runbook |
|-------|----------------------------------|
| B8F5A durable cleanup backoff / authority | Frozen — do not change here |
| B8F5B expiry worker wiring | Present but disabled — enablement is a separate authorization |
| Public `CHECKOUT_RESOURCE_LEASE_ENABLED` | Separate |
| Checkout resource-lease reconciliation scheduling | Separate |
| Broader B8F3/B8F4 index inventory | Separate unless explicitly listed |

---

## Approved definition cross-check

| Source | Definition |
|--------|------------|
| Model `AccommodationCheckoutLease` | Same five-field key + name `…_v2`; `autoIndex: false` |
| Worker readiness check | Same name + ordered key directions |
| This runbook / preflight | Same |

Collection name: **`accommodationcheckoutleases`** (Mongoose default for `AccommodationCheckoutLease`).
