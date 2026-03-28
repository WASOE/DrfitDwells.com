# Production edge: caching and compression

Use this when configuring CDN (e.g. Cloudflare), reverse proxy (nginx), or static hosting. App code cannot fix wrong `Cache-Control` at the edge.

## Fingerprinted assets (`/assets/*` or hashed filenames)

- **Goal:** `Cache-Control: public, max-age=31536000, immutable`
- **Why:** Vite emits content-hashed filenames; long TTL is safe and improves repeat visits.
- **Verify:** Response headers for a built JS/CSS file from production; ensure nothing strips `immutable`.

## HTML (document responses)

- **Goal:** short TTL (e.g. minutes) or `no-cache` with revalidation, **not** year-long cache for `index.html`.
- **Why:** Users must get new app shells after deploys.

## Images and media under `/media/*`, `/uploads/*`

- Fingerprinted or versioned files: same as assets (long TTL + `immutable` if you control filenames).
- User-uploaded paths without hashes: use a shorter TTL or cache-busting query params from the app.

## Compression

- **Brotli** for `text/html`, `text/css`, `application/javascript`, `image/svg+xml`, JSON where applicable.
- **gzip** as fallback for clients without Brotli.
- **Verify:** `Content-Encoding: br` (or `gzip`) on HTML/JS/CSS in production.

## Overrides

- Confirm the CDN or host is **not** overriding your desired headers with a global “4h TTL” or similar rule.
- PageSpeed “cache TTL” warnings often point here, not to Vite config.

## Optional checks

- HTTP/2 or HTTP/3 enabled.
- HSTS and security headers per your policy (separate from LCP).
