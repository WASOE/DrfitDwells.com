# Historical paid-checkout recovery (Batch 8)

Controlled, allowlist-only recovery for historical accommodation checkouts that paid in Stripe but never fully finalized.

Binding: [`02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md`](./02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md)

This CLI wraps the Batch 7 reconciliation service (`reconcilePaidCheckoutSubject`). It does **not** invent payment, booking, job, or email logic.

## Hard requirements

Mutations require **all three**:

1. `FINALIZE_RECONCILE_HISTORICAL=1`
2. `--execute`
3. `--allowlist=<file>`

Default mode is **dry-run**. There is no server-startup scheduler and no unbounded historical scan.

## Allowlist format

JSON array. Each row needs at least `checkoutId` or `paymentIntentId`:

```json
[
  {
    "checkoutId": "chk_...",
    "paymentIntentId": "pi_...",
    "reason": "operator-approved historical recovery"
  }
]
```

Validation rules:

- malformed rows → reject the allowlist
- identical duplicates → collapsed (idempotent)
- conflicting duplicates (same checkoutId → different paymentIntentIds, or reverse) → reject

Example file (fake IDs only):

`docs/checkout-payment-architecture/examples/historical-recovery-allowlist.example.json`

## CLI usage

```bash
# Dry-run (always require allowlist)
node server/scripts/recoverHistoricalPaidCheckoutFinalization.js \
  --allowlist=./ops-approved-allowlist.json \
  --limit=25

# Execute safe repairs
FINALIZE_RECONCILE_HISTORICAL=1 node server/scripts/recoverHistoricalPaidCheckoutFinalization.js \
  --execute \
  --allowlist=./ops-approved-allowlist.json \
  --limit=25 \
  --report=./historical-recovery-report.json

# Resume next page
FINALIZE_RECONCILE_HISTORICAL=1 node server/scripts/recoverHistoricalPaidCheckoutFinalization.js \
  --execute \
  --allowlist=./ops-approved-allowlist.json \
  --offset=25 \
  --limit=25 \
  --checkpoint=./historical-recovery.checkpoint.json
```

### Options

| Option | Meaning |
|---|---|
| `--allowlist=<file>` | Required. Operator-approved JSON allowlist |
| `--dry-run` | Default. Inspect + propose only |
| `--execute` | Apply safe repairs when historical flag is on |
| `--limit=<n>` | Max entries this run (default 25, max 200) |
| `--offset=<n>` | Skip first N validated entries (resume) |
| `--checkpoint=<file>` | Write `{ nextOffset, exhausted }` after the run |
| `--report=<file>` | Write full redacted JSON report |

## Report fields (per entry)

Redacted. No guest PII, no `client_secret`, no full Stripe objects.

- `classification`
- `verification` (Stripe status / ok)
- `proposedAction` / `executedAction`
- `bookingId` / `jobId` when applicable
- `failureStage`
- `mutated`, `dryRun`, `emailResendAttempted`, `bookingCreated`

## Safety bans

- No automatic refunds
- No new or replacement PaymentIntent
- No duplicate Booking / active job
- No ambiguous confirmation email resend
- Gift vouchers and location payments excluded
- Missing/ambiguous evidence → review only, no auto-recover
- Amount / currency / entity / date / hash mismatches → review only
- Superseded or noncanonical PI → never recovered

## Related flags

| Flag | Batch | Default |
|---|---|---|
| `FINALIZE_RECONCILE_ENQUEUE` | 7 (current orphans) | off |
| `FINALIZE_RECONCILE_HISTORICAL` | 8 (allowlisted historical) | off |
