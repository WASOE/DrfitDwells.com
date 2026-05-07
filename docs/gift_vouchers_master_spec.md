# Drift & Dwells Gift Vouchers - Master Spec (Batch 1 Locked)

Status: Approved for Batch 1 documentation only  
Scope lock: This document defines product, accounting, redemption, attribution, and commission rules for a full gift voucher module.  
Batch lock: Batch 1 creates this spec only. No implementation changes are allowed in Batch 1.

Related control file:

- `docs/drift_dwells_gift_vouchers_locked_batches.md`

If this spec and the locked batch file conflict, stop and ask for review before implementation.

---

## 1) Product intent

### Core product statement

The Gift of Time Offline

A Drift & Dwells gift voucher, delivered by email or as a physical card by post.  
The buyer pays now.  
The recipient receives a personal gift voucher code.  
The code can be used later toward a stay at The Cabin or The Valley.

### Critical business distinction

Gift vouchers are prepaid credit, not discounts.

- Promo code: reduces price.
- Gift voucher: pays part or all of payable amount.

This distinction is mandatory for accounting, creator attribution, commission, and reporting.

---

## 2) Product rules

- Currency: EUR
- Minimum amount: EUR 15
- Preset amounts: EUR 15 / EUR 50 / EUR 100 / EUR 250
- Optional custom amount: allowed (minimum EUR 15)
- Validity: 12 months from activation/payment confirmation
- Redeemable for: The Cabin and The Valley
- Not redeemable for cash
- Subject to availability
- If stay costs more than voucher value, recipient pays difference
- If stay costs less, remaining voucher balance remains available

VAT note: SPV/MPV treatment is an accounting decision that must be finalized before invoicing logic is locked.

---

## 3) Domain model (locked naming + money strategy)

All monetary fields must be stored as integer cents (never floats).

### GiftVoucher

Required/expected fields:

- code (nullable before activation)
- amountOriginalCents
- balanceRemainingCents
- currency (`EUR`)
- status (`draft` | `pending_payment` | `active` | `partially_redeemed` | `redeemed` | `expired` | `voided` | `refunded`)
- buyerName
- buyerEmail
- recipientName
- recipientEmail
- message
- deliveryMode (`email` | `postal` | `manual`)
- deliveryAddress.addressLine1
- deliveryAddress.addressLine2
- deliveryAddress.city
- deliveryAddress.postalCode
- deliveryAddress.country
- deliveryDate
- sentAt
- expiresAt
- purchaseRequestId (idempotency)
- stripePaymentIntentId
- stripeCheckoutSessionId (optional if ever used)
- activatedAt
- stripeEventIdsProcessed (or equivalent idempotency evidence strategy)
- attribution.referralCode
- attribution.creatorPartnerId
- attribution.landingPath
- attribution.utmSource
- attribution.utmMedium
- attribution.utmCampaign
- attribution.utmTerm
- attribution.utmContent
- createdAt
- updatedAt

### GiftVoucherRedemption

- giftVoucherId
- bookingId
- reservationId
- amountAppliedCents
- status (`reserved` | `confirmed` | `released` | `voided`)
- reservedAt
- confirmedAt
- releasedAt
- expiresAt
- reason

### GiftVoucherEvent

- giftVoucherId
- type (`created` | `payment_pending` | `paid` | `activated` | `send_attempted` | `sent` | `send_failed` | `resent` | `redeemed_reserved` | `redeemed_confirmed` | `redeemed_released` | `adjusted` | `voided` | `expired` | `refunded` | `expiry_extended` | `recipient_email_updated` | `manual_review_created`)
- actor
- note
- previousBalanceCents (required for financial changes)
- newBalanceCents (required for financial changes)
- deltaCents (required for financial changes)
- createdAt

Event log rule: any financial mutation must include before/after values, delta, actor, and note.

---

## 4) Indexing and uniqueness rules

### GiftVoucher.code unique index must be partial

Pending vouchers may not have a code yet.  
Unique constraint applies only when code is a string.

Canonical index:

```js
GiftVoucherSchema.index(
  { code: 1 },
  {
    unique: true,
    partialFilterExpression: { code: { $type: "string" } }
  }
);
```

---

## 5) Voucher code security policy (v1)

v1 decision:

- Store code in plaintext (high entropy only).
- Never expose broadly in APIs.
- Show code only in buyer/recipient delivery flows and authorized OPS detail views.

Entropy requirement:

- Use high-entropy format such as `DD-XXXX-XXXX-XXXX` or equivalent.
- Do not use short formats like `DD-XXXX-XXXX`.
- Minimum random payload target: 12 base32-style random characters.

Future upgrade path (optional later): `codeHash` / encrypted storage / masked display fields.

---

## 6) Payment and activation policy

### Activation trust boundary

There must be no public activation endpoint.

Forbidden:

- `POST /api/gift-vouchers/activate`

Required approach:

- activation is service-only from trusted Stripe webhook handling, e.g.:
  - `giftVoucherPaymentService.activatePaidVoucherFromStripeEvent(event)`

No frontend/manual/public activation route is allowed.

### Idempotency policy

Stripe webhook handling must be idempotent.

Duplicate `payment_intent.succeeded` events must not create:

- second activation
- second code
- duplicate voucher events
- duplicate recipient/buyer emails

Idempotency must be supported with persisted identifiers/evidence (for example `purchaseRequestId`, `stripePaymentIntentId`, processed Stripe event ids, activation timestamp).

### Email failure policy after successful payment

Payment success and activation are not blocked by email delivery.

