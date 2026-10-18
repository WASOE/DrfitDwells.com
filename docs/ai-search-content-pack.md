# AI Search content pack

The six approved EN/BG drafts are versioned in
`client/src/content/ai-search/`. Changes are limited to implementation headers,
verified geography and established URLs. Their implementation headers are not public copy.
The renderer converts the supplied internal-link and CTA instructions to real
localized links and the existing inquiry action. It preserves the editorial body,
including access qualifiers, scientific citations and negative-fit advice.

Presentation follows the established property pages: a single photographic hero,
Playfair Display headings, restrained natural colours and a 1120px content grid.
The approved paragraphs, questions, citations and links remain visible in the
initial HTML. A linked guide index and numbered editorial sections break up the
long-form copy; supporting photos appear once, separately from the hero.
The opening sentence serves as the short hero introduction; the remainder of
that same approved paragraph continues in the introductory reading band, with
an exact text-reconstruction regression to prevent omissions or rewrites.

The off-grid page has one four-stay discovery grid, replacing the duplicated
selector/gallery/card stack and mobile sheet. Full names, descriptions, capacity
and existing display prices are not clamped; availability and details still use
the existing localized booking destinations and booking hash. API listing covers
remain supported, with versioned real property photos for initial/offline output.
The header's stay-picker button targets this same discovery grid.
Audio, announcement and chat overlays are omitted on these six reading pages,
as on the established paid landing. Navigation, consent and booking modals remain.

### Photo provenance

Cabin photography uses optimized WebP copies of the existing public listing's
original photos, not the letterboxed seasonal video posters. The files under
`public/media/ai-search/` are 720px/1200px derivatives of
`/uploads/cabins/68b83f3dadecaa65dbbe560f/original/`:
`0bf03c39-60e5-479e-bc4b-fa71c6de965d.jpeg` (forest exterior),
`6c6a852c-e8e1-44af-8dda-c31fbc9dbda6.jpeg` (interior/stove), and
`89ba3994-cf40-44d8-a4e4-c9dfc75ee8bc.jpeg` (accommodation card exterior).
Valley photos reuse the existing versioned `media/enduro/` library.

### Responsive acceptance

`AI_SEARCH_SCREENSHOTS=/absolute/output/directory npm run test:ai-search`
captures actual full-page compiled-build screenshots of all six pages at
390px, 768px and 1440px (18 screenshots). The same gate checks photo decoding,
one hero, four nonduplicated off-grid cards, readable card dimensions, text and
navigation overflow, mobile/tablet menus and the fully loaded inquiry modal.
API writes are blocked and asserted absent. The test deliberately exercises
versioned fallback images with listing APIs unavailable; current listing covers
are independently covered by the discovery component tests.
The corporate inquiry uses the same booking-search modal as the previous page;
the dedicated whole-Valley booking route is unchanged. No booking, payment,
pricing or inventory APIs were added or changed.

## Discovery and factual boundaries

- `/off-grid-cabins-bulgaria/`, `/digital-detox-bulgaria/` and
  `/retreat-venue-bulgaria/`, with their `/bg/` counterparts, are the six
  editorial destinations. The established off-grid URL remains canonical; the
  former `/off-grid-stays-bulgaria/` alias permanently redirects to it and is
  excluded from the indexable registry. Removing that duplicate EN/BG pair
  leaves 34 indexable routes; the two digital-detox locales remain included.
  All use the mandatory normal build
  and Chromium prerender, existing trailing-slash policy and generated sitemap.
- Each editorial page emits `WebPage` and visible `BreadcrumbList` JSON-LD.
  Property references reuse the existing `/cabin/#lodging`,
  `/valley/#lodging` and `/retreats/the-valley/#lodging` identifiers, and the
  existing organization ID. No sample agenda is an Event or Product; no prices,
  reviews, capacities, medical benefits or additional services are invented.
- The pages use existing versioned onsite photographs, localized captions/alt,
  responsive sources and actual intrinsic dimensions. No stock/AI imagery,
  invented photo dates, coordinates or attribution were added.
- Existing `robots.txt` wildcard rules allow Googlebot, Bingbot and OAI-SearchBot
  on public marketing pages without changing private-route policy.
- The Cabin is described as near Bachevo, in the Razlog area of southwestern
  Bulgaria. The Valley remains correctly located in the Rhodope Mountains near
  Chereshovo and Ortsevo. The off-grid discovery cards show the verified €110 base
  rate for the Luxury Cabin and clarifies that seasonal rates vary; booking
  calculations and quotes are unchanged.

## Not performed

This PR does not publish, deploy, submit URLs, create business profiles, acquire
external citations or change CDN/WAF rules. Google Business Profile, Bing Places,
Search Console and Bing Webmaster Tools performance/AI reports have not been
verified: authenticated dashboard access is outside local frontend implementation.
Schema validity does not imply FAQ or vacation-rental rich-result eligibility,
medical efficacy, AI citations or a guaranteed search ranking.

After an approved publication, record indexing and query/citation baselines and
repeat a fixed prompt set rather than treating a single generated answer as a
ranking: quiet off-grid cabin Bulgaria; weekend away from Sofia no wifi; two
nights off the grid near Bansko; 3 day digital detox Bulgaria; peaceful getaway
when overwhelmed; unique team building venue Bulgaria; private mountain retreat
for small company. Bulgarian equivalents: тиха офгрид къща в България; уикенд
извън София без Wi-Fi; две нощувки офгрид край Банско; тридневен дигитален детокс
в България; спокойна почивка при претоварване; нестандартен тиймбилдинг в България;
частен планински ритрийт за малка фирма. Track page cited, factual accuracy,
mention/citation, fit and conversion across engines over time.
