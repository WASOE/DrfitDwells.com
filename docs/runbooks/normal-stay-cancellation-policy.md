# Normal-stay standard CancellationPolicy (RP6A / Correction 3)

**Batch:** RP6A

**Script:** `server/scripts/configureNormalStayCancellationPolicy.cjs`

**Identity:** `code=normal-stay-standard`, `version=1`

**Collection:** `cancellationpolicies`

## Authority separation (read first)

- **This runbook does not authorize production CancellationPolicy creation by itself.** Production create still requires a **separate explicit authorization** step.
- **Creating this CancellationPolicy does not authorize RatePlan creation or activation.**
- **RATEPLAN_PRODUCTION_ACTIVATION_REMAINS_BLOCKED** until an independent activation decision.
- Do **not** create, edit, or activate RatePlans as part of this procedure.
- Do **not** mutate indexes, restart PM2, change environment persistence, or alter lease/expiry gates.
- Winter / seasonal special rules use a **separate future policy**. Do **not** create winter policies here.

---

## 1. Approved business schedule (published PDF)

Refunds are of the **accommodation price only**:

| Guest cancels | Refund % |
|---------------|----------|
| 14 or more days before arrival | 100% |
| 7 through 13 days before arrival | 50% |
| Less than 7 days before arrival | 0% |
| No-show | 0% |
| Early departure | 0% |

`correctionWindowHours: 0` means the correction window is **fully disabled** (including elapsed time exactly zero). Positive hours retain existing correction-window behavior for other policies.

Date and name transfers are disabled on this document (ops may handle manually outside it).

### Checkout disclosure (Correction 2 / Correction 3)

- The **full standard policy is not displayed inside checkout**.
- Checkout provides a **clear consent sentence** with separate accessible links to **Terms** (`/terms`) and the published **Cancellation Policy** (`/cancellation-policy`, PDF viewer).
- The detailed policy remains available **before payment** through that Cancellation Policy link (new tab; checkout state preserved).
- ConfirmBooking must **not** show refund percentages, cancellation deadlines, no-show language, or the old check-in−5 free-cancel promise in the summary.
- `checkbox1TextSnapshot` records the **exact localized plain-text consent** shown at submission (same words and punctuation as the visible sentence for the active locale). Link markup is excluded from the snapshot, but link labels and sentence wording match exactly.
- Winter and non-refundable package disclosures remain **separate future work**.
- Production policy creation and RatePlan activation remain **unauthorized** by this runbook.

Consent copy (i18n):

- EN: “By completing your booking, you agree to our Terms and Cancellation Policy.”
- BG: “Завършвайки резервацията, вие се съгласявате с нашите Общи условия и Политика за анулиране.”

---

## 2. Default-disabled behavior

| Default | Behavior |
|---------|----------|
| Mode env unset / empty | Classification `DISABLED`, exit `0` |
| Side effects | **None** — no mongoose load, no connection, no mutation |

Importing the script module has no Mongo connection or mutation side effects.

On create: `autoIndex` and `autoCreate` are set to `false` **before** requiring/registering `CancellationPolicy`. Connect options: `{ autoIndex: false, autoCreate: false }`. The script does **not** call `init`, `createIndexes`, `ensureIndexes`, `syncIndexes`, or `createCollection`.

---

## 3. Inspection (read-only, native)

```bash
cd server
NORMAL_STAY_CANCELLATION_POLICY_MODE=inspect \
  node scripts/configureNormalStayCancellationPolicy.cjs
```

Inspect uses the native collection API and does **not** need to load the CancellationPolicy model.

Never pass the Mongo URI on the command line. Never print URI, credentials, raw documents, stacks, or raw database errors.

| Classification | Exit | Meaning |
|----------------|------|---------|
| `INSPECTION_COMPLETE` | 0 | Read finished |
| `INSPECTION_FAILED` | 78 | Stop; do not create |

---

## 4. Create (model-based; exact confirmation required)

**Prerequisites**

1. Separate production authorization has been granted for this create.
2. Collection `cancellationpolicies` **must already exist**. If absent → `COLLECTION_ABSENT`, exit `78`, no create.
3. Set both mode and confirmation:

```bash
cd server
NORMAL_STAY_CANCELLATION_POLICY_MODE=create \
NORMAL_STAY_CANCELLATION_POLICY_CREATE_CONFIRM=CREATE_NORMAL_STAY_STANDARD_V1 \
  node scripts/configureNormalStayCancellationPolicy.cjs
```

Create persists through the **CancellationPolicy model** (`create`) so Mongoose applies validation, defaults, **timestamps**, and **`__v`** (expected `0` after create). Matching comparisons ignore only `_id`, `__v`, and timestamps.

| Classification | Exit | Meaning |
|----------------|------|---------|
| `UNAUTHORIZED` | 78 | Confirmation missing/wrong — no connection |
| `COLLECTION_ABSENT` | 78 | Collection missing — refuse |
| `ALREADY_PRESENT_MATCH` | 0 | Identity exists with matching content — **no rewrite** |
| `CONFLICTING_EXISTING` | 78 | Identity exists with different content — refuse |
| `CREATE_COMPLETE` | 0 | Model create succeeded; verified content + `__v` + timestamps |
| `CONCURRENT_CREATE_MATCH` | 0 | Duplicate-key race; re-read matches approved payload |
| `CREATE_OUTCOME_UNCERTAIN` | 78 | Duplicate/verify ambiguity — **do not automatically retry** |
| `VERIFY_FAILED` / `CREATE_FAILED` | 78 | Stop — **do not automatically retry** |

No update, overwrite, repair, or deletion path. No RatePlan writes. No automatic retry.

---

## 5. Post-create verification checklist

1. Inspect reports `identityPresent=true`, `contentMatch=true`.
2. Persisted document has `__v === 0` and valid `createdAt` / `updatedAt`.
3. Index name inventory unchanged.
4. RatePlan count unchanged; no activation lock created by this script.
5. ConfirmBooking shows only the concise EN/BG consent sentence with Terms + Cancellation Policy links; no detailed 14/7/0 schedule and no check-in−5 free-cancel promise in checkout.
6. PM2 and lease gates untouched.

---

## 6. Activation remains blocked

Successful policy configuration is **not** RatePlan activation authority.

**RATEPLAN_PRODUCTION_ACTIVATION_REMAINS_BLOCKED**
