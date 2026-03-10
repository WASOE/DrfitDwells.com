# Payment Security

## Stripe Integration

### Key Separation
- **Publishable key** (`pk_live_*`): Only in client (VITE_STRIPE_PUBLISHABLE_KEY). Safe to expose.
- **Secret key** (`sk_live_*`): Only on server (STRIPE_SECRET_KEY). Never in client, never in git.

### Amount Calculation (Critical)
The payment amount is **always** calculated on the server. The client never sends `amount`.

- **create-payment-intent** accepts: `cabinId`, `checkIn`, `checkOut`, `adults`, `children`, `experienceKeys`
- Server loads cabin from DB, validates dates/guests, computes total via `pricingService.calculateCabinPrice`
- PaymentIntent is created with server-calculated amount only

### Experience Keys (Add-ons)
- `experienceKeys` are **whitelisted** against cabin.experiences
- Unknown keys are rejected with 400
- Duplicates are deduped; pricing uses server-side cabin experience prices only

### Booking Finalization (Stripe-paid path)
When `paymentIntentId` is provided with `cabinId`:
1. **Idempotency**: If booking with this paymentIntentId exists → return it (no duplicate)
2. **Stripe verify**: Retrieve PaymentIntent, assert `status === 'succeeded'`
3. **Metadata match**: Assert cabinId in metadata matches request
4. **Amount verify**: Recalculate expected amount; assert Stripe `amount`/`amount_received` matches
5. **Availability re-check**: Conflict check before creating booking
6. **Shared pricing**: Same `pricingService.calculateCabinPrice` as create-payment-intent

### Rate Limiting
- `create-payment-intent` and `POST /bookings`: 10 requests per minute per IP

### Flow
1. Client requests PaymentIntent with booking params (no amount)
2. Server validates cabin, dates, guests, experienceKeys; calculates total; creates PaymentIntent
3. Client confirms payment via Stripe.js
4. Client calls `POST /bookings` with `paymentIntentId` + same params
5. Server verifies payment, recalculates, re-checks availability, creates booking (or returns existing)

## Operational Rules

### Metadata Trust Boundary
Server rebuilds all booking data from request + DB. Stripe metadata is used only for validation (cabinId match), not as source of truth.

### Currency
PaymentIntent must be in EUR. Verified at finalization.

### Stale Price / Stale Cabin Data
**Rule: Reject mismatch.** If cabin prices or config change between payment-intent creation and finalization, the server recalculated amount will differ from the paid amount. We reject with "Payment amount mismatch". User must restart the flow and create a new payment.

### Conflict After Payment (Paid but Unavailable)
If payment succeeded but availability check fails at finalization (race condition):
- **Booking not created**
- User receives: "This cabin is no longer available for the selected dates. Your payment will be refunded – please contact us."
- Server logs `[PAID_UNAVAILABLE]` with paymentIntentId, cabinId, dates, amount for manual refund/ops
- **Action**: Process refund in Stripe Dashboard; contact guest if needed

### Webhook Path
Currently success depends on client return flow. **Webhook support is recommended** for:
- Reconciliation
- Recovery when user closes browser before return
- Audit trail

If adding Stripe webhooks: **signature verification is mandatory** via `STRIPE_WEBHOOK_SECRET`.

### Rate Limiting
- 10 req/min per IP for create-payment-intent and POST /bookings
- Set `TRUST_PROXY=1` when behind reverse proxy/CDN so rate limit uses correct client IP

### Audit Logging
- `[PAID_BOOKING_SUCCESS]`: paymentIntentId, bookingId, cabinId, amountCents
- `[PAID_UNAVAILABLE]`: paymentIntentId, cabinId, dates, amountCents (for refund handling)
- No card data or sensitive guest PII in logs

## Production Checklist

- [ ] `STRIPE_SECRET_KEY` set on server (never committed)
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` set for client build
- [ ] Use **live** keys only in production; test keys for staging
- [ ] Stripe webhooks (if added): verify signature with `STRIPE_WEBHOOK_SECRET`
- [ ] HTTPS enforced for all payment pages
- [ ] No full Stripe errors or secrets logged in production
- [ ] `TRUST_PROXY=1` set when behind reverse proxy (for rate limiting)
