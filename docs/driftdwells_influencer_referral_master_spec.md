# Drift & Dwells Influencer and Referral System Master Spec

Date: 2026-04-29
Project: driftdwells.com
Feature owner: Drift & Dwells
Implementation target: existing Drift & Dwells booking portal
Status: Logic locked before implementation

## 1. Purpose

Build a simple, elegant, reliable influencer and creator tracking system for Drift & Dwells.

The system must answer four business questions:

1. Which creator sent this guest?
2. Which bookings came from that creator?
3. How much paid revenue did those bookings generate?
4. What commission or reward is owed?

The system must not become a bloated affiliate platform. It should reuse the existing booking, promo, payment, and ops architecture wherever possible.

## 2. Core principle

The booking is the source of truth.

Influencer tracking is not a separate sales system. It is extra attribution data attached to the existing booking and payment flow.

The feature should fit into the current architecture:

- Existing booking flow stays intact.
- Existing promo code logic stays intact.
- Existing Stripe PaymentIntent flow stays intact.
- Existing Ops backoffice becomes the place for management.
- Existing Booking model gets minimal safe extensions.
- Existing attribution capture gets upgraded instead of replaced.

## 3. Existing architecture to reuse

Based on the audit, reuse these parts:

### Frontend

- `client/src/tracking/attribution.js`
- `client/src/layouts/SiteLayout.jsx`
- `client/src/pages/ConfirmBooking.jsx`
- `client/src/pages/craft/Step4Summary.jsx`
- Existing booking form and booking state
- Existing promo code input and behavior

### Backend

- `server/routes/bookingRoutes.js`
- `server/models/Booking.js`
- `server/models/PromoCode.js`
- `server/services/promoService.js`
- `server/services/bookingQuoteService.js`
- Existing Stripe PaymentIntent creation
- Existing Stripe webhook ingestion
- Existing ops payment ingestion models where useful

### Backoffice

- Use `/ops`, not legacy `/admin`
- Pattern match existing Ops pages such as reservations, payments, reviews, and manual review

## 4. What this feature is

A creator referral system with:

- Creator records
- Creator links
- Optional promo codes
- Booking attribution
- Stripe metadata linkage
- Commission snapshots
- Manual payout tracking
- Simple Ops dashboard
- Optional public `/creators` page later

## 5. What this feature is not

This is not:

- A full public affiliate portal
- A login system for influencers
- Stripe Connect payouts
- Automatic bank payouts
- Multi-level affiliate marketing
- Coupon-only tracking
- A replacement for current promo codes
- A replacement for current booking logic
- A replacement for current Stripe PaymentIntent flow

## 6. Roles

### 6.1 Admin or operator

The admin uses the system to:

- Create a creator profile
- Give the creator a link and optional promo code
- Track visits, bookings, paid revenue, and commission
- See whether creator deliverables were received
- Mark commissions as approved, void, or paid
- Export or manually process payouts
- Review which creators are actually bringing value

### 6.2 Creator or influencer

The creator uses the system without logging in.

They receive:

- A personal link, for example `https://driftdwells.com/?ref=ana`
- An optional promo code, for example `ANA10`
- Clear campaign terms
- Clear content deliverables
- Clear commission or reward terms

They share the link in bio, stories, reels, posts, or direct messages.

### 6.3 Guest

The guest lands on the website through a creator link or uses a creator promo code.

The guest experience must remain normal:

- No affiliate branding forced into the booking flow
- No extra steps
- No confusing referral fields
- Promo code works the same way as now
- Booking and payment flow stays clean

## 7. Simple user story

### Admin flow

1. Admin opens `/ops/influencers`.
2. Admin creates a creator:
   - Name: Ana
   - Handle: `@ana.travel`
   - Referral code: `ana`
   - Promo code: `ANA10`
   - Commission rate: 10 percent
   - Status: active
3. System shows:
   - Creator link: `https://driftdwells.com/?ref=ana`
   - Promo code: `ANA10`
4. Admin sends this to the creator.
5. Creator posts the link and code.
6. Guests book.
7. Admin later sees:
   - Clicks
   - Bookings
   - Paid revenue
   - Commission due
   - Payout status
8. Admin pays manually and marks payout as paid.

### Creator flow

1. Creator receives link and code.
2. Creator posts content.
3. Creator tells followers:
   - Book directly on driftdwells.com
   - Use code `ANA10`
