# Drift & Dwells Influencer and Referral System Master Spec

Date: 2026-04-29
Project: driftdwells.com
Feature owner: Drift & Dwells
Implementation target: existing Drift & Dwells booking portal
Status: Updated to reflect implemented architecture and remaining batches

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

### 4.1 Current implemented architecture

The implementation now uses these names and routes as the source of truth:

- Model: `CreatorPartner`
- Creator management UI: `/ops/creator-partners`
- Creator management API: `/api/ops/creator-partners`
- Public referral params: `ref`, `referral`, `creator`
- Booking attribution field: `Booking.attribution.referralCode`
- Paid booking safety record: `PaymentResolutionIssue`
- Visit/click model to build next: `CreatorReferralVisit`

Do not create new `/ops/creator-partners` or `/api/ops/creator-partners` routes.
Do not create a parallel `Influencer` model.
Future work must continue from `CreatorPartner`, not restart the architecture.

### 4.2 Current build status

Already implemented:

- Layer 0 payment safety foundation
- Layer 1 attribution foundation
- Instagram-style referral codes such as `diana.bosa`
- Booking attribution storage
- Stripe PaymentIntent attribution metadata
- Stripe PaymentIntent `bookingId` / `reservationId` metadata after booking save
- `CreatorPartner` model
- `/api/ops/creator-partners` routes
- `/ops/creator-partners` management UI
- Promo code management moved to Ops
- Service worker/cache update hardening

Not implemented yet:

- Referral visit/click tracking
- Creator booking aggregation
- Paid revenue totals per creator
- Commission ledger
- Manual mark-paid flow
- Creator performance/detail UI
- Booking attribution block inside reservation detail
- Public `/creators` page

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

1. Admin opens `/ops/creator-partners`.
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

- `?ref=ana` becomes `referralCode = ana`
- Normalize to lowercase
- Trim whitespace
- Allow only letters, numbers, dash, and underscore
- Max length 80
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

## 15. CreatorPartner model

The implemented creator model is:

```txt
server/models/CreatorPartner.js
```

Use `CreatorPartner` internally and `Creator partners` or `Creators` in the UI.
Do not add a separate `Influencer` model.

Implemented fields:

```js
{
  name: String,
  slug: String,
  status: String,
  contact: {
    email: String,
    phone: String
  },
  profiles: {
    instagram: String,
    tiktok: String,
    youtube: String,
    website: String
  },
  referral: {
    code: String,
    cookieDays: Number
  },
  promo: {
    code: String,
    promoCodeId: ObjectId
  },
  commission: {
    rateBps: Number,
    basis: String,
    eligibleAfter: String
  },
  contentAgreement: {
    compStayOffered: Boolean,
    deliverables: String,
    usageRights: String,
    agreedAt: Date
  },
  notes: String,
  createdBy: String,
  updatedBy: String,
  createdAt: Date,
  updatedAt: Date
}
```

### Status values

```txt
draft
active
paused
archived
```

### Referral code rules

Creator referral codes support Instagram-style handles.

Rules:

- Lowercase
- Trim whitespace
- Strip a leading `@`
- Allowed: `a-z`, `0-9`, dot `.`, dash `-`, underscore `_`
- Max length 80

Examples:

```txt
diana.bosa
diana_bosa
diana-bosa
@diana.bosa -> diana.bosa
```

### Slug rules

Creator slugs remain stricter and do not allow dots.

Rules:

- Lowercase
- Trim whitespace
- Allowed: `a-z`, `0-9`, dash `-`, underscore `_`
- Max length 80

Example:

```txt
diana-bosa
```

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

Use `/ops/creator-partners`.

Do not build `/admin/influencers` or `/admin/creator-partners`.
Legacy admin routes should not be used for this feature.

UI wording should use:

```txt
Creator partners
Creators
```

Not:

```txt
Influencers
```

### 22.1 Current management page

Route:

```txt
/ops/creator-partners
```

Current management features:

- List creator partners
- Search
- Filter by status
- Create creator partner
- Edit creator partner
- Pause creator partner
- Archive creator partner
- Copy referral link
- Store content agreement basics
- Store commission settings
- Store optional promo code link

### 22.2 Performance columns to add later

The `/ops/creator-partners` page must evolve from management-only to performance-aware.

Add these metrics after visit tracking and aggregation exist:

