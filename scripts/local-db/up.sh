#!/usr/bin/env bash
# Start the local stack: PostgREST (:3000) + gateway (:54321) + fake Resend (:54400).
# Needs a Postgres server with a database prepared by reset.sh.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ADMIN_URL=${LOCAL_DB_ADMIN_URL:-postgresql://postgres:postgres@127.0.0.1:5432/postgres}
DB=${LOCAL_DB_NAME:-beatstore_local}
BIN="$HERE/.cache/postgrest"
mkdir -p "$HERE/.cache"
if [ ! -x "$BIN" ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz \
    | tar -xJ -C "$HERE/.cache"
fi
# PostgREST logs in as `authenticator` and switches to anon / authenticated / service_role.
psql "$ADMIN_URL" -q -c "ALTER ROLE authenticator WITH LOGIN PASSWORD 'authpass'" >/dev/null
SECRET=$(node -e "import('$HERE/jwt.mjs').then(m => console.log(m.SECRET))")
cat > "$HERE/.cache/postgrest.local-db.conf" <<CONF
db-uri = "postgres://authenticator:authpass@127.0.0.1:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3000
server-host = "127.0.0.1"
CONF
pkill -f '[p]ostgrest.local-db.conf' 2>/dev/null || true
pkill -f '[g]ateway.mjs' 2>/dev/null || true
nohup "$BIN" "$HERE/.cache/postgrest.local-db.conf" > "$HERE/.cache/postgrest.log" 2>&1 &
nohup node "$HERE/gateway.mjs" > "$HERE/.cache/gateway.log" 2>&1 &
# Wait (bounded) until PostgREST AND the gateway in front of it answer a real query with the service key, so the first
# request of a run never hits "TypeError: fetch failed" (review G19).
SERVICE_KEY=$(node -e "import('$HERE/jwt.mjs').then(m => console.log(m.SERVICE_KEY))")
ready=0
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
        'http://127.0.0.1:54321/rest/v1/creator_profiles?select=user_id&limit=1')" = 200 ]; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "local stack did not become ready within 60 s (see $HERE/.cache/*.log)" >&2; exit 1; }
echo "✓ local stack up — now: source scripts/local-db/env.sh && npm run dev -- -p 3457"
