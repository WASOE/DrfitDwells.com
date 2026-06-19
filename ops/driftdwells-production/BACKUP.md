# Drift & Dwells Production Backup

Ops-only backup system for the main booking app on `driftdwells.com`. This does **not** change application code, schema, or runtime behavior.

## What is backed up

Each backup set includes **both** pillars required for recovery:

| Component | Source | Artifact |
|-----------|--------|----------|
| **MongoDB** | Production database (name parsed from env URI) | `mongo/driftdwells-mongo-YYYYMMDD-HHMMSS.gz` (`mongodump --gzip --archive`) |
| **Uploads** | `/home/illoc/apps/driftdwells-booking-portal/uploads` | `uploads/driftdwells-uploads-YYYYMMDD-HHMMSS.tar.gz` |
| **Integrity** | SHA-256 of both files | `checksums.sha256` |
| **Metadata** | Safe fields only (no secrets) | `manifest.txt` |

Backup sets are stored under:

- **Daily:** `/home/illoc/backups/driftdwells/daily/YYYYMMDD-HHMMSS/`
- **Weekly (Sunday UTC):** copy of that day’s set → `/home/illoc/backups/driftdwells/weekly/YYYYMMDD-HHMMSS/`

Manual backups you create under `/home/illoc/backups/driftdwells/manual/` are **never** deleted by retention.

## What is not backed up

- `.env` / secrets (back up separately via your secret manager or encrypted offline store)
- `client/dist/` (rebuild from git + `npm run build`)
- Stripe dashboard data (external source of truth for payments — reconcile after restore)
- SMTP / email provider logs
- PM2 logs (optional; see logrotate config)
- Git repository (use GitHub as source of truth)

## Disk space warning

Uploads are **~309 MB** today and grow with cabin admin images and media. Each daily set duplicates uploads until retention prunes old sets.

Plan for roughly:

- **Mongo dump size** (varies with bookings)
- **+ ~309 MB uploads** per retained daily set
- **× up to 14 daily + 8 weekly** sets before pruning

Monitor with:

```bash
du -sh /home/illoc/backups/driftdwells
df -h /home/illoc
```

## Retention policy

| Tier | Location | Retention |
|------|----------|-----------|
| Daily | `daily/` | 14 days |
| Weekly | `weekly/` | 8 weeks (56 days) |
| Manual | `manual/` | Never auto-deleted |

On **Sunday UTC**, the successful daily set is copied into `weekly/`.

## Install scripts (production host)

From the repo as user `illoc`. Install **copies** scripts into `/home/illoc/bin/` (mode `750`) so git pulls do not silently change the live backup job. Re-run after updating backup scripts in git.

```bash
cd /home/illoc/apps/driftdwells-booking-portal
bash ops/driftdwells-production/install-backup.sh
```

## Disk preflight

Before each backup, `driftdwells-backup.sh` checks free space under `/home/illoc/backups/driftdwells`. Default minimum: **2 GB** (`2097152` KB).

Override:

```bash
DRIFTDWELLS_BACKUP_MIN_FREE_KB=3145728 /home/illoc/bin/driftdwells-backup.sh   # 3 GB example
```

If free space is below the threshold, the backup exits non-zero without printing secrets.

Then install systemd timer (sudo):

```bash
sudo cp ops/driftdwells-production/systemd/driftdwells-backup.service /etc/systemd/system/
sudo cp ops/driftdwells-production/systemd/driftdwells-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now driftdwells-backup.timer
```

Optional PM2 log rotation (sudo):

```bash
sudo cp ops/driftdwells-production/logrotate-driftdwells-pm2 /etc/logrotate.d/driftdwells-pm2
```

## Manual backup command

```bash
/home/illoc/bin/driftdwells-backup.sh
```

Or before a deploy:

```bash
/home/illoc/bin/driftdwells-backup.sh && echo "backup ok"
```

Copy a set to `manual/` before major changes:

```bash
cp -a /home/illoc/backups/driftdwells/daily/YYYYMMDD-HHMMSS \
  /home/illoc/backups/driftdwells/manual/pre-deploy-YYYYMMDD-HHMMSS
```

## Enable / inspect timer

```bash
sudo systemctl enable --now driftdwells-backup.timer
systemctl list-timers driftdwells-backup.timer
```

## Trigger backup immediately (via systemd)

```bash
sudo systemctl start driftdwells-backup.service
sudo journalctl -u driftdwells-backup.service -n 50 --no-pager
```

## Restore verification command

Verifies checksums, restores Mongo **only** into `driftdwells_restore_test`, compares collection counts with production, and validates uploads tar **without extracting to production**.

Latest daily set:

```bash
/home/illoc/bin/driftdwells-restore-verify.sh
```

Explicit set:

```bash
/home/illoc/bin/driftdwells-restore-verify.sh /home/illoc/backups/driftdwells/daily/YYYYMMDD-HHMMSS
```

Keep test DB for inspection:

```bash
KEEP_RESTORE_TEST_DB=true /home/illoc/bin/driftdwells-restore-verify.sh
```

Collections compared: `bookings`, `payments`, `giftvouchers`, `cabins`, `availabilityblocks`, `opsusers`, `reviews`, `guests`, `promocodes`, `paymentfinalizations`.

## Recovery principles

1. **Never restore Mongo directly over production.** Always restore to `driftdwells_restore_test` first and verify counts.
2. **Never extract uploads backup over production `uploads/` during verification.** Verification uses `tar -tzf` only.
3. **Restore Mongo + uploads together** — cabin documents reference `/uploads/...` paths on disk.
4. After a real incident, reconcile payments with Stripe before declaring recovery complete.
5. Re-run iCal sync if availability blocks may be stale.

## Stop conditions

Do **not** rely on backups or proceed with destructive recovery if:

- Backup artifacts are empty or checksum verification fails
- Disk is too full to complete a new backup set
- `mongodump` / `mongorestore` tools are missing
- Restore verification count mismatch persists across two backup sets
- You only have Mongo **or** uploads, not both

## Rollback

If a new backup script version misbehaves:

1. Disable timer: `sudo systemctl disable --now driftdwells-backup.timer`
2. Restore previous script symlinks from git checkout
3. Re-run `install-backup.sh`
4. Manual backup still works independently of systemd

Existing backup sets under `daily/`, `weekly/`, and `manual/` remain valid regardless of script version.

## Warnings

- **Never run seed scripts** (`npm run seed`, `seedDatabase.js`, etc.) against production.
- **Never restore over production** database or extract uploads tar into production during verification.
- **Never `source` `.env`** in interactive shells — ops scripts read it internally without printing secrets.
- **Never commit or log** `MONGODB_URI`, Stripe keys, SMTP credentials, or JWT secrets.
- Backups are **not** a substitute for off-server copies — plan Phase 2 replication (S3/rclone) separately.

## Scripts

| File | Purpose |
|------|---------|
| `backup/read-mongodb-uri.sh` | Load URI from env file (source only; no stdout) |
| `backup/driftdwells-backup.sh` | Create daily (+ weekly Sunday) backup set |
| `backup/driftdwells-restore-verify.sh` | Verify latest or explicit backup set |
| `install-backup.sh` | Symlink scripts into `/home/illoc/bin/` |

See also [README.md](./README.md).
