# OPS Push — Go-Live Runbook

Standalone OPS web push + durable inbox. Guest Message Automation (GMA) is separate.

## Commit chain

| Batch | Commit | Scope |
|-------|--------|-------|
| OPS-PUSH-1 | `beb61fa` | Platform: models, `sendOpsPush`, subscription API, SW |
| OPS-PUSH-2 | `6df3747` | Client subscribe UX, push health |
| OPS-PUSH-3 | `9099906` | Real-time event hooks |
| OPS-PUSH-4 | `c9c8478` | Scheduled jobs + worker |
| OPS-PUSH-5 | `6bb575f` | In-app notification center (bell/inbox) |

## Environment variables

### VAPID (required for real push + inbox rows from sends)

| Variable | Required | Notes |
|----------|----------|-------|
| `WEB_PUSH_VAPID_PUBLIC_KEY` | Yes | Exposed via `GET /api/ops/push-config` |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Yes | Server only — never commit |
| `WEB_PUSH_VAPID_SUBJECT` | Yes | `mailto:ops@…` or `https://driftdwells.com` |

Generate keys (one-time, off production):

```bash
cd server && npx web-push generate-vapid-keys
```

**Important:** When VAPID is unset, `sendOpsPush` returns before `OpsNotification` creation. Real-time hooks are safe no-ops, but **no new inbox rows** are created until VAPID is configured.

There is no separate `OPS_PUSH_SEND_ENABLED` flag — all three VAPID vars must be set.

### Scheduled push (default OFF)

| Variable | Values | Purpose |
|----------|--------|---------|
| `OPS_PUSH_SCHEDULED_ENABLED` | `1` to enable | Schedule/cancel jobs on booking lifecycle |
| `OPS_PUSH_SCHEDULER_WORKER_ENABLED` | `1` to enable | Worker tick + stale-claimed sweeper |

### Optional worker tuning

| Variable | Default |
|----------|---------|
| `OPS_PUSH_SCHEDULER_WORKER_TICK_MS` | `60000` |
| `OPS_PUSH_SCHEDULER_WORKER_SWEEPER_TICK_MS` | `120000` |
| `OPS_PUSH_SCHEDULER_WORKER_BATCH_SIZE` | `50` |
| `OPS_PUSH_SCHEDULER_WORKER_VISIBILITY_TIMEOUT_MS` | `300000` |
| `OPS_PUSH_SCHEDULER_WORKER_ID` | auto-generated |

### Worker deployment mode

**Recommended for current single PM2 API process:** integrated worker only.

- Set `OPS_PUSH_SCHEDULER_WORKER_ENABLED=1` on the main `server.js` process.
- **Do not** also run `node scripts/runOpsPushWorker.js` with the flag enabled.

**Split worker (multiple API instances only):**

- `OPS_PUSH_SCHEDULER_WORKER_ENABLED=0` on all API instances.
- One dedicated PM2 process: `node scripts/runOpsPushWorker.js` with flag `=1`.

**Warning:** Never enable the worker on more than one process — risks duplicate ticks/claims.

## Pre-go-live maintenance

### Index sync

Dry-run (read-only):

```bash
cd server
MONGODB_URI='…' node scripts/opsPushSyncIndexes.cjs
```

Apply:

```bash
cd server
ALLOW_PRODUCTION_OPS_PUSH_INDEX_SYNC=1 MONGODB_URI='…' node scripts/opsPushSyncIndexes.cjs --apply
```

Collections: `opspushsubscriptions`, `opsnotifications`, `opspushscheduledjobs`.

### Park obsolete cleaner GMA checkout-today rules

Superseded by OPS push `cleaning_checkout_day` (08:00 Sofia checkout day).

Dry-run:

```bash
cd server
MONGODB_URI='…' node scripts/parkCleanerGmaRulesForOpsPush.cjs
```

Apply:

```bash
cd server
ALLOW_PRODUCTION_GMA_PARK=1 MONGODB_URI='…' node scripts/parkCleanerGmaRulesForOpsPush.cjs --apply
```

Targets only:

- `cleaner_checkout_today_cabin`
- `cleaner_checkout_today_valley`

Does **not** touch prep rules, guest rules, `ops_alert_*` rules, or any templates. Does not delete rows.

## Production deployment checklist

1. Pull `master` at OPS-PUSH-5 or later (`6bb575f+`).
2. Set env vars on the server (VAPID first, then scheduled flags when ready).
3. `cd server && npm install` (includes `web-push` since PUSH-1).
4. Run index sync dry-run, then apply if needed.
5. `npm run build` (from repo root).
6. Restart PM2 API process.
7. Verify logs for `ops-push-worker` start or disabled message.
8. API smoke (OpsUser Bearer token required).
9. Real-device QA (below).
10. Optionally park cleaner GMA checkout-today rules after OPS push is verified.

