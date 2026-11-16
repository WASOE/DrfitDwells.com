# Atomic frontend deployment


## CURRENT PRODUCTION STATUS: LIVE (16 November 2026)

The first atomic document-root migration is **complete**. Do **not** run the
initial migration again, use the old in-place publisher, or apply the old
DirectAdmin vhost migration.

- DocumentRoot stays /home/illoc/domains/driftdwells.com/public_html
- Live chain: public_html -> /home/illoc/releases/frontend/current -> immutable release
- Initial live frontend SHA: 43ee143d88fc35824f92997253c03c0a11f1dc78
- API SHA at cutover: 01d64f8f4b1f6503c92f3e849a4aa04e99476687
- Original tree: /home/illoc/releases/frontend/backups/pre-atomic-public_html
- Host cutover receipt: /home/illoc/releases/frontend/state/cutover-43ee143-20261116/cutover-receipt.json
- An independently checked off-host backup was retained.
- Known old test host behavior: HTTP 301 to https://driftdwells.com/ and
  HTTPS diagnostic 404, with an expired test-host certificate. Production
  TLS validation must remain strict.
- Apache, DirectAdmin, PHP-FPM, API, and nine PM2 processes were unchanged
  by the initial cutover.

### Routine frontend update

Run as illoc from the reviewed, merged repository. Produce a verified exact
commit production artifact using production-artifact.yml, verify release-safety
CI success, and record the NEW artifact run ID and full SHA.

Identify the CURRENT artifact run ID and full SHA from release records and
the live pointer. Never assume the initial SHA is still active.
Supply OPS_VERIFY_TOKEN, VITE_STRIPE_PUBLISHABLE_KEY and DRIFT_ORIGIN_IP
via the existing protected server environment. Do not print credentials.

```bash
readlink -f /home/illoc/domains/driftdwells.com/public_html
readlink -f /home/illoc/releases/frontend/current

node scripts/release-safety/atomic-production.mjs deploy \
  CANDIDATE_RUN_ID CANDIDATE_FULL_SHA \
  CURRENT_RUN_ID CURRENT_FULL_SHA API_FULL_SHA
```


That command verifies artifacts, stages a sealed release, checks the live
site, atomically switches frontend/current, and runs origin/route checks with
automatic rollback on verification failure. Verify homepage, both wishlist
routes, booking, checkout, Ops, API, uploads, legal files, test HTTP/HTTPS,
and representative unrelated hosted websites. Routine frontend updates
require no Apache, DirectAdmin, PHP-FPM or PM2 restart.

### Manual rollback

Use the verified rollback action with the old artifact as ROLLBACK and the
currently active artifact as CURRENT:

```bash
node scripts/release-safety/atomic-production.mjs rollback \
  ROLLBACK_RUN_ID ROLLBACK_FULL_SHA \
  CURRENT_RUN_ID CURRENT_FULL_SHA API_FULL_SHA
```


For an interrupted release, inspect the activation journal and follow the
recover section further below. Verify no publisher is running before removing
a stale deployment lock. Preserve old releases, append-only hashed assets,
the cutover receipt, and backups. These operations deploy FRONTEND only.
API, PM2, payment completion and actual email delivery require separate tests.

---


## Decision

Keep DirectAdmin and Apache configured with `DocumentRoot
/home/illoc/domains/driftdwells.com/public_html`. Convert that exact pathname
once from a real directory to an `illoc`-owned symlink. The symlink targets
`/home/illoc/releases/frontend/current`; future releases atomically rename only
that pointer. Routine releases do not regenerate DirectAdmin configuration and
do not reload Apache or PHP-FPM.

The first conversion uses Linux `renameat2(RENAME_EXCHANGE)` to exchange the
nonempty directory and a prepared symlink in one filesystem operation. There is
no two-rename fallback. The original directory is then retained intact under
`frontend/backups/`. A durable journal is written before and after the exchange.
If verification fails, the same atomic exchange restores the original directory.

Each release is read-only and has an owner-matched `assets` symlink.
`assets` targets an append-only shared asset store. Before the first exchange,
every file in the original live `public_html/assets` is hashed and imported
without replacement; a same-name/different-hash collision blocks migration.
This preserves prior hashed URLs for existing browser sessions. When the test
root exists, an owner-matched `test` symlink targets the stable path
`frontend/stable-test/root`. If the original test root is absent, both the stable
root and the release's `test` entry remain absent: a dangling symlink changes
Apache's behavior to 403 before the inherited redirect rules can run.
This preserves the observed HTTP 301 to `https://driftdwells.com/` and HTTPS 404.
If a real legacy test tree exists, its complete tree is imported before exchange;
the migration then adds the link to the inactive staged release, restores its
read-only mode and verifies it again. Future releases link only an existing real
stable root. Previously staged releases with dangling test links fail verification
and must be restaged; do not bypass the check or create an empty test root.
`/api` and `/uploads` remain the existing reverse proxies. `/legal` and every
other non-artifact local path are audited: a live path missing from the verified
candidate blocks migration instead of being silently lost.

## Verified host compatibility (read-only, 15 November 2026)

- DirectAdmin 1.714; Apache 2.4.66 on AlmaLinux 9.7.
- `/` is ext4 and both the current webroot and proposed release base are on that filesystem.
- SELinux is disabled.
- `public_html` is `illoc:illoc 0755`; its parent is `apache:apache 0755`.
- Apache runs as `apache`, can traverse the existing path, and uses
  `SymLinksIfOwnerMatch`; release directories, both pointer links and targets
  must therefore remain owned by `illoc`.
