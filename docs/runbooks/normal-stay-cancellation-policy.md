# Normal-stay cancellation policy v2

**Identity:** `normal-stay-standard@v2`
**Configuration script:** `server/scripts/configureNormalStayCancellationPolicy.cjs`
**Customer document:** `client/public/legal/cancellation-policy-2026-10-12-v2.pdf`

Version 1 remains immutable for historical bookings at
`client/public/legal/cancellation-policy-2026-04-19-v1.pdf`.

## Proposed policy

### Cash refund

| Guest cancels | Cash refund |
|---|---|
| 30 or more days before arrival | 100% of the original booking amount, less €15 administration fee |
| 14–29 days before arrival | 50% of the original booking amount, less €15 administration fee |
| Fewer than 14 days before arrival | No cash refund |
| No-show | No cash refund |

The administration fee applies only when a cash refund would otherwise be due,
is capped at that refundable amount, and does not apply when Drift & Dwells
cancels for reasons within its control.

### Voluntary booking credit

Guests cancelling at least 14 days before arrival may explicitly choose booking
credit instead of cash. Credit is 100% of the original booking amount, has no
administration fee, and may be used for a future Drift & Dwells stay subject to
availability. This policy does not create an expiry date. Credit is not
automatically offered for cancellations fewer than 14 days before arrival or
for no-shows.

## Checkout disclosure

Checkout retains the existing concise EN/BG consent sentence and links to
Terms and the Cancellation Policy. Do not add policy tables, fee banners,
countdowns, warnings, or additional confirmation steps to checkout or property
pages.

New booking consent records carry `normal-stay-standard@v2` and the immutable
v2 document URL. Missing cancellation-policy fields on historical records are
treated as legacy v1 evidence. Fixed-package bookings continue to use their
frozen rate-plan cancellation-policy snapshot.

## Mandatory legal and production gate

The candidate document is `status=draft` and `legalReviewStatus=pending`.
Neither creating the draft policy nor merging its code authorizes activation.
Before production publication or RatePlan reassignment, obtain and record
Bulgarian/EU legal approval for the complete schedule and €15 fee. Then update
the policy to `status=active`, `legalReviewStatus=approved`, and populate
`legalApprovalMetadata.reviewedAt`, `reviewedBy`, and `notes` through a reviewed
follow-up change.

Do not overwrite v1, mutate existing Booking policy evidence, automatically
refund Stripe payments, or automatically choose booking credit.

## Safe inspection and draft creation

With mode absent, the script exits without connecting. Read-only inspection:

```bash
cd server
NORMAL_STAY_CANCELLATION_POLICY_MODE=inspect \
  node scripts/configureNormalStayCancellationPolicy.cjs
```

Draft creation is a separate production-data action and is not authorized by
this runbook alone. It requires this exact confirmation:

```bash
NORMAL_STAY_CANCELLATION_POLICY_MODE=create \
NORMAL_STAY_CANCELLATION_POLICY_CREATE_CONFIRM=CREATE_NORMAL_STAY_STANDARD_V2_DRAFT \
  node scripts/configureNormalStayCancellationPolicy.cjs
```

The script creates only `normal-stay-standard@v2`, refuses conflicting content,
does not update or delete v1, does not modify RatePlans, and does not create or
change indexes.

## Verification before any activation

1. Focused cancellation policy, checkout consent, and split-settlement tests pass.
2. Version 1 and version 2 PDFs both exist and are byte-distinct.
3. `/cancellation-policy` remains the discreet public route.
4. Checkout contains no five-day free-cancellation promise or detailed schedule.
5. Existing bookings and frozen v1 snapshots remain unchanged.
6. Legal approval metadata is complete before changing v2 from pending/draft.
7. Production RatePlan reassignment, deployment, and policy publication receive
   explicit authorization after the legal gate closes.
