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

`production-artifact.yml` builds a production-key artifact after an exact
`master` SHA dispatch; `stage-production.mjs` verifies the artifact and matching
GitHub release-safety evidence before staging. Reverify the artifact and its
evidence before use. The historical rollback workflow is pinned to source
`9baa749f76afd88f1fe3122414ce9c8ef8217f45`; its source build is not a
recovery of missing historical production bytes.

### First migration and activation (not yet authorized)

**DirectAdmin verification gate:** The behavior-preserving generator test
below has been completed, but it does not validate migration or rollback.
Do not execute either against production until the remaining execution gate
described below is resolved and tested under separate authorization. Tests
using a fixture renderer do not establish how the installed generator expands
tokens or when Apache loads its output. Record the original persistent custom
configuration and generated account configuration, including checksums,
ownership, mode and ACLs; verify restoration from those backups before the test.
Compare the generated main HTTP/HTTPS and test-subdomain vhosts, including
forwarded headers and CGI, `/api`, `/uploads` and `/legal`. Verify HTTP behavior
for those routes and representative unrelated sites before and after each
account-scoped regeneration; test Apache syntax before any manual reload.
Never write the generated account `httpd.conf` directly, rewrite all users,
or replace or drain the shared DirectAdmin task queue. Determine whether the
installed `taskq --run` performs or schedules an Apache reload before the
authorized test; do not assume syntax can be checked first if it reloads.
On a failure, restore
the original persistent source, regenerate only `illoc`, verify the original
effective configuration and HTTP behavior, and stop.

The commands below are a proposed sequence, not executable production
authorization: this revision deliberately disables `apply`, `recover`, and
`rollback` with the real command runner. The observed queued reload behavior
must be accommodated and verified before these commands can be used.

For the future generator gate, record these read-only facts on the host before
making any changes:

```bash
DOMAIN_CONFIG=/usr/local/directadmin/data/users/illoc/domains/driftdwells.com.cust_httpd
SSL_CONFIG=/usr/local/directadmin/data/users/illoc/domains/driftdwells.com.cust_httpd_ssl
GENERATED=/usr/local/directadmin/data/users/illoc/httpd.conf
sudo sha256sum "$DOMAIN_CONFIG" "$SSL_CONFIG" "$GENERATED"
sudo stat -c '%n %U:%G %a' "$DOMAIN_CONFIG" "$SSL_CONFIG" "$GENERATED"
sudo getfacl -p "$DOMAIN_CONFIG" "$SSL_CONFIG" "$GENERATED"
sudo /usr/sbin/httpd -t
sudo /usr/local/directadmin/directadmin taskq --help
```

In the observed configuration the HTTPS vhosts use the HTTP custom source and
its `http`/`80` forwarded headers. The separate SSL custom file differs; do not
silently replace those effective headers when testing regeneration. Preserve
both source files and the generated file as independent, metadata-preserving
backups and verify their hashes. The `taskq --run` scope and reload behavior,
the exact generated vhost changes, and complete restoration must be verified
before the first real migration.

#### Reversible DirectAdmin generator test (separate authorization required)

**Observed on 15 November 2026:** On DirectAdmin 1.714, two account-scoped
comment rewrites and one restore rewrite preserved the source and regenerated
account configuration. Each invocation appended
`action=httpd&value=reload` to the shared task queue. The scheduler later
coalesced these entries and reloaded Apache and PHP-FPM 8.1 and 8.3. Syntax,
the original source/generated hashes, 37 other account configuration hashes,
and the recorded origin HTTP responses matched after restoration and the
queued reload. The observed test-site HTTPS `/` returned 404 and `/legal/`
returned 403 both before and after the test; these were not treated as healthy
routes.

**Execution remains disabled.** The transition code now requires separate
pre-load validation and effective-reload verification callbacks, journals
reload-pending and restoration phases, and retains the release pointer even
after a verified rollback. A failed or timed-out verification records
`recovery-required` and leaves recovery assets intact. Fixture callbacks are
simulations, not a production implementation or evidence that Apache reloaded.
The CLI deliberately provides no way to satisfy these callbacks or bypass the
gate. The retained pointer is not garbage-collectable merely because the
generated file has changed: old Apache workers may still use it. If that
pointer is missing after configuration installation may have begun, recovery
stops without changing or regenerating configuration and records
`recovery-required`; an operator must investigate the effective Apache state.

The outstanding blocker is pre-load validation of the **actual** DirectAdmin
generated configuration. `taskq --run` writes the live generated file and
queues a shared-service reload, so a syntax test after that command cannot
guarantee the file was validated before Apache loaded it. No supported,
account-isolated staging or reload sequencing mechanism has been verified.
Before enabling execution, implement and demonstrate such a mechanism without
altering unrelated queue entries or other accounts. Also implement a real
bounded reload observer that distinguishes the active and restored Apache
configurations (including graceful old workers) and verifies HTTP and HTTPS
for apex/www and test, assets, `/api`, `/uploads`, `/legal`, representative
unrelated sites, and PHP-FPM 8.1 and 8.3 health. A queue entry, generated-file
hash, successful syntax test, or elapsed time alone is not proof of an
effective reload. Verify interruption and rollback at every transition on the
actual generator in a separately authorized reversible test. Preserve the
pointer and backups whenever state is uncertain. The 15 November test does not
authorize frontend migration or activation.

