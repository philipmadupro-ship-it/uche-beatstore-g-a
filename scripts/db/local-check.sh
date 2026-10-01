#!/usr/bin/env bash
#
# Verify the migrations against a THROWAWAY local Postgres.
#
#   npm run db:local-check            # build, check, delete
#   KEEP_LOCAL_DB=1 npm run db:local-check   # leave it running to poke at
#
# Every schema change runs this before it is pushed. It never reads
# SUPABASE_DB_URL and never connects anywhere but the cluster it creates in a
# temp directory, so it cannot touch staging or production.
#
# Steps, each stopping on the first error:
#   1. initdb a fresh cluster on 127.0.0.1:${LOCAL_DB_PORT:-55432};
#   2. supabase/local/stubs.sql (API roles, auth.users/auth.uid(), realtime);
#   3. every supabase/migrations/*.sql in order, one transaction per file —
#      the same contract as scripts/apply-migrations.sh;
#   4. the whole set AGAIN: migrations must be idempotent;
#   5. each supabase/local/checks/*.sql, in its own copy of the database, so
#      checks cannot see each other's rows and deferred triggers really fire
#      at COMMIT. A check fails by raising;
#   6. the capability parity check: has_org_cap against capabilitiesFor()
#      for every generated fixture (scripts/db/capability-parity.ts);
#   7. each supabase/rollback/NNN_*.down.sql in its own copy, then its
#      migration again: rollbacks must work and leave a re-appliable schema.
#
# Needs a Postgres 15+ server install (initdb, pg_ctl, psql) and Node for
# step 6. Run as root, it runs the server as the `postgres` OS user.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${LOCAL_DB_PORT:-55432}"
DB=antigravity

find_bin() {
  if command -v "$1" >/dev/null 2>&1; then command -v "$1"; return; fi
  if command -v pg_config >/dev/null 2>&1 && [ -x "$(pg_config --bindir)/$1" ]; then
    echo "$(pg_config --bindir)/$1"; return
  fi
  local found
  found="$(ls -d /usr/lib/postgresql/*/bin/"$1" 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$found" ]; then echo "$found"; return; fi
  echo "local-check: '$1' not found — install a Postgres server (apt install postgresql / brew install postgresql)" >&2
  exit 1
}
INITDB="$(find_bin initdb)"
PG_CTL="$(find_bin pg_ctl)"
PSQL="$(find_bin psql)"

WORK="$(mktemp -d "${LOCAL_DB_TMP:-/tmp}/antigravity-db.XXXXXX")"
DATA="$WORK/data"

as_server() {
  if [ "$(id -u)" = 0 ]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi
}
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; chmod 755 "$WORK"; fi

cleanup() {
  if [ "${KEEP_LOCAL_DB:-}" = 1 ]; then
    echo "local-check: kept running — psql -h 127.0.0.1 -p $PORT -U postgres $DB"
    echo "             stop with: $PG_CTL -D $DATA stop && rm -rf $WORK"
    return
  fi
  as_server "'$PG_CTL' -D '$DATA' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

as_server "'$INITDB' -D '$DATA' -U postgres -A trust --no-sync" >/dev/null
as_server "'$PG_CTL' -D '$DATA' -l '$WORK/server.log' -w \
  -o \"-p $PORT -k '' -c listen_addresses=127.0.0.1 -c fsync=off\" start" >/dev/null \
  || { cat "$WORK/server.log" >&2; exit 1; }

psql_db() { # db, then psql args
  local db="$1"; shift
  PGOPTIONS='-c client_min_messages=warning' \
    "$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -X "$@"
}
copy_db() { psql_db postgres -c "CREATE DATABASE $2 TEMPLATE $1"; }

psql_db postgres -c "CREATE DATABASE $DB"
psql_db "$DB" -f "$ROOT/supabase/local/stubs.sql"

shopt -s nullglob
migrations=("$ROOT"/supabase/migrations/*.sql)
for pass in 1 2; do
  for f in "${migrations[@]}"; do
    psql_db "$DB" --single-transaction -f "$f" \
      || { echo "local-check: FAILED applying $(basename "$f") (pass $pass)" >&2; exit 1; }
  done
  echo "local-check: pass $pass — ${#migrations[@]} migrations applied"
done

n=0
for f in "$ROOT"/supabase/local/checks/*.sql; do
  n=$((n + 1))
  copy_db "$DB" "check_$n"
  psql_db "check_$n" -f "$f" \
    || { echo "local-check: FAILED check $(basename "$f")" >&2; exit 1; }
  echo "local-check: check ok — $(basename "$f")"
done

org_core=("$ROOT"/supabase/migrations/*_labelos_org_core.sql)
if [ ${#org_core[@]} -gt 0 ]; then
  copy_db "$DB" check_parity
  (cd "$ROOT" && npx --no-install jiti scripts/db/capability-parity.ts "$WORK/parity.sql")
  psql_db check_parity -f "$WORK/parity.sql" \
    || { echo "local-check: FAILED capability parity (has_org_cap vs capabilitiesFor)" >&2; exit 1; }
  echo "local-check: capability parity ok — has_org_cap == capabilitiesFor"
fi

n=0
for down in "$ROOT"/supabase/rollback/*.down.sql; do
  n=$((n + 1))
  up="$ROOT/supabase/migrations/$(basename "$down" .down.sql).sql"
  [ -f "$up" ] || { echo "local-check: $(basename "$down") has no matching migration" >&2; exit 1; }
  copy_db "$DB" "rollback_$n"
  psql_db "rollback_$n" --single-transaction -f "$down"
  psql_db "rollback_$n" --single-transaction -f "$up"
  echo "local-check: rollback ok — $(basename "$down") then re-apply"
done

echo "local-check: ✓ all passed (throwaway database $( [ "${KEEP_LOCAL_DB:-}" = 1 ] && echo kept || echo deleted ))"
