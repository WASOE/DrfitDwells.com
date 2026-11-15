# Atomic frontend deployment

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

Each release is read-only and has an owner-matched `assets` symlink to an
append-only shared asset store. This preserves old content-hashed URLs for
existing browser sessions without an Apache Alias. `/api` and `/uploads` remain
the existing reverse proxies, `/legal` continues through the unchanged
DocumentRoot pathname, and the test subdomain continues to resolve
`public_html/test` inside the active release.

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
2. As `illoc`, create private state and append-only asset directories on the
   same filesystem:

   ```bash
   install -d -m 0755 /home/illoc/releases/frontend/{releases,shared-assets}
   install -d -m 0700 /home/illoc/releases/frontend/{state,backups}
   ```

3. Export the existing protected values without printing them, then stage the
   verified artifact. Staging does not change the live site:

   ```bash
   node scripts/release-safety/atomic-production.mjs stage PRODUCTION_RUN_ID FRONTEND_FULL_SHA
   ```

4. Verify the staged release, owner/group/modes, parent traversal, current
   Apache syntax, main/test vhost paths, origin responses, API release, booking
   and checkout capabilities. Make and independently verify a full off-host
   backup of the existing `public_html` tree. The exchange also retains that
   original tree locally, but it is not a substitute for the off-host backup.
5. With explicit cutover authorization, run only the migration command through
   the approved narrow sudo policy, preserving only the three named public or
   protected verification variables:

   ```bash
   sudo --preserve-env=OPS_VERIFY_TOKEN,VITE_STRIPE_PUBLISHABLE_KEY,DRIFT_ORIGIN_IP \
     node scripts/release-safety/migrate-atomic-production.mjs apply FRONTEND_FULL_SHA API_FULL_SHA
   ```

6. Verify the journal phase is `complete`, `public_html` resolves through
   `frontend/current` to the exact commit, and the original nonempty tree is at
   `frontend/backups/pre-atomic-public_html`. Re-run homepage, booking,
   checkout, Ops, wishlist, `/api`, `/uploads`, `/legal`, test-subdomain and
   representative unrelated-site checks. Do not delete the original tree.

If the process is interrupted and `document-root-migration.json` is `prepared`
or `exchanged`, do not improvise. After proving no migration process is alive:

```bash
sudo --preserve-env=OPS_VERIFY_TOKEN \
  node scripts/release-safety/migrate-atomic-production.mjs recover ignored API_FULL_SHA
```

Recovery atomically restores the original directory and verifies it. A
`complete` or `rolled-back` journal is terminal and must be reviewed, not
overwritten.

## Future one-command deployment

Run as `illoc` from the exact merged repository revision. The command downloads
and independently verifies both candidate and rollback artifacts, checks exact
commit provenance and CI evidence, stages a sealed release, verifies assets at
the certificate-validated origin, checks the current site and API, atomically
switches `current`, and rolls back on a failed smoke check:

```bash
node scripts/release-safety/atomic-production.mjs deploy \
  CANDIDATE_RUN_ID CANDIDATE_FULL_SHA CURRENT_RUN_ID CURRENT_FULL_SHA API_FULL_SHA
```

Never run two publishers concurrently. The filesystem lock fails the second
publisher closed. Retain release directories and shared assets for the complete
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

