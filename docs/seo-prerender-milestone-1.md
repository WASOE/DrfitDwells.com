# Milestone 1: crawlability and prerendering

## Failure evidence and limits

This work does not repeat the production audit. The supplied audit found a generic
SPA shell at `/`, even though `/` was already in the prerender allowlist.

Confirmed from the pre-change source and local reproduction:

- The allowlist omitted retreat, voucher, FAQ and stay detail routes.
- Missing Chromium could exit successfully without generating any route HTML.
- Readiness accepted nonempty root text plus any non-default title; it did not
  establish route identity, meaningful main content, locale or complete output.
- The capture server fell back to `dist/index.html`, including for API requests.
  Stay resolution and subsequent Cabin/A-frame data requests therefore could not
  obtain listing JSON from that server.
- `/` was written first, replacing the shell subsequently used as fallback for
  other captures. The revised server holds the original shell in memory instead.
- Local safe publication copies nested route HTML in its static phase and root
  HTML last. Remote publication used `--exclude=index.html`, which rsync applies
  to matching basenames at every depth. An isolated rsync regression reproduces
  the loss of nested `index.html` files and verifies root-anchored exclusions fix
  it. This is a confirmed nested-route packaging defect, not proof that this
  publication mode was used in the audited release.
- The checked-in Apache rules serve real files/directories normally and fall
  back to root HTML for missing extensionless routes. They do not redirect `/`
  to another shell. The explicit guide-root rewrites concern noindex guides,
  which are outside the required set. No rewrite rules were changed.
- Publication previously checked only root HTML/assets existence, not SEO output.

**The historical cause of the generic production `/` remains unproven.** There is
no deployed build artifact, browser/build log, publication log, or verified live
server configuration in this checkout establishing which file reached production
or whether it was later overwritten. The old soft-skip makes a generic build
possible; it does not explain a root-only failure alongside 21 prerendered routes.
Root is required and validated by both build and publication after this change.

## Route eligibility and coverage matrix

`client/src/data/publicSeoRoutes.json` is the shared finite source of truth:
18 page definitions, **34 required URLs**. It contains locale availability and
existing heading fingerprints for validation, not new metadata policy.

Every included URL receives the same checks: meaningful raw HTML with JS disabled,
route-specific heading and head, correct document locale, desktop (1280 x 800) and
mobile (390 x 844) loading, client root replacement, and absence of browser/React
hydration errors. The automated browser command prints a per-URL record including
title, heading, locale and meaningful main-content length.

- Home, Cabin and Valley: `/`, `/cabin`, `/valley`; EN and BG (6 URLs).
- About: `/about`; EN only (1 URL).
- Public FAQ: `/cabin/faq`; EN only (1 URL).
- Retreat: `/retreats/the-valley`; EN and BG (2 URLs).
- Voucher marketing: `/gift-vouchers`; EN and BG (2 URLs).
- SEO landings: `/off-grid-cabins-bulgaria`, `/rhodopes-cabin-retreat`,
  `/bansko-remote-work-retreat`, `/retreat-venue-bulgaria`,
  `/off-grid-stays-bulgaria`, `/enduro`; EN and BG (12 URLs).
- Winter Village: `/winter-village`; EN and BG (2 URLs).
- Public stays: `/stays/the-cabin`, `/stays/a-frame`, `/stays/lux-cabin`,
  `/stays/stone-house`; EN and BG (8 URLs).

BG paths are `/bg` for home and `/bg` followed by the EN path otherwise.
Although App exposes `/bg/about` and `/bg/cabin/faq`, their body content is
English-only. About has a localized head but English sections. Neither BG page is
treated as a localized SEO artifact. Their app routes and metadata are unchanged.

The supplied production audit counted **37 URLs**. Reconciled against that set,
the 34 required URLs exclude exactly `/build` (explicitly noindex),
`/bg/about` (English body despite a localized head), and `/bg/cabin/faq`
(English-only content). The last two have app routes, but not localized public
page content; no new localization or metadata policy is implied.

The remaining App route patterns are deliberately not enumerated:

- `/build` is noindex; `/journal` redirects to it.
- Legal/document routes (`/terms`, `/privacy`, `/cancellation-policy`, `/career`,
  `/press`) and public guide roots/detail patterns are noindex. Legacy legal
  aliases and `/guides/cabin/:slug` are redirects, not separate SEO documents.
- `/search` and `/craft/step-*` are interactive booking surfaces.
- Stay/cabin confirmation routes, booking success/refund, voucher success/redeem,
  communication preferences, booking continuation, and `my-trip` guides are
  transactional or user/token-specific.
- `/cabin/:id` is a legacy identifier redirect, not finite public SEO inventory.
- Login, admin, ops, maintenance, embedded and creator routes are application or
  private surfaces. Wildcards, including unsupported `/nl/*`, are not SEO pages.
