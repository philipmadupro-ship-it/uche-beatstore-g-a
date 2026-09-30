#!/usr/bin/env bash
# Recreate the local verification database and apply EVERY migration with the
# same runner production uses (scripts/apply-migrations.sh), then seed.
#   LOCAL_DB_ADMIN_URL  superuser URL for the server (default postgres@127.0.0.1)
#   LOCAL_DB_NAME       database to (re)create (default beatstore_local)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ADMIN_URL=${LOCAL_DB_ADMIN_URL:-postgresql://postgres:postgres@127.0.0.1:5432/postgres}
DB=${LOCAL_DB_NAME:-beatstore_local}
DB_URL="${ADMIN_URL%/*}/$DB"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$HERE/bootstrap.sql"
SUPABASE_DB_URL="$DB_URL" bash "$HERE/../apply-migrations.sh" 2>&1 | grep -vE 'NOTICE|wal_level|HINT' || true
# Apply twice: the deploy contract is that re-running every migration is a no-op.
SUPABASE_DB_URL="$DB_URL" bash "$HERE/../apply-migrations.sh" >/dev/null 2>&1
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$HERE/seed.sql"
# PostgREST (if running) must re-read the schema of the new database.
pkill -USR1 -f '[p]ostgrest.local-db.conf' 2>/dev/null || true
echo "✓ $DB reset: migrations applied twice, seeded"
