# Build Enquiries — deployment & rollback

Feature branch: `feat/build-enquiry-batch1`. Do **not** merge until staging verification passes.

## Pre-deploy checklist

1. Production Mongo backup (mongodump or existing backup job).
2. Confirm SMTP env on API **and** worker hosts (`SMTP_HOST`/`SMTP_URL`, `EMAIL_FROM`, `ADMIN_EMAIL`).
3. Confirm `MONGODB_URI` (not local default) for worker when `NODE_ENV=production`.
4. Staging smoke: `/build` enquiry → Ops list/detail; worker tick with test addresses only.

## MongoDB indexes

Model: `BuildEnquiry` (`server/models/BuildEnquiry.js`).

Required keys (created via `BuildEnquiry.syncIndexes()` on deploy boot or one-off):

- unique `projectReference`
- unique `idempotencyKey`
- `{ contact.emailNormalized: 1, createdAt: -1 }`
- `{ status: 1, createdAt: -1 }`
- `{ emails.internal.status: 1, emails.internal.nextAttemptAt: 1 }`
- `{ emails.customer.status: 1, emails.customer.nextAttemptAt: 1 }`
- `{ isTest: 1 }`

One-off (staging/prod shell after deploy of code):

```bash
cd /path/to/app/server
node -e "require('dotenv').config(); const m=require('mongoose'); const {DEFAULT_MONGO_URI}=require('./config/dbDefaults'); (async()=>{ await m.connect(process.env.MONGODB_URI||process.env.MONGO_URI||DEFAULT_MONGO_URI); await require('./models/BuildEnquiry').syncIndexes(); console.log(await require('./models/BuildEnquiry').collection.indexes()); await m.disconnect(); })().catch(e=>{console.error(e); process.exit(1);});"
```

## Deploy order

1. Deploy API + client (feature code). Keep worker **disabled**.
2. Sync indexes (command above).
3. Verify SMTP from worker host (existing SMTP health tooling).
4. Start worker:

```bash
pm2 start ecosystem.config.cjs --only driftdwells-build-enquiry-email-worker --env production
pm2 set / restart with BUILD_ENQUIRY_EMAIL_WORKER_ENABLED=1
# or: pm2 restart driftdwells-build-enquiry-email-worker --update-env
```

Ensure API process leaves `BUILD_ENQUIRY_EMAIL_WORKER_ENABLED` unset/`0`.

5. Post-deploy verify:
   - Submit **test** enquiry from `/build` (non-customer email).
   - Confirm document in Mongo + Ops `/ops/build-enquiries`.
   - Confirm both email lanes reach `succeeded` (or retry then succeed).
   - Confirm Ops never shows `idempotencyKey` / SMTP `lastError`.

## Rollback

1. Stop worker: `pm2 stop driftdwells-build-enquiry-email-worker` (or set `BUILD_ENQUIRY_EMAIL_WORKER_ENABLED=0` and restart).
2. Redeploy previous API/client release (route `/api/public/build-enquiries` 404 is acceptable; existing Mongo docs remain).
3. Optional: leave collection; do **not** drop without backup review.
4. Revert PM2 ecosystem entry only if rolling back the whole release artifact.

## Env reference

| Variable | Where | Notes |
|---|---|---|
| `BUILD_ENQUIRY_EMAIL_WORKER_ENABLED` | Worker only | `1` to run |
| `BUILD_ENQUIRY_EMAIL_WORKER_TICK_MS` | Worker | default 15000 |
| `BUILD_ENQUIRY_EMAIL_WORKER_BATCH_SIZE` | Worker | default 20 |
| `BUILD_ENQUIRY_EMAIL_WORKER_VISIBILITY_TIMEOUT_MS` | Worker | claim lease |
| `MONGODB_URI` / `MONGO_URI` | Worker + API | required in production |
| `ALLOW_DEFAULT_LOCAL_MONGO_IN_PRODUCTION` | Worker | must stay unset in prod |
| SMTP / `EMAIL_FROM` / `ADMIN_EMAIL` | API + Worker | controlled senders only |