### API smoke checks

```bash
TOKEN='…'
HOST='https://booking.driftdwells.com'

curl -s -H "Authorization: Bearer $TOKEN" "$HOST/api/ops/push-config"
curl -s -H "Authorization: Bearer $TOKEN" "$HOST/api/ops/push-subscriptions/mine"
curl -s -H "Authorization: Bearer $TOKEN" "$HOST/api/ops/notifications/unread-count"
```

Expected:

- `push-config`: `pushEnabled: true` and `vapidPublicKey` when VAPID set.
- `push-subscriptions/mine`: `{ subscriptions: [...] }` — no `keys` in response.
- `notifications/unread-count`: `{ unreadCount: N }`.

### Worker log checks

```bash
pm2 logs --lines 200 | grep -E 'ops-push-worker|ops-push-scheduler'
```

- Started: `"source":"ops-push-worker","phase":"start"`
- Disabled: `"phase":"disabled"` with `OPS_PUSH_SCHEDULER_WORKER_ENABLED is not '1'`

## Device QA checklist

### All roles (admin, operator, cleaner)

Prerequisites: HTTPS, valid OpsUser login (24-char ObjectId `actorId`), VAPID configured, fresh frontend build.

1. Log in to OPS.
2. Enable notifications from the push strip (if shown).
3. Confirm `GET /api/ops/push-subscriptions/mine` returns an active subscription.
4. Trigger a test event (e.g. manual reservation, checkout-day job).
5. Receive system push notification.
6. Tap notification → navigates to safe `/ops/...` path (SW sanitizes URL).
7. Header bell shows unread count; open dropdown → notification listed.
8. Click row → mark read + navigate + dropdown closes.
9. **Mark all read** → badge clears.
10. **Turn off** push → subscription removed.

### Install OPS as a web app

The PWA manifest launches at `/ops` with standalone display. Install while signed in on a real device.

#### Android (Chrome)

1. Open `https://driftdwells.com/ops` in Chrome.
2. Log in with your OpsUser account.
3. **Install app** (Chrome menu → Install app, or the install banner when offered).
4. Open Drift & Dwells **from the app icon** on the home screen.
5. Enable notifications from the OPS push strip.
6. Send a **test notification** (admin) or trigger a real OPS event.

- Permission prompt → Allow.
- Background push should appear when the app is closed (if the OS allows).

#### iOS 16.4+ (Safari)

iOS Web Push requires an installed Home Screen app. A normal Safari tab alone is **not** enough.

1. Open `https://driftdwells.com/ops` in Safari.
2. Tap **Share** → **Add to Home Screen**.
3. Open Drift & Dwells **from the Home Screen icon** (not the Safari tab).
4. Log in with your OpsUser account.
5. Enable notifications from the OPS push strip.
6. Send a **test notification** (admin) or trigger a real OPS event.

If permission denied: iOS Settings → Notifications → Drift & Dwells → enable.

### Known limitations

- **Android/Chrome/PWA delivery timing:** Web Push can still be delayed by Doze, battery saver, and OS notification settings — especially when the device is idle or the app is backgrounded. The OPS inbox `createdAt` timestamp is the **server-side send time** and is the source of truth for scheduler timing. `urgency: high` improves delivery priority but does **not** guarantee exact wall-clock system notification display.
- **Staff devices:** Install OPS as a PWA (`/ops`) and disable battery optimization for Drift & Dwells on Android if timely alerts are important.
- **Cleaner reservation deep-links:** notifications linking to `/ops/reservations/:id` may redirect cleaners to `/ops/cleaning` due to existing frontend module guards. Push and inbox still deliver; destination access is unchanged from pre-PUSH behavior.
- **Legacy env-admin login:** no bell/push — requires OpsUser record with valid ObjectId.

## Rollback

1. `OPS_PUSH_SCHEDULER_WORKER_ENABLED=0` — stop scheduled execution.
2. `OPS_PUSH_SCHEDULED_ENABLED=0` — stop scheduling new jobs.
3. Unset `WEB_PUSH_VAPID_*` vars — all sends become safe `vapid_not_configured` skips.
4. `pm2 restart <api-process>`
5. Inbox API remains safe (read-only). Existing `OpsNotification` rows stay readable.
6. Event hooks remain fire-and-forget no-ops when VAPID unset.

Scheduled job rows already in Mongo are not auto-deleted; with worker off they will not execute.

## Scheduled job types (reference)

| jobType | When | Audience |
|---------|------|----------|
| `arrival_reminder_admin` | 09:00 Europe/Sofia, day before check-in | Admins |
| `cleaning_checkout_day` | 08:00 Europe/Sofia on checkout day | Cleaners by `propertyKind` |
