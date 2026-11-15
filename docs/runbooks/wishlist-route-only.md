# Wishlist-only release: Drift & Dwells

Purpose: make only /wishlist and /bg/wishlist live. This is NOT a
production approval for the blocked DirectAdmin or full-site blue-green
migration. The server's existing DocumentRoot remains public_html.

## Scope and preconditions

- Never run the legacy in-place frontend publisher.
- No changes to Apache, DirectAdmin, PHP-FPM, other hosting accounts,
  public_html/index.html, public_html/.htaccess, public_html/sw.js,
  existing asset bytes, or unrelated routes.
- The API must already be healthy on release
  01d64f8f4b1f6503c92f3e849a4aa04e99476687 (PM2 111 at planning).
- The publisher downloads and independently verifies the pinned
  production artifact workflow 43695815193 for master commit
  874ed57e19e78d3d6b4d05c13c7d1805bc1da708.
- The existing .htaccess serves actual directories rather than rewriting
  them to the root app shell; confirm this again on the real host.
- Preserve the verified original live site. Existing wishlist route files,
  if any, are copied with full metadata to a private rollback journal.
- Only NEW hashed assets in /assets are allowed. Existing asset names
  must have identical bytes. Unexpected unversioned assets are refused.
- New bundle entry can coexist with old root entry only after a browser
  check, including an already-installed service worker.
- Do not publish if the new pages require absent non-/assets static files.
  Verify their linked images/media and dependencies before activation.

## Run on the host with the merged release tools

Use a fresh, unique state directory outside the webroot. No output should
contain a secret. The GitHub credential needs repository/Actions read access.

    export VITE_STRIPE_PUBLISHABLE_KEY='[existing public production key]'
    export DRIFT_ORIGIN_IP='[verified origin IP]'
    export OPS_VERIFY_TOKEN='[existing authorized Finance Ops token]'
    STATE=/home/illoc/releases/frontend/wishlist-only-20261115

    node scripts/release-safety/publish-wishlist-only.mjs plan "$STATE"

Review the plan: expected exactly two localized route HTML files, no
collisions, new hashed assets only; audit missing media and current
service-worker behavior. Verify no concurrent live webroot publisher or
other process changing wishlist/index.html, bg/wishlist/index.html or
/assets. Perform a real-origin browser check using a protected staging
or test route where feasible without changing unrelated live files.

After explicit approval for the route-only cutover, execute:

    WISHLIST_ROUTE_ONLY_AUTHORIZE=YES \
      node scripts/release-safety/publish-wishlist-only.mjs apply "$STATE"

The CLI verifies GitHub provenance again, stages immutable assets, backs
up original HTML, atomically replaces only the two route HTML files,
verifies real origin HTML, entry assets, root, search, checkout and API
health, and rolls back changed HTML on any smoke failure. If it crashes,
do not rerun apply with an existing state; inspect the journal and use
the rollback operation.

    node scripts/release-safety/publish-wishlist-only.mjs rollback "$STATE"

Rollback restores the previous route files (or removes newly introduced
ones). It retains additive immutable assets so existing browser tabs do
not break. On concurrent modification, rollback refuses to overwrite
unrecognized bytes and marks recovery-required; resolve manually from
the verified private backups.

## Complete the campaign release

1. Verify both languages' forms with invalid data only. Do not create a
   real lead unless expressly authorized.
2. Verify authenticated Finance Ops lead listing.
3. Start and verify only the dedicated corporate gift notification
   worker, following the separate documented PM2 worker procedure.
4. Verify all existing seven workers, API/booking/Stripe health,
   historical website paths and test subdomain remain unchanged.
5. Fix the deferred PM2 save under a separately controlled, verified
   operation so a reboot does not resurrect the old API.
6. Confirm emails are sent and retried; do not claim inbox delivery
   until actual mailbox receipt is verified.

The complete blue-green PR #68 remains draft and execution-blocked.
