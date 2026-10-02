#!/usr/bin/env bash
#
# Prove the migrations on a THROWAWAY local Postgres — run before pushing any
# change under supabase/ (owner decision 2026-10-01: always run a local
# database).
#
#   npm run db:local:check                    # start, check, delete
#   KEEP_LOCAL_DB=1 npm run db:local:check    # leave it running to poke at
#
# Unlike reset.sh, it needs no server: it initdbs one in a temp directory on
# 127.0.0.1:${LOCAL_DB_PORT:-55432} and deletes it afterwards. It never reads
# SUPABASE_DB_URL, so it cannot touch staging or production.
#
#   1. reset.sh against that server: bootstrap.sql, EVERY migration twice
#      through scripts/apply-migrations.sh (the deploy runner), seed.sql;
#   2. each supabase/local/checks/*.sql in its own copy of the database, so
#      checks cannot see each other's rows and deferred triggers really fire
#      at COMMIT. A check fails by raising;
#   3. capability parity: the real has_org_cap against capabilitiesFor() on
#      generated fixtures (capability-parity.ts);
#   4. every supabase/rollback/NNN_*.down.sql in one copy, newest first
#      (each after every later rollback), then those migrations again.
#
# Needs a Postgres server install (initdb, pg_ctl, psql) and Node. Run as
# root, the server runs as the `postgres` OS user.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${LOCAL_DB_PORT:-55432}"
DB=beatstore_check
ADMIN_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"

find_bin() {
  if command -v "$1" >/dev/null 2>&1; then command -v "$1"; return; fi
  if command -v pg_config >/dev/null 2>&1 && [ -x "$(pg_config --bindir)/$1" ]; then
    echo "$(pg_config --bindir)/$1"; return
  fi
  local found
  found="$(ls -d /usr/lib/postgresql/*/bin/"$1" 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$found" ]; then echo "$found"; return; fi
  echo "db:local:check: '$1' not found — install a Postgres server (apt install postgresql / brew install postgresql)" >&2
  exit 1
}
INITDB="$(find_bin initdb)"
PG_CTL="$(find_bin pg_ctl)"
PSQL="$(find_bin psql)"
export PATH="$(dirname "$PSQL"):$PATH" # reset.sh / apply-migrations.sh call `psql`

WORK="$(mktemp -d "${LOCAL_DB_TMP:-/tmp}/beatstore-db.XXXXXX")"
DATA="$WORK/data"
as_server() {
  if [ "$(id -u)" = 0 ]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi
}
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; chmod 755 "$WORK"; fi

cleanup() {
  if [ "${KEEP_LOCAL_DB:-}" = 1 ]; then
    echo "db:local:check: kept running — psql $ADMIN_URL (database $DB)"
    echo "                stop with: $PG_CTL -D $DATA stop && rm -rf $WORK"
    return
  fi
  as_server "'$PG_CTL' -D '$DATA' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

as_server "'$INITDB' -D '$DATA' -U postgres -A trust --no-sync" >/dev/null
as_server "'$PG_CTL' -D '$DATA' -l '$WORK/server.log' -w \
  -o \"-p $PORT -k '' -c listen_addresses=127.0.0.1 -c fsync=off -c wal_level=logical\" start" >/dev/null \
  || { cat "$WORK/server.log" >&2; exit 1; }

psql_db() { # db, then psql args
  local db="$1"; shift
  PGOPTIONS='-c client_min_messages=warning' \
    "$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -X "$@"
}
copy_db() { psql_db postgres -c "CREATE DATABASE $2 TEMPLATE $1"; }

# 1. reset.sh swallows pass-1 output, so a broken migration shows up as a
#    failed pass 2; rerun the runner by hand to see which file.
LOCAL_DB_ADMIN_URL="$ADMIN_URL" LOCAL_DB_NAME="$DB" bash "$HERE/reset.sh" >/dev/null \
  || { echo "db:local:check: FAILED in reset.sh (bootstrap / migrations twice / seed)" >&2; exit 1; }
count=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')
echo "db:local:check: reset ok — $count migrations applied twice, seeded"

shopt -s nullglob
n=0
for f in "$ROOT"/supabase/local/checks/*.sql; do
  n=$((n + 1))
  copy_db "$DB" "check_$n"
  psql_db "check_$n" -o /dev/null -f "$f" \
    || { echo "db:local:check: FAILED check $(basename "$f")" >&2; exit 1; }
  echo "db:local:check: check ok — $(basename "$f")"
done

org_core=("$ROOT"/supabase/migrations/*_labelos_org_core.sql)
if [ ${#org_core[@]} -gt 0 ]; then
  copy_db "$DB" check_parity
  (cd "$ROOT" && npx --no-install jiti scripts/local-db/capability-parity.ts "$WORK/parity.sql") >/dev/null
  psql_db check_parity -f "$WORK/parity.sql" \
    || { echo "db:local:check: FAILED capability parity (has_org_cap vs capabilitiesFor)" >&2; exit 1; }
  echo "db:local:check: capability parity ok — has_org_cap == capabilitiesFor"
fi

# Rollbacks run the way they are used by hand: newest first, each after the
# rollbacks of every later migration (later migrations build on earlier
# ones — 141's policies call 139's can_see_artist), all in one copy. Then
# every migration is re-applied, oldest first, proving each rollback left a
# database its migration applies to cleanly. Linear in the number of files.
downs=("$ROOT"/supabase/rollback/*.down.sql)
if [ ${#downs[@]} -gt 0 ]; then
  for down in "${downs[@]}"; do
    up="$ROOT/supabase/migrations/$(basename "$down" .down.sql).sql"
    [ -f "$up" ] || { echo "db:local:check: $(basename "$down") has no matching migration" >&2; exit 1; }
  done
  copy_db "$DB" rollback_all
  for ((j = ${#downs[@]} - 1; j >= 0; j--)); do
    psql_db rollback_all --single-transaction -f "${downs[$j]}"
    echo "db:local:check: rollback ok — $(basename "${downs[$j]}")"
  done
  for down in "${downs[@]}"; do
    psql_db rollback_all --single-transaction -f "$ROOT/supabase/migrations/$(basename "$down" .down.sql).sql"
  done
  echo "db:local:check: re-applied ${#downs[@]} migration(s) after their rollbacks"
fi

echo "db:local:check: ✓ all passed (throwaway database $( [ "${KEEP_LOCAL_DB:-}" = 1 ] && echo kept || echo deleted ))"
