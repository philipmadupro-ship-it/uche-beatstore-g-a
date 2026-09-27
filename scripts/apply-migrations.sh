#!/usr/bin/env bash
#
# Apply all Supabase SQL migrations in order.
#
# Every migration in supabase/migrations/ is idempotent (CREATE ... IF NOT
# EXISTS, guarded DO blocks) and ends with `NOTIFY pgrst, 'reload schema'`, so
# running the full set is safe and re-runnable — that's the deploy contract.
#
# Usage:
#   SUPABASE_DB_URL='postgresql://...pooler.supabase.com:5432/postgres' \
#     npm run db:migrate
#
# Get SUPABASE_DB_URL from: Supabase dashboard → Project Settings → Database →
# Connection string (use the direct/session connection, not the transaction
# pooler, so multi-statement migrations run in one session).
#
# Apply migrations on STAGING first, then prod. Run BEFORE deploying code that
# depends on the new schema.

set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the Supabase Postgres connection string}"

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required (brew install libpq && brew link --force libpq)." >&2
  exit 1
fi

shopt -s nullglob
files=("$MIGRATIONS_DIR"/*.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "No migrations found in $MIGRATIONS_DIR" >&2
  exit 1
fi

echo "Applying ${#files[@]} migration(s) from $MIGRATIONS_DIR"
for f in "${files[@]}"; do
  echo "→ $(basename "$f")"
  # --single-transaction: each file is atomic, and the `CREATE TEMP TABLE
  # ... ON COMMIT DROP` in 096/110/112 survives past its own statement. In
  # autocommit it was dropped immediately and the next line failed, which
  # stopped this runner at 096.
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$f"
done

echo "✓ All migrations applied. PostgREST schema reloaded (wait ~10s for cache)."
