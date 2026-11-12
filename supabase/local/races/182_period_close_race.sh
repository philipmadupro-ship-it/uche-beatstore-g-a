#!/usr/bin/env bash
# Two-session race for 182_labelos_finance_advances_close.sql (LABEL-64): a period close and an import
# cannot both win. Run by scripts/local-db/check.sh in its own copy of the database; RACE_DB_URL names it
# and `psql` is on PATH. Fails (non-zero) with a message on the first wrong outcome.
#
#  1. Close first (holds the lock for 2 s), import arrives while it is held → the import WAITS, then is
#     refused period_closed, and no import row exists in the period.
#  2. Import first (holds the lock for 2 s), close arrives while it is held → the close WAITS, then
#     succeeds: the import is in the period and the period is closed AFTER it.
#  3. Without the advisory lock at all (a bare UPDATE closing the period, a bare INSERT importing), the
#     period row lock alone serialises them: the INSERT waits for the close and is refused.
set -euo pipefail

SQL() { psql "$RACE_DB_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"; }
L=b1820000-0000-4000-8000-0000000000f1
O=a1820000-0000-4000-8000-0000000000f1
A=c1820000-0000-4000-8000-0000000000f1
P=d1820000-0000-4000-8000-0000000000f1
PY=e2820000-0000-4000-8000-0000000000f1
T=e1820000-0000-4000-8000-0000000000f1
SH=e3820000-0000-4000-8000-0000000000f1
PJ=e1820000-0000-4000-8000-0000000000e1

