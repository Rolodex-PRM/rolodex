#!/bin/sh
# Deliberately broken backups must fail verification / restore preflight.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
SOURCE=${1:-}
[ -n "$SOURCE" ] || { echo "Usage: scripts/test/negative-backup-cases.sh backups/STAMP" >&2; exit 1; }

case "$SOURCE" in
  /*) SRC=$SOURCE ;;
  *) SRC=$(CDPATH= cd -- "$SOURCE" && pwd) ;;
esac

WORKDIR=$(mktemp -d)
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT INT TERM

fail_expected() {
  name=$1
  shift
  echo "Case: $name"
  if "$@" >/tmp/rolodex-neg-out.txt 2>/tmp/rolodex-neg-err.txt; then
    echo "error: expected failure for $name" >&2
    cat /tmp/rolodex-neg-err.txt >&2 || true
    exit 1
  fi
  echo "  failed as expected"
}

cp -a "$SRC" "$WORKDIR/good"

# Missing artifact
rm -rf "$WORKDIR/missing"
cp -a "$WORKDIR/good" "$WORKDIR/missing"
rm -f "$WORKDIR/missing/uploads.tar.gz"
fail_expected "missing uploads" "$ROOT/scripts/verify-backup.sh" "$WORKDIR/missing"

# Bad checksum
rm -rf "$WORKDIR/badsum"
cp -a "$WORKDIR/good" "$WORKDIR/badsum"
# Flip one character in checksums file
sed '1s/[0-9a-f]/0/' "$WORKDIR/badsum/checksums.sha256" >"$WORKDIR/badsum/checksums.tmp" || true
# Portable flip: rewrite first line with wrong hash
first=$(head -n 1 "$WORKDIR/good/checksums.sha256")
file=$(printf '%s\n' "$first" | awk '{print $2}')
printf '%s  %s\n' "0000000000000000000000000000000000000000000000000000000000000000" "$file" >"$WORKDIR/badsum/checksums.sha256"
tail -n +2 "$WORKDIR/good/checksums.sha256" >>"$WORKDIR/badsum/checksums.sha256"
fail_expected "checksum mismatch" "$ROOT/scripts/verify-backup.sh" "$WORKDIR/badsum"

# Unsupported manifest version
rm -rf "$WORKDIR/badfmt"
cp -a "$WORKDIR/good" "$WORKDIR/badfmt"
# Rewrite format_version then refresh checksum for manifest only is hard; break by changing manifest
# and updating checksums to match so verify reaches format check... Simpler: change format after
# forging checksums for the new manifest.
sed 's/"format_version": 1/"format_version": 99/' "$WORKDIR/good/manifest.json" >"$WORKDIR/badfmt/manifest.json"
(
  CDPATH= cd -- "$WORKDIR/badfmt"
  : >checksums.sha256
  for name in database.dump uploads.tar.gz manifest.json; do
    if command -v sha256sum >/dev/null 2>&1; then hash=$(sha256sum "$name" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then hash=$(shasum -a 256 "$name" | awk '{print $1}')
    else hash=$(openssl dgst -sha256 "$name" | awk '{print $NF}')
    fi
    printf '%s  %s\n' "$hash" "$name" >>checksums.sha256
  done
)
fail_expected "unsupported format_version" "$ROOT/scripts/verify-backup.sh" "$WORKDIR/badfmt"

# Truncated archive
rm -rf "$WORKDIR/trunc"
cp -a "$WORKDIR/good" "$WORKDIR/trunc"
dd if="$WORKDIR/good/uploads.tar.gz" of="$WORKDIR/trunc/uploads.tar.gz" bs=64 count=1 status=none 2>/dev/null \
  || dd if="$WORKDIR/good/uploads.tar.gz" of="$WORKDIR/trunc/uploads.tar.gz" bs=64 count=1
(
  CDPATH= cd -- "$WORKDIR/trunc"
  : >checksums.sha256
  for name in database.dump uploads.tar.gz manifest.json; do
    if command -v sha256sum >/dev/null 2>&1; then hash=$(sha256sum "$name" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then hash=$(shasum -a 256 "$name" | awk '{print $1}')
    else hash=$(openssl dgst -sha256 "$name" | awk '{print $NF}')
    fi
    printf '%s  %s\n' "$hash" "$name" >>checksums.sha256
  done
)
fail_expected "truncated uploads archive" "$ROOT/scripts/verify-backup.sh" "$WORKDIR/trunc"

# Restore without --confirm must refuse
fail_expected "restore without confirm" "$ROOT/scripts/restore.sh" "$WORKDIR/good"

echo "All negative backup cases passed"