Required flow:

1. Payment succeeds.
2. Voucher activates.
3. Code is generated.
4. Email send is attempted.
5. If email fails: log `GiftVoucherEvent` + open `ManualReviewItem`.
6. Voucher remains `active`.
7. OPS can resend.

### Public error and rate-limit policy

Public voucher validation/redeem endpoints must be rate-limited.

Public errors must be generic and must not expose whether a voucher exists, is expired, has balance, or belongs to a specific person.

Detailed failure reasons are allowed only in server logs, internal reason codes, `ManualReviewItem`, and OPS.

---

## 7) Redemption accounting and race-safety policy

### Atomic reservation rule (mandatory)

Reserve path must be atomic and race-safe:

1. Validate voucher state.
2. Atomically decrement `balanceRemainingCents`.
3. Create `GiftVoucherRedemption` with `status=reserved`.
4. Expire/release if booking fails or times out.

Do not create redemption first and decrement later.

### Balance invariant decision for this app (v1)

Use simple balance model:

- `amountOriginalCents`
- `balanceRemainingCents`

Rules:

- Reserve: decrement `balanceRemainingCents`.
- Release: increment `balanceRemainingCents`.
- Confirm: no additional balance change.

Interpretation:

- `reserved` redemptions are temporarily consumed balance.

Idempotency requirements:

- Release must be idempotent.
- Confirm must be idempotent.
- Duplicate release must not restore balance twice.
- Duplicate confirm must not consume balance twice.

---

## 8) Manual review rules

`ManualReviewItem` must be opened for:

- paid voucher activation failed
- paid voucher code generation failed
- paid voucher email failed
- Stripe webhook references missing voucher
- Stripe amount mismatch
- duplicate suspicious payment event
- voucher redemption reserve failed after checkout started
- booking succeeded but redemption confirmation failed
- redemption release failed

---

## 9) Booking accounting shape (future batch integration target)

When booking integration is implemented, booking totals must use cents and separate value components:

- `subtotalCents`
- `discountAmountCents`
- `giftVoucherAppliedCents`
- `stripePaidAmountCents`
- `totalValueCents`

Gift vouchers must not be represented as promo discounts.

---

## 10) Public pages (future implementation target)

- `/gift-vouchers`
- `/gift-vouchers/success`
- `/gift-vouchers/redeem`

These are product requirements for later batches only.

---

## 11) OPS module requirements (future implementation target)

Target pages:

- `/ops/gift-vouchers`
- `/ops/gift-vouchers/:id`

Required features (later batch):

- list/search/filter vouchers
- payment status visibility
- balance and redemption history
- resend voucher email
- recipient email correction before send
- void/extend/manual adjust with evented financial audit trail
- attribution and related booking visibility

No silent edits for financial state.

---

## 12) Attribution and creator commission rules

Each voucher purchase must capture:

- `referralCode`
- `creatorPartnerId`
- `landingPath`
- UTM fields

Creator analytics must include separate voucher metrics:

- gift voucher purchases
- gift voucher revenue
- gift voucher commission

Double commission prevention:

- commission is applied on voucher sale once (under configured eligibility policy)
- voucher-covered redemption value must not generate second commission
- additional cash paid later may be separately attributable only with valid attribution signal

---

## 13) Delivery email requirements (future implementation target)

Required email categories:

- buyer receipt
- recipient gift voucher
- voucher resend
- voucher redeemed confirmation
- voucher expiry reminder
- internal OPS notification for failed payment/failed send

Premium gift card style is required in recipient-facing voucher delivery.

---

## 14) Non-goals for v1

- no cash withdrawals
- no bank transfer payout
- no public standalone voucher balance lookup
- no Stripe Payment Link workaround
- no manual spreadsheet process
- no advanced tax invoice automation before accountant decision
- no multi-currency
- no public influencer dashboard changes unless explicitly approved

Note: physical card mailing workflow is not implemented in this batch; only delivery preference and postal address storage are captured for later operational handling.

---

## 15) Required tests before production

- voucher code generation is unique
- voucher code format is valid
- paid Stripe event activates voucher
- duplicate Stripe event is idempotent
- unpaid voucher cannot be redeemed
- expired voucher cannot be redeemed
- voided voucher cannot be redeemed
- same voucher cannot overspend
- partial redemption leaves balance
- second redemption uses remaining balance
- booking failure releases reserved voucher amount
- full voucher payment creates valid booking without Stripe charge
- creator referral attaches to voucher purchase
- creator commission does not double count voucher redemption
- email failure after payment keeps voucher active and creates manual review

---

## 16) Batch plan lock

### Batch 1 (this batch)

Allowed:

- create this spec document only

Not allowed:

- models
- services
- routes
- Stripe handling code
- UI pages/components
- email templates/code
- OPS screens
- booking schema or checkout changes
- tests

### Batch 2 (next, separate approval required)

Scope will be backend foundation only:

- GiftVoucher model
- GiftVoucherRedemption model
- GiftVoucherEvent model
- giftVoucherCodeService
- giftVoucherValidationService
- giftVoucherLedgerService
- giftVoucherEventService
- tests

Batch 2 must not touch booking flow yet.

---

## 17) Definition of done (full feature target, not Batch 1)

- guest can buy voucher online
- payment auto-activates voucher via trusted webhook path
- recipient gets premium voucher delivery
- OPS can manage lifecycle and resend
- voucher redeemable during booking
- balances tracked correctly with race-safe reservation
- attribution and single-commission logic work correctly
- no spreadsheet/manual workaround required

