#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=${1:-"$ROOT/backups/$STAMP"}
mkdir -p "$OUT"
echo "Writing PostgreSQL dump"
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres pg_dump -U rolodex -d rolodex --clean --if-exists --no-owner > "$OUT/database.sql"
VOLUME=$(docker volume ls -q --filter name=minio-data | head -n 1)
if [ -n "$VOLUME" ]; then
  echo "Archiving object storage from $VOLUME"
  docker run --rm -v "$VOLUME":/data:ro -v "$OUT":/backup alpine:3 tar -C /data -cf /backup/minio.tar .
else
  echo "No MinIO volume found; database dump only"
fi
echo "Backup written to $OUT"