#### Evaluating a bounded DirectAdmin scheduler pause

The [DirectAdmin configuration reference](https://docs.directadmin.com/directadmin/general-usage/all-directadmin-conf-values.html#dataskq-run-interval)
states that `dataskq_run_interval=0` disables the main DirectAdmin service's
periodic task queue processor. The
[configuration guide](https://docs.directadmin.com/directadmin/general-usage/configuring-da.html)
documents `da config-set NAME VALUE`, which reloads or restarts DirectAdmin by
default; `--no-reload` requires a separate reload. This setting does **not**
disable a separately started `dataskq`, direct `taskq --run`, an independent
Apache reload, service restart, or a queued task already being processed.
It is a server-wide scheduler change, not an `illoc`-scoped change: queued
operations for every hosting customer will be delayed. Restoring periodic
processing can then execute unrelated queued operations and trigger a shared
Apache and PHP-FPM reload. Never drain, replace, filter or delete queue entries
to create a maintenance window.

Read-only inspection on 15 November 2026 showed DirectAdmin 1.714, effective
`dataskq_run_interval` `1m0s`, and **no explicit setting** in
`directadmin.conf` (the default applies). `config-set --help` documented
`--no-reload`, but the installed CLI listed no `config-unset` command. Exact
restoration therefore requires a verified method that restores both the
setting's absence and its effective value without overwriting concurrent
configuration changes. The Apache systemd `ExecReload` invokes `httpd -k
graceful`; the DirectAdmin service reload sends `HUP`. DirectAdmin's cron file
also schedules server-wide tally and reset tasks. The targeted inspection
found no active `dataskq` process, no matching system timer, and no matching
cron command that directly runs `dataskq` or reloads Apache; it is a
point-in-time observation, not proof that other reload sources cannot run.

**No scheduler-pause procedure is authorized or implemented by this PR.**
The proposed use of `config-set dataskq_run_interval 0` must not be executed
as a migration workaround. An independent, persistent crash/reboot recovery
mechanism would first need to be installed and proven: if the deployment
process dies after an invalid generated config is installed, merely restoring
the interval could load invalid config, while merely leaving it disabled
indefinitely blocks other customers' queued work. The recovery mechanism must
restore the exact original per-domain source and regenerate only `illoc`,
validate the actual full Apache configuration before allowing any reload,
and restore the exact scheduler configuration without touching unrelated queue
entries. It must handle interruption and reboot at every step, fail closed on
conflicting edits, and be validated against installed DirectAdmin 1.714.
Independently controlled or already-running reload sources must also be
excluded for the entire mutation and recovery interval. An observer must
verify the effective Apache generation, required site routes and both PHP-FPM
services, not merely the queue or on-disk files.

Before any separate authorization, an operator can refresh these read-only
facts without changing the scheduler or queue:

```bash
sudo /usr/local/directadmin/directadmin version
sudo /usr/local/directadmin/directadmin config-get dataskq_run_interval
sudo /usr/local/directadmin/directadmin config-set --help
sudo grep -nE '^[[:space:]]*dataskq_run_interval[[:space:]]*=' \
  /usr/local/directadmin/conf/directadmin.conf || true
systemctl show directadmin -p ExecReload -p Restart -p ActiveState
systemctl show httpd -p ExecReload -p ActiveState
systemctl list-timers --all --no-pager
systemctl list-jobs --no-pager
ps -eo pid,ppid,comm,args | grep -E '[d]ataskq|[d]irectadmin taskq'
sudo stat /usr/local/directadmin/data/task.queue
```

An absent task queue file is normal. These commands do not establish exclusive
control, and the last command can report absence; neither condition permits a
scheduler pause or migration.

This is a test of the installed generator, **not** frontend migration or
activation. It adds only a unique Apache comment to the existing main-domain
custom source. Do not start unless the operator has independently verified
that `taskq --run` processes only the requested task without consuming the
shared queue, and whether it reloads Apache. If that cannot be established
without risk to other accounts, stop; do not use the shared task queue as a
workaround. Confirm the test window, that no other process can edit these
files or regenerate `illoc`, and that a privileged operator can restore them.

1. Capture the effective HTTP and HTTPS vhosts for apex/www and test, Apache
   syntax, current task-queue state, checksums of other users' generated vhost
   files, and HTTP results for the main and test sites, `/api`, `/uploads`,
   `/legal`, and representative other customers' sites. Record existing
   non-200 responses as baselines, not as passing assertions. Confirm ownership,
   modes, ACLs, filesystem traversal permissions and SELinux state for the
   configuration and release paths.
2. In a new root-owned directory outside the webroot, save independent copies
   of both custom files and generated `httpd.conf` using `cp -a --preserve=all`.
   Save and independently verify SHA-256, owner, group, mode and `getfacl -p`
   for originals and backups. Test the restore procedure on copies; never
   restore generated `httpd.conf` by writing it directly. Keep the originals
   and backups available throughout the test.
3. Recheck source hashes and metadata against the baseline. Add a unique
   comment line to **only** `driftdwells.com.cust_httpd`, using a same-directory
   metadata-preserving temporary copy and atomic rename. Do not change
   `.cust_httpd_ssl`, headers, DOCROOT, aliases or any other directive.
   Record the modified source hash. Do not overwrite another operator's edit.
4. Execute the following single task directly, not through the shared queue:

   ```bash
   sudo /usr/local/directadmin/directadmin taskq \
     '--run=action=rewrite&value=httpd&user=illoc'
   ```

   Check its result, queue state, `sudo /usr/sbin/httpd -t`, source hash,
   metadata and generated comment. Compare all non-comment directives and
   other users' vhost hashes with the baseline. Verify the recorded HTTP
   results, including HTTPS, API, uploads, legal and test-site routing. Repeat
   the same account-scoped task once and repeat all comparisons to prove
   persistence. A simulated renderer is not evidence for this step.
5. Restore the original custom source from its verified backup through a
   same-directory metadata-preserving temporary copy and atomic rename, after
   confirming the current source hash is the recorded test hash. Run the same
   account-scoped task once more. Verify both custom files, generated config,
   metadata and ACLs against the baseline; rerun syntax, queue, unrelated-vhost
   and HTTP checks. If any check fails, restore the original persistent source
   and regenerate only `illoc`, verify recovery, and stop. If source ownership
   or hashes changed unexpectedly, stop rather than overwrite those changes.
   Do not directly overwrite the generated config or reload Apache manually
   before a successful syntax check.

Record command output, source and backup hashes, test marker, before/after
comparisons, observed reload behavior and any recovery evidence in the
change record. Successful completion is a prerequisite for reviewing and
enabling this implementation, not authorization for the migration itself.

The production API cutover's PM2 save was deferred. Until separately
authorized and verified, a host reboot or PM2 resurrection may start the older
saved API release, which does not provide wishlist endpoints. Do not start the
corporate gift worker or run `pm2 save` as part of this verification gate.

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
exclusive publisher control of the shared-asset store. Verify DirectAdmin's
account-scoped rewrite and reload effects; Apache is shared. Quiesce webroot writers throughout
the first snapshot. An independently stored copy of the sealed backup and
manifest must be verified before activation.

After creating and securing the release, state and shared-asset directories
without changing the live document root, set these values to the verified host
paths. The executable paths are examples and **must** match the verified host:

```bash
BASE=/home/illoc/releases/frontend
WEBROOT=/home/illoc/domains/driftdwells.com/public_html
SITE_CONFIG=/usr/local/directadmin/data/users/illoc/httpd.conf
CUSTOM_CONFIG=/usr/local/directadmin/data/users/illoc/domains/driftdwells.com.cust_httpd
APACHE_CONFIG=/etc/httpd/conf/httpd.conf
ASSET_MANIFEST="$BASE/observed-assets.json"

node --input-type=module -e 'import fs from "node:fs"; import { createInventory } from "./scripts/release-safety/frontend-inventory.mjs"; const [root,out]=process.argv.slice(1); const files=createInventory(root,"observed-production","observed-production").files.filter(x=>x.path.startsWith("assets/")); fs.writeFileSync(out,JSON.stringify(files),{flag:"wx",mode:0o600});' "$WEBROOT" "$ASSET_MANIFEST"

node scripts/release-safety/vhost-migration-cli.mjs plan \
  --site-config "$SITE_CONFIG" --custom-config "$CUSTOM_CONFIG" --directadmin-user illoc \
  --apache-config "$APACHE_CONFIG" --document-root "$WEBROOT" \
  --shared-assets "$BASE/assets" --assets-manifest "$ASSET_MANIFEST" \
  --release-root "$BASE/releases" --pointer "$BASE/current" --state-dir "$BASE/migration-state"

node scripts/release-safety/vhost-migration-cli.mjs apply --apply \
  --confirm-webroot-quiesced --confirm-account-scoped-regeneration --confirm-shared-assets-policy \
  --site-config "$SITE_CONFIG" --custom-config "$CUSTOM_CONFIG" --directadmin-user illoc \
  --apache-config "$APACHE_CONFIG" --document-root "$WEBROOT" \
  --shared-assets "$BASE/assets" --assets-manifest "$ASSET_MANIFEST" \
  --release-root "$BASE/releases" --pointer "$BASE/current" --state-dir "$BASE/migration-state" \
  --httpd /usr/sbin/httpd --directadmin /usr/local/directadmin/directadmin --copy-command /usr/bin/cp \
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
node scripts/release-safety/activate-production.mjs rollback-observed "$CANDIDATE_RUN_ID" "$CANDIDATE_SHA" "$API_SHA"
node scripts/release-safety/vhost-migration-cli.mjs rollback --state-dir "$BASE/migration-state"
```

If `rollback-observed` is interrupted, recover its previous (candidate) release
with `activate-production.mjs recover "$CANDIDATE_RUN_ID" "$CANDIDATE_SHA" "$API_SHA"`
after verifying and removing the stale activation lock. Then retry rollback.
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