SQL <<SQLSETUP
INSERT INTO auth.users (id, email) VALUES ('$O', 'race182@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES ('$L', 'Race', 'race-182', 'label', '$O');
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES ('$L', '$O', 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES ('$A', NULL, '$L', 'Ara', 'race-ara182@local.test', 'artist');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES ('$PJ', NULL, '$L', 'EP');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES ('$T', NULL, '$L', '$O', 'Song', 'song', 'r2://private/orgs/l/race', 'inbox');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES ('$PJ', '$T', 0);
INSERT INTO public.parties (id, org_id, kind, display_name, contact_id) VALUES ('$P', '$L', 'person', 'Ara', '$A');
INSERT INTO public.payees (id, org_id, party_id, artist_contact_id, currency, created_by) VALUES ('$PY', '$L', '$P', '$A', 'USD', '$O');
INSERT INTO public.split_sheets (id, org_id, track_id, kind, version) VALUES ('$SH', '$L', '$T', 'master', 1);
INSERT INTO public.split_lines (split_sheet_id, party_id, role, share, position) VALUES ('$SH', '$P', 'master_owner', 100, 0);
UPDATE public.split_sheets SET status = 'circulated', circulated_at = now() WHERE id = '$SH';
INSERT INTO public.finance_periods (id, org_id, label, starts_on, ends_on) VALUES
  ('e4820000-0000-4000-8000-0000000000f1', '$L', 'R1', '2026-01-01', '2026-01-31'),
  ('e4820000-0000-4000-8000-0000000000f2', '$L', 'R2', '2026-02-01', '2026-02-28'),
  ('e4820000-0000-4000-8000-0000000000f3', '$L', 'R3', '2026-03-01', '2026-03-31');
SQLSETUP

import_sql() { # period, sha
  cat <<SQLIMPORT
SET ROLE service_role;
SELECT public.labelos_earnings_import('$L'::uuid, '$O'::uuid,
  jsonb_build_object('period_id', '$1', 'source', 'generic', 'file_name', 'f.csv', 'file_sha256', '$2', 'currency', 'USD', 'row_count', 1, 'total_minor', '1000'),
  jsonb_build_array(jsonb_build_object('line_no', 1, 'isrc', 'USABC2600009', 'track_id', '$T', 'song_track_id', '$T', 'gross_minor', '1000', 'currency', 'USD', 'income_class', 'master')),
  jsonb_build_array(jsonb_build_object('line_no', 1, 'payee_id', '$PY', 'party_id', '$P', 'song_track_id', '$T', 'kind', 'master', 'sheet_id', '$SH', 'basis', 'split', 'units', 1000000, 'payable_minor', '1000')),
  '[]'::jsonb);
SQLIMPORT
}
fail() { echo "RACE FAILED: $*" >&2; exit 1; }

# 1. close holds the lock; the import arrives mid-way.
P1=e4820000-0000-4000-8000-0000000000f1
( SQL <<SQLA
BEGIN;
SET ROLE service_role;
SELECT public.labelos_audit_period_close('$L', '$O', '$P1', '{}'::jsonb);
SELECT pg_sleep(2);
COMMIT;
SQLA
) >/dev/null &
CLOSER=$!
sleep 0.7
START=$(date +%s%N)
if import_sql "$P1" "$(printf '1%.0s' {1..64})" | SQL >/dev/null 2>"${TMPDIR:-/tmp}/race182.err"; then fail "1: an import was accepted into a period being closed"; fi
WAITED=$(( ($(date +%s%N) - START) / 1000000 ))
grep -q 'period_closed' "${TMPDIR:-/tmp}/race182.err" || fail "1: wrong refusal: $(cat "${TMPDIR:-/tmp}/race182.err")"
[ "$WAITED" -ge 800 ] || fail "1: the import did not wait for the close (${WAITED} ms)"
wait "$CLOSER"
[ "$(SQL -c "SELECT count(*) FROM public.earnings_imports WHERE period_id = '$P1'")" = 0 ] || fail "1: an import row exists in the closed period"
[ "$(SQL -c "SELECT status FROM public.finance_periods WHERE id = '$P1'")" = closed ] || fail "1: the period is not closed"

# 2. import holds the lock; the close arrives mid-way and waits for it.
P2=e4820000-0000-4000-8000-0000000000f2
( { echo "BEGIN;"; import_sql "$P2" "$(printf '2%.0s' {1..64})"; echo "SELECT pg_sleep(2);"; echo "COMMIT;"; } | SQL ) >/dev/null &
IMPORTER=$!
sleep 0.7
START=$(date +%s%N)
SQL <<SQLB >/dev/null || fail "2: the close was refused"
SET ROLE service_role;
SELECT public.labelos_audit_period_close('$L', '$O', '$P2', '{}'::jsonb);
SQLB
WAITED=$(( ($(date +%s%N) - START) / 1000000 ))
[ "$WAITED" -ge 800 ] || fail "2: the close did not wait for the import (${WAITED} ms)"
wait "$IMPORTER"
[ "$(SQL -c "SELECT count(*) FROM public.earnings_imports WHERE period_id = '$P2'")" = 1 ] || fail "2: the import is missing"
[ "$(SQL -c "SELECT status FROM public.finance_periods WHERE id = '$P2'")" = closed ] || fail "2: the period is not closed"

# 3. no advisory lock at all: a bare close and a bare INSERT, serialised by the period row alone.
P3=e4820000-0000-4000-8000-0000000000f3
( SQL <<SQLC
BEGIN;
UPDATE public.finance_periods SET status = 'closed', closed_at = clock_timestamp() WHERE id = '$P3';
SELECT pg_sleep(2);
COMMIT;
SQLC
) >/dev/null &
BARE=$!
sleep 0.7
START=$(date +%s%N)
if SQL -c "INSERT INTO public.earnings_imports (org_id, period_id, source, file_sha256, currency, row_count, total_minor, imported_by) VALUES ('$L', '$P3', 'generic', '$(printf '3%.0s' {1..64})', 'USD', 0, 0, '$O')" >/dev/null 2>"${TMPDIR:-/tmp}/race182.err"; then fail "3: a bare INSERT slipped into a period being closed"; fi
WAITED=$(( ($(date +%s%N) - START) / 1000000 ))
grep -q 'period_closed' "${TMPDIR:-/tmp}/race182.err" || fail "3: wrong refusal: $(cat "${TMPDIR:-/tmp}/race182.err")"
[ "$WAITED" -ge 800 ] || fail "3: the INSERT did not wait for the close (${WAITED} ms)"
wait "$BARE"
[ "$(SQL -c "SELECT count(*) FROM public.earnings_imports WHERE period_id = '$P3'")" = 0 ] || fail "3: an import row exists in the closed period"
echo "182 race: close and import serialise (3 cases)"