4. Creator does not need an account.
5. Admin can later share a manual report if needed.

### Guest flow

1. Guest clicks `https://driftdwells.com/?ref=ana`.
2. Website stores `referralCode = ana` for 60 days.
3. Guest browses and books later.
4. Booking stores the referral attribution.
5. Stripe PaymentIntent metadata also stores the referral attribution.
6. Booking becomes commission eligible only after payment is confirmed and no refund issue exists.

## 8. Tracking model

Use two tracking methods together:

### 8.1 Referral link

Example:

```txt
https://driftdwells.com/?ref=ana
```

Supported query params:

```txt
ref
referral
creator
```

Canonical internal field:

```txt
referralCode
```

Rules:

- `?ref=ana` becomes `referralCode = ana` (same for `?ref=diana.bosa`)
- Normalize to lowercase
- Trim whitespace
- If the value starts with `@` (Instagram handle paste), remove that single leading `@` and trim again
- Allowed characters: `a-z`, `0-9`, dot `.`, dash `-`, underscore `_`
- Max length 80
- Invalid examples (rejected, not stored): spaces, `/`, `,`, angle brackets / markup, empty after normalize
- Slug rules for creator **slug** in Ops remain stricter (no dots): `a-z`, `0-9`, `-`, `_` only
- Store first valid touch for 60 days
- Do not overwrite valid first-touch attribution unless explicitly designed later

### 8.2 Promo code

Example:

```txt
ANA10
```

Promo codes already exist in local MongoDB and are applied server-side before Stripe.

Keep this behavior.

Promo codes are for guest discount and optional attribution confirmation.

Referral link and promo code are related but not the same thing.

## 9. Attribution priority

When a booking has multiple signals, use this priority:

1. Promo code linked to an active creator
2. Referral code stored from URL
3. UTM campaign
4. Paid click ID
5. Direct or unknown

Important:

- Promo code wins for attribution only if the promo code is explicitly linked to a creator.
- A normal promo code should not automatically become influencer commission.
- Referral code should not automatically create a discount.
- Promo and referral are separate concepts.

## 10. First-touch versus last-touch

Use first-touch for V1.

Reason:

- It is simpler.
- It avoids creators stealing attribution from each other at the last moment.
- It fits the existing attribution behavior.
- It is good enough for the current stage.

Future option:

- Add last-touch separately if needed.
- Do not add it now.

## 11. Storage behavior

Current system uses sessionStorage only.

Upgrade to localStorage with TTL.

Storage key:

```txt
dd_attrib_v2
```

TTL:

```txt
60 days
```

Stored fields:

```json
{
  "referralCode": "ana",
  "utm_source": "instagram",
  "utm_medium": "creator",
  "utm_campaign": "ana_april_2026",
  "utm_content": "story",
  "gclid": null,
  "gbraid": null,
  "wbraid": null,
  "fbclid": null,
  "msclkid": null,
  "referrer": "https://instagram.com/",
  "landingPath": "/?ref=ana",
  "attributionCapturedAt": "2026-04-29T18:00:00.000Z",
  "expiresAt": "2026-06-28T18:00:00.000Z"
}
```

Rules:

- If no existing valid attribution exists, capture new valid attribution.
- If valid attribution exists, preserve it.
- If attribution is expired, replace it with new valid attribution.
- If URL has no tracking data, do not wipe stored attribution.
- `getAttributionPayload()` must remain backward compatible.

## 12. Consent and privacy

The system stores marketing attribution in localStorage.

Requirements:

- Do not store sensitive personal data in attribution.
- Do not store guest email, phone, name, or address in attribution storage.
- Do not add third-party tracking scripts for this feature.
- Respect existing consent banner patterns.
- Update privacy policy later to mention referral and campaign attribution.
- Keep retention reasonable.

For V1, localStorage TTL of 60 days is acceptable if aligned with existing site consent behavior.

## 13. Backend attribution fields

Extend `Booking.attribution` minimally.

Add optional fields:

```js
attribution: {
  referralCode: String,
  attributionSource: String,
  attributionCapturedAt: Date,
  utmSource: String,
  utmMedium: String,
  utmCampaign: String,
  utmContent: String,
  gclid: String,
  gbraid: String,
  wbraid: String,
  fbclid: String,
  msclkid: String,
  referrer: String,
  landingPath: String
}
```

Use existing field names where already present.

Do not create duplicate UTM fields if they already exist.

Server must sanitize all attribution fields.