- Effective vhosts use the unchanged main DocumentRoot, the test root beneath
  it, `/api` and `/uploads` proxies, and `/legal/` beneath the main root.

The parent ownership means only the one-time exchange needs a tightly scoped
privileged invocation. Routine stage/deploy/rollback commands run as `illoc`.
Do not change the domain directory owner or permissions.

## Initial migration — separate cutover authorization required

Do not run this section merely because the implementation and CI pass. Record
the authorized window and quiesce every frontend publisher first. Do not stop or
restart PM2 processes.

1. Build the exact master commit through `production-artifact.yml`. Confirm its
   exact release-safety run passed and record both workflow run IDs.
2. As `illoc`, create private state, append-only assets, and the stable test
   parent on the
   same filesystem:

   ```bash
   install -d -m 0755 /home/illoc/releases/frontend/{releases,shared-assets,stable-test}
   install -d -m 0700 /home/illoc/releases/frontend/{state,backups}
   ```

   Do not create `stable-test/root` when the current
   `public_html/test` does not exist. The migration creates and fills it only
   when an existing real test tree must be preserved.

3. Export the existing protected values without printing them, then stage the
   verified artifact. Staging does not change the live site:

   ```bash
   node scripts/release-safety/atomic-production.mjs stage PRODUCTION_RUN_ID FRONTEND_FULL_SHA
   ```

4. Verify the staged release, owner/group/modes, parent traversal and current
   Apache syntax. Record HTTP and HTTPS responses for the apex, www and test
   hosts, including status, redirect location and content type. Verify `/api`,
   `/uploads`, `/legal`, representative legal files, API release, booking and
   checkout capabilities. Inventory all top-level live paths and review any
   path not present in the candidate; the migration independently repeats this
   audit and fails closed. Make and independently verify a full off-host backup
   of the existing `public_html` tree. The retained original tree is not a
   substitute for that off-host backup.
5. With explicit cutover authorization, run only the migration command through
   the approved narrow sudo policy, preserving only the three named public or
   protected verification variables:

   ```bash
   sudo --preserve-env=OPS_VERIFY_TOKEN,VITE_STRIPE_PUBLISHABLE_KEY,DRIFT_ORIGIN_IP \
     node scripts/release-safety/migrate-atomic-production.mjs apply FRONTEND_FULL_SHA API_FULL_SHA
   ```

   During this command, legacy assets and any real test tree are imported and
   verified before `RENAME_EXCHANGE`. Candidate-only assets are checked locally
   before switching and through the certificate-validated production origin
   only after switching; any failure atomically restores the original root.
   The command also compares actual HTTP and HTTPS test-subdomain behavior with
   the immediately preceding baseline. It probes the verified origin IP with
   `test.driftdwells.com` as HTTP Host and TLS SNI, so an intentionally absent
   public DNS record neither bypasses this check nor blocks it.

6. Verify the journal phase is `complete`, `public_html` resolves through
   `frontend/current` to the exact commit, and the original nonempty tree is at
   `frontend/backups/pre-atomic-public_html`. Re-run homepage, booking,
   checkout, Ops, wishlist, `/api`, `/uploads`, `/legal`, test-subdomain and
   representative unrelated-site checks. Do not delete the original tree.

If the process is interrupted and `document-root-migration.json` is `prepared`
or `exchanged`, do not improvise. Recovery handles both locations of the
original tree: `public_html.atomic-exchange` before the backup move and
`frontend/backups/pre-atomic-public_html` after it. After proving no migration
process is alive:

```bash
sudo --preserve-env=OPS_VERIFY_TOKEN,DRIFT_ORIGIN_IP \
  node scripts/release-safety/migrate-atomic-production.mjs recover ignored API_FULL_SHA
```

Recovery atomically restores the original directory and verifies it. A
`complete` or `rolled-back` journal is terminal and must be reviewed, not
overwritten.

## Future one-command deployment

Run as `illoc` from the exact merged repository revision. The command downloads
and independently verifies both candidate and rollback artifacts, checks exact
commit provenance and CI evidence, stages a sealed release, checks local hashes
and the current site/API, records HTTP and HTTPS test-subdomain behavior,
atomically switches `current`, then verifies candidate assets at the
certificate-validated origin. Candidate-origin, site, API, or test-subdomain
failure rolls the pointer back:

```bash
node scripts/release-safety/atomic-production.mjs deploy \
  CANDIDATE_RUN_ID CANDIDATE_FULL_SHA CURRENT_RUN_ID CURRENT_FULL_SHA API_FULL_SHA
```

Never run two publishers concurrently. The filesystem lock fails the second
publisher closed. Retain release directories, stable test content and shared assets for the complete
browser-session rollback window; there is intentionally no automated garbage
collection.

## Rollback

Rollback is the same verified activation with the current and prior releases
reversed; it never copies into the live tree:

```bash
node scripts/release-safety/atomic-production.mjs rollback \
  ROLLBACK_RUN_ID ROLLBACK_FULL_SHA CURRENT_RUN_ID CURRENT_FULL_SHA API_FULL_SHA
```

After a crash between pointer switch and journal removal, prove the publisher is
not running, remove only a demonstrably stale `frontend-deploy.lock`, then run:

```bash
node scripts/release-safety/atomic-production.mjs recover PREVIOUS_FULL_SHA API_FULL_SHA
```

The journal permits only its recorded candidate or previous target. Any other
pointer state fails closed and requires investigation.
