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

The blue-green modules stage an inventory outside the active tree, atomically
switch an existing symlink, retain hashed assets separately, and journal
activation. The activation entry point downloads and verifies both artifacts,
checks the site and shared assets, and restores the previous pointer on smoke
failure. **This is not yet a production-ready migration procedure.** In
particular, the first activation may use only the separately checked migration
snapshot labeled `observed-production`; it is not a Git commit or a recovered
historical release. The historical production artifact and complete sequence
still need verification with real production configuration. Removing write permissions does not make an owner-controlled directory
immutable. The optional `RUN_ALMA_HTTPD_TEST=1 node --test
scripts/release-safety/blue-green-alma.test.mjs` test exercises an isolated
AlmaLinux httpd container with selected observed vhost rules, including a
test vhost and uploads proxy. It does not reproduce the full DirectAdmin
configuration, TLS, or SELinux. SELinux was observed disabled on the host;
recheck its state before any future transition. Do not use these modules to
switch the live site.

The read-only vhost inspection identified an explicit `/legal/` alias as well
as the `/api` and `/uploads` proxies. The migration code is development work
and is not authorized for production.
The host runs Apache 2.4.66 on AlmaLinux 9.7 with `SymLinksIfOwnerMatch`;
Apache's user can traverse `/home/illoc`. A real transition must establish
matching symlink and target owners and recheck all permissions and labels.

The development branch contains `production-artifact.yml`, which builds a
production-key artifact only after an exact `master` SHA dispatch, and
`stage-production.mjs`, which verifies the artifact and the matching GitHub
release-safety evidence before staging. The workflow is not usable until it is
present on `master`, its production public Stripe key variable is configured,
and an exact-SHA workflow run has succeeded. The historical rollback workflow
is pinned to source `9baa749f76afd88f1fe3122414ce9c8ef8217f45`; it is not
a verified production artifact until its trusted master run succeeds and its
artifact and evidence have been independently verified. Do not use the
staging or activation commands as a production procedure until that
independent rollback and deployment prerequisites are resolved.

### First migration and activation (not yet authorized)

Do not run these commands until the PR is approved and merged, the artifact
workflow and its exact production candidate have passed, the actual hosting
configuration and privileges have been confirmed, and production migration is
separately authorized. The old webroot is never renamed or removed. The
snapshot is an observed copy of the live tree, not proof of any source commit
or restoration of missing historical bytes.

Prerequisites: a repository-scoped GitHub Actions/Contents read credential;
`VITE_STRIPE_PUBLISHABLE_KEY` set to the actual **public** production key;
`OPS_VERIFY_TOKEN` with Finance access; and `DRIFT_ORIGIN_IP` set to the
verified origin IP. Do not put credentials in the command line or logs. Verify
the current API release, booking/payment capabilities and wishlist API before
activating a wishlist build. Confirm the effective persistent Apache config,
matching owner of symlink and release for `SymLinksIfOwnerMatch`, Apache
traverse/read permissions, ACLs and SELinux labels for every new path, and
exclusive publisher control of the shared-asset store. Confirm a tested
site-scoped reload command; Apache is shared. Quiesce webroot writers throughout
the first snapshot. An independently stored copy of the sealed backup and
manifest must be verified before activation.

After creating and securing the release, state and shared-asset directories
without changing the live document root, set these values to the verified host
paths. The executable and reload arguments are examples and **must** match
the verified host:

```bash
BASE=/home/illoc/releases/frontend
WEBROOT=/home/illoc/domains/driftdwells.com/public_html
SITE_CONFIG=/usr/local/directadmin/data/users/illoc/httpd.conf
APACHE_CONFIG=/etc/httpd/conf/httpd.conf
ASSET_MANIFEST="$BASE/observed-assets.json"

node --input-type=module -e 'import fs from "node:fs"; import { createInventory } from "./scripts/release-safety/frontend-inventory.mjs"; const [root,out]=process.argv.slice(1); const files=createInventory(root,"observed-production","observed-production").files.filter(x=>x.path.startsWith("assets/")); fs.writeFileSync(out,JSON.stringify(files),{flag:"wx",mode:0o600});' "$WEBROOT" "$ASSET_MANIFEST"

node scripts/release-safety/vhost-migration-cli.mjs plan \
  --site-config "$SITE_CONFIG" --apache-config "$APACHE_CONFIG" --document-root "$WEBROOT" \
  --shared-assets "$BASE/assets" --assets-manifest "$ASSET_MANIFEST" \
  --release-root "$BASE/releases" --pointer "$BASE/current" --state-dir "$BASE/migration-state"

node scripts/release-safety/vhost-migration-cli.mjs apply --apply \
  --confirm-webroot-quiesced --confirm-config-persistence --confirm-shared-assets-policy \
  --site-config "$SITE_CONFIG" --apache-config "$APACHE_CONFIG" --document-root "$WEBROOT" \
  --shared-assets "$BASE/assets" --assets-manifest "$ASSET_MANIFEST" \
  --release-root "$BASE/releases" --pointer "$BASE/current" --state-dir "$BASE/migration-state" \
  --httpd /usr/sbin/httpd --copy-command /usr/bin/cp \
  --reload-command /usr/sbin/httpd --reload-arg -k --reload-arg graceful \
  --probe-url https://driftdwells.com/search --probe-url https://driftdwells.com/checkout
```

Verify and independently retain `$BASE/migration-state/backup` before the
first activation. The migration journal, sealed snapshot, original backup,
shared assets and active vhost are checked again by the first activation:

```bash
node scripts/release-safety/activate-production.mjs \
  "$CANDIDATE_RUN_ID" "$CANDIDATE_SHA" observed observed-production "$API_SHA"
```

An unsuccessful activation restores the prior pointer and runs rollback smoke
checks. If interrupted, establish that no publisher is running, remove only
its stale `$BASE/state/activation.lock`, then run:

```bash
node scripts/release-safety/activate-production.mjs recover observed observed-production "$API_SHA"
```

To reverse the initial vhost migration after restoring the observed pointer:

```bash
node scripts/release-safety/vhost-migration-cli.mjs rollback --state-dir "$BASE/migration-state"
```

For later releases supply the independently verified previous run ID and full
commit SHA instead of `observed observed-production`. Do not use the observed
exception to relabel later releases. If verification or rollback smoke fails,
leave the journal intact and stop.

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
