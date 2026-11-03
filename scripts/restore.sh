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
if [ -f "$IN/minio.tar" ]; then
  VOLUME=$(docker volume ls -q --filter name=minio-data | head -n 1)
  if [ -z "$VOLUME" ]; then
    echo "No MinIO volume found" >&2
    exit 1
  fi
  echo "Restoring object storage into $VOLUME"
  docker compose -f "$ROOT/docker-compose.yml" stop api web >/dev/null
  docker run --rm -v "$VOLUME":/data -v "$IN":/backup alpine:3 tar -C /data -xf /backup/minio.tar
  docker compose -f "$ROOT/docker-compose.yml" start api web >/dev/null
fi
echo "Restore finished"
