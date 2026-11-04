#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=${1:-"$ROOT/backups/$STAMP"}
mkdir -p "$OUT"
echo "Writing PostgreSQL dump"
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres pg_dump -U rolodex -d rolodex --clean --if-exists --no-owner > "$OUT/database.sql"
archive() {
  volume=$(docker volume ls -q --filter name="$1" | head -n 1)
  if [ -n "$volume" ]; then
    echo "Archiving $volume"
    docker run --rm -v "$volume":/data:ro -v "$OUT":/backup alpine:3 tar -C /data -cf "/backup/$2" .
  fi
}
archive uploads files.tar
archive minio-data minio.tar
echo "Backup written to $OUT"
