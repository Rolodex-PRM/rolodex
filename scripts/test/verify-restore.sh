#!/bin/sh
# Compare restored Rolodex state against the fixture snapshot from seed-backup-fixture.sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
BASE_URL=${BASE_URL:-http://127.0.0.1:8080}
STATE_DIR=${STATE_DIR:-"$ROOT/scripts/test/.fixture-state"}

[ -f "$STATE_DIR/counts.csv" ] || { echo "error: missing fixture state at $STATE_DIR (run seed first)" >&2; exit 1; }

compose() {
  docker compose -f "$ROOT/docker-compose.yml" "$@"
}

json_field() {
  printf '%s' "$1" | node -e '
const key = process.argv[1]
let raw = ""
process.stdin.on("data", (chunk) => { raw += chunk })
process.stdin.on("end", () => {
  const walk = (value) => {
    if (value == null) return null
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item)
        if (found != null) return found
      }
      return null
    }
    if (typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, key) && (typeof value[key] === "string" || typeof value[key] === "number")) {
        return String(value[key])
      }
      for (const item of Object.values(value)) {
        const found = walk(item)
        if (found != null) return found
      }
    }
    return null
  }
  const found = walk(JSON.parse(raw))
  if (found == null) process.exit(2)
  process.stdout.write(found)
})
' "$2"
}

wait_for_api() {
  i=0
  while [ "$i" -lt 90 ]; do
    if curl -fsS "$BASE_URL/" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "error: site did not become ready at $BASE_URL" >&2
  exit 1
}

echo "Waiting for restored application"
wait_for_api

expected=$(tr -d '\r' <"$STATE_DIR/counts.csv")
actual=$(compose exec -T postgres psql -U rolodex -d rolodex -At -F ',' -c "
SELECT
  (SELECT COUNT(*) FROM users),
  (SELECT COUNT(*) FROM contacts),
  (SELECT COUNT(*) FROM contacts WHERE deleted_at IS NOT NULL),
  (SELECT COUNT(*) FROM relationships),
  (SELECT COUNT(*) FROM notes),
  (SELECT COUNT(*) FROM tasks),
  (SELECT COUNT(*) FROM calendar_events),
  (SELECT COUNT(*) FROM tags),
  (SELECT COUNT(*) FROM app_passwords),
  (SELECT COUNT(*) FROM attachments),
  (SELECT COUNT(*) FROM integration_credentials)
" | tr -d '\r')

echo "Expected counts: $expected"
echo "Restored counts: $actual"
[ "$expected" = "$actual" ] || { echo "error: restored row counts do not match fixture" >&2; exit 1; }

ADMIN_EMAIL=$(tr -d '\r' <"$STATE_DIR/admin-email.txt")
ADMIN_PASSWORD=$(tr -d '\r' <"$STATE_DIR/admin-password.txt")
login=$(curl -fsS -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"remember\":true}")
TOKEN=$(json_field "$login" token)
[ -n "$TOKEN" ] || { echo "error: administrator could not sign in after restore" >&2; exit 1; }

WS=$(tr -d '\r' <"$STATE_DIR/workspace-id.txt")
ALICE=$(tr -d '\r' <"$STATE_DIR/alice-id.txt")
EXPECTED_HASH=$(tr -d '\r' <"$STATE_DIR/attachment.sha256")

contact=$(curl -fsS "$BASE_URL/api/workspaces/$WS/contacts/$ALICE" -H "Authorization: Bearer $TOKEN")
case "$contact" in
  *Alice*) ;;
  *) echo "error: restored Alice contact missing or incomplete: $contact" >&2; exit 1 ;;
esac

# Resolve attachment storage key and hash the file from the uploads volume
STORAGE_KEY=$(compose exec -T postgres psql -U rolodex -d rolodex -At -c \
  "SELECT storage_key FROM attachments ORDER BY created_at ASC LIMIT 1" | tr -d '\r')
[ -n "$STORAGE_KEY" ] || { echo "error: no attachment after restore" >&2; exit 1; }

VOLUME=$(docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' "$(compose ps -aq rolodex)" | head -n 1 | tr -d '\r')
ACTUAL_HASH=$(docker run --rm -v "$VOLUME":/data:ro alpine:3 \
  sh -c "sha256sum \"/data/$STORAGE_KEY\" | awk '{print \$1}'" | tr -d '\r')
echo "Expected attachment hash: $EXPECTED_HASH"
echo "Restored attachment hash: $ACTUAL_HASH"
[ "$EXPECTED_HASH" = "$ACTUAL_HASH" ] || { echo "error: attachment content hash mismatch" >&2; exit 1; }

# Encrypted credentials must decrypt with the preserved CREDENTIALS_KEY
CREDENTIALS_KEY=$(grep -E '^CREDENTIALS_KEY=' "$ROOT/.env" 2>/dev/null | head -n 1 | cut -d= -f2- || true)
if [ -z "$CREDENTIALS_KEY" ]; then
  CREDENTIALS_KEY=$(grep -E '^CREDENTIALS_KEY=' "$ROOT/.env.example" | head -n 1 | cut -d= -f2-)
fi
export CREDENTIALS_KEY
ROW=$(compose exec -T postgres psql -U rolodex -d rolodex -At -F '|' -c \
  "SELECT ciphertext, nonce FROM integration_credentials LIMIT 1" | tr -d '\r')
CIPHER=${ROW%%|*}
NONCE=${ROW#*|}
export CIPHER NONCE
node <<'NODE'
const { createDecipheriv } = require('crypto')
const key = Buffer.from(process.env.CREDENTIALS_KEY, 'base64')
const iv = Buffer.from(process.env.NONCE, 'base64')
const data = Buffer.from(process.env.CIPHER, 'base64')
const tag = data.subarray(data.length - 16)
const body = data.subarray(0, data.length - 16)
const decipher = createDecipheriv('aes-256-gcm', key, iv)
decipher.setAuthTag(tag)
const plaintext = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
const parsed = JSON.parse(plaintext)
if (parsed.token !== 'fixture-secret-token') {
  console.error('decrypted credential payload mismatch')
  process.exit(1)
}
NODE

echo "Restore verification succeeded (counts, login, attachment hash, encryption key)"
