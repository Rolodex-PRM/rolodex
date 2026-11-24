#!/bin/sh
# Seed a representative Rolodex install for backup/restore round-trip tests.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
BASE_URL=${BASE_URL:-http://127.0.0.1:8080}
STATE_DIR=${STATE_DIR:-"$ROOT/scripts/test/.fixture-state"}
ADMIN_EMAIL=${ADMIN_EMAIL:-backup-owner@example.com}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-BackupOwner1!}
SECOND_EMAIL=${SECOND_EMAIL:-backup-editor@example.com}
SECOND_PASSWORD=${SECOND_PASSWORD:-BackupEditor1!}

mkdir -p "$STATE_DIR"
rm -f "$STATE_DIR"/*

wait_for_api() {
  i=0
  while [ "$i" -lt 90 ]; do
    if curl -fsS "$BASE_URL/api/auth/setup" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "error: API did not become ready at $BASE_URL" >&2
  exit 1
}

json_field() {
  # Usage: json_field <json> <key>  — first matching string/number field (depth-first, arrays included)
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

api() {
  method=$1
  path=$2
  body=${3:-}
  tmp=$(mktemp)
  if [ -n "$body" ]; then
    code=$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" || true)
  else
    code=$(curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN" || true)
  fi
  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    echo "error: $method $path failed with HTTP $code" >&2
    head -c 500 "$tmp" >&2 || true
    echo >&2
    rm -f "$tmp"
    exit 1
  fi
  cat "$tmp"
  rm -f "$tmp"
}

compose() {
  docker compose -f "$ROOT/docker-compose.yml" "$@"
}

echo "Waiting for API at $BASE_URL"
wait_for_api

setup=$(curl -fsS "$BASE_URL/api/auth/setup")
case "$setup" in
  *'"required":true'* | *'"required": true'*)
    echo "Creating first administrator"
    created=$(curl -fsS -X POST "$BASE_URL/api/auth/setup" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"displayName\":\"Backup Owner\"}")
    TOKEN=$(json_field "$created" token)
    ;;
  *)
    echo "Administrator already exists; signing in"
    created=$(curl -fsS -X POST "$BASE_URL/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"remember\":true}")
    TOKEN=$(json_field "$created" token)
    ;;
esac
[ -n "$TOKEN" ] || { echo "error: no session token" >&2; exit 1; }

workspaces=$(api GET /api/workspaces)
WS=$(json_field "$workspaces" id)
[ -n "$WS" ] || { echo "error: no workspace" >&2; exit 1; }

echo "Seeding workspace $WS"

api PUT "/api/workspaces/$WS/registration" '{"inviteOnly":false}' >/dev/null || true

# Second account (best-effort; ignore if already registered)
curl -fsS -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$SECOND_EMAIL\",\"password\":\"$SECOND_PASSWORD\",\"displayName\":\"Backup Editor\"}" \
  >/dev/null 2>&1 || true

tag=$(api POST "/api/workspaces/$WS/tags" '{"name":"backup-fixture","color":"#336699"}')
TAG_ID=$(json_field "$tag" id)

alice=$(api POST "/api/workspaces/$WS/contacts" "{\"firstName\":\"Alice\",\"lastName\":\"Backup\",\"methods\":[{\"kind\":\"email\",\"value\":\"alice@example.com\",\"isPrimary\":true},{\"kind\":\"phone\",\"value\":\"+1-555-0100\",\"isPrimary\":true}],\"addresses\":[{\"label\":\"home\",\"street\":\"1 Test Lane\",\"city\":\"Austin\",\"region\":\"TX\",\"postalCode\":\"78701\",\"country\":\"US\"}],\"personalDetails\":\"Private note for Alice\",\"tagIds\":[\"$TAG_ID\"],\"howWeMet\":\"Conference\"}")
ALICE_ID=$(json_field "$alice" id)

bob=$(api POST "/api/workspaces/$WS/contacts" '{"firstName":"Bob","lastName":"Backup","methods":[{"kind":"email","value":"bob@example.com","isPrimary":true}],"cardNote":"Card note for Bob"}')
BOB_ID=$(json_field "$bob" id)

trash=$(api POST "/api/workspaces/$WS/contacts" '{"firstName":"Trash","lastName":"Contact","methods":[{"kind":"email","value":"trash@example.com","isPrimary":true}]}')
TRASH_ID=$(json_field "$trash" id)
api DELETE "/api/workspaces/$WS/contacts/$TRASH_ID" >/dev/null

# Prefer a built-in type (coworker) so re-runs do not conflict; create one only if missing.
types=$(api GET "/api/workspaces/$WS/relationship-types")
TYPE_ID=$(printf '%s' "$types" | node -e '
let raw = ""
process.stdin.on("data", (chunk) => { raw += chunk })
process.stdin.on("end", () => {
  const rows = JSON.parse(raw)
  const list = Array.isArray(rows) ? rows : []
  const hit = list.find((row) => String(row.label || "").toLowerCase() === "coworker")
    || list.find((row) => row.id)
  if (!hit?.id) process.exit(2)
  process.stdout.write(String(hit.id))
})
')
api POST "/api/workspaces/$WS/contacts/$ALICE_ID/relationships" "{\"toContactId\":\"$BOB_ID\",\"typeId\":\"$TYPE_ID\",\"side\":\"label\"}" >/dev/null

note=$(api POST "/api/workspaces/$WS/notes" "{\"contactId\":\"$ALICE_ID\",\"body\":\"Fixture private note body\",\"visibility\":\"private\"}")
NOTE_ID=$(json_field "$note" id)

printf 'rolodex-backup-fixture-bytes\n' >"$STATE_DIR/attachment.txt"
FILE_HASH=$(
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$STATE_DIR/attachment.txt" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$STATE_DIR/attachment.txt" | awk '{print $1}'
  else openssl dgst -sha256 "$STATE_DIR/attachment.txt" | awk '{print $NF}'
  fi
)
file_tmp=$(mktemp)
file_code=$(curl -sS -o "$file_tmp" -w "%{http_code}" -X POST "$BASE_URL/api/workspaces/$WS/notes/$NOTE_ID/files" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$STATE_DIR/attachment.txt;type=text/plain" || true)
if [ "$file_code" -lt 200 ] || [ "$file_code" -ge 300 ]; then
  echo "error: note file upload failed with HTTP $file_code" >&2
  head -c 500 "$file_tmp" >&2 || true
  echo >&2
  rm -f "$file_tmp"
  exit 1
fi
rm -f "$file_tmp"

api POST "/api/workspaces/$WS/calendar/events" "{\"type\":\"meeting\",\"summary\":\"Backup Fixture Event\",\"description\":\"Round-trip event\",\"date\":\"2030-01-15\",\"allDay\":true,\"contactId\":\"$ALICE_ID\"}" >/dev/null
api POST "/api/workspaces/$WS/tasks" "{\"title\":\"Backup fixture task\",\"notes\":\"Task body\",\"priority\":3,\"contactId\":\"$ALICE_ID\"}" >/dev/null

client=$(api POST /api/app-passwords '{"label":"Backup Sync Client"}')
CLIENT_ID=$(json_field "$client" id)

api PUT "/api/workspaces/$WS/appearance" '{"css":"/* backup-fixture */\nbody{outline:0}","userCss":false}' >/dev/null

