#!/usr/bin/env bash
set -euo pipefail

# Drift & Dwells restore verification — never restores over production.
# Restores Mongo into driftdwells_restore_test only; validates uploads tar listing.
# Must run as user illoc. Never prints secrets.

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=read-mongodb-uri.sh
source "${SCRIPT_DIR}/read-mongodb-uri.sh"

readonly BACKUP_ROOT="/home/illoc/backups/driftdwells"
readonly DAILY_ROOT="${BACKUP_ROOT}/daily"
readonly RESTORE_TEST_DB="driftdwells_restore_test"

readonly COLLECTIONS=(
  bookings
  payments
  giftvouchers
  cabins
  availabilityblocks
  opsusers
  reviews
  guests
  promocodes
  paymentfinalizations
)

log() {
  printf '[driftdwells-restore-verify] %s\n' "$*"
}

die() {
  printf '[driftdwells-restore-verify] ERROR: %s\n' "$*" >&2
  exit 1
}

require_user_illoc() {
  if [[ "$(id -un)" != "illoc" ]]; then
    die "must run as user illoc (current: $(id -un))"
  fi
}

require_commands() {
  local cmd
  for cmd in mongorestore mongosh sha256sum tar find sort; do
    command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
  done
}

latest_daily_backup_set() {
  find "$DAILY_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
    | sort \
    | tail -n 1
}

resolve_backup_set() {
  local arg="${1:-}"
  if [[ -n "$arg" ]]; then
    if [[ ! -d "$arg" ]]; then
      die "backup set directory not found: $arg"
    fi
    printf '%s' "$arg"
    return 0
  fi

  local latest
  latest="$(latest_daily_backup_set || true)"
  if [[ -z "$latest" ]]; then
    die "no daily backup sets found under $DAILY_ROOT"
  fi
  printf '%s' "$latest"
}

find_single_file() {
  local dir="$1"
  local pattern="$2"
  local matches count

  mapfile -t matches < <(find "$dir" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | sort)
  count="${#matches[@]}"
  if [[ "$count" -ne 1 ]]; then
    die "expected exactly one file matching ${pattern} in ${dir}, found ${count}"
  fi
  printf '%s' "${matches[0]}"
}

verify_checksums() {
  local backup_set="$1"
  local checksums="${backup_set}/checksums.sha256"

  if [[ ! -f "$checksums" ]]; then
    die "checksums file missing: $checksums"
  fi

  log "verifying checksums"
  (
    cd "$backup_set"
    sha256sum -c "$checksums"
  )
}

verify_uploads_tar() {
  local uploads_archive="$1"
  log "verifying uploads tar integrity (list only, no extract)"
  tar -tzf "$uploads_archive" >/dev/null
}

drop_restore_test_db() {
  local uri="$1"
  log "dropping restore test database: ${RESTORE_TEST_DB}"
  mongosh "$uri" --quiet --eval "db.getSiblingDB('${RESTORE_TEST_DB}').dropDatabase()" >/dev/null
}

collection_count() {
  local uri="$1"
  local db_name="$2"
  local coll="$3"
  local out
  out="$(mongosh "$uri" --quiet --eval "db.getSiblingDB('${db_name}').getCollection('${coll}').countDocuments()" 2>/dev/null | tail -n 1 | tr -d '\r\n[:space:]')"
  printf '%s' "$out"
}

compare_collection_counts() {
  local prod_uri="$1"
  local prod_db="$2"
  local test_uri="$3"
  local coll prod_count test_count

  for coll in "${COLLECTIONS[@]}"; do
    prod_count="$(collection_count "$prod_uri" "$prod_db" "$coll")"
    test_count="$(collection_count "$test_uri" "$RESTORE_TEST_DB" "$coll")"

    if [[ -z "$prod_count" || -z "$test_count" ]]; then
      die "failed to read counts for collection ${coll}"
    fi

    log "count ${coll}: production=${prod_count} restore_test=${test_count}"

    if [[ "$prod_count" != "$test_count" ]]; then
      die "count mismatch for ${coll}: production=${prod_count} restore_test=${test_count}"
    fi
  done
}

cleanup_on_exit() {
  local uri="${DRIFTDWELLS_MONGODB_URI:-}"
  if [[ "${KEEP_RESTORE_TEST_DB:-}" == "true" ]]; then
    log "KEEP_RESTORE_TEST_DB=true — leaving ${RESTORE_TEST_DB} in place"
    return 0
  fi
  if [[ -n "$uri" ]]; then
    drop_restore_test_db "$uri" || true
  fi
}

main() {
  local backup_set mongo_archive uploads_archive prod_db

  require_user_illoc
  require_commands

  drift_load_mongodb_uri || die "failed to load MongoDB URI from env file"
  prod_db="$(drift_mongodb_db_name_from_uri "$DRIFTDWELLS_MONGODB_URI")"

  backup_set="$(resolve_backup_set "${1:-}")"
  log "using backup set: ${backup_set}"

  mongo_archive="$(find_single_file "${backup_set}/mongo" 'driftdwells-mongo-*.gz')"
  uploads_archive="$(find_single_file "${backup_set}/uploads" 'driftdwells-uploads-*.tar.gz')"

  if [[ ! -s "$mongo_archive" ]]; then
    die "mongo archive missing or empty"
  fi
  if [[ ! -s "$uploads_archive" ]]; then
    die "uploads archive missing or empty"
  fi

  verify_checksums "$backup_set"
  verify_uploads_tar "$uploads_archive"

  trap cleanup_on_exit EXIT

  log "restoring Mongo into test database ${RESTORE_TEST_DB} (never production)"
  drop_restore_test_db "$DRIFTDWELLS_MONGODB_URI"

  if ! mongorestore \
    --quiet \
    --uri="$DRIFTDWELLS_MONGODB_URI" \
    --gzip \
    --archive="$mongo_archive" \
    --nsFrom="${prod_db}.*" \
    --nsTo="${RESTORE_TEST_DB}.*" \
    --drop; then
    die "mongorestore failed"
  fi

  log "comparing collection counts (production db: ${prod_db} vs ${RESTORE_TEST_DB})"
  compare_collection_counts "$DRIFTDWELLS_MONGODB_URI" "$prod_db" "$DRIFTDWELLS_MONGODB_URI"

  log "restore verification passed"
  if [[ "${KEEP_RESTORE_TEST_DB:-}" == "true" ]]; then
    log "KEEP_RESTORE_TEST_DB=true — leaving ${RESTORE_TEST_DB} in place"
    trap - EXIT
  else
    trap - EXIT
    cleanup_on_exit
  fi
}

main "$@"
