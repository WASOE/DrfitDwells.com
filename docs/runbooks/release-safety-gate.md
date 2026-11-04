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

## What blocks a production deploy

`npm run deploy:frontend:safe` always refuses to publish unless `RELEASE_SAFETY_REPORT` matches the release SHA and a completed successful GitHub Actions run. The run must contain both artifacts:

- `apache-browser-evidence` — `/search` and `/checkout` stayed on path, and the historical redirect failed
- `staging-evidence` — quote, finalize-intent, then create-payment-intent each returned HTTP 200 `success: true`, with a finalize hash and a `pi_` client secret

The report SHA is the commit GitHub built. On a pull request that is the merge commit, which must have the branch head as a parent. On `master` it is the pushed commit. Create the report from that green run; publication downloads the artifacts again and rejects any difference.

```bash
node scripts/release-safety/assemble-report.mjs <run-id> <full-sha>
RELEASE_SAFETY_REPORT=$PWD/release-safety-report.json npm run deploy:frontend:safe
```

A missing `gh` login, a failed run, a different SHA, or a hand-written report fails closed. There is no opt-in flag.

The deploy host needs `gh` authenticated with permission to read Actions runs and artifacts.

## Rollback

A real `WEBROOT` publish snapshots `index.html`, `sw.js`, `.htaccess`, and `release-manifest.json` in `../private-release-snapshots/<sha>`, which is outside `public_html`. After the files are copied, Apache must still serve `/search` and `/checkout` as HTTP 200 on those paths. If publication or that probe fails, the snapshot is restored. Hashed assets and uploads stay. The API is not restarted and the database is not written.

Remote rsync publication is refused because it cannot restore that snapshot.

## Isolated staging

`Isolated staging booking` fails closed until a separate origin and database exist. Do not point it at production.

Repository secrets, after that host is serving this branch:

- `RELEASE_STAGING_BASE_URL` — not `driftdwells.com` or `www.driftdwells.com`; the same origin must serve the site and `/api`
- `RELEASE_STAGING_STRIPE_MODE` — `test`
- `RELEASE_STAGING_ALLOW_PAYMENT_INIT` — `1`

`/api/health` on that origin must return `stripeMode: "test"`, derived from an `sk_test_` secret. The staging database must not be the production database. The test records successful responses in order and does not confirm a Stripe charge. Setting the secrets without those responses does not pass the job.

## Branch protection

`master` requires both check names. `enforce_admins` is currently false, so a repository admin can bypass them. Turning that on is an owner action:

```bash
gh api --method POST repos/WASOE/DrfitDwells.com/branches/master/protection/enforce_admins
```

Confirm with:

```bash
gh api repos/WASOE/DrfitDwells.com/branches/master/protection --jq '{checks:.required_status_checks.contexts,admins:.enforce_admins.enabled}'
```
