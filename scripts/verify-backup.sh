#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
# shellcheck source=lib/backup-common.sh
. "$ROOT/scripts/lib/backup-common.sh"

if [ -z "${1:-}" ]; then
  echo "Usage: scripts/verify-backup.sh backups/STAMP" >&2
  exit 1
fi

require_docker

case "$1" in
  /*) IN=$1 ;;
  *) IN=$(CDPATH= cd -- "$1" && pwd) ;;
esac

log "Verifying backup at $IN (production is not modified)"

require_backup_dir "$IN"
log "Checking checksums"
verify_checksums "$IN"
log "Validating manifest"
validate_manifest "$IN"

log "Checking uploads archive listing"
if ! tar -tzf "$IN/$UPLOADS_ARTIFACT" >/dev/null; then
  die "uploads archive is not a readable gzip tar"
fi
assert_archive_paths_safe "$IN/$UPLOADS_ARTIFACT"

log "Listing database dump with pg_restore"
docker run --rm \
  -v "$IN":/backup:ro \
  postgres:16-alpine \
  pg_restore --list "/backup/$DATABASE_ARTIFACT" >/dev/null \
  || die "database dump is not readable by pg_restore"

VERIFY_NAME="rolodex-verify-$$"
VERIFY_PASS=$(openssl rand -hex 12 2>/dev/null || echo "verify-pass-$$")
cleanup_verify() {
  docker rm -f "$VERIFY_NAME" >/dev/null 2>&1 || true
}
trap cleanup_verify EXIT INT TERM

log "Restoring dump into a disposable PostgreSQL container"
docker run -d --name "$VERIFY_NAME" \
  -e POSTGRES_PASSWORD="$VERIFY_PASS" \
  -e POSTGRES_USER=verify \
  -e POSTGRES_DB=verify \
  postgres:16-alpine >/dev/null

i=0
while [ "$i" -lt 40 ]; do
  if docker exec "$VERIFY_NAME" pg_isready -U verify -d verify >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
docker exec "$VERIFY_NAME" pg_isready -U verify -d verify >/dev/null \
  || die "temporary PostgreSQL did not become ready"

docker cp "$IN/$DATABASE_ARTIFACT" "$VERIFY_NAME:/tmp/database.dump"
docker exec "$VERIFY_NAME" \
  pg_restore -U verify -d verify --clean --if-exists --no-owner --no-acl /tmp/database.dump \
  || die "isolated pg_restore failed"

docker exec "$VERIFY_NAME" \
  psql -U verify -d verify -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" \
  >/dev/null \
  || die "restored database could not be queried"

log "Backup verification succeeded"
log "  checksums: ok"
log "  manifest: ok (format_version $BACKUP_FORMAT_VERSION)"
log "  uploads archive: ok"
log "  database dump: readable and restorable in isolation"
log "This confirms the backup artifacts; it does not mean a production restore has been performed."
