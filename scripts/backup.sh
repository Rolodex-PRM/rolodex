#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
# shellcheck source=lib/backup-common.sh
. "$ROOT/scripts/lib/backup-common.sh"

require_docker

STAMP=$(date -u +%Y-%m-%d_%H%M%S)
DEST_ARG=${1:-}
if [ -n "$DEST_ARG" ]; then
  case "$DEST_ARG" in
    /*) OUT=$DEST_ARG ;;
    *) OUT="$ROOT/$DEST_ARG" ;;
  esac
else
  # Prefer BACKUP_DIR from the environment or .env (same host path Compose mounts).
  if [ -z "${BACKUP_DIR:-}" ] && [ -f "$ROOT/.env" ]; then
    BACKUP_DIR=$(sed -n 's/^[[:space:]]*BACKUP_DIR[[:space:]]*=[[:space:]]*//p' "$ROOT/.env" | head -n 1 | tr -d '\r' | sed 's/^["'\'']//; s/["'\'']$//')
  fi
  BACKUP_ROOT=${BACKUP_DIR:-"$ROOT/backups"}
  case "$BACKUP_ROOT" in
    /* | [A-Za-z]:*) ;;
    ./*) BACKUP_ROOT="$ROOT/${BACKUP_ROOT#./}" ;;
    *) BACKUP_ROOT="$ROOT/$BACKUP_ROOT" ;;
  esac
  OUT="$BACKUP_ROOT/$STAMP"
fi

PARENT=$(dirname "$OUT")
BASE=$(basename "$OUT")
PARTIAL="$PARENT/${BASE}.partial"

if [ -e "$OUT" ]; then
  die "backup destination already exists: $OUT"
fi
if [ -e "$PARTIAL" ]; then
  die "incomplete backup directory already exists: $PARTIAL (remove it and retry)"
fi

mkdir -p "$PARENT"
mkdir -p "$PARTIAL"
chmod 700 "$PARTIAL" 2>/dev/null || true

APP_STOPPED=0
cleanup() {
  code=$?
  if [ "$APP_STOPPED" = 1 ]; then
    start_rolodex || true
  fi
  if [ "$code" -ne 0 ] && [ -d "$PARTIAL" ]; then
    log "Removing incomplete backup at $PARTIAL"
    rm -rf "$PARTIAL"
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

log "Creating backup under $PARTIAL"

postgres_env
stop_rolodex
APP_STOPPED=1

log "Dumping PostgreSQL (custom format)"
compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --clean --if-exists --no-owner --no-acl \
  >"$PARTIAL/$DATABASE_ARTIFACT"
[ -s "$PARTIAL/$DATABASE_ARTIFACT" ] || die "database dump is empty"

UPLOADS_VOLUME=$(uploads_volume_name)
log "Archiving uploads volume ($UPLOADS_VOLUME)"
docker run --rm \
  -v "$UPLOADS_VOLUME":/data:ro \
  -v "$PARTIAL":/backup \
  alpine:3 \
  tar -C /data -czf "/backup/$UPLOADS_ARTIFACT" .
[ -s "$PARTIAL/$UPLOADS_ARTIFACT" ] || die "uploads archive is empty"

CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
APP_VERSION=$(application_version)
PG_VERSION=$(postgres_version_string)
[ -n "$PG_VERSION" ] || PG_VERSION="unknown"
STATS_JSON=$(collect_backup_stats || true)

log "Writing manifest and checksums"
write_manifest "$PARTIAL" "$CREATED_AT" "$APP_VERSION" "$PG_VERSION" "$STATS_JSON"
write_checksums "$PARTIAL"
restrict_backup_permissions "$PARTIAL"

log "Publishing backup to $OUT"
mv "$PARTIAL" "$OUT"

log "Backup created successfully:"
log "  $OUT"
log "  $DATABASE_ARTIFACT + $UPLOADS_ARTIFACT + $MANIFEST_NAME + $CHECKSUMS_NAME"
log "Preserve CREDENTIALS_KEY from .env separately; it is not included in this archive."
log "Verify with: ./scripts/verify-backup.sh \"$OUT\""
