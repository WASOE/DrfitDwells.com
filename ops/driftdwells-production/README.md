# Drift & Dwells — Production Ops

Repository-backed operational assets for the **main booking portal** (`driftdwells.com` / `booking.driftdwells.com`).

## Production context

| Item | Value |
|------|-------|
| App path | `/home/illoc/apps/driftdwells-booking-portal` |
| Service user | `illoc` |
| Production API name | `driftdwells-production-<short-sha>` (one numeric PM2 ID) |
| Backend env file | `/home/illoc/apps/driftdwells-booking-portal/server/.env` |
| MongoDB env keys | `MONGODB_URI` (primary), `MONGO_URI` (fallback) |
| Backup root | `/home/illoc/backups/driftdwells/` |

The client build (`cd client && npm run build`) requires
`VITE_STRIPE_PUBLISHABLE_KEY` at build time in `pk_live_...` or `pk_test_...`
format. Supply the appropriate publishable key in the build environment; a
server-only Stripe configuration cannot populate an already-built client.
The build rejects missing or malformed keys before generating assets. Local
development and tests do not require this variable.

Manual reservation inventory uses the existing public Cabin and active Unit
APIs for canonical parent/type/unit identities and the authenticated Ops calendar
for date-specific occupancy. Unit blocked days use Europe/Sofia and checkout is
exclusive. Occupied or blocked units cannot be selected; availability failures
block submission. Calendar-origin reservations keep their explicit unit, and the
backend remains the final availability/unique-night-claim authority. No automatic
unit assignment or request retries are performed.

Ops Calendar and accommodation details normalize multi-unit parent Cabin IDs
and CabinType IDs to the same canonical type and physical inventory. Booking
queries use the type; availability blocks and render identity retain the parent.
Cancelled, archived and test bookings are excluded from Calendar occupancy.
Calendar bars are event visibility, not a replacement for authoritative booking
availability or unique unit-night claims.

### Reservation reassignment

The single-cabin reservation **Reassign** dialog loads named destinations from
`GET /api/ops/reservations/:id/rebook-candidates` (admin reassignment permission).
It checks the original dates, capacity, inventory conflicts and night claims
without reserving anything. It excludes the current accommodation, unavailable
destinations and unsupported downgrades. Prices and transferable coverage reuse
the REBOOK evidence services; unverifiable evidence blocks the list.

Confirmation uses the existing ownership-protected `actions/rebook` command,
not legacy `actions/reassign`. Equal-price changes and explicitly approved full
complimentary upgrades are supported; no payment is collected. External channel
holds require separate acknowledgement. The command repeats availability,
pricing and financial checks. Dates, guests and original financial records are
preserved; the original reservation links to its replacement. No guest
notification is requested. Same-product physical unit moves still use **Move
Unit** / REALLOCATE.

After an attempted request, the dialog freezes its intent and reuses the same
idempotency key for retries. An uncertain or reconciliation result is not a
successful reassignment. Refresh/review history before starting another change.
Successful changes reload the source detail and link to the replacement and
calendar (which fetches current inventory on navigation). Never test production
by reassigning an actual reservation without explicit authorization.

Run `cd client && node scripts/verify-manual-reservation-mobile.mjs` against a
local frontend on port 3017 (or set `TEST_ORIGIN`) for the 432px browser check.
It intercepts every API request with fixtures and never creates a real booking.

## Directory layout

```
ops/driftdwells-production/
├── README.md
├── BACKUP.md                 # Full backup/recovery runbook
├── PAYMENT_CONTRACT_MONITOR.md
├── payment-contract-monitor.mjs
├── paymentContractMonitorLib.mjs
├── install-backup.sh         # Copy scripts → ~/bin (stable; re-run after git pull)
├── logrotate-driftdwells-pm2
├── backup/
│   ├── read-mongodb-uri.sh
│   ├── driftdwells-backup.sh
│   └── driftdwells-restore-verify.sh
└── systemd/
    ├── driftdwells-backup.service
    └── driftdwells-backup.timer   # daily 03:45 UTC
```

## Payment contract monitor

Named-process and checkout-capability checks live in [PAYMENT_CONTRACT_MONITOR.md](./PAYMENT_CONTRACT_MONITOR.md). The incident runbook is [docs/runbooks/payment-contract-incident.md](../../docs/runbooks/payment-contract-incident.md). The monitor script does not install or edit systemd units.

The script's built-in default API role is the historical name `driftdwells`. This document's production API name is `driftdwells-production-<short-sha>`. Before using the monitor against production, pass `--require-role` for that live API name and for `driftdwells-confirmation-worker`. Do not replace the production API name in the table above.

## Installed paths (after `install-backup.sh`)

Stable copies (not symlinks) in `/home/illoc/bin/`:

| File | Role |
|------|------|
| `read-mongodb-uri.sh` | Env URI loader (sourced by other scripts) |
| `driftdwells-backup.sh` | Daily backup job |
| `driftdwells-restore-verify.sh` | Restore verification |
| `ensure-shared-uploads.cjs` | Link every release at the persistent uploads store |
| `driftdwells-deploy-api-guarded.cjs` | Guarded API deploy; links uploads before verification |

Scripts load `read-mongodb-uri.sh` from the same directory via `BASH_SOURCE`. Re-run `install-backup.sh` after git pull when backup scripts change.

Systemd unit runs `/home/illoc/bin/driftdwells-backup.sh` as `illoc`.

## Quick start

```bash
cd /home/illoc/apps/driftdwells-booking-portal
bash ops/driftdwells-production/install-backup.sh
/home/illoc/bin/driftdwells-backup.sh
/home/illoc/bin/driftdwells-restore-verify.sh
```

Enable scheduled backups: see [BACKUP.md](./BACKUP.md).

## Scope

- **In scope:** backup, restore verification, logrotate, systemd timer
- **Out of scope:** application code, DB migrations, seed scripts, `.env` changes

## Log retention and local monitoring

`logrotate-driftdwells-pm2` retains 14 compressed generations of application
logs (daily or above 10 MiB) and seven compressed generations of the PM2
daemon log (above 10 MiB). The supplemental five-minute systemd timer checks
only this rule, sharing the default logrotate state/lock with the daily
system timer. Timestamped archive names support more than one rotation per
day. Existing historical archives are retained; do not delete diagnostics
during an incident. `copytruncate` preserves open file descriptors and does
not restart processes; as with all copytruncate policies, a small
copy/truncate race can lose concurrent log lines. Preserve a protected
compressed diagnostic excerpt before an incident rotation.

Install `monitor.cjs` as `/home/illoc/bin/driftdwells-monitor.cjs` and the
four `systemd/driftdwells-{monitor,logrotate}.{service,timer}` files under
`/etc/systemd/system/`. Install the logrotate rule under `/etc/logrotate.d/`,
validate it with `logrotate --debug`, reload systemd, then enable/start both
timers. No application process restart is needed. The monitor checks every
minute for failed DB-connected API health, process count/name drift,
restart/PID changes, stopped/disappeared processes, error-log growth above
5 MiB/minute, two EADDRINUSE lines or three reconciliation failures within
five minutes. Reads are incremental and bounded to 256 KiB per log per tick;
overflow alerts rather than silently skipping a burst.

Alerts are structured, credential-free journal errors and a failed systemd
service; inspect `journalctl -u driftdwells-monitor` and
`systemctl status driftdwells-monitor`. This is **local monitoring only**, not
an external pager. State is private under
`/home/illoc/.local/state/driftdwells-monitor/`. There is no new paid service,
and no automatic process restart or payment repair.

## Application index maintenance

API startup disables Mongoose index and collection auto-creation. It does not
synchronize indexes or run migrations. The `Review` model's declared indexes
are expected to be provisioned and retained by the database operator; use a
reviewed, explicit index operation when setting up a new database or changing
those definitions.

External-hold CleaningRecord creation depends on the explicitly provisioned
unique partial index
`availabilityBlockId_1_cleaningDate_1_external_hold_unique` on
`{ availabilityBlockId: 1, cleaningDate: 1 }`. Its filter includes only rows
where `sourceKind` is `external_hold`, `availabilityBlockId` is an ObjectId,
and `cleaningDate` is a Date, with simple collation. It is an additive
constraint: the migration does not remove the legacy booking index or modify
CleaningRecord documents. Incomplete legacy rows outside that filter are not
rewritten or indexed.

Run `cd server && npm run migrate:cleaning-record-indexes` for a read-only
preflight. The preflight reports current index definitions/collations and fails
closed on duplicate keys in the partial-index scope, non-external records in
that scope, mismatched external-hold identities, or unexpected unique index
definitions. Review the report and obtain explicit operational approval before
applying with
`cd server && npm run migrate:cleaning-record-indexes -- --apply`.
Never run this migration as part of API deployment or startup.

The normal application rollback is code-only; retain the additive unique index
because it is backward-compatible and preserves the external-hold race
protection. Only if index removal is essential, first quiesce every
CleaningRecord external-hold writer and verify no writes can resume, then drop
only the named index with
`db.cleaningrecords.dropIndex("availabilityBlockId_1_cleaningDate_1_external_hold_unique")`.
Removing it restores the duplicate-creation risk and must not be done while any
version of the find/create writer is active.

## Refunded finalized checkout reconciliation

A captured PaymentIntent remains `succeeded` after a refund. Its canonical
Payment ledger must retain `partial` or `refunded`; never replay payment-success
ingestion to make this ledger `paid` again.

