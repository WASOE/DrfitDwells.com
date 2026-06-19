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
