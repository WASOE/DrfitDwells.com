# Release safety gate

Booking routes are gated before production. This workflow does not deploy.

## What runs on every pull request

`Apache, browser, and payment contract` builds `client/dist` and checks it with Apache 2.4 and the release `.htaccess`:

- prerendered pages render their own titles
- `/search` and `/checkout` stay on their paths with HTTP 200
- direct `/index.html` still redirects to `/`
- the historical `/index.html` rule, without the `THE_REQUEST` guard, fails `/search` and `/checkout`
- referenced JavaScript exists
- the compiled payment contract is enabled
- the service worker does not call `skipWaiting()` during install

The three gitignored cabin originals are fetched with public GET requests before `npm run build`. `validate:media` is unchanged.

The browser job is mocked. It serves that artifact through Apache and stubs `/api`. It does not call production or Stripe.

Both jobs upload evidence only after they pass. A coverage label or an environment variable is not evidence.

The Apache/browser job also uploads `frontend-validation-test-key`: the complete
tested build as a tar archive, its SHA-256, and a per-file inventory including
hidden files. CI unpacks and verifies the archive before upload. This artifact
contains a **test** Stripe publishable key and is not a production release.
Its inventory establishes package integrity, not the authenticity of a
download or production compatibility; associate it with the trusted CI run.

## What blocks a production deploy

**Production frontend publication is currently blocked.** The existing
in-place publisher can leave nested prerendered pages and other static files
from different releases after interruption, and its legacy snapshot only
contains the shell. Do not remove the production block until a transactional
publication and complete recovery path have been implemented and verified on
the production hosting layout. The separate legacy `activateTestedRelease`
helper is disabled as it also copied in place and could not restore all files.
The release host need not run Apache for production HTTP checks; the Apache
routing check belongs in the verified build workflow.

The existing production `public_html` is a directory whose parent is owned by
`apache`, not the deploy user. DirectAdmin also configures a test-site root
under `public_html`, and Apache proxies `/uploads` to the API. A transition
must preserve these and the hosting configuration, establish Apache's effective
symlink behavior, and be tested for interruption and recovery on the hosting
layout. A rename of a replacement symlink over the nonempty directory is not an
ordinary atomic switch. No activation or rollback procedure is approved yet.

`scripts/release-safety/blue-green.mjs` is an isolated prototype. It stages a
verified inventory outside the active tree, atomically switches an existing
symlink, and journals activation so an interrupted switch can be restored.
It is **not a production deployment command**: provenance and smoke checks
are caller-supplied, staging is not serialized, and the initial DirectAdmin
vhost transition, the original directory snapshot, file ownership, test-site
routing, SELinux, and production HTTP checks are not implemented or validated.
Removing write permissions does not make an owner-controlled directory
immutable. The optional `RUN_ALMA_HTTPD_TEST=1 node --test
scripts/release-safety/blue-green-alma.test.mjs` test exercises an isolated
AlmaLinux httpd container with selected observed vhost rules, including a
test vhost and uploads proxy. It does not reproduce the full DirectAdmin
configuration, TLS, or SELinux. SELinux was observed disabled on the host;
recheck its state before any future transition. Do not use this prototype to
switch the live site.

`npm run deploy:frontend:safe` always refuses to publish unless `RELEASE_SAFETY_REPORT` matches the release SHA and a completed successful GitHub Actions run. The run must contain both artifacts:

- `apache-browser-evidence` — `/search` and `/checkout` stayed on path, and the historical redirect failed
- `staging-evidence` — quote, finalize-intent, then create-payment-intent each returned HTTP 200 `success: true`, with a finalize hash and a redacted test PaymentIntent proof. A raw `clientSecret` is rejected.

The report SHA is the commit GitHub built. On a pull request that is the merge commit, which must have the branch head as a parent. On `master` it is the pushed commit. Create the report from that green run; publication downloads the artifacts again and rejects any difference.

```bash
node scripts/release-safety/assemble-report.mjs <run-id> <full-sha>
RELEASE_SAFETY_REPORT=$PWD/release-safety-report.json npm run deploy:frontend:safe
```

A missing `gh` login, a failed run, a different SHA, or a hand-written report fails closed. There is no opt-in flag.

The deploy host has the official `gh` 2.103.3 package. `illoc` still needs a credential that can only read this repository's Actions runs, artifacts, and commits. A token that can push code does not belong on the server. Create it in GitHub settings, limited to `WASOE/DrfitDwells.com`, with Actions read and Contents read:

https://github.com/settings/personal-access-tokens/new?name=drift-dwells-release-reader&description=Read+Actions+evidence+for+frontend+publication&target_name=WASOE&expires_in=90&actions=read&contents=read

Install that token only in `/home/illoc/.config/gh` as mode `600`. Do not paste it into chat, logs, or the repository. Until it exists, `gh run view` returns 401 and publication fails closed.

## Rollback

The legacy `WEBROOT` publisher snapshots only `index.html`, `sw.js`,
`.htaccess`, and `release-manifest.json` in
`../private-release-snapshots/<sha>`. Its post-copy Apache probe and shell
restore do **not** protect nested prerendered pages or other static files.
Do not use it to publish production until complete transactional recovery has
been implemented and verified. The local production block is not installed on
the production host; operators must not run the old publisher there.

Remote rsync publication is refused because it cannot restore that snapshot.

## Isolated staging

`Isolated staging booking` builds this pull request and runs it on the GitHub runner:

- Apache 2.4 serves `client/dist` and proxies `/api/` to the real server on `127.0.0.1`
- MongoDB 7 is a service container. The only allowed database is `drift-dwells-ci-staging` on loopback, seeded with a synthetic cabin and dropped when the job ends
- Stripe is `stripe-mock` on `127.0.0.1:12111`. The server refuses `sk_live_`, Atlas, `mongodb+srv`, and any Stripe host other than loopback while `RELEASE_CI_STAGING=1`
- SMTP, webhooks, schedulers, and booking notification workers are off
- Playwright aborts browser requests to `driftdwells.com` and `stripe.com`

No repository secret is required for this job. Do not point it at production MongoDB, the production API, or live Stripe. The evidence records `stripeMode: "test"`, the loopback database name, and a redacted PaymentIntent proof. It does not confirm a charge.

## Branch protection

`master` requires both check names, strict status checks, and administrator enforcement. An administrator cannot bypass:

- `Apache, browser, and payment contract`
- `Isolated staging booking`

Confirm with:

```bash
gh api repos/WASOE/DrfitDwells.com/branches/master/protection --jq '{checks:.required_status_checks.contexts,strict:.required_status_checks.strict,admins:.enforce_admins.enabled}'
```