## 14. Attribution source values

Use simple string values:

```txt
creator_promo
creator_referral
utm
paid_click
direct
unknown
```

Rules:

- `creator_promo`: promo code is linked to an active creator
- `creator_referral`: referralCode exists
- `utm`: UTM exists, no creator signal
- `paid_click`: click ID exists, no creator or UTM signal
- `direct`: no attribution signal
- `unknown`: fallback when source cannot be determined

## 15. Creator model

Add a new model in Phase 2:

File:

```txt
server/models/Influencer.js
```

Use the name `Influencer` internally if that fits code naming, but UI should say `Creators` or `Creator Partners`.

Suggested fields:

```js
{
  name: String,
  displayName: String,
  handle: String,
  platform: String,
  email: String,
  phone: String,
  referralCode: String,
  promoCode: String,
  status: String,
  commissionRate: Number,
  cookieDays: Number,
  notes: String,
  contentDeliverables: [String],
  rightsStatus: String,
  createdAt: Date,
  updatedAt: Date
}
```

### Status values

```txt
draft
invited
active
paused
completed
archived
```

### Rights status values

```txt
not_required
pending
approved
rejected
```

Keep this simple. No creator login.

## 16. Promo code relation

Current `PromoCode` model should remain the discount source.

Add optional linking later:

```js
creatorId
creatorReferralCode
```

Only if needed.

Rules:

- Existing promo codes must continue working unchanged.
- A promo code only creates creator commission when linked to a creator.
- A creator can have no promo code and still use referral link tracking.
- A creator can have a promo code and referral link together.

## 17. Commission model

Commission should be simple and safe.

V1 commission can live on the booking as a snapshot.

Add after Phase 1, when creator model exists:

```js
commission: {
  creatorId: ObjectId,
  referralCode: String,
  source: String,
  rateSnapshot: Number,
  commissionableRevenueSnapshot: Number,
  amountSnapshot: Number,
  currency: String,
  status: String,
  calculatedAt: Date,
  approvedAt: Date,
  paidAt: Date,
  voidReason: String
}
```

### Commission status values

```txt
none
pending
approved
paid
void
```

Rules:

- `none`: no creator attribution or not eligible
- `pending`: payment confirmed but not approved for payout yet
- `approved`: admin approved commission
- `paid`: admin marked as paid
- `void`: cancelled, refunded, fraud, duplicate, or not eligible

## 18. Commission calculation

Default rule:

```txt
Commission = commissionable revenue x creator commission rate
```

Recommended default:

```txt
10 percent of paid accommodation revenue
```

Commissionable revenue should exclude:

- Refunds
- Cleaning fees if separated
- Taxes if separated
- Stripe fees
- Add-ons unless explicitly agreed
- Security deposits if any
- Manually comped bookings

If current booking model does not cleanly separate all categories, use the safest available revenue field and document it.

Preferred initial field:

```txt
subtotalPrice minus discountAmount
```

Only if that represents lodging revenue before extras.

Do not calculate commission from gross Stripe amount unless no better source exists.

## 19. Stripe integration

Current Stripe flow is PaymentIntent, not Checkout Session.

Keep PaymentIntent.

### 19.1 Create PaymentIntent

File:

```txt
server/routes/bookingRoutes.js
```

When creating PaymentIntent, add compact metadata:

```js
{
  referralCode: "ana",
  attrSource: "creator_referral",
  utmSource: "instagram",
  utmCampaign: "ana_april_2026",
  landingPath: "/?ref=ana"
}
```

Rules:

- Keep current promo metadata.
- Keep metadata compact.
- Do not add large JSON blobs.
- Do not add personal data.
- Respect Stripe metadata limits.

### 19.2 After Booking save

After successful booking creation, update PaymentIntent metadata with:

```js
{
  bookingId: booking._id,
  reservationId: booking._id,
  referralCode: "ana"
}
```

Reason:

Current Stripe ingestion links weakly because PaymentIntent metadata does not include bookingId or reservationId.

Rules:

- If metadata update fails after booking is saved, do not fail the guest booking.
- Log clearly.
- Ops can manually reconcile later.

## 20. Webhook behavior

Do not make webhooks the primary booking confirmer in this feature.

Current system confirms bookings when the succeeded PaymentIntent is verified during `POST /api/bookings`.

Keep that pattern unless doing a separate payment architecture refactor.

Influencer commission must not assume:

