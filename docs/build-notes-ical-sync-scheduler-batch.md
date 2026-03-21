## Automatic iCal Sync Scheduling Batch (Production Notes)

### What triggers sync automatically
- On server startup, the backend starts an in-process scheduler for Airbnb iCal sync when explicitly enabled via env.
- The scheduler periodically scans `CabinChannelSyncState` records where `channel="airbnb_ical"` and `feedUrl != null`.
- For each configured cabin+channel, the scheduler calls the existing importer entry point (`server/services/ops/ingestion/icalIngestionService.js`) indirectly via the existing ingestion logic (no importer redesign).

### Default interval (production)
- Default schedule interval: `OPS_ICAL_SYNC_INTERVAL_MS` (defaults to `900000` ms = 15 minutes).

### Retry/backoff policy
- Default transient retry behavior is controlled by:
  - `OPS_ICAL_SYNC_RETRY_MAX` (defaults to `2`)
  - `OPS_ICAL_SYNC_RETRY_DELAY_MS` (defaults to `60000` ms)
- Retries are only attempted when the importer returns `outcome: "failed"` (e.g., fetch/unreachable failures).
- Delay uses a simple increasing backoff: `retryDelayMs * attemptIndex`.
- If all attempts fail, the final attempt’s importer-written sync evidence remains honest (no fake success).

### Per-cabin/channel safety controls
- In-progress protection: the scheduler maintains an in-memory lock per `cabinId + channel` to prevent overlapping runs for the same feed.
- Cooldown protection: after a run completes, the scheduler applies a cooldown (configurable via `OPS_ICAL_SYNC_COOLDOWN_MS` / `OPS_ICAL_SYNC_FAILURE_COOLDOWN_MS`) to avoid repeatedly hammering a failing feed.

### Manual/internal route compatibility
- The existing internal route `POST /api/internal/sync/airbnb-ical/run` remains available.
- Manual runs respect the same in-progress protection; if a run is already active for the same cabin+channel, the route returns `409` with an explicit `sync_in_progress` errorType.

### Multi-instance limitations (important)
- This batch uses an in-process scheduler + in-memory locks. It is **single Node-process safe**, but **not DB-distributed lock safe**.
- If multiple app instances are deployed and all enable the scheduler env, they may run the same cabin+channel concurrently.
- If multi-instance concurrency needs to be prevented globally, we should add a DB-level lease/lock for `cabinId+channel` (out of scope for this batch).

### Operational visibility
- Scheduler enable/disable state and runtime stats are exposed in ops readiness payload via `server/services/ops/readModels/healthReadModel.js` under `calendarSyncScheduler`.
- Logs include scheduler startup and per-tick failure details.

