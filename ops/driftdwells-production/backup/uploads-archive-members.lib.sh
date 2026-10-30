# Shared uploads-archive membership check for Drift & Dwells backups.
# Sourced by driftdwells-backup.sh and regression tests.
#
# Under `set -o pipefail`, `tar … | grep -q …` is unsafe: grep -q exits on the
# first match, closes the pipe, tar receives SIGPIPE, and a valid archive is
# reported as a failure. Drain tar's listing instead (grep without -q).

uploads_archive_has_members() {
  local archive="$1"

  if [[ -z "$archive" || ! -f "$archive" ]]; then
    return 1
  fi

  # tar non-zero (corrupt/unreadable) fails the pipeline via pipefail.
  # grep exit 1 (no match) also fails. A match drains stdout to EOF so tar
  # exits 0 and is not SIGPIPE'd.
  tar -tzf "$archive" | grep '^uploads/.' >/dev/null
}
