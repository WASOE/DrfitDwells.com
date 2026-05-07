# Drift & Dwells Gift Vouchers
# Locked implementation batches and anti-drift rules

This guidance file is a locked implementation contract for the Gift Vouchers feature.

## Core anti-drift principles

- Gift vouchers are prepaid credit, not discounts.
- Do not implement as Stripe Payment Links, manual workflows, promo-code hacks, or spreadsheets.
- Keep The Cabin and The Valley distinct in copy, operations, and reporting.
- Keep voucher logic separated from promo logic across accounting, booking totals, commission, and reporting.
- Never activate vouchers from frontend flows.
- Never add a public activation endpoint.

## Money and naming rules

- All money fields must be integer cents.
- Never store money as floats.
- Required cents naming pattern:
  - `amountOriginalCents`
  - `balanceRemainingCents`
  - `amountAppliedCents`
  - `subtotalCents`
  - `discountAmountCents`
  - `giftVoucherAppliedCents`
  - `stripePaidAmountCents`
  - `totalValueCents`

## Security rules

- Voucher code must be high entropy.
- Minimum acceptable format: `DD-XXXX-XXXX-XXXX` (or equivalent entropy).
- Do not use short weak codes.
- Do not expose internal IDs publicly as voucher identifiers.
- Public validation responses should be generic; detailed reasons are for OPS/logs.
- Voucher validation/redemption endpoints must be rate limited.

## Data model guardrails

- `GiftVoucher.code` unique index must be partial (code may be null pre-activation).
- Example locked index:

```js
GiftVoucherSchema.index(
  { code: 1 },
  {
    unique: true,
    partialFilterExpression: { code: { $type: "string" } }
  }
);
```

- Financial actions require immutable event logging (`GiftVoucherEvent`) including:
  - `previousBalanceCents`
  - `newBalanceCents`
  - `deltaCents`
  - `actor`
  - `note`

## Redemption invariant (locked)

Chosen v1 invariant:

- reserve = decrement `balanceRemainingCents`
- release = restore `balanceRemainingCents`
- confirm = no additional balance change

Rules:

- Reserve must be atomic and race-safe.
- Do not create redemption first and decrement balance later.
- Confirm and release must both be idempotent.
- Duplicate release must not restore twice.
- Duplicate confirm must not consume twice.

## Stripe and activation guardrails

- Voucher activation must be service-only via trusted Stripe webhook processing.
- No public route such as `POST /api/gift-vouchers/activate` is allowed.
- Suggested internal service entrypoint:
  - `giftVoucherPaymentService.activatePaidVoucherFromStripeEvent(event)`

Webhook idempotency must ensure duplicate `payment_intent.succeeded` cannot:

- create second voucher code
- send duplicate buyer/recipient emails
- create duplicate paid events
- double count commission

Required idempotency evidence fields:

- `purchaseRequestId`
- `stripePaymentIntentId`
- processed Stripe event identifiers
- `activatedAt`

## Email after payment rule

- Paid voucher activation must not depend on successful email delivery.
- If email fails after payment:
  - voucher remains active
  - create voucher event(s)
  - create email failure event
  - open manual review item
  - allow OPS resend

## Public and OPS scope targets

Public pages (future implementation target):

- `/gift-vouchers`
- `/gift-vouchers/success`
- `/gift-vouchers/redeem`

OPS pages (future implementation target):

- `/ops/gift-vouchers`
- `/ops/gift-vouchers/:id`

OPS requires strict audit trail for all financial/manual actions.

## Influencer and commission rules

- Capture voucher purchase attribution (`referralCode`, `creatorPartnerId`, `landingPath`, UTM fields).
- Track voucher stats separately from normal bookings.
- Prevent double commission:
  - commission on voucher sale only once
  - no second commission on voucher-covered redemption value

## Locked batch execution policy

- Implement batch-by-batch only.
- Do not combine batches unless explicitly approved.
- Do not alter unrelated systems while implementing active batch.
- No booking flow changes before Batch 7.
- No commission behavior changes before Batch 8.

### Batch lock reminder

- Batch 1: spec only.
- Batch 2: backend foundation only (models/services/tests).
- Batch 3+: continue by approved batch scope.

## Stop conditions

Stop and request review if implementation attempts to:

- combine batches without approval
- add public activation endpoint
- treat vouchers as promo discounts
- use float money
- activate from frontend success page
- skip webhook idempotency
- skip financial event logs
- skip reserve/release lifecycle
- change booking flow before Batch 7
- change commission logic before Batch 8

## Execution reporting requirement

After each approved batch, report:

- files changed
- logic added
- tests run
- risks
- intentionally untouched areas