```txt
Stripe payment succeeded = valid commission
```

Commission eligibility requires:

- Booking exists
- Booking is confirmed or paid according to existing status logic
- Payment exists or PaymentIntent is verified
- No full refund
- No cancelled booking
- No manual void

## 21. Critical payment safety issue

The audit found a risk:

A PaymentIntent can succeed, then booking creation can fail because of a 409 conflict or race condition. The client seems to expect refund handling, but server response may not fully implement it.

This must be handled before commission automation is trusted.

Requirement:

Before Phase 2 commission automation, add a safe resolution for:

```txt
paid PaymentIntent + failed booking persistence
```

Accepted solution options:

1. Automatically create a refund and a clear PaymentFinalization record.
2. Create a manual review record and block commission eligibility.
3. Prevent the race earlier by reserving inventory before payment.

Preferred practical solution for now:

- If booking save fails after payment verification, create a clear operational record.
- Trigger refund flow or manual review according to current project patterns.
- Return a guest-safe message.
- Never silently delete a paid booking without clear refund or manual review tracking.

This is part of the feature foundation because commission must only be calculated on clean bookings.

## 22. Ops UI

Use `/ops/influencers`.

Do not build `/admin/influencers` unless it redirects to `/ops/influencers`.

UI wording should use:

```txt
Creators
```

Not:

```txt
Influencers
```

Internal code can still use `Influencer` if simpler.

### 22.1 Main list

Route:

```txt
/ops/influencers
```

Columns:

- Creator
- Platform
- Status
- Referral code
- Promo code
- Clicks
- Bookings
- Paid revenue
- Commission due
- Commission paid
- Last booking

Actions:

- View
- Edit
- Pause
- Archive

### 22.2 Creator detail

Route:

```txt
/ops/influencers/:id
```

Sections:

1. Creator profile
2. Tracking details
3. Campaign terms
4. Deliverables
5. Bookings
6. Commission summary
7. Payout history
8. Notes

### 22.3 Create creator

Fields:

- Name
- Platform
- Handle
- Email
- Referral code
- Promo code
- Commission rate
- Status
- Notes
- Deliverables

System should generate:

```txt
https://driftdwells.com/?ref={referralCode}
```

### 22.4 Booking attribution display

In reservation detail, show a small attribution block:

```txt
Source: Creator referral
Creator: Ana
Referral code: ana
Promo code: ANA10
Campaign: ana_april_2026
```

Keep it quiet. Do not clutter the reservation screen.

## 23. Creator page

Public page is Phase 3.

Route:

```txt
/creators
```

Purpose:

- Create a controlled channel for good creators to apply.
- Make Drift & Dwells look professional.
- Avoid random free-stay requests.

Tone:

- Selective
- Calm
- Real
- Not desperate
- Not generic influencer marketing

Page structure:

1. Hero
2. What creator stays are
3. Who we work with
4. What we offer
5. What we expect
6. Rights and usage
7. Apply

Recommended copy direction:

```txt
Create at Drift & Dwells

We work with a small number of creators who can capture the place honestly and beautifully.

No fake luxury. No staged nonsense. Just strong visual stories from the mountains.
```

Do not build creator login.

## 24. Content rights

Every creator collaboration should have simple written terms.

Track in Ops:

- Agreed deliverables
- Usage rights approved or not
- Can Drift & Dwells repost organically?
- Can Drift & Dwells use content in paid ads?
- Duration of usage rights
- Required tags or mentions
- Deadline for content delivery

Minimum terms for tomorrow:

```txt
Creator grants Drift & Dwells permission to repost delivered content organically on Drift & Dwells channels.
Paid ad usage requires separate approval unless agreed in writing.
```

Better long-term:

- Store rights status in creator profile.
- Upload signed agreement or paste agreement text into notes.

## 25. Click tracking

Do not overbuild click tracking in Phase 1.

Phase 1 can rely on stored attribution and bookings.

Phase 2 can add a lightweight click event.

Possible model:

```txt
server/models/InfluencerClick.js
```

Fields:

```js
{
  referralCode: String,
  creatorId: ObjectId,
  landingPath: String,
  referrer: String,
  userAgentHash: String,
  ipHash: String,
  createdAt: Date
}
```

Privacy rules:

- Do not store raw IP unless project already has a policy for it.
- Hash if needed.
- Keep click data limited.
- Clicks are directional, not financial truth.

Booking and paid revenue matter more than clicks.

## 26. API design

