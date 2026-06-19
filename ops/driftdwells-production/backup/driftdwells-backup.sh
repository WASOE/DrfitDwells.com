#!/usr/bin/env bash
set -euo pipefail

# Drift & Dwells production backup — MongoDB archive + uploads tarball.
# Must run as user illoc. Never prints secrets.

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=read-mongodb-uri.sh
source "${SCRIPT_DIR}/read-mongodb-uri.sh"

readonly APP="/home/illoc/apps/driftdwells-booking-portal"
readonly BACKUP_ROOT="/home/illoc/backups/driftdwells"
readonly DAILY_ROOT="${BACKUP_ROOT}/daily"
readonly WEEKLY_ROOT="${BACKUP_ROOT}/weekly"
readonly MANUAL_ROOT="${BACKUP_ROOT}/manual"

readonly DAILY_RETENTION_DAYS=14
readonly WEEKLY_RETENTION_DAYS=56
readonly DEFAULT_MIN_FREE_KB=2097152 # 2 GB

# Override with DRIFTDWELLS_BACKUP_MIN_FREE_KB (kilobytes) if needed.

log() {
  printf '[driftdwells-backup] %s\n' "$*"
}

die() {
  printf '[driftdwells-backup] ERROR: %s\n' "$*" >&2
  exit 1
}

require_user_illoc() {
  if [[ "$(id -un)" != "illoc" ]]; then
    die "must run as user illoc (current: $(id -un))"
  fi
}

require_commands() {
  local cmd
  for cmd in mongodump tar sha256sum du df find date cp mkdir chmod; do
    command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
  done
  if ! tar --help 2>/dev/null | grep -q 'gzip'; then
    if ! command -v gzip >/dev/null 2>&1; then
      die "tar gzip support or gzip command required"
    fi
  fi
}

human_size() {
  du -h "$1" 2>/dev/null | awk '{print $1}'
}

non_empty_file() {
  local f="$1"
  [[ -f "$f" ]] && [[ -s "$f" ]]
}

check_disk_space() {
  local min_kb avail_kb

  min_kb="${DRIFTDWELLS_BACKUP_MIN_FREE_KB:-$DEFAULT_MIN_FREE_KB}"
  if [[ ! "$min_kb" =~ ^[0-9]+$ ]] || [[ "$min_kb" -lt 1 ]]; then
    die "DRIFTDWELLS_BACKUP_MIN_FREE_KB must be a positive integer (kilobytes)"
  fi

  mkdir -p "$BACKUP_ROOT"
  avail_kb="$(df -Pk "$BACKUP_ROOT" | awk 'NR==2 {print $4}')"
  if [[ -z "$avail_kb" || ! "$avail_kb" =~ ^[0-9]+$ ]]; then
    die "could not determine free disk space for ${BACKUP_ROOT}"
  fi

  if (( avail_kb < min_kb )); then
    die "insufficient disk space under ${BACKUP_ROOT}: ${avail_kb} KB free, need at least ${min_kb} KB (adjust DRIFTDWELLS_BACKUP_MIN_FREE_KB)"
  fi

  log "disk preflight ok: ${avail_kb} KB free (minimum ${min_kb} KB)"
}

prune_old_sets() {
  local root="$1"
  local label="$2"
  local max_days="$3"
  local dir

  # Retention applies only to daily/ weekly timestamp directories — never manual/.
  if [[ ! -d "$root" ]]; then
    return 0
  fi

  while IFS= read -r -d '' dir; do
    log "retention: removing ${label} backup set $(basename "$dir") (older than ${max_days} days)"
    rm -rf "$dir"
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -mtime "+${max_days}" -print0 2>/dev/null || true)
}

main() {
  local ts backup_set mongo_dir uploads_dir
  local mongo_file uploads_file manifest checksums
  local mongo_size uploads_size

  require_user_illoc
  require_commands
  check_disk_space

  if [[ ! -d "$APP/uploads" ]]; then
    die "uploads directory missing: ${APP}/uploads"
  fi

  drift_load_mongodb_uri || die "failed to load MongoDB URI from env file"

  ts="$(date -u +%Y%m%d-%H%M%S)"
  backup_set="${DAILY_ROOT}/${ts}"
  mongo_dir="${backup_set}/mongo"
  uploads_dir="${backup_set}/uploads"
  mongo_file="${mongo_dir}/driftdwells-mongo-${ts}.gz"
  uploads_file="${uploads_dir}/driftdwells-uploads-${ts}.tar.gz"
  manifest="${backup_set}/manifest.txt"
  checksums="${backup_set}/checksums.sha256"

  log "starting backup set ${ts}"

  mkdir -p "$mongo_dir" "$uploads_dir" "$WEEKLY_ROOT" "$MANUAL_ROOT"
  chmod 700 "$BACKUP_ROOT" "$DAILY_ROOT" "$WEEKLY_ROOT" "$MANUAL_ROOT" 2>/dev/null || true
  chmod 700 "$backup_set" "$mongo_dir" "$uploads_dir"

  log "mongodump archive -> $(basename "$mongo_file")"
  mongodump --quiet --uri="$DRIFTDWELLS_MONGODB_URI" --gzip --archive="$mongo_file"

  if ! non_empty_file "$mongo_file"; then
    die "mongo backup file missing or empty: $mongo_file"
  fi

  log "uploads tar -> $(basename "$uploads_file")"
  tar -czf "$uploads_file" -C "$APP" uploads

  if ! non_empty_file "$uploads_file"; then
    die "uploads backup file missing or empty: $uploads_file"
  fi

  mongo_size="$(human_size "$mongo_file")"
  uploads_size="$(human_size "$uploads_file")"

  (
    cd "$backup_set"
    sha256sum "mongo/$(basename "$mongo_file")" "uploads/$(basename "$uploads_file")" > "$checksums"
  )

  cat >"$manifest" <<EOF
timestamp=${ts}
timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
app_path=${APP}
mongo_backup_file=mongo/$(basename "$mongo_file")
uploads_backup_file=uploads/$(basename "$uploads_file")
mongo_backup_size=${mongo_size}
uploads_backup_size=${uploads_size}
backup_set_path=${backup_set}
host=$(hostname -f 2>/dev/null || hostname)
EOF

  chmod 600 "$manifest" "$checksums" "$mongo_file" "$uploads_file"

  log "checksums written"
  log "mongo backup size: ${mongo_size}"
  log "uploads backup size: ${uploads_size}"

  if [[ "$(date -u +%u)" -eq 7 ]]; then
    log "Sunday UTC — copying backup set to weekly retention"
    cp -a "$backup_set" "${WEEKLY_ROOT}/${ts}"
    chmod -R 700 "${WEEKLY_ROOT}/${ts}" 2>/dev/null || true
  fi

  log "applying retention (daily: ${DAILY_RETENTION_DAYS} days, weekly: ${WEEKLY_RETENTION_DAYS} days)"
  prune_old_sets "$DAILY_ROOT" "daily" "$DAILY_RETENTION_DAYS"
  prune_old_sets "$WEEKLY_ROOT" "weekly" "$WEEKLY_RETENTION_DAYS"

  log "backup completed successfully: ${backup_set}"
}

main "$@"
