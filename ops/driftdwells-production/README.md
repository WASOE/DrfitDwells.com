# Drift & Dwells — Production Ops

Repository-backed operational assets for the **main booking portal** (`driftdwells.com` / `booking.driftdwells.com`).

## Production context

| Item | Value |
|------|-------|
| App path | `/home/illoc/apps/driftdwells-booking-portal` |
| Service user | `illoc` |
| PM2 app name | `driftdwells` |
| Backend env file | `/home/illoc/apps/driftdwells-booking-portal/server/.env` |
| MongoDB env keys | `MONGODB_URI` (primary), `MONGO_URI` (fallback) |
| Backup root | `/home/illoc/backups/driftdwells/` |

The client build (`cd client && npm run build`) requires
`VITE_STRIPE_PUBLISHABLE_KEY` at build time in `pk_live_...` or `pk_test_...`
format. Supply the appropriate publishable key in the build environment; a
server-only Stripe configuration cannot populate an already-built client.
The build rejects missing or malformed keys before generating assets. Local
development and tests do not require this variable.

## Directory layout

```
ops/driftdwells-production/
├── README.md
├── BACKUP.md                 # Full backup/recovery runbook
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

## Installed paths (after `install-backup.sh`)

Stable copies (not symlinks) in `/home/illoc/bin/`:

| File | Role |
|------|------|
| `read-mongodb-uri.sh` | Env URI loader (sourced by other scripts) |
| `driftdwells-backup.sh` | Daily backup job |
| `driftdwells-restore-verify.sh` | Restore verification |

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
