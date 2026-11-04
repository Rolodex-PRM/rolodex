#!/bin/sh
set -eu
if [ -z "${1:-}" ]; then
  echo "Usage: scripts/restore.sh backups/STAMP" >&2
  exit 1
fi
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
IN=$(CDPATH= cd -- "$1" && pwd)
if [ ! -f "$IN/database.sql" ]; then
  echo "No database.sql in $IN" >&2
  exit 1
fi
echo "Restoring PostgreSQL from $IN/database.sql"
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres psql -U rolodex -d rolodex -v ON_ERROR_STOP=1 < "$IN/database.sql"
restore_volume() {
  archive="$1"
  filter="$2"
  if [ ! -f "$IN/$archive" ]; then
    return 0
  fi
  volume=$(docker volume ls -q --filter name="$filter" | head -n 1)
  if [ -z "$volume" ]; then
    echo "No volume matching $filter" >&2
    exit 1
  fi
  echo "Restoring $archive into $volume"
  docker compose -f "$ROOT/docker-compose.yml" stop rolodex >/dev/null || true
  docker run --rm -v "$volume":/data -v "$IN":/backup alpine:3 tar -C /data -xf "/backup/$archive"
  stopped=1
}
stopped=0
restore_volume files.tar uploads
restore_volume minio.tar minio-data
if [ "$stopped" = 1 ]; then
  docker compose -f "$ROOT/docker-compose.yml" start rolodex >/dev/null
fi
echo "Restore finished"
