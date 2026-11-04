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

A real `WEBROOT` publish snapshots `index.html`, `sw.js`, `.htaccess`, and `release-manifest.json` in `../private-release-snapshots/<sha>`, which is outside `public_html`. After the files are copied, Apache must still serve `/search` and `/checkout` as HTTP 200 on those paths. If publication or that probe fails, the snapshot is restored. Hashed assets and uploads stay. The API is not restarted and the database is not written.

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
