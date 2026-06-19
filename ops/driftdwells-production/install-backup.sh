#!/usr/bin/env bash
set -euo pipefail

# Install Drift & Dwells backup scripts as stable copies in ~/bin.
# Run on the production host as user illoc (sudo only for systemd/logrotate).
#
# Re-run after git pull when backup scripts change — live jobs use ~/bin copies,
# not repo symlinks.

readonly REPO="/home/illoc/apps/driftdwells-booking-portal"
readonly OPS="${REPO}/ops/driftdwells-production"
readonly BIN="/home/illoc/bin"

log() {
  printf '[install-backup] %s\n' "$*"
}

die() {
  printf '[install-backup] ERROR: %s\n' "$*" >&2
  exit 1
}

install_script() {
  local src="$1"
  local dest="$2"
  install -m 750 -o illoc -g illoc "$src" "$dest"
}

main() {
  if [[ "$(id -un)" != "illoc" ]]; then
    die "run as user illoc"
  fi

  if [[ ! -d "$OPS/backup" ]]; then
    die "ops backup directory not found: ${OPS}/backup"
  fi

  for script in read-mongodb-uri.sh driftdwells-backup.sh driftdwells-restore-verify.sh; do
    if [[ ! -f "${OPS}/backup/${script}" ]]; then
      die "missing source script: ${OPS}/backup/${script}"
    fi
  done

  mkdir -p "$BIN" "${HOME}/backups/driftdwells/manual"

  install_script "${OPS}/backup/read-mongodb-uri.sh" "${BIN}/read-mongodb-uri.sh"
  install_script "${OPS}/backup/driftdwells-backup.sh" "${BIN}/driftdwells-backup.sh"
  install_script "${OPS}/backup/driftdwells-restore-verify.sh" "${BIN}/driftdwells-restore-verify.sh"

  log "installed ${BIN}/read-mongodb-uri.sh"
  log "installed ${BIN}/driftdwells-backup.sh"
  log "installed ${BIN}/driftdwells-restore-verify.sh"

  log "To install systemd timer (requires sudo):"
  printf '  sudo cp %s/systemd/driftdwells-backup.service /etc/systemd/system/\n' "$OPS"
  printf '  sudo cp %s/systemd/driftdwells-backup.timer /etc/systemd/system/\n' "$OPS"
  printf '  sudo systemctl daemon-reload\n'
  printf '  sudo systemctl enable --now driftdwells-backup.timer\n'

  log "To install logrotate config (requires sudo):"
  printf '  sudo cp %s/logrotate-driftdwells-pm2 /etc/logrotate.d/driftdwells-pm2\n' "$OPS"

  log "install complete (re-run this script after git pull when backup scripts change)"
}

main "$@"
