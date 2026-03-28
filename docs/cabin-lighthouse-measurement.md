# Measuring cabin detail LCP locally or on staging

Cabin pages need a real `GET /api/...` cabin payload and gallery URLs. The static Vite preview has no API unless you proxy to a backend.

## Option A: Staging + real cabin id

1. Pick a stable cabin URL from production or staging, e.g. `https://staging.example.com/cabin/<mongoId>`.
2. Run three mobile Lighthouse reports against that URL (same machine, same Chrome flags as home/search).

```bash
export URL="https://YOUR_STAGING/cabin/YOUR_CABIN_ID"
for i in 1 2 3; do
  npx lighthouse "$URL" --only-categories=performance \
    --screenEmulation.mobile=true --form-factor=mobile \
    --output=json --output-path="/tmp/lh-cabin-$i.json" \
    --chrome-flags="--headless --no-sandbox" --quiet
done
```

3. In each JSON, read `audits['lcp-discovery-insight']` and `audits['lcp-breakdown-insight']` for the LCP element and subparts.

## Option B: Local client + API

1. Run the API server with a seeded DB that includes at least one cabin with images.
2. Run Vite dev or preview with `/api` proxied to that server (see `client/vite.config.js` `server.proxy`).
3. Open `http://localhost:3000/cabin/<id>` and run Lighthouse against that origin.

## Option C: Scripted median

Parse three JSON outputs and take the median `audits['largest-contentful-paint'].numericValue` for regression tracking.
