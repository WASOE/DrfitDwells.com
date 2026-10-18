# AI Search content pack

The six approved EN/BG drafts are versioned unchanged in
`client/src/content/ai-search/`. Their implementation headers are not public copy.
The renderer converts the supplied internal-link and CTA instructions to real
localized links and the existing inquiry action. It preserves the editorial body,
including access qualifiers, scientific citations and negative-fit advice.

The existing off-grid stay selector, detailed cards, booking destinations and
mobile sheet remain in place immediately after the introductory answer and photos.
The corporate inquiry uses the same booking-search modal as the previous page;
the dedicated whole-Valley booking route is unchanged. No booking, payment,
pricing or inventory APIs were added or changed.

## Discovery and factual boundaries

- `/digital-detox-bulgaria/` and `/bg/digital-detox-bulgaria/` extend the finite
  indexable registry from 34 to 36 routes. All use the mandatory normal build
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
- Geographic ambiguity is avoided using the approved near-Bachevo wording.
  The existing Valley source still contains a `€85/night` marketing label;
  this pack introduces no hardcoded rates and does not alter seasonal quotes.

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