- `/guides/the-valley/:staySlug` is not a reason to enumerate arbitrary slugs.
  Only the four explicit public stay routes above are expanded.

## Implementation contract

- `client/scripts/prerender-routes.cjs` remains the generator. Build explicitly
  sets `PRERENDER_REQUIRE_BROWSER=1`; generation is now mandatory by default too.
  Skip/disabled flags, unavailable configured executables, browser launch failure,
  page exceptions, wrong redirects and invalid output fail rather than succeed.
- `prerender-contract.cjs` shares required paths and HTML validation between
  generation, tests and the safe publication entry point. Every artifact must
  have its capture marker, existing route heading fingerprint, non-generic title,
  meaningful description, matching canonical path, expected language, no noindex,
  and at least 180 characters of main content excluding script/style text.
  This checks existing head output; it does not change canonical/schema policy.
- Each page starts from the immutable original SPA shell. API calls receive an
  explicit unavailable JSON response rather than SPA HTML. Interception prevents
  external network calls and all non-GET network publication, including analytics
  and payments. No production API, credential, database or user session is used.
- Before serialization, finite root animations finish and commit their final
  styles; framework completion work settles for two animation frames. A separate
  fresh page then reloads that serialized HTML with JavaScript disabled and real
  local stylesheets. The expected heading must have geometry and visible
  computed heading/ancestor styles before the artifact can be written. This
  catches native-animation paint that would otherwise serialize `opacity: 0`.
  Infinite animations are not finished; no live-client animation is changed.
  Capture and raw-validation pages bypass service-worker responses so generated
  HTML, rather than a previously precached SPA shell, is checked. Raw validation
  requires an actual HTTP 200 and refuses a service-worker response.
- `PublicStayIntro.jsx` reads the finite registry and existing EN/BG `seo` copy
  already used by the paid-traffic landing, plus existing fallback image metadata.
  It renders only the name, fit, public facts and character/access description:
  no price, availability, occupancy quote or booking identifier is copied.
- `StayDetails.jsx` renders the same intro initially in both capture and normal
  client use. Live resolution still selects the existing Cabin/A-frame components;
  their loading branches accept the intro. Resolver network errors are logged,
  visibly reported and retryable; unknown/unpublished slugs still reach NotFound.
  Booking, quotes, payments and reservations remain in their existing components.
- `prepareClientRoot.js` isolates only a marked root immediately before `createRoot`.
  This is **client replacement, not hydration**. Saved SEO HTML remains available
  to non-JS crawlers. No global `hydrateRoot` conversion or identical-state claim
  is made for viewport, season, consent, user storage or live API data. The saved
  subtree remains as an inert overlay while lazy client code loads, then is
  removed when the client heading (or error fallback) is present and fully
  opaque for two consecutive animation frames. It does not hide the live client from layout or
  animation observers. Compiled-browser frame sampling covers this handoff.
  Responsive hidden headings are ignored; inline API alerts do not establish
  readiness. Only the main page heading or the explicitly marked whole-page
  ErrorBoundary fallback can release the overlay. A mismatched homepage capture
  served by SPA fallback is cleared directly, without retaining an overlay on
  transactional/private routes.
- The safe deployment CLI validates all required HTML before writing its manifest
  or publishing files. Remote exclusions are root-anchored so nested HTML is
  included, while root HTML/service worker retain their last-publication phase.

## Validation commands and prerequisites

Run from the repository root:

```sh
node --test scripts/deploy-frontend-safe.test.mjs
cd client
npm run test:prerender
npm test -- src/pages/StayDetails.prerender.test.jsx src/utils/prepareClientRoot.test.js src/pages/GiftVouchers.test.jsx src/pages/GiftVouchers.stripeUnavailable.test.jsx src/pages/CabinDetails.ratePlanDisplay.test.js src/pages/AFrameDetails.ratePlanDisplay.test.js
npm run build
npm run test:prerender:browser
node scripts/verify-seo-packaging.mjs
```

The default browser check requires actual `dist` output. It verifies all required
raw artifacts without JS, reloads the captured HTML with JS and checks root
replacement, SPA navigation, voucher amount/design controls, and existing date
modals for both Cabin and A-frame. Booking data in interaction checks is a bounded
test fixture; external calls and payment/booking mutations are blocked/asserted
absent. Voucher component regressions exercise purchase states with mocks only.

When production build prerequisites are unavailable, a separately labelled
development-only rendering check can run against an isolated Vite server:

```sh
npm run dev -- --host 127.0.0.1 --port 4175 --strictPort
PRERENDER_TEST_ORIGIN=http://127.0.0.1:4175 npm run test:prerender:browser
```

This uses the same generator and validation contract, writes temporary captures
inside the worktree, and cleans them up. It is **not evidence of a successful
production bundle or deployed Apache behavior**.

