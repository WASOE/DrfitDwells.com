#!/usr/bin/env bash
# Safe MongoDB URI loader for Drift & Dwells production ops scripts.
#
# Usage (source only — never execute for output):
#   Installed copy lives beside driftdwells-backup.sh in /home/illoc/bin/.
#   Callers resolve this file via BASH_SOURCE/script directory, not repo paths.
#   drift_load_mongodb_uri   # sets DRIFTDWELLS_MONGODB_URI (exported)
#
# Never prints MONGODB_URI, MONGO_URI, or any secret.

readonly DRIFTDWELLS_ENV_FILE="/home/illoc/apps/driftdwells-booking-portal/server/.env"

_drift_trim() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

_drift_strip_quotes() {
  local v="$1"
  if [[ ${#v} -ge 2 ]]; then
    case "$v" in
      \"*\") v="${v:1:${#v}-2}" ;;
      \'*\') v="${v:1:${#v}-2}" ;;
    esac
  fi
  printf '%s' "$v"
}

_drift_read_env_key() {
  local key="$1"
  local line raw value

  if [[ ! -r "$DRIFTDWELLS_ENV_FILE" ]]; then
    echo "ERROR: env file not readable: $DRIFTDWELLS_ENV_FILE" >&2
    return 1
  fi

  line="$(grep -E "^${key}=" "$DRIFTDWELLS_ENV_FILE" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi

  raw="${line#*=}"
  value="$(_drift_trim "$(_drift_strip_quotes "$raw")")"
  if [[ -z "$value" ]]; then
    return 1
  fi

  printf '%s' "$value"
}

# Sets and exports DRIFTDWELLS_MONGODB_URI without printing it.
drift_load_mongodb_uri() {
  local uri=""

  uri="$(_drift_read_env_key "MONGODB_URI" || true)"
  if [[ -z "$uri" ]]; then
    uri="$(_drift_read_env_key "MONGO_URI" || true)"
  fi

  if [[ -z "$uri" ]]; then
    echo "ERROR: MONGODB_URI (or MONGO_URI fallback) not found in $DRIFTDWELLS_ENV_FILE" >&2
    return 1
  fi

  export DRIFTDWELLS_MONGODB_URI="$uri"
  return 0
}

# Parses DB name from DRIFTDWELLS_MONGODB_URI; prints only the db name (not credentials).
drift_mongodb_db_name_from_uri() {
  local uri="$1"
  local rest db

  rest="${uri#mongodb+srv://}"
  if [[ "$rest" == "$uri" ]]; then
    rest="${uri#mongodb://}"
  fi

  if [[ "$rest" == *"@"* ]]; then
    rest="${rest#*@}"
  fi

  if [[ "$rest" != *"/"* ]]; then
    printf '%s' "drift-dwells-booking"
    return 0
  fi

  db="${rest#*/}"
  db="${db%%\?*}"
  db="${db%%/*}"

  if [[ -z "$db" ]]; then
    printf '%s' "drift-dwells-booking"
  else
    printf '%s' "$db"
  fi
}