### Phase 1

Use existing endpoints:

```txt
POST /api/bookings/create-payment-intent
POST /api/bookings
```

Add attribution payload support.

### Phase 2

Add Ops endpoints:

```txt
GET /api/ops/influencers
POST /api/ops/influencers
GET /api/ops/influencers/:id
PATCH /api/ops/influencers/:id
GET /api/ops/influencers/:id/bookings
GET /api/ops/influencers/:id/commission
POST /api/ops/influencers/:id/recalculate
POST /api/ops/influencers/:id/mark-paid
```

Protect with existing Ops authentication and authorization.

## 27. Security rules

- Only Ops users can create or edit creators.
- Public users can only pass referral params.
- Public users cannot see commission data.
- Public users cannot query creator revenue.
- Referral codes must be sanitized server-side.
- Promo codes must continue to be validated server-side.
- Never trust frontend attribution blindly for money decisions.
- Commission must be calculated server-side only.

## 28. Data integrity rules

- Old bookings must remain valid.
- Missing attribution means direct or unknown.
- Missing commission means not calculated.
- Referral code should be normalized consistently.
- Do not use display names as keys.
- Use stable creator IDs once creator model exists.
- Snapshot commission rate and revenue at calculation time.
- Later changes to creator commission rate must not rewrite historical commission unless admin explicitly recalculates.

## 29. Conflict cases

### Case 1: Guest clicks creator A, then creator B

Use first-touch.

Creator A gets attribution.

### Case 2: Guest clicks creator A, then uses creator B promo code

Promo code wins only if promo code is linked to creator B.

Creator B gets attribution.

Reason:

The guest intentionally used that creator code at purchase.

### Case 3: Guest uses normal seasonal promo code

Normal promo code does not create creator commission.

Attribution can still come from referral link.

### Case 4: Guest gets refunded

Commission becomes void or reduced.

### Case 5: Guest changes dates

Commission remains attached to booking unless booking is cancelled or refunded.

### Case 6: Manual booking by admin

Admin can optionally assign creator attribution manually later.

### Case 7: Booking paid but failed to save

No commission.

Must go to refund or manual review flow.

## 30. Implementation order

This is one feature, but it should be implemented in clean layers.

Do not mix all layers in one uncontrolled patch.

### Layer 0: Payment safety foundation

Goal:

Make sure paid but failed booking cases are visible and safe.

Tasks:

- Audit and fix 409 after succeeded PaymentIntent path.
- Ensure refund or manual review state exists.
- Ensure guest gets a safe response.
- Ensure ops can see the case.

This protects the whole booking system, not only influencer tracking.

### Layer 1: Attribution foundation

Goal:

Capture creator referral data and attach it to bookings and Stripe PaymentIntent metadata.

Tasks:

- Upgrade frontend attribution storage.
- Add referralCode support.
- Extend Booking.attribution.
- Sanitize backend fields.
- Add attribution metadata to PaymentIntent.
- Add bookingId and reservationId metadata after booking save.

No UI yet.

### Layer 2: Creator records

Goal:

Ops can create and manage creator partners.

Tasks:

- Add Influencer model.
- Add Ops routes.
- Add `/ops/influencers` list and detail page.
- Generate referral link.
- Link optional promo code.

### Layer 3: Commission ledger

Goal:

Ops can see commission due and mark payouts manually.

Tasks:

- Add commission snapshot on booking.
- Calculate commission only for eligible paid bookings.
- Handle refunds and voids.
- Add payout status.
- Add manual mark-paid flow.

### Layer 4: Public creator page

Goal:

Professional inbound creator applications.

Tasks:

- Add `/creators` page.
- Add simple application form.
- Store or email applications according to existing project patterns.
- Add content rights workflow later if needed.

## 31. Definition of done

Feature is done when:

- Admin can create a creator in Ops.
- Creator gets a clean referral link and optional promo code.
- Guest can book normally using link or promo code.
- Booking stores attribution.
- Stripe PaymentIntent stores attribution.
- Stripe PaymentIntent gets bookingId after booking save.
- Ops can see creator bookings.
- Ops can see paid revenue.
- Ops can see commission due.
- Ops can mark commission as paid.
- Refunds and failed paid bookings do not create payable commission.
- Existing bookings still work.
- Existing promo codes still work.
- A-frame booking path still works.
- Admin booking and Ops screens do not break.

## 32. Manual QA checklist

### Attribution