## Production build-blocker follow-up

The seven missing media paths in `client/src/data/buildMediaLibrary.js` were added by
commit `37c48de` from the public cabin listing. They point into `uploads/`, which
`.gitignore` excludes. The exact files are not in Git history and were absent
from both local upload trees. The first check used HTTP `HEAD` and returned 404
for three files; direct `GET` from the public listing URLs returned the original
JPEG bytes for all seven. Local ignored restoration was not reproducible, so
the exact original bytes are now included as versionable source assets in
`client/public/media/build-originals/` (seven JPEGs, approximately 4.9 MB).
Only those seven references now point to `/media/build-originals/`; visual
mapping, image bytes, and the remaining existing media references are unchanged.
`client/src/data/buildOriginalAssets.json` records every original upload path
and SHA-256 fingerprint. Tests verify the new references and fingerprints.
Vite copies these inputs into both build outputs; ordinary local/static rsync
publication includes `media/`, unlike protected external `uploads/`. Packaging
checks verify the seven delivered responses byte-for-byte on Apache. No fetch
from production is required to build or deliver these seven files.
Other existing upload media still uses the project's normal provisioned
uploads store; this change does not make the entire repository hermetic.

The Stripe setting is a build-time `VITE_STRIPE_PUBLISHABLE_KEY`, not the
server-only Stripe secret. `.env.example` documents it with a placeholder, and
`ops/driftdwells-production/README.md` says to supply the publishable key in the
build environment. No local `.env`/client env file or process variable is
available. The repository has no Actions workflow or visible repository secret
names/environment; the public config API returns only `stripeEnabled`, not a
publishable key. A scan of the deployed site's reachable JS bundles did not
locate a publishable key either. The Vite guard is unchanged; no live/test
credential was invented, fabricated or placed in source.

After restoring the original image files, the ordinary `npm run build` proceeds past media
validation and stops at that existing Vite guard:
`Client build requires a valid VITE_STRIPE_PUBLISHABLE_KEY (pk_live_... or pk_test_...).`
The exact Vite configuration point is the environment of the process running
`cd client && npm run build`, or the ignored `client/.env.production.local`
file loaded by Vite in that directory. A root `.env` or `server/.env` does not
populate the client build. Do not copy the backend environment into the client.
No configuration file or credential was created. No usable authorized deployment
build environment is available here; the existing guard is unchanged and
continues to fail closed. The eventual publishable production build must run
in its existing authorized build environment, not use SEO verification output.

## Isolated compiled SEO verification

The production guard is evaluated before Vite compiles any page. It therefore
also blocks unrelated local SEO compilation if the machine has no Stripe
configuration. SEO validation now has a distinct, explicitly non-publishable
path, without modifying Stripe integration or supplying a fake key:

```sh
cd client
npm run build:seo-verification
npm run test:seo-verification
npm run test:seo-verification:browser
npm run test:seo-verification:packaging
```

`build-seo-verification.mjs` reuses the existing development-compatible Vite
configuration, then invokes real Vite compilation/minification, code splitting,
CSS and public-asset copying, PWA generation, and the mandatory Puppeteer
generator/34-artifact validation. Output is exclusively
`client/.seo-verification/dist`, not `client/dist`. Environment-file loading is
disabled and the Stripe publishable-key expression is explicitly empty, so the
existing application reports payments unavailable; there is no payment stub
or fake credential. Payment execution is not tested with this output.

Every verification HTML head has `seo-verification-only`, and the output also
contains `seo-verification-only.json`. Safe production publication rejects either
marker before writing a manifest or touching a destination, even if somebody
copies the output into `client/dist`. Every required HTML file is checked, so
mixed output with a clean production root and a verification-only nested page
is also rejected. The production guard itself is exercised
in a credential-free temporary config directory by the isolation regressions.

The browser harness checks all 34 compiled HTML files at 1280 x 800 and 390 x 844,
without JS and with JS, with the browser cache disabled during client checks.
It validates route-specific content/head/locale and samples animation frames
for visible-heading gaps during root replacement (including heading opacity).
It also exercises SPA navigation, voucher amount/design controls, and Cabin/
A-frame date modals using bounded public fixtures, blocking all transaction
requests. The initial compiled check reproduced a 16-frame blank homepage
handoff; the retained-snapshot implementation addresses that observed failure.

The packaging command runs the actual additive local and rsync helpers against
temporary destinations. It starts isolated loopback Apache processes with the
unchanged built `.htaccess`, verifies all 34 URLs (including slash/query forms),
all compiled JS/CSS/font files, seven SHA-256-matched JPEG responses, legacy
redirect, SPA fallback and API/missing-static 404 behavior. It also deliberately
removes a required artifact to check validation failure. CLI regressions prove
missing/generic artifacts and verification output are rejected before any
publication. It requires the existing system `apache2`, its standard modules,
and `rsync`; it never contacts a deployment destination.

