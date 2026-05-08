# Drift & Dwells Creator Financial Semantics Hardening

Status: Locked planning spec (implementation not started)  
Owner: Ops + Engineering  
Batch name: Creator Financial Semantics Hardening

---

## 1) Current problem statement

The creator/influencer system is already active, money-facing, and used in ops workflows (creator partners, attribution, commission lifecycle, voucher integration). Current semantics and labels in ops reporting can mislead operators:

- `grossBookingRevenue` is currently surfaced as "Paid revenue" in ops.
- `grossBookingRevenue` includes attributed bookings beyond paid/confirmed cash outcomes.
- Stats and ledger apply different status filters and duplicate attribution resolution logic.
- Projected/estimate metrics are not consistently separated from payable metrics.

This must be hardened before public creator/collab pages because public expansion increases attribution and commission volume, and semantic ambiguity at current scale will become a financial-control and trust risk.

---

## 2) Metric definitions (locked)

### `attributedBookingValue`
- Definition: total booking value for bookings attributed to a creator by resolver rules.
- Semantic guardrail: visibility metric only; not cash collected, not paid, not payable.
- Source: stats aggregation from attributed booking rows.
- Included statuses: all attributed booking statuses unless explicitly filtered for a separate metric.
- Excluded statuses: non-attributed bookings.
- Operator-safe: informational only.
- Payable: no.
- Suggested UI label: **Attributed booking value**.
- UI restriction: label must never imply money collected or settled revenue.

### `paidStayRevenue`
- Definition: paid/confirmed stay cash revenue attributable to creator bookings.
- Semantic guardrail: this is not a booking-status-only proxy and must not be derived from all-status `totalPrice`.
- Source: stats aggregation using existing cash revenue logic (not all-status gross booking total).
- Included statuses: `confirmed`, `in_house`, `completed`.
- Excluded statuses: `pending`, `cancelled`, `refunded`, `failed`, `unpaid`, and `needs_review`/unresolved payment issue states where detectable.
- Revenue basis rules:
  - use existing cash revenue logic rather than all-status gross totals,
  - where Stripe paid amount exists and current code path supports cap logic, respect/cap by actual paid amount,
  - voucher-covered portions must not be counted as cash revenue where current logic already separates voucher and cash components.
- Operator-safe: yes (financially meaningful ops KPI).
- Payable: no (revenue KPI, not payout amount).
- Suggested UI label: **Paid stay revenue**.

### `paidConfirmedBookings`
- Definition: count of attributed bookings in paid/confirmed statuses.
- Source: stats aggregation.
- Included statuses: `confirmed`, `in_house`, `completed`.
- Excluded statuses: `pending`, `cancelled`, `refunded`, `failed`, `unpaid`, and unresolved `PaymentResolutionIssue` / manual-review blocking states where detectable.
- Operator-safe: yes.
- Payable: no.
- Suggested UI label: **Paid confirmed bookings**.

### `projectedCommission`
- Definition: non-payable projection from stats model for forward-looking visibility.
- Semantic guardrail: planning metric only, not a payout estimate.
- Source: stats estimate logic (documented estimate inputs only).
- Included statuses: only statuses explicitly documented for projection logic in implementation; must be clearly separated from ledger eligibility.
- Excluded statuses: per explicit documented estimate policy.
- Operator-safe: yes if clearly marked estimate.
- Payable: no.
- Suggested UI label: **Projected commission (not payable)** or **Est. commission (not payable)**.
- Workflow restriction: must not be used for approve/pay workflows.

### `eligibleCommission`
- Definition: sum/count derived from ledger rows with eligibility set to eligible.
- Meaning clarification: "eligible" means technically eligible for payout review, not approved for payout.
- Source: `CreatorCommission` ledger.
- Included statuses: ledger rows with `eligibilityStatus=eligible`.
- Excluded statuses: `not_eligible`, `needs_review`.
- Operator-safe: yes.
- Payable: not yet (payout still requires manual approval state progression).
- Suggested UI label: **Eligible commission (ledger)**.

### `approvedCommission`
- Definition: ledger commission that passed manual approval.
- Source: `CreatorCommission` rows with `status=approved`.
- Included statuses: approved.
- Excluded statuses: pending, paid, void.
- Operator-safe: yes.
- Payable: yes (approved payable queue).
- Suggested UI label: **Approved commission**.

### `paidCommission`
- Definition: ledger commission marked paid.
- Source: `CreatorCommission` rows with `status=paid`.
- Included statuses: paid.
- Excluded statuses: pending, approved, void.
- Operator-safe: yes.
- Payable: already paid (settled).
- Suggested UI label: **Paid commission**.

### `voucherCommissionProjected` / `voucherCommissionPending`
- Definition: informational voucher commission amount not yet payable.
- Source: voucher commission rows filtered to pending informational lifecycle states.
- Included statuses: pending / pending-manual-approval type states only.
- Excluded statuses: approved, paid, voided, blocked.
- Operator-safe: yes (if explicitly marked non-payable).
- Payable: no (never payable from this metric).
- Suggested UI label: **Voucher commission (pending / informational)**.

### `voucherCommissionApproved`
- Definition: voucher commission approved for payout queue.
- Source: voucher commission rows in approved lifecycle state.
- Excluded statuses: blocked, voided, pending, paid.
- Operator-safe: yes.
- Payable: yes (payable queue).
- Suggested UI label: **Voucher commission approved**.

### `voucherCommissionPaid`
- Definition: voucher commission already paid/settled.
- Source: voucher commission rows in paid lifecycle state.
- Excluded statuses: blocked, voided, pending, approved.
- Operator-safe: yes.
- Payable: settled (already paid).
- Suggested UI label: **Voucher commission paid**.

