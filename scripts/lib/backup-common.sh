#!/bin/sh
# Shared helpers for Rolodex backup, restore, and verify scripts.
# shellcheck shell=sh

BACKUP_FORMAT_VERSION=1
MANIFEST_NAME=manifest.json
CHECKSUMS_NAME=checksums.sha256
DATABASE_ARTIFACT=database.dump
UPLOADS_ARTIFACT=uploads.tar.gz

die() {
  echo "error: $*" >&2
  exit 1
}

log() {
  echo "$*"
}

script_root() {
  CDPATH= cd -- "$(dirname "$0")/.." && pwd
}

compose_file() {
  echo "$ROOT/docker-compose.yml"
}

compose() {
  docker compose -f "$(compose_file)" "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is required"
  docker compose version >/dev/null 2>&1 || die "docker compose is required"
}

sha256_file() {
  file=$1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    die "need sha256sum, shasum, or openssl to compute checksums"
  fi
}

write_checksums() {
  dir=$1
  (
    CDPATH= cd -- "$dir" || exit 1
    : >"$CHECKSUMS_NAME"
    for name in "$DATABASE_ARTIFACT" "$UPLOADS_ARTIFACT" "$MANIFEST_NAME"; do
      [ -f "$name" ] || die "missing artifact for checksums: $name"
      hash=$(sha256_file "$name")
      # Two spaces match GNU sha256sum -c expectations.
      printf '%s  %s\n' "$hash" "$name" >>"$CHECKSUMS_NAME"
    done
  )
}

verify_checksums() {
  dir=$1
  checksums="$dir/$CHECKSUMS_NAME"
  [ -f "$checksums" ] || die "missing $CHECKSUMS_NAME"
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    hash=$(printf '%s\n' "$line" | awk '{print $1}')
    file=$(printf '%s\n' "$line" | awk '{print $2}')
    [ -n "$hash" ] && [ -n "$file" ] || die "invalid checksum line: $line"
    case "$file" in
      */* | .* | *..*) die "unsafe checksum path: $file" ;;
    esac
    [ -f "$dir/$file" ] || die "missing artifact listed in checksums: $file"
    actual=$(sha256_file "$dir/$file")
    [ "$actual" = "$hash" ] || die "checksum mismatch for $file"
  done <"$checksums"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

application_version() {
  version_file="$ROOT/docs/version.json"
  if [ -f "$version_file" ]; then
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$version_file" | head -n 1
  else
    echo "unknown"
  fi
}

postgres_env() {
  POSTGRES_USER=$(compose exec -T postgres printenv POSTGRES_USER 2>/dev/null || true)
  POSTGRES_DB=$(compose exec -T postgres printenv POSTGRES_DB 2>/dev/null || true)
  POSTGRES_USER=${POSTGRES_USER:-rolodex}
  POSTGRES_DB=${POSTGRES_DB:-rolodex}
}

postgres_version_string() {
  compose exec -T postgres postgres --version 2>/dev/null | head -n 1 | tr -d '\r'
}

uploads_volume_name() {
  # Include stopped containers so backup/restore still resolve /data after compose stop.
  cid=$(compose ps -aq rolodex 2>/dev/null || true)
  if [ -n "$cid" ]; then
    volume=$(docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' "$cid" | head -n 1 | tr -d '\r')
    if [ -n "$volume" ]; then
      printf '%s\n' "$volume"
      return 0
    fi
  fi
  volume=$(docker volume ls -q --filter label=com.docker.compose.volume=uploads | head -n 1)
  if [ -z "$volume" ]; then
    volume=$(docker volume ls -q | awk '/(^|_)uploads$/{print; exit}')
  fi
  [ -n "$volume" ] || die "could not find the Compose uploads volume"
  printf '%s\n' "$volume"
}

assert_archive_paths_safe() {
  archive=$1
  # Reject absolute paths and any path segment that is "..".
  if bad=$(tar -tzf "$archive" | awk '
    /^\// { print; exit 1 }
    /(^|\/)\.\.(\/|$)/ { print; exit 1 }
  '); then
    return 0
  fi
  die "uploads archive contains unsafe paths: ${bad:-unknown}"
}

require_backup_dir() {
  dir=$1
  [ -d "$dir" ] || die "backup directory not found: $dir"
  [ -f "$dir/$DATABASE_ARTIFACT" ] || die "missing $DATABASE_ARTIFACT"
  [ -f "$dir/$UPLOADS_ARTIFACT" ] || die "missing $UPLOADS_ARTIFACT"
  [ -f "$dir/$MANIFEST_NAME" ] || die "missing $MANIFEST_NAME"
  [ -f "$dir/$CHECKSUMS_NAME" ] || die "missing $CHECKSUMS_NAME"
}

validate_manifest() {
  dir=$1
  manifest="$dir/$MANIFEST_NAME"
  grep -q '"format_version"[[:space:]]*:[[:space:]]*'"$BACKUP_FORMAT_VERSION" "$manifest" \
    || die "unsupported or missing format_version (expected $BACKUP_FORMAT_VERSION)"
  grep -q '"application"[[:space:]]*:[[:space:]]*"rolodex"' "$manifest" \
    || die "manifest application must be rolodex"
  grep -q "\"file\"[[:space:]]*:[[:space:]]*\"$DATABASE_ARTIFACT\"" "$manifest" \
    || die "manifest does not reference $DATABASE_ARTIFACT"
  grep -q "\"file\"[[:space:]]*:[[:space:]]*\"$UPLOADS_ARTIFACT\"" "$manifest" \
    || die "manifest does not reference $UPLOADS_ARTIFACT"
}

write_manifest() {
  dir=$1
  created_at=$2
  app_version=$3
  pg_version=$4
  cat >"$dir/$MANIFEST_NAME" <<EOF
{
  "format_version": $BACKUP_FORMAT_VERSION,
  "application": "rolodex",
  "application_version": "$(json_escape "$app_version")",
  "created_at": "$(json_escape "$created_at")",
  "postgres_version": "$(json_escape "$pg_version")",
  "components": {
    "database": {
      "file": "$DATABASE_ARTIFACT",
      "format": "postgres-custom"
    },
    "uploads": {
      "file": "$UPLOADS_ARTIFACT"
    }
  }
}
EOF
}

restrict_backup_permissions() {
  dir=$1
  chmod 700 "$dir" 2>/dev/null || true
  chmod 600 "$dir/$DATABASE_ARTIFACT" "$dir/$UPLOADS_ARTIFACT" "$dir/$MANIFEST_NAME" "$dir/$CHECKSUMS_NAME" 2>/dev/null || true
}

start_rolodex() {
  log "Starting rolodex service"
  compose start rolodex >/dev/null
}

stop_rolodex() {
  log "Stopping rolodex service (write freeze for consistent backup/restore)"
  compose stop rolodex >/dev/null
}
