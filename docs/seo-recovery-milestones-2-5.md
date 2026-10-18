# SEO recovery milestones 2–5

## Metadata and canonical URL policy

`client/src/data/publicSeoRoutes.json` remains the finite public SEO route
registry. Each route now declares its own Open Graph fallback image. Page
components continue to supply their localized titles and descriptions; the
shared `Seo` component emits matching Open Graph and Twitter metadata, absolute
image URLs, and route-registry-derived language alternates. The English-only
About and Cabin FAQ pages do not advertise Bulgarian alternates. Requests to
those pages under `/bg/` are marked `noindex` and canonicalize to the English
page.

Public route URLs use a trailing slash except for the root. Canonicals,
hreflang links, and sitemap locations share that policy. Prerender output stays
in the existing nested `index.html` layout, which Apache's standard directory
slash handling serves at the canonical URL.

## Structured data

The public stay fallback renders its own JSON-LD before live cabin data loads:
`LodgingBusiness`, `Accommodation`, and `BreadcrumbList` are built from the
same translated name, description, and fallback image visible in that content.
Live detail schemas use the same conservative builder. No undated price,
rating, room count, or offer is emitted. The Cabin and The Valley retain their
public LodgingBusiness and breadcrumb schemas; unsupported 24-hour opening
claims were removed. The Cabin FAQ schema is checked against visible questions
and non-empty answers in the raw output.

Winter Village dates are described by the public configuration as planned
preview dates, bookings are not open, and package details are still being
confirmed. They are deliberately not emitted as scheduled Event JSON-LD. Add
Event markup only after the event dates and details are confirmed for booking.

## Sitemap and noindex coverage

`client/scripts/generate-sitemap.mjs` builds `client/public/sitemap.xml` from
the public route registry during the normal build. It emits only registered
English and Bulgarian pages and applies the shared trailing-slash policy. The
interactive, transactional, private, redirected, and noindex routes are not
registered and therefore cannot enter the sitemap. The generated file is
copied into the production bundle by Vite.

## Luxury Cabin pricing trace

The database seed establishes €85/night as the Luxury Cabin's base entity
price. The public quote and availability code resolves active
`seasonal_stay` RatePlans before pricing; entity pricing is used only when no
applicable seasonal plan is selected, and malformed or ambiguous plans do not
silently fall back. Existing UI regression fixtures establish the distinction:
a six-night €660 seasonal total displays as €110/night rather than the entity
€85/night. The "from €85/night" copy remains a base starting rate, while
date-specific quotes continue to use the authoritative booking path. Winter
Village's €110 label is a separate proposed seasonal offer and is not used as
a replacement for live normal-stay pricing.

## Regression checks

`client/scripts/prerender-contract.cjs` validates the actual serialized
prerendered document: route-specific head, canonical URL, OG/Twitter tags,
hreflang coverage, supported JSON-LD, FAQ visibility, and the expected public
content. `npm run test:seo-recovery` checks all 34 compiled HTML routes,
structured data, sitemap membership and exclusions, robots.txt, and permanent
legacy redirects. The command must run after the ordinary production build;
the isolated SEO verification build is not a substitute.