# Encrypted integration credential row (uses CREDENTIALS_KEY from .env)
CREDENTIALS_KEY=$(grep -E '^CREDENTIALS_KEY=' "$ROOT/.env" 2>/dev/null | head -n 1 | cut -d= -f2- || true)
if [ -z "$CREDENTIALS_KEY" ]; then
  CREDENTIALS_KEY=$(grep -E '^CREDENTIALS_KEY=' "$ROOT/.env.example" | head -n 1 | cut -d= -f2-)
fi
export CREDENTIALS_KEY
ENC=$(node <<'NODE'
const { createCipheriv, randomBytes } = require('crypto')
const key = Buffer.from(process.env.CREDENTIALS_KEY, 'base64')
if (key.length !== 32) throw new Error('CREDENTIALS_KEY must be 32 bytes base64')
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, iv)
const plaintext = Buffer.from(JSON.stringify({ token: 'fixture-secret-token' }), 'utf8')
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
const tag = cipher.getAuthTag()
process.stdout.write(JSON.stringify({
  ciphertext: Buffer.concat([ciphertext, tag]).toString('base64'),
  nonce: iv.toString('base64'),
}))
NODE
)
CIPHER=$(json_field "$ENC" ciphertext)
NONCE=$(json_field "$ENC" nonce)

compose exec -T postgres psql -U rolodex -d rolodex -v ON_ERROR_STOP=1 <<SQL
INSERT INTO integrations (id, workspace_id, provider, name, status, settings)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  '$WS',
  'mailbox',
  'Fixture Mailbox',
  'connected',
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_credentials (id, integration_id, ciphertext, nonce)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  '$CIPHER',
  '$NONCE'
)
ON CONFLICT (integration_id) DO UPDATE
SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, updated_at = now();
SQL

# Snapshot expected counts / hashes for verify-restore.sh
compose exec -T postgres psql -U rolodex -d rolodex -At -F ',' -c "
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
" >"$STATE_DIR/counts.csv"

printf '%s\n' "$FILE_HASH" >"$STATE_DIR/attachment.sha256"
printf '%s\n' "$WS" >"$STATE_DIR/workspace-id.txt"
printf '%s\n' "$ALICE_ID" >"$STATE_DIR/alice-id.txt"
printf '%s\n' "$CLIENT_ID" >"$STATE_DIR/client-id.txt"
printf '%s\n' "$ADMIN_EMAIL" >"$STATE_DIR/admin-email.txt"
printf '%s\n' "$ADMIN_PASSWORD" >"$STATE_DIR/admin-password.txt"

echo "Fixture seeded"
echo "  workspace=$WS alice=$ALICE_ID attachment_sha256=$FILE_HASH"
echo "  state=$STATE_DIR"
