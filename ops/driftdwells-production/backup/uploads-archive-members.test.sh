#!/usr/bin/env bash
# Regression tests for uploads archive membership validation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=uploads-archive-members.lib.sh
source "${SCRIPT_DIR}/uploads-archive-members.lib.sh"

pass=0
fail=0

assert_ok() {
  local name="$1"
  shift
  if "$@"; then
    printf 'ok - %s\n' "$name"
    pass=$((pass + 1))
  else
    printf 'not ok - %s\n' "$name" >&2
    fail=$((fail + 1))
  fi
}

assert_fail() {
  local name="$1"
  shift
  if "$@"; then
    printf 'not ok - %s (expected failure)\n' "$name" >&2
    fail=$((fail + 1))
  else
    printf 'ok - %s\n' "$name"
    pass=$((pass + 1))
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/uploads/Headers"
printf 'x\n' >"$TMP/uploads/Headers/a.png"
# Exceed typical pipe buffer so grep -q closes before tar finishes listing.
for i in $(seq 1 8000); do
  printf 'f\n' >"$TMP/uploads/file-${i}.txt"
done
tar -czf "$TMP/valid.tar.gz" -C "$TMP" uploads

mkdir -p "$TMP/empty-root/uploads"
tar -czf "$TMP/dir-only.tar.gz" -C "$TMP/empty-root" uploads

printf 'not-a-gzip-archive\n' >"$TMP/corrupt.tar.gz"

# --- valid archive must pass fixed checker ---
assert_ok 'valid archive has members' uploads_archive_has_members "$TMP/valid.tar.gz"

# --- directory-only archive must fail (no uploads/<name> file members) ---
assert_fail 'directory-only archive rejected' uploads_archive_has_members "$TMP/dir-only.tar.gz"

# --- corrupt archive must fail ---
assert_fail 'corrupt archive rejected' uploads_archive_has_members "$TMP/corrupt.tar.gz"

# --- missing path must fail ---
assert_fail 'missing archive rejected' uploads_archive_has_members "$TMP/does-not-exist.tar.gz"

# --- SIGPIPE regression: grep -q under pipefail falsely fails the same valid archive ---
set +e
# Disable stdout buffering on tar when available so the producer keeps writing
# after grep -q's early exit (otherwise a small listing can fit in the pipe).
if command -v stdbuf >/dev/null 2>&1; then
  bash -c 'set -euo pipefail; stdbuf -o0 tar -tzf "$1" | grep -q "^uploads/."' bash "$TMP/valid.tar.gz"
else
  bash -c 'set -euo pipefail; tar -tzf "$1" | grep -q "^uploads/."' bash "$TMP/valid.tar.gz"
fi
buggy_status=$?
set -e
if [[ "$buggy_status" -ne 0 ]]; then
  printf 'ok - grep -q under pipefail still false-fails valid archive (status %s)\n' "$buggy_status"
  pass=$((pass + 1))
else
  printf 'not ok - expected grep -q pipefail false failure on valid archive\n' >&2
  fail=$((fail + 1))
fi

# Fixed pipeline (same as lib) must succeed on that archive under pipefail.
assert_ok 'fixed pipeline drains tar under pipefail' \
  bash -c 'set -euo pipefail; tar -tzf "$1" | grep "^uploads/." >/dev/null' bash "$TMP/valid.tar.gz"

printf '1..%s\n' "$((pass + fail))"
if [[ "$fail" -ne 0 ]]; then
  printf '# %s failed, %s passed\n' "$fail" "$pass" >&2
  exit 1
fi
printf '# %s passed\n' "$pass"
exit 0
