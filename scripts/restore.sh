#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
# shellcheck source=lib/backup-common.sh
. "$ROOT/scripts/lib/backup-common.sh"

usage() {
  echo "Usage: scripts/restore.sh backups/STAMP --confirm" >&2
  echo "Restores PostgreSQL and the uploads volume. Existing data is overwritten." >&2
  exit 1
}

BACKUP_ARG=
CONFIRM=0
for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRM=1 ;;
    -h | --help) usage ;;
    *)
      if [ -z "$BACKUP_ARG" ]; then
        BACKUP_ARG=$arg
      else
        usage
      fi
      ;;
  esac
done

[ -n "$BACKUP_ARG" ] || usage
[ "$CONFIRM" = 1 ] || die "refusing to overwrite data without --confirm (see scripts/restore.sh --help)"

require_docker

case "$BACKUP_ARG" in
  /*) IN=$BACKUP_ARG ;;
  *) IN=$(CDPATH= cd -- "$BACKUP_ARG" && pwd) ;;
esac

STAGE=preflight
fail_stage() {
  die "restore failed during $STAGE. $*"
}

log "WARNING: This will overwrite the PostgreSQL database and uploads volume."
log "CREDENTIALS_KEY in .env must match the key used when this backup was created."
log "Preflight validation for $IN"

require_backup_dir "$IN" || fail_stage "Backup directory is incomplete."
verify_checksums "$IN" || fail_stage "Fix or replace the backup before restoring."
validate_manifest "$IN" || fail_stage "Manifest is incompatible."
assert_archive_paths_safe "$IN/$UPLOADS_ARTIFACT" || fail_stage "Uploads archive failed path checks."

log "Checking database dump readability"
docker run --rm \
  -v "$IN":/backup:ro \
  postgres:16-alpine \
  pg_restore --list "/backup/$DATABASE_ARTIFACT" >/dev/null \
  || fail_stage "database.dump is not readable by pg_restore."

PG_BACKUP=$(sed -n 's/.*"postgres_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$IN/$MANIFEST_NAME" | head -n 1)
PG_NOW=$(postgres_version_string || true)
if [ -n "$PG_BACKUP" ] && [ -n "$PG_NOW" ]; then
  log "Backup PostgreSQL: $PG_BACKUP"
  log "Target PostgreSQL: $PG_NOW"
  # Soft check: major version from "postgres (PostgreSQL) 16.x"
  backup_major=$(printf '%s\n' "$PG_BACKUP" | sed -n 's/.*PostgreSQL) \([0-9][0-9]*\).*/\1/p')
  target_major=$(printf '%s\n' "$PG_NOW" | sed -n 's/.*PostgreSQL) \([0-9][0-9]*\).*/\1/p')
  if [ -n "$backup_major" ] && [ -n "$target_major" ] && [ "$target_major" -lt "$backup_major" ]; then
    fail_stage "Target PostgreSQL $target_major is older than backup $backup_major. Upgrade Postgres before restoring."
  fi
fi

APP_STOPPED=0
cleanup() {
  code=$?
  if [ "$APP_STOPPED" = 1 ]; then
    start_rolodex || log "warning: could not restart rolodex; start it manually with: docker compose start rolodex"
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

STAGE=stop-app
stop_rolodex
APP_STOPPED=1

STAGE=restore-database
log "Restoring PostgreSQL from $DATABASE_ARTIFACT"
postgres_env
set +e
compose exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl - \
  <"$IN/$DATABASE_ARTIFACT"
restore_status=$?
set -e
# pg_restore exits 1 when some objects emit recoverable errors; require a readable schema either way.
if ! compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contacts';" \
  >/dev/null; then
  fail_stage "Database restore did not complete (pg_restore exit $restore_status). Do not treat the install as healthy. Re-run restore after fixing the dump, or recreate volumes and try again."
fi
if [ "$restore_status" -ne 0 ] && [ "$restore_status" -ne 1 ]; then
  fail_stage "Database restore failed with exit $restore_status. Do not treat the install as healthy."
fi
if [ "$restore_status" -eq 1 ]; then
  log "pg_restore reported warnings (exit 1); contacts table is readable — continuing"
fi

STAGE=restore-uploads
UPLOADS_VOLUME=$(uploads_volume_name)
log "Replacing uploads volume contents ($UPLOADS_VOLUME)"
# Clear existing files, then extract. Refuse path traversal (checked in preflight).
docker run --rm \
  -v "$UPLOADS_VOLUME":/data \
  -v "$IN":/backup:ro \
  alpine:3 \
  sh -c 'rm -rf /data/.[!.]* /data/* 2>/dev/null; tar -C /data -xzf "/backup/'"$UPLOADS_ARTIFACT"'"' \
  || fail_stage "Uploads restore failed. Database may already be replaced. Re-run restore or restore uploads manually from $UPLOADS_ARTIFACT."

STAGE=start-app
start_rolodex
APP_STOPPED=0

log "Restore finished"
log "  database: restored"
log "  uploads: restored"
log "Confirm the site loads, you can sign in, and attachments open."
log "If encrypted integrations fail, CREDENTIALS_KEY in .env does not match the backup era."