- Visits / clicks
- Unique-ish visitors
- Bookings
- Paid bookings
- Paid revenue
- Commission due
- Commission paid
- Last booking
- Payout status

### 22.3 Creator detail

Future route:

```txt
/ops/creator-partners/:id
```

Sections:

1. Creator profile
2. Tracking details
3. Campaign terms
4. Deliverables and content rights
5. Visits
6. Bookings
7. Commission summary
8. Payout history
9. Notes

### 22.4 Booking attribution display

In reservation detail, show a small attribution block:

```txt
Source: Creator referral
Creator: Diana Bosa
Referral code: diana.bosa
Promo code: DIANA10
Campaign: optional campaign
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

## 25. Referral visit / click tracking

Click tracking is in scope, but it is not financial truth.

Phase 1 can rely on stored attribution and bookings.
The next remaining batch must add a lightweight referral visit event.

Model to build next:

```txt
server/models/CreatorReferralVisit.js
```

Purpose:

Track how many people land on the site through each creator referral link.

Suggested fields:

```js
{
  creatorPartnerId: ObjectId,
  referralCode: String,
  landingPath: String,
  referrer: String,
  userAgentHash: String,
  ipHash: String,
  visitorKey: String,
  sessionKey: String,
  firstSeenAt: Date,
  lastSeenAt: Date,
  visitCount: Number,
  convertedBookingId: ObjectId
}
```

Privacy rules:

- Do not store raw IP.
- Hash IP only if needed and acceptable under the project privacy policy.
- Hash or reduce user-agent data.
- Do not store guest name, email, or phone in visit records.
- Keep click data limited and directional.
- Do not block page load if visit tracking fails.
- Do not add third-party tracking scripts.

Counting rules:

- Count a referral landing event when a valid `ref`, `referral`, or `creator` param exists.
- Deduplicate basic refresh/repeat events using a privacy-safe visitor or session key.
- Do not overwrite first-touch booking attribution because of click tracking.
- Clicks are a marketing signal, not a commission source.

Booking and paid revenue matter more than clicks.

## 26. API design

### Implemented booking endpoints

Use existing endpoints:

```txt
POST /api/bookings/create-payment-intent
POST /api/bookings
```

These now support attribution payload and Stripe metadata linkage.

### Implemented creator partner endpoints

```txt
GET /api/ops/creator-partners
POST /api/ops/creator-partners
GET /api/ops/creator-partners/:id
PATCH /api/ops/creator-partners/:id
```

Protect with existing Ops authentication and authorization.

### Next visit tracking endpoints

```txt
POST /api/creator-referral-visits
```

or, if the project prefers grouping under Ops/creator naming:

```txt
POST /api/creator-partner-visits
```

This endpoint is public but must be strictly limited:

- Accept only sanitized referral visit data.
- Never expose creator revenue.
- Never expose private creator records.
- Never block the booking or page load if it fails.
- Rate-limit or deduplicate where reasonable.

### Future Ops reporting endpoints

```txt
GET /api/ops/creator-partners/:id/bookings
GET /api/ops/creator-partners/:id/performance
GET /api/ops/creator-partners/:id/commission
POST /api/ops/creator-partners/:id/recalculate
POST /api/ops/creator-partners/:id/mark-paid
```

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

This is one feature, but it must be implemented in clean layers.

Do not mix all layers in one uncontrolled patch.

### Completed Batch 1: Attribution foundation

Status: implemented.

Includes:

- Frontend attribution storage upgraded to `dd_attrib_v2`
- `ref`, `referral`, and `creator` URL params supported
- Instagram-style referral codes with dots supported
- `Booking.attribution.referralCode` stored
- Attribution metadata added to Stripe PaymentIntent
- PaymentIntent updated with `bookingId` / `reservationId` after booking save

### Completed Batch 2: Payment safety foundation

Status: implemented.

Includes:

- `PaymentResolutionIssue` for paid-but-unsaved booking failures
- Manual review integration
- Safe guest-facing response for payment received but booking not finalized
- No commission eligibility for failed paid booking cases

### Completed Batch 3: CreatorPartner registry foundation

Status: implemented.

Includes:

- `server/models/CreatorPartner.js`
- `/api/ops/creator-partners`
- Promo code linking without changing promo discount logic

### Completed Batch 4: Promo codes Ops migration

Status: implemented.

Includes:

- Promo code management moved into Ops
- New creator work uses Ops, not legacy admin
- Existing promo behavior preserved

### Completed Batch 5: Creator partners Ops UI

Status: implemented.

Includes:

- `/ops/creator-partners`
- Create/edit/pause/archive creator partner
- Copy referral link
- Store content agreement basics
- Store commission settings

### Completed Batch 5A: Referral code and PWA hardening

Status: implemented.

Includes:

- Instagram-style referral codes such as `diana.bosa`
- Leading `@` normalization
- Service worker/cache update hardening

### Next Batch 6: Creator referral visit tracking

Goal:

Track visits/clicks from creator referral links.

Tasks:

- Add `CreatorReferralVisit` model.
- Add small public visit tracking endpoint.
- Add frontend fire-and-forget event after valid referral capture.
- Deduplicate repeat refreshes where reasonable.
- Do not store raw IP.
- Do not block page load if tracking fails.
- Do not use third-party scripts.

### Batch 7: Creator booking and revenue aggregation

Goal:

Ops can see which bookings and paid revenue came from each creator.

Tasks:

- Aggregate bookings by `Booking.attribution.referralCode`.
- Apply attribution priority: creator-linked promo code first, referral code second.
- Count bookings, paid bookings, cancelled/refunded bookings.
- Calculate paid revenue and commissionable revenue using the safest booking fields.
- Do not calculate payable commission yet.

### Batch 8: Commission ledger foundation

Goal:

Ops can see commission due and mark payouts manually.

Tasks:

- Add commission snapshot records or booking commission snapshot.
- Calculate only for eligible paid bookings.
- Exclude paid-but-unsaved review issues.
- Handle refunds and voids.
- Add payout status.
- Add manual mark-paid flow.
- No Stripe Connect.

### Batch 9: Creator performance UI

Goal:

Upgrade `/ops/creator-partners` from management-only to performance-aware.

Tasks:

- Show visits/clicks.
- Show unique-ish visitors.
- Show bookings and paid bookings.
- Show conversion rate.
- Show paid revenue and commissionable revenue.
- Show commission due and paid.
- Show last booking and payout status.

### Batch 10: Public `/creators` page

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

## 34. Recommended next Cursor task

Next task: Batch 6, Creator referral visit tracking.

Do not start commission ledger until visit tracking and booking aggregation are separated clearly.

Prompt:

```md
Use docs/driftdwells_influencer_referral_master_spec.md as the source of truth.

