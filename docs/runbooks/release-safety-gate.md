# Release safety gate

Booking routes are gated before production. The gate does not deploy.

## What runs on every pull request

`Apache, browser, and payment contract` builds `client/dist` and checks it with Apache 2.4 and the release `.htaccess`:

- prerendered pages render their own titles
- `/search`, `/checkout`, confirmation, voucher, and return routes stay on their path
- direct `/index.html` still redirects to `/`
- HTTP and `www` redirects keep the path and query
- the PR #47 `/index.html` rule, without the `THE_REQUEST` guard, fails `/search` and `/checkout`
- referenced JavaScript exists
- the compiled payment contract is enabled
- the service worker does not call `skipWaiting()` during install, and payment routes stay network-only

The browser job is mocked. It serves that artifact through Apache and stubs `/api`. It does not call production or Stripe. It is not staging end-to-end coverage.

## What blocks a production deploy

`npm run deploy:frontend:safe` refuses to publish unless `RELEASE_SAFETY_REPORT` passes `artifactOk`, `deployOk`, the same 40-character SHA, mocked browser coverage, and isolated staging coverage.

`Isolated staging booking` fails closed until these repository secrets exist:

- `RELEASE_STAGING_BASE_URL` — an origin that is not `driftdwells.com` or `www.driftdwells.com`
- `RELEASE_STAGING_STRIPE_MODE` — `test`
- `RELEASE_STAGING_ALLOW_PAYMENT_INIT` — `1`

That job then runs quote, finalize-intent, and Stripe test-mode initialization against staging and stops before confirming a charge.

## Rollback

Publication with `REQUIRE_RELEASE_SAFETY_REPORT=1` snapshots `index.html`, `sw.js`, `.htaccess`, and `release-manifest.json` under `.release-snapshots/<sha>` before the shell switch. Hashed assets stay. `activateTestedRelease` restores that snapshot when a critical-route probe fails. It does not restart the API or write the database.

Shell-last copy is the activation step. The webroot is not replaced with one atomic directory rename, because uploads and previously hashed assets live in the same document root.

## Owner action still required

These checks are not GitHub-required until branch protection lists both job names. A repository admin needs to add them:

```bash
gh api --method PUT repos/WASOE/DrfitDwells.com/branches/master/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Apache, browser, and payment contract",
      "Isolated staging booking"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null
}
EOF
```

Confirm with:

```bash
gh api repos/WASOE/DrfitDwells.com/branches/master/protection --jq '.required_status_checks.contexts'
```

Until that list contains both names, a red check does not by itself stop a merge. Do not treat the workflow as mandatory enforcement before that.
