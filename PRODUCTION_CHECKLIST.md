# Production Deploy Checklist

Verify these before deploying.

## 1. Environment variables (server)

| Variable | Required | Notes |
|----------|----------|-------|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `ADMIN_JWT_SECRET` | Yes | For admin auth; use a strong random value |
| `STRIPE_SECRET_KEY` | Yes | Live secret key for payments (never in client/git) |
| `STRIPE_WEBHOOK_SECRET` | No* | For refund reconciliation; *recommended for prod – webhook to `/api/stripe/webhook`, subscribe to `refund.created`, `refund.updated`, `refund.failed` (optionally `charge.refunded`) |
| `NODE_ENV` | Yes | Set to `production` |
| `MULTI_UNIT_ENABLED` | Yes* | *Required for A-Frame / pooled inventory in prod: `true`. If unset with `NODE_ENV=production`, multi-unit stays **off**. |
| `MULTI_UNIT_TYPES` | Yes* | *For A-Frame only: `a-frame`. Comma-separated if multiple pooled types. Recommended even when using a single type so behavior is explicit. |
| `CORS_ORIGINS` | No | Comma-separated allowed origins; defaults to driftdwells.com in prod |
| `TRUST_PROXY` | No | Set to `1` when behind reverse proxy (for rate limiting IP) |
| `PORT` | No | Defaults to 5000 |
| `SMTP_URL` | Yes | For booking emails (see docs/email/DEPLOY_ENV.md) |
| `EMAIL_FROM` | No | Override default sender |
| `EMAIL_TO_INTERNAL` | No | Internal notification recipient |
| `CONTACT_EMAIL` | No | Support email in backend-generated emails (e.g. refunds); fallback: info@driftdwells.com |
| `APP_URL` | No | Base URL for links in emails (e.g. https://driftdwells.com) |

### OPS push (optional — default OFF until go-live)

Full runbook: [docs/ops-push/GO_LIVE_RUNBOOK.md](docs/ops-push/GO_LIVE_RUNBOOK.md)

| Variable | Required | Notes |
|----------|----------|-------|
| `WEB_PUSH_VAPID_PUBLIC_KEY` | For push | All three VAPID vars required together |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | For push | Server only — never commit |
| `WEB_PUSH_VAPID_SUBJECT` | For push | `mailto:…` or `https://…` |
| `OPS_PUSH_SCHEDULED_ENABLED` | No | `=1` to schedule arrival/cleaning jobs |
| `OPS_PUSH_SCHEDULER_WORKER_ENABLED` | No | `=1` to run worker tick/sweeper |

**One worker only:** enable `OPS_PUSH_SCHEDULER_WORKER_ENABLED=1` on a single process (integrated `server.js` **or** standalone `runOpsPushWorker.js`, not both). Multiple enabled workers risk duplicate job claims.

## 2. Client env (Vite, optional overrides)

| Variable | Purpose |
|----------|---------|
| `VITE_CONTACT_PHONE` | Override default +359 87 634 2540 |
| `VITE_CONTACT_EMAIL` | Override default info@driftdwells.com |
| `VITE_GMB_CABIN_MAPS_URL` | Override GMB Cabin Maps link |
| `VITE_GMB_VALLEY_MAPS_URL` | Override GMB Valley Maps link |
| `VITE_STRIPE_PUBLISHABLE_KEY` | **Required for payments** – Stripe publishable key (pk_live_*) |

## 3. Domain & URLs

- **Canonical domain**: `https://driftanddwells.com` (used in sitemap, robots, schema.org, Seo component)
- **Booking subdomain** (if different): `https://booking.driftdwells.com` – ensure CORS and iframe origin match where the main site embeds the booking portal

## 4. Static files

- `client/public/sitemap.xml` – must be served at `/sitemap.xml`
- `client/public/robots.txt` – must be served at `/robots.txt`
- Both reference `https://driftanddwells.com`

## 5. CORS & iframe

- Server CORS for embedded Craft iframe: `https://driftdwells.com` (see `server/server.js` `allowCraftOrigin`)
- If the embed parent is on a different domain, add it to CORS
- `client/src/pages/embedded/CraftEmbedded.jsx` posts messages to `https://driftdwells.com` – ensure this matches the parent

## 6. Pre-deploy commands

```bash
npm run build          # Must pass (includes generate:home-mobile-posters — see §6a)
npm run lint           # Must pass (in client/)
npm run check:i18n     # Must pass (in client/)
```

### 6a. Hard-reset production deploy (illoc @ VPS)

Canonical sequence used on `driftdwells.com` (DirectAdmin `public_html` + PM2 `driftdwells`):

```bash
cd /home/illoc/apps/driftdwells-booking-portal

git fetch origin
git reset --hard origin/master   # or origin/<branch> when shipping a feature branch
git rev-parse --short HEAD

npm install --legacy-peer-deps
rm -rf node_modules/.vite

# Client build — generate:home-mobile-posters runs HERE (inside client npm run build),
# after generate:hero-media and before validate:media / vite build.
# Script is idempotent; missing source JPEGs log a WARN and do not fail the build.
PRERENDER_SKIP=1 npm run build

# Optional explicit re-run (same as the build step; safe to repeat):
# cd client && npm run generate:home-mobile-posters && cd ..

rsync -av \
  --exclude='.htaccess' \
  client/dist/ \
  /home/illoc/domains/driftdwells.com/public_html/

cd server
npm install --legacy-peer-deps
cd ..

pm2 restart driftdwells --update-env
pm2 save
pm2 status driftdwells
```

**Where posters land:** `uploads/Videos/*-poster.avif|.webp` next to the existing JPEGs (served by Node `/uploads`, not copied by rsync of `client/dist/`).

## 7. Definition of ready

- [ ] Build passes  
- [ ] Lint passes  
- [ ] i18n checks pass  
- [ ] No unsafe production logs (all gated with `import.meta.env.DEV`)  
- [ ] `MONGODB_URI`, `ADMIN_JWT_SECRET`, `STRIPE_SECRET_KEY`, mail vars set in production  
- [ ] If A-Frame / multi-unit is live: `MULTI_UNIT_ENABLED=true` and `MULTI_UNIT_TYPES=a-frame` set explicitly  
- [ ] Canonical domain and CORS/iframe origin verified  
- [ ] Sitemap and robots.txt served at root  
- [ ] After homepage poster perf merge: `uploads/Videos/*-poster.avif` exist on the VPS (or accept JPEG-only fallback until `generate:home-mobile-posters` has run once)