The reconciler recognizes a subsequent refund only after normal canonical
PaymentIntent/quote/intent/amount/currency/date/entity verification passes,
all session/booking/job/payment identities agree, durable finalization and
confirmation are complete, and the expanded Stripe charge confirms capture
and the matching refund state without a dispute. It resolves only obsolete
`PAYMENT_RECORD_NOT_PAID` / `PAYMENT_RECORD_MISSING_OR_NOT_PAID` alerts for that
same checkout. It does not change payments, bookings, jobs or confirmation
delivery. Missing, conflicting, disputed or unfinalized evidence stays
fail-closed. The explicit CLI remains dry-run by default; both it and the
dedicated reconciler disable automatic index and collection creation.

Deploy a reconciler-only fix by replacing only its numeric PM2 process target
with a verified release and preserved protected environment. Do not restart the
API or other workers for this change. Keep the previous worker release and
protected PM2 environment as rollback material; never run old and new
reconcilers concurrently.

## Guarded backend deployment

There is no backend CI deployment workflow in this repository. The frontend
publisher is separate and does not restart PM2. Use
`deploy-api-guarded.cjs` for future API releases; never restart the legacy
shared `driftdwells` name or restart/reload all PM2 processes.

1. Run focused application regressions and commit the release. Package that
   exact commit with
   `node ops/driftdwells-production/package-api-release.cjs <full-sha> <artifact-directory>`.
   This includes `server/`, root `shared/`, operational assets and a sidecar
   manifest of Git blob hashes. Transfer and checksum both artifacts through
   the authorized release channel, extract into a new isolated release, and
   retain the sidecar manifest. Copy the protected server environment without
   printing it and provision dependencies through the established release
   flow. Do not modify the live release.
2. Create a private (0600) JSON plan with `current`, `candidate` and `rollback`
   objects, each containing `id`, `root`, `sha` and `manifest`. Use full commit
   SHAs and absolute paths. `current.id` is the live API's numeric PM2 ID;
   probe IDs are initially null. The rollback release must be independently
   index-safe and pass the same booking/Ops checks, not merely be an old
   directory. Normally retain the currently healthy release as rollback.
   Keep all release directories, manifests and protected environments through
   the rollback window.
3. Supply an existing authorized admin token through `OPS_VERIFY_TOKEN` in a
   protected environment (never a command-line argument or printed output).
   Run `node deploy-api-guarded.cjs <plan> --candidate`, then record its numeric
   ID in the plan. Run with `--rollback` and record that ID as well. Both
   probe commands verify artifact hashes and startup-index regressions
   **before launch**, disable all nine API worker/scheduler flags explicitly,
   bind only `127.0.0.1:5001` / `:5002`, verify release/DB health/public booking/
   Ops readiness, and remove only the probe they created if a gate fails.
   They never save PM2 or touch the live API.
4. Run `node deploy-api-guarded.cjs <plan>` for read-only preflight. It requires
   exactly the three specified API processes, five distinct online dedicated
   workers, single PID-owned listeners, matching SHA/file hashes/script/cwd
   (including `/proc` cwd), production environments, disabled API runtimes,
   loopback probes and authenticated endpoint checks. Probes must have all nine
   flags off; the live API must have the five API-runtime scheduler flags off
   and may inherit the four dedicated-worker flags from the shared `.env` only
   because release verification rejects any API entrypoint that starts those
   workers. Unverifiable listener
   ownership, conflicting processes or any gate failure blocks cutover.
5. Only with operational authorization, add `--cutover`. A fresh protected
   PM2/environment/plan checkpoint is created first. Only the specified
   numeric API/probe IDs are stopped. One uniquely named production API is
   started from the candidate release on port 5000. The command verifies its
   exact release handshake, one listener, DB-connected health, configuration,
   checkout capabilities, public availability, Ops session/readiness and
   critical errors, then repeats these gates for two minutes and confirms
   that all five worker PIDs/restart counts are unchanged. These are GET-only
   checks: no bookings, persistent quote endpoint, confirmations or payments
   are created. Application-specific policy/quote regressions remain required
   before packaging.
6. Only after these gates pass are stopped API/probe entries removed and
   `pm2 save` run, with the dump set to 0600. A critical failure instead stops
   the newly created API by numeric ID and starts the independently verified
   rollback release on port 5000. The rollback must pass identity, listener,
   endpoint and worker gates before its PM2 configuration can be saved.
   Failed recovery is surfaced as a hard blocker; no automatic reboot occurs.

The guarded command deliberately requires a fresh plan and existing Ops
authorization; it does not guess a production target, provision indexes,
run migrations, modify payment states or change the five dedicated workers.
Keep `/home/illoc/.pm2/dump.pm2` private and verify the enabled
`pm2-illoc.service` uses that PM2 home and `pm2 resurrect`. Do not test reboot
recovery by rebooting production without separate approval.
