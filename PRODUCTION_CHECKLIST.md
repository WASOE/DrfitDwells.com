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
| `CORS_ORIGINS` | No | Comma-separated allowed origins; defaults to driftdwells.com in prod |
| `TRUST_PROXY` | No | Set to `1` when behind reverse proxy (for rate limiting IP) |
| `PORT` | No | Defaults to 5000 |
| `SMTP_URL` | Yes | For booking emails (see docs/email/DEPLOY_ENV.md) |
| `EMAIL_FROM` | No | Override default sender |
| `EMAIL_TO_INTERNAL` | No | Internal notification recipient |
| `CONTACT_EMAIL` | No | Support email in backend-generated emails (e.g. refunds); fallback: info@driftdwells.com |
| `APP_URL` | No | Base URL for links in emails (e.g. https://driftdwells.com) |

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
npm run build          # Must pass
npm run lint           # Must pass (in client/)
npm run check:i18n     # Must pass (in client/)
```

## 7. Definition of ready

- [ ] Build passes  
- [ ] Lint passes  
- [ ] i18n checks pass  
- [ ] No unsafe production logs (all gated with `import.meta.env.DEV`)  
- [ ] `MONGODB_URI`, `ADMIN_JWT_SECRET`, `STRIPE_SECRET_KEY`, mail vars set in production  
- [ ] Canonical domain and CORS/iframe origin verified  
- [ ] Sitemap and robots.txt served at root  