- Visit `/?ref=ana`.
- Confirm localStorage `dd_attrib_v2` contains `referralCode = ana`.
- Refresh page and confirm attribution remains.
- Close tab and reopen site, confirm attribution remains.
- Change to `/?ref=bob`, confirm first-touch behavior preserves ana while valid.
- Expire or clear storage, confirm bob can be captured.

### Booking

- Create normal booking without ref.
- Create booking with ref.
- Create booking with UTM only.
- Create booking with ref and promo code.
- Create A-frame booking with ref.
- Create craft Step4 booking with ref if flow is still supported.

### Stripe

- Confirm PaymentIntent metadata includes referralCode.
- Confirm metadata does not include personal data.
- Complete payment.
- Confirm Booking stores attribution.
- Confirm PaymentIntent metadata gets bookingId and reservationId after booking save.

### Promo

- Existing promo code still discounts correctly.
- Invalid promo code still fails correctly.
- Promo code is still stored on booking.
- Promo code metadata still reaches Stripe.

### Ops

- Old bookings still render.
- New attributed bookings show source.
- Creator list loads.
- Creator detail shows bookings.
- Commission is not payable for unpaid, refunded, failed, or cancelled bookings.

## 33. Cursor implementation rules

Cursor must follow these rules:

1. Read this spec first.
2. Read the previous audit before coding.
3. Do not implement unrelated refactors.
4. Do not replace the booking flow.
5. Do not replace promo logic.
6. Do not switch to Stripe Checkout.
7. Do not add Stripe Connect.
8. Do not build creator login.
9. Do not add third-party affiliate software.
10. Preserve existing A-frame logic.
11. Preserve existing admin and ops booking logic.
12. Keep old bookings backward compatible.
13. Keep implementation layered.
14. After each layer, run build and targeted QA.
15. Report exact files changed and risks left open.

## 34. Recommended first Cursor task

Start with Layer 0 and Layer 1.

Do not start with UI.

Reason:

Tracking and payment safety must be correct before an Ops dashboard displays numbers.

Prompt:

```md
Use docs/driftdwells_influencer_referral_master_spec.md as the source of truth.

Implement only Layer 0 and Layer 1.

Layer 0:
- Audit and fix the paid PaymentIntent plus failed booking save or 409 path.
- Ensure the system creates either a refund path or a manual review path according to existing project patterns.
- Do not silently delete or lose a paid booking without clear operational tracking.

Layer 1:
- Upgrade attribution capture to support referralCode from ref, referral, or creator URL params.
- Store attribution in localStorage with 60-day TTL using dd_attrib_v2.
- Preserve first-touch behavior.
- Send attributionCapturedAt and referralCode in existing booking attribution payload.
- Extend Booking.attribution minimally.
- Sanitize attribution server-side.
- Add compact attribution metadata to Stripe PaymentIntent.
- After successful booking.save(), update PaymentIntent metadata with bookingId and reservationId.

Do not build:
- /ops/influencers
- /creators
- commission calculation
- payout automation
- creator login
- Stripe Connect

Preserve:
- existing booking flow
- existing promo code logic
- existing PaymentIntent flow
- existing A-frame booking path
- existing admin and ops behavior

After implementation, report:
- Files changed
- Exact schema fields added
- Whether migration is needed
- Build result
- Manual QA checklist result
- Risks left open
```

## 35. Tomorrow operating plan

Until the system is live, use manual tracking.

Give the creator:

```txt
Link: https://driftdwells.com/?ref=creatorname
Code: CREATOR10
Guest discount: 10 percent
Creator commission: 10 percent of paid accommodation revenue
```

Log manually:

```txt
Creator:
Handle:
Date of stay:
Referral link:
Promo code:
Commission rate:
Deliverables:
Usage rights:
Bookings generated:
Commission owed:
Paid status:
Notes:
```

## 36. Final locked decision

The correct architecture is:

```txt
Creator link and optional promo code
    ↓
Frontend attribution capture
    ↓
Booking form payload
    ↓
Server-side sanitized Booking.attribution
    ↓
Stripe PaymentIntent metadata
    ↓
Booking saved with attribution
    ↓
PaymentIntent metadata updated with bookingId
    ↓
Ops creator ledger
    ↓
Manual commission approval and payout tracking
```

This gives Drift & Dwells a clean creator system without overbuilding, without breaking the existing booking architecture, and without depending on Stripe as an affiliate platform.
