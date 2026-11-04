# SEO Batch 1 — Ratings / reviews evidence (private)

**Status:** FREEZE. No production rating, review, testimonial, or review schema changes authorized in Batch 1.

**Date:** 2026-11-03  
**Production frontend SHA (manifest):** `d36dce9da8af529d7531d46c0f778ed729ad5602`

## Site displays (unchanged)

Hardcoded marketing surfaces observed live / in source:

- `AuthorityStrip`, `TrustStrip`, `PaidTrafficTrustStrip`, Footer, About stats
- `seo.json` `paidStaysBulgaria.card.ratingDisplay`: **4.95**
- About copy: **4.95 Airbnb, 9.8 Booking**

No Batch 1 code changes touch these files for rating values.

## External observations (not applied)

| Source | Observation | Confidence |
| --- | --- | --- |
| `https://www.airbnb.com/rooms/797914705574649299` (historical Bucephalus / The Cabin id from internal import docs) | HTTP **410** on 2026-11-03 | High |
| Public Airbnb cabin SERP snippet for “Unique off-grid cabin in raw nature: Bucephalus” (Bachevo) | **4.68 / 163 reviews** | Medium (SERP; listing page itself 410) |
| Live `/api/cabins` | `the-cabin` `averageRating=0`, `reviewsCount=0`; `lux-cabin` `4.9` / 150; `stone-house` `4.8` / 97 | High |

## Required owner confirmation before any future rating change

1. Current public Airbnb listing URL(s) for The Cabin and Valley units.
2. Current Booking.com listing URL(s) and Traveller Review Award figure.
3. Which figure (if any) should appear on site-wide trust strips vs property pages.
4. Whether review JSON-LD should remain omitted (current stay schema deliberately excludes `aggregateRating`).

Until confirmed, keep all public ratings frozen.