---

## 3) UI label rules (locked)

- Do not display `grossBookingRevenue` as **Paid revenue**.
- If total attributed booking value is shown, label it **Attributed booking value**.
- True paid revenue must use paid/confirmed cash revenue logic and be labeled **Paid stay revenue** (or equivalent explicit paid label).
- Estimated metrics must explicitly state non-payable nature:
  - **Projected commission (not payable)** or
  - **Est. commission (not payable)**.
- Payable/approved/paid commission values must come from ledger rows only (`CreatorCommission` lifecycle), not projected stats.

---

## 4) Attribution resolver architecture (implementation direction)

Introduce a shared, read-only creator attribution resolver for booking attribution used by stats and ledger.

### Resolver requirements
- Priority:
  1. creator-linked promo code
  2. referral code
- Status policy:
  - include: `active`, `paused`, `archived`
  - exclude: `draft`
- Output shape (minimum):
  - `creatorPartnerId`
  - `source` (`creator_promo` | `creator_referral` | `none`)
  - `referralCode`
  - `promoCode`
  - `reason`
- Behavior:
  - read-only
  - no mutation of booking/promo/payment/creator records
  - deterministic and reusable in both stats and ledger services

---

## 5) Status policy (locked)

- `draft`: setup-only; excluded from attribution, stats, and ledger attribution resolution.
- `active`: normal live creator.
- `paused`: not actively promoted, but attribution remains resolvable for current/historical integrity.
- `archived`: hidden from active management workflows, but attribution remains resolvable for historical integrity.

Rule: status must not be used as a destructive filter that erases historical performance visibility.

---

## 6) Commission source of truth (locked)

- Stats projected commission is informational only.
- `CreatorCommission` ledger rows are source of truth for:
  - eligibility
  - payout workflow state
  - approved/paid lifecycle
- Payout-facing UI must never use projected stats as payable amount.
- Voucher commission must remain explicitly separated as voucher-domain commission.
- Any booking with unresolved `PaymentResolutionIssue` or equivalent manual-review blocking state must not contribute to paid/payable commission metrics.

---

## 6.1) Naming migration note (compatibility)

- Existing backend field names (for example, `grossBookingRevenue`) may remain internally for backward compatibility.
- UI and newly documented API semantics must not present such fields as paid revenue.
- Public-facing and ops-facing labels must follow locked semantics in this spec, even if internal storage/field names are retained temporarily.

---

## 7) Files likely touched in implementation batch

### Likely
- `server/services/ops/creatorPartnerStatsService.js`
- `server/services/ops/creatorCommissionLedgerService.js`
- `server/services/creators/creatorAttributionResolver.js` (new shared service, naming may vary)
- `client/src/pages/ops/OpsCreatorPartners.jsx`
- creator stats/commission semantic tests and related scripts

### Explicitly not touched
- `server/routes/bookingRoutes.js`
- `server/routes/giftVoucherRoutes.js`
- `server/services/giftVouchers/giftVoucherPaymentService.js`
- `server/services/ops/ingestion/stripeIngestionService.js`
- promo validation core logic
- availability/calendar logic
- checkout/payment logic

---

## 8) Test plan for later implementation

Add/extend tests to validate semantic correctness and consistency:

1. Stats UI/API does not present gross attributed value as paid revenue.
2. Paid revenue excludes pending/unpaid/cancelled/refunded/manual-review-ineligible outcomes per locked definition.
3. Projected commission uses documented estimate inputs and is clearly non-payable.
4. Ledger eligibility remains stricter than projected stats.
5. Stats and ledger share same promo-vs-referral priority via shared resolver.
6. Archived creators remain visible in historical stats/ledger attribution.
7. Draft creators are excluded from attribution resolution.
8. Commission action transition guards (approve/mark-paid/void) remain covered.
9. Existing creator referral visit tests remain green.
10. Existing gift voucher creator commission tests remain green.

---

## 9) Implementation batch proposal (next code batch)

### Name
Creator Financial Semantics Hardening

### Scope
- add shared read-only creator attribution resolver
- align stats metric mapping with locked definitions
- correct ops labels and non-payable messaging
- add targeted semantics + consistency tests
- update relevant docs to reflect final semantics

### Out of scope
- public collab pages
- `CreatorStayRequest`
- comp stay approvals
- booking/payment/voucher internals
- calendar blocks
- promo engine changes

---

## 10) Stop conditions (safety gates)

Stop implementation immediately if any of these is encountered:

1. Any required change mutates booking/payment/promo/voucher flow internals.
2. Revenue definition ambiguity remains unresolved by this spec.
3. Tests indicate production data migration is required.
4. Shared resolver would require rewriting persisted booking records.
5. Ops UI change would hide historical creator attribution/performance.
6. Implementation requires rewriting persisted booking attribution records.
7. Implementation requires automatic mass mutation of existing commission rows.

Implementation safety constraints:
- no persisted booking attribution records should be rewritten in this batch,
- no commission rows should be mass-mutated automatically,
- recalculation must preserve approved/paid rows unless current service already has a proven safe preservation rule.

---

## Locked decisions summary

- "Paid revenue" means paid/confirmed stay cash revenue only.
- `grossBookingRevenue` (or equivalent all-status attributed total) must not be labeled paid revenue.
- Commission ledger is authoritative for payable lifecycle.
- Projected stats are informational and must be labeled non-payable.
- Attribution status policy is unified: include active/paused/archived, exclude draft.
- Historical attribution must remain visible after archive.
- This batch excludes booking/payment/promo/pricing/availability internals and public collab pages.