These are **compiled SEO verification artifacts**, not an authorized production
release. They provide stronger evidence than development captures, but do not
certify Stripe initialization, production environment-dependent flags, deployed
Apache configuration, or production service-worker behavior. The full guarded
`npm run build` and its default production browser/packaging checks remain a
separate release requirement in the existing authorized build environment.
The historical cause of the production generic homepage remains unproven.

## Final verification evidence

The isolated compiled build and mandatory prerender completed for all 34 URLs
(18 EN, 16 BG), including the fresh no-JavaScript visibility gate on each saved
document. Homepage HTML has the heading `Dwell in the Silence.`, a route-specific
title/head, and 2,886 meaningful main-content characters.

- Desktop 1280 x 800: 34 raw documents and 34 client replacements passed.
- Mobile 390 x 844: 34 raw documents and 34 client replacements passed.
- Both viewports: zero observed blank-heading frames during handoff, no unhandled
  browser/React/hydration errors, actual header/mobile-menu same-document router
  navigation, voucher amount/design controls and both Cabin/A-frame date modals.
  Direct search/login/voucher-success fallback pages do not retain the saved
  homepage overlay. No booking/payment mutation was attempted.
- Real Apache simulation passed after both additive local and actual rsync
  packaging, including all 34 routes, slash/query forms, all compiled
  JS/CSS/font delivery, all seven original JPEG hashes, redirects, SPA fallback,
  API/missing-static 404 handling and protected existing uploads.
- 110 focused client/Stripe compatibility tests, 7 prerender contract tests,
  and 32 combined isolation/publication tests passed. Focused ESLint and
  `git diff --check` passed.
- The ordinary guarded production build was also attempted. Guide export, hero
  generation and media validation passed, but Vite correctly stopped before
  compilation because this checkout has no valid `VITE_STRIPE_PUBLISHABLE_KEY`.
  No authorized GitHub workflow/environment or repository secret is configured
  for this repository. The required value must come from the existing authorized
  deployment environment (or its ignored `client/.env.production.local`); no
  credential was requested, printed, fabricated or committed.
- The full client suite reports 1,277 passing and 12 failing tests across six
  files, all in unrelated existing Ops/navigation/visual coverage or Vitest
  discovering the existing Node-only media validator as a test. Repository-wide
  lint and i18n checks also report existing errors outside the changed Milestone
  1 files. These failures were not changed as unrelated work.

The final independent artifact-aware review confirmed the 34-route artifact
set, both browser completion summaries, Apache local/rsync results, seven JPEG
hashes, verification markers and publication rejection. All reported findings
were resolved; no remaining significant issue was found within this compiled
SEO scope. Resolutions include checking nested verification markers, preventing
inline API alerts from releasing the handoff early, and committing/validating
serialized animation visibility. This is not production-release certification.

These results certify the stated **compiled SEO verification** scope. They are
not a successful guarded production build, payment-initialization test, live
deployment verification or production service-worker certification. The marked
verification output is deliberately non-publishable. Release approval still
requires the ordinary guarded build in the existing authorized deployment
environment and its default artifact/browser/packaging checks; no Stripe key is
required from the owner to run the SEO checks above.

## Changed surfaces

- Route contract/generation: `client/src/data/publicSeoRoutes.json`,
  `client/scripts/prerender-contract.cjs`, `prerender-contract.node.cjs`,
  `prerender-routes.cjs`, and `prerender-browser-check.cjs`.
- Client handoff: `client/src/main.jsx`, `client/src/utils/prepareClientRoot.js`
  and its test; `client/src/components/ErrorBoundary.jsx` adds only the explicit
  whole-page error-fallback marker.
- Public stay content: `client/src/components/PublicStayIntro.jsx`,
  `client/src/pages/StayDetails.jsx`, `CabinDetails.jsx`, `AFrameDetails.jsx`,
  and `StayDetails.prerender.test.jsx`.
- Reproducible originals: `client/src/data/buildMediaLibrary.js`,
  `buildOriginalAssets.json`, and the seven exact JPEGs in
  `client/public/media/build-originals/`.
- Isolated verification: `client/scripts/build-seo-verification.mjs`,
  `seo-verification.node.mjs`, `verify-seo-packaging.mjs`,
  `client/package.json`, and `.gitignore`.
- Publication: `scripts/deploy-frontend-safe.mjs`, its `.lib.mjs` and `.test.mjs`;
  this milestone documentation.

`client/vite.config.js` and payment integration/checkout components are unchanged.
No environment file, credential, dependency or database migration was added.

No commit, push, PR, merge, production deploy, DB migration or production
modification is part of this milestone. Pricing, payments, reservation logic,
metadata policy, schemas, sitemap and Milestones 2-6 remain deferred.