Implement only Batch 6: Creator referral visit tracking.

Goal:
Track how many people land on the site through each creator referral link.

Do not implement:
- commission calculation
- payout logic
- Stripe Connect
- creator login
- public /creators page
- booking revenue aggregation
- creator performance UI
- pricing changes
- promo discount changes
- booking flow refactors

Backend:
- Add `server/models/CreatorReferralVisit.js`.
- Add a small public endpoint for referral visit tracking.
- Resolve `creatorPartnerId` from `referralCode` if an active/draft/paused CreatorPartner exists.
- Store sanitized referralCode, landingPath, referrer, firstSeenAt, lastSeenAt, visitCount.
- Use privacy-safe deduplication.
- Do not store raw IP.
- Hash IP only if already acceptable under project privacy policy, otherwise omit it.
- Do not store guest name/email/phone.
- Do not expose creator revenue or private creator data publicly.

Frontend:
- Reuse `client/src/tracking/attribution.js`.
- After valid referral capture, send a fire-and-forget visit event.
- Do not block page load.
- Do not retry aggressively.
- Do not add third-party scripts.
- Do not overwrite first-touch attribution.

Deduplication:
- Avoid creating unlimited rows on refresh.
- Prefer an upsert keyed by referralCode plus a privacy-safe visitor/session key and a short day bucket, or another simple project-consistent method.
- Click counts are directional, not financial truth.

Verification:
- Visit `/?ref=diana.bosa`.
- Confirm `dd_attrib_v2.referralCode = diana.bosa`.
- Confirm one visit record is created.
- Refresh and confirm it updates/dedupes instead of creating unlimited duplicates.
- Visit invalid `/?ref=diana bosa` and confirm no visit record is created.
- Confirm booking flow still works.
- Confirm `/ops/creator-partners` still works.
- Run `npm run build`.
- Run `npm run test:e2e:api`.
- Run `npm run test:e2e:attribution`.
- Run `git diff --check`.

Output:
- Files changed
- Model and endpoint added
- Deduplication rule
- Privacy choices
- Build/test result
- Manual QA checklist
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
