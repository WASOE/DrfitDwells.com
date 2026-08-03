# Multi-Unit Paid-Orphan Recovery CLI (S0)

Binding architecture: `docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md`

## Purpose

Allowlisted, resumable recovery of a paid CheckoutSession that failed finalization with `DUPLICATE_STAY_CONFLICT` when a second physical unit of the same cabin type is available.

## Hard bans

- No Stripe charge or refund creation
- No SMTP / confirmation send
- No confirmation-worker start
- No capability-module import from the CLI
- No production identifiers in examples (use fake IDs only)
- Flag `MULTI_UNIT_PAID_ORPHAN_RECOVERY` alone grants no privilege

## Dry-run (default)

```bash
node server/scripts/recoverMultiUnitPaidOrphanCheckout.js \
  --allowlist=docs/checkout-payment-architecture/examples/multi-unit-paid-orphan-allowlist.example.json
```

Prints sanitized `canonicalEvidence` + `digest`. Performs **zero writes**.

## Execute (initial)

```bash
MULTI_UNIT_PAID_ORPHAN_RECOVERY=1 node server/scripts/recoverMultiUnitPaidOrphanCheckout.js \
  --execute \
  --allowlist=/secure/ops-approved-allowlist.json \
  --evidence=/secure/dry-run-evidence.json \
  --digest=<sha256-hex> \
  --phrase='I CONFIRM THE GUEST INTENDS TO PURCHASE A SECOND PHYSICAL A-FRAME' \
  --operator=ops:alice \
  --intent-at=2026-08-03T12:00:00.000Z \
  --reason='Guest confirmed second physical A-frame'
```

## Resume

```bash
MULTI_UNIT_PAID_ORPHAN_RECOVERY=1 node server/scripts/recoverMultiUnitPaidOrphanCheckout.js \
  --resume --execute \
  --allowlist=/secure/ops-approved-allowlist.json \
  --evidence=/secure/dry-run-evidence.json \
  --digest=<sha256-hex> \
  --phrase='I CONFIRM THE GUEST INTENDS TO PURCHASE A SECOND PHYSICAL A-FRAME' \
  --operator=ops:alice \
  --intent-at=2026-08-03T12:00:00.000Z \
  --reason='Guest confirmed second physical A-frame' \
  --resumed-by=ops:bob
```

Resume reuses the same `recoveryExecutionId` and original digest. No new dry-run is required for compatible incomplete recovery.

## Allowlist fields

See `examples/multi-unit-paid-orphan-allowlist.example.json`. Required identities:

- `checkoutId`, `checkoutSessionId`, `paymentIntentId`, `paymentId`
- `finalizationJobId`, `manualReviewItemId`
- `cabinTypeId`, `expectedTargetUnitId`
- optional `firstBookingId`, `expectedFailureCode`

## Feature flag

`MULTI_UNIT_PAID_ORPHAN_RECOVERY` defaults false. Enable only for approved execute/resume. Do **not** enable `MULTI_UNIT_CAPACITY_STAY_GUARD` for this incident recovery.
