-- Behaviour checks for 180_labelos_earnings.sql (LABEL-62), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Proven here (the arithmetic itself is proved in TypeScript, earnings-calc.test.ts):
--   · the import is ONE transaction, idempotent by file hash: a second call with
--     the same file writes nothing and returns the original import;
--   · the invariants that must never be false are enforced by the database even
--     against a buggy caller: a rate payee names its contract, a split payee does not;
--     the payees of a line are never owed more than the line (the label keeps the rest); no mixed currencies; the sheet is the song's
--     own; only a signed contract sets a rate; a recoupment never exceeds the
--     advance or the earnings, never touches a non-recoupable or void advance;
--   · a refused import leaves nothing behind (rolled back whole);
--   · the rows are fixed once written; a line waiting for review can be
--     resolved once; the API roles cannot call the write functions or write rows;
--   · reads (anon / authenticated, allow AND deny): finance.read staff read
--     allocations and recoupments; a member scoped to ONE artist reads only that
--     artist's payees' rows (and no earnings lines); marketing, a roster artist,
--     a stranger and anon read nothing; an org without the finance module reads nothing;
--   · the org's hard delete still takes everything.
--
-- Cast: label L, owner O, finance F (whole org), scoped finance S (artist A1),
-- marketing N, roster artist R1 (A1); stranger label L2 (owner Z).

\set O  '''a1800000-0000-4000-8000-000000000001'''
\set F  '''a1800000-0000-4000-8000-000000000002'''
\set S  '''a1800000-0000-4000-8000-000000000003'''
\set N  '''a1800000-0000-4000-8000-000000000004'''
\set R1 '''a1800000-0000-4000-8000-000000000005'''
\set Z  '''a1800000-0000-4000-8000-000000000006'''
\set L  '''b1800000-0000-4000-8000-000000000001'''
\set L2 '''b1800000-0000-4000-8000-000000000002'''
\set A1 '''c1800000-0000-4000-8000-0000000000a1'''
\set A2 '''c1800000-0000-4000-8000-0000000000a2'''
\set P1 '''d1800000-0000-4000-8000-000000000001'''
\set P2 '''d1800000-0000-4000-8000-000000000002'''
\set P3 '''d1800000-0000-4000-8000-000000000003'''
\set PX '''d1800000-0000-4000-8000-000000000004'''
\set PY1 '''e2800000-0000-4000-8000-000000000001'''
\set PY2 '''e2800000-0000-4000-8000-000000000002'''
\set PY3 '''e2800000-0000-4000-8000-000000000003'''
\set PJ1 '''e1800000-0000-4000-8000-0000000000b1'''
\set PJ2 '''e1800000-0000-4000-8000-0000000000b2'''
\set T1 '''e1800000-0000-4000-8000-000000000001'''
\set T2 '''e1800000-0000-4000-8000-000000000002'''
\set T3 '''e1800000-0000-4000-8000-000000000003'''
\set SH1 '''e3800000-0000-4000-8000-000000000001'''
\set SH2 '''e3800000-0000-4000-8000-000000000002'''
\set ADV1 '''e5800000-0000-4000-8000-000000000001'''
\set ADVNR '''e5800000-0000-4000-8000-000000000002'''
\set ADVV '''e5800000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o180@local.test'), (:F, 'f180@local.test'), (:S, 's180@local.test'), (:N, 'n180@local.test'), (:R1, 'r1180@local.test'), (:Z, 'z180@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-180', 'label', :O),
  (:L2, 'Label L2', 'label-l2-180', 'label', :Z);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :F, 'member', '{finance}', 'org'),
  (:L, :S, 'member', '{finance}', 'artists'),
  (:L, :N, 'member', '{marketing}', 'org'),
  (:L, :R1, 'artist', '{}', 'artists'),
  (:L2, :Z, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:A1, NULL, :L, 'Ara', 'ara180@local.test', 'artist'),
  (:A2, NULL, :L, 'Bo', 'bo180@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :S, :A1), (:L, :R1, :A1);
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:PJ1, NULL, :L, 'Ara EP'), (:PJ2, NULL, :L, 'Bo EP');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:T1, NULL, :L, :O, 'Night Shift', 'song', 'r2://private/orgs/l/t1', 'inbox'),
  (:T2, NULL, :L, :O, 'Bo song', 'song', 'r2://private/orgs/l/t2', 'inbox'),
  (:T3, NULL, :L, :O, 'No sheet', 'song', 'r2://private/orgs/l/t3', 'inbox');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:PJ1, :T1, 0), (:PJ2, :T2, 0);
INSERT INTO public.parties (id, org_id, kind, display_name, contact_id) VALUES
  (:P1, :L, 'person', 'Ara', :A1), (:P2, :L, 'person', 'Bo', :A2), (:P3, :L, 'person', 'Euro Ed', NULL), (:PX, :L2, 'person', 'X', NULL);
INSERT INTO public.payees (id, org_id, party_id, artist_contact_id, currency, created_by) VALUES
  (:PY1, :L, :P1, :A1, 'USD', :F), (:PY2, :L, :P2, :A2, 'USD', :F), (:PY3, :L, :P3, NULL, 'EUR', :F);
-- T1: Ara 60 % / Bo 40 %. T2: Bo 100 %.
INSERT INTO public.split_sheets (id, org_id, track_id, kind, version) VALUES (:SH1, :L, :T1, 'master', 1), (:SH2, :L, :T2, 'master', 1);
INSERT INTO public.split_lines (split_sheet_id, party_id, role, share, position) VALUES
  (:SH1, :P1, 'master_owner', 60, 0), (:SH1, :P2, 'master_owner', 40, 1), (:SH2, :P2, 'master_owner', 100, 0);
UPDATE public.split_sheets SET status = 'circulated', circulated_at = now() WHERE id IN (:SH1, :SH2);
INSERT INTO public.finance_periods (id, org_id, label, starts_on, ends_on) VALUES ('e4800000-0000-4000-8000-000000000001', :L, 'Closed', '2025-01-01', '2025-03-31');
UPDATE public.finance_periods SET status = 'closed', closed_at = now() WHERE id = 'e4800000-0000-4000-8000-000000000001';
INSERT INTO public.advances (id, org_id, payee_id, kind, amount_minor, currency) VALUES
  (:ADV1, :L, :PY1, 'recoupable', 500, 'USD'),
  (:ADVNR, :L, :PY1, 'non_recoupable', 900, 'USD');
INSERT INTO public.advances (id, org_id, payee_id, kind, amount_minor, currency, voided_at) VALUES (:ADVV, :L, :PY1, 'recoupable', 900, 'USD', NULL);
UPDATE public.advances SET voided_at = now() WHERE id = :ADVV;

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
CREATE FUNCTION public.check_raises(label text, stmt text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* pattern THEN RETURN; END IF;
    RAISE EXCEPTION 'CHECK FAILED: % — raised "%", wanted /%/', label, SQLERRM, pattern;
  END;
  RAISE EXCEPTION 'CHECK FAILED: % — statement succeeded, wanted /%/', label, pattern;
END $$;
CREATE FUNCTION public.as_user(p_user text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
CREATE FUNCTION public.vis(p_table text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('SELECT count(*)::int FROM public.%I', p_table) INTO n;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text),
  public.as_user(text), public.vis(text) TO anon, authenticated;

-- ── Shape ───────────────────────────────────────────────────────────────

SELECT public.check_eq('both new tables have RLS on and no user_id',
  (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relrowsecurity
     AND c.relname IN ('earnings_allocations', 'earnings_recoupments')
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)), 2);
SELECT public.check_eq('no money column is numeric or float',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name IN ('earnings_allocations', 'earnings_recoupments') AND column_name LIKE '%\_minor' ESCAPE '\' AND data_type <> 'bigint'), 0);

-- ── The import: one transaction, idempotent ─────────────────────────────

CREATE FUNCTION public.chk_payload(p_sha text, p_alloc_ara bigint, p_alloc_bo bigint, p_payable_ara bigint) RETURNS TABLE (imp jsonb, lines jsonb, allocs jsonb, recoups jsonb)
LANGUAGE sql AS $$
  SELECT
    jsonb_build_object('period_id', NULL, 'source', 'generic', 'file_name', 'q3.csv', 'file_sha256', p_sha, 'currency', 'USD', 'row_count', 3, 'total_minor', '1600'),
    jsonb_build_array(
      jsonb_build_object('line_no', 2, 'isrc', 'USABC2600001', 'track_id', 'e1800000-0000-4000-8000-000000000001', 'song_track_id', 'e1800000-0000-4000-8000-000000000001', 'gross_minor', '1000', 'currency', 'USD', 'income_class', 'master'),
      jsonb_build_object('line_no', 3, 'isrc', 'USABC2600003', 'track_id', 'e1800000-0000-4000-8000-000000000003', 'song_track_id', 'e1800000-0000-4000-8000-000000000003', 'gross_minor', '600', 'currency', 'USD', 'income_class', 'master', 'review_reason', 'no_sheet'),
      jsonb_build_object('line_no', 4, 'gross_minor', '0', 'currency', 'USD', 'income_class', 'master', 'review_reason', 'no_identifier')),
    jsonb_build_array(
      jsonb_build_object('line_no', 2, 'payee_id', 'e2800000-0000-4000-8000-000000000001', 'party_id', 'd1800000-0000-4000-8000-000000000001', 'song_track_id', 'e1800000-0000-4000-8000-000000000001', 'kind', 'master',
        'sheet_id', 'e3800000-0000-4000-8000-000000000001', 'basis', 'split', 'units', 600000, 'payable_minor', p_payable_ara::text),
      jsonb_build_object('line_no', 2, 'payee_id', 'e2800000-0000-4000-8000-000000000002', 'party_id', 'd1800000-0000-4000-8000-000000000002', 'song_track_id', 'e1800000-0000-4000-8000-000000000001', 'kind', 'master',
        'sheet_id', 'e3800000-0000-4000-8000-000000000001', 'basis', 'split', 'units', 400000, 'payable_minor', p_alloc_bo::text)),
    jsonb_build_array(jsonb_build_object('line_no', 2, 'payee_id', 'e2800000-0000-4000-8000-000000000001', 'advance_id', 'e5800000-0000-4000-8000-000000000001', 'amount_minor', '500'));
$$;

SET ROLE service_role;
SELECT public.check_eq('the import is created',
  (SELECT public.labelos_earnings_import(:L, :F, p.imp, p.lines, p.allocs, p.recoups) ->> 'created' FROM public.chk_payload(repeat('a', 64), 600, 400, 600) p), 'true');
RESET ROLE;
SELECT public.check_eq('import: lines written', (SELECT count(*)::int FROM public.earnings_lines WHERE org_id = :L), 3);
SELECT public.check_eq('import: allocations written', (SELECT count(*)::int FROM public.earnings_allocations WHERE org_id = :L), 2);
SELECT public.check_eq('import: recoupment written', (SELECT sum(amount_minor)::int FROM public.earnings_recoupments WHERE org_id = :L), 500);
SELECT public.check_eq('an allocation takes its artist from its payee',
  (SELECT artist_contact_id FROM public.earnings_allocations WHERE payee_id = :PY1), 'c1800000-0000-4000-8000-0000000000a1'::uuid);
SELECT public.check_eq('the payees of the line are owed exactly the line when everyone is on the split',
  (SELECT sum(payable_minor)::int FROM public.earnings_allocations), 1000);

SET ROLE service_role;
SELECT public.check_eq('the same file again returns the original import and says it was not created',
  (SELECT (public.labelos_earnings_import(:L, :F, p.imp, p.lines, p.allocs, p.recoups) ->> 'created') FROM public.chk_payload(repeat('a', 64), 600, 400, 600) p), 'false');
RESET ROLE;
SELECT public.check_eq('...and wrote nothing more',
  (SELECT (SELECT count(*) FROM public.earnings_lines) + (SELECT count(*) FROM public.earnings_allocations) + (SELECT count(*) FROM public.earnings_recoupments) + (SELECT count(*) FROM public.earnings_imports))::int, 3 + 2 + 1 + 1);
SELECT public.check_eq('...even when another user imports it', (SELECT count(*)::int FROM public.earnings_imports WHERE imported_by = :F), 1);

-- ── Refusals leave nothing behind ───────────────────────────────────────

SET ROLE service_role;
SELECT public.check_raises('payees owed more than the line are refused',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, p.allocs, '[]'::jsonb) FROM public.chk_payload(repeat('b', 64), 600, 401, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'allocation_mismatch');
SELECT public.check_raises('a rate payee names its contract; a split payee does not',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, jsonb_set(p.allocs, '{0,basis}', '"rate"'), '[]'::jsonb) FROM public.chk_payload(repeat('c', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'basis_contract_check');
SELECT public.check_raises('a payee paid with the opposite sign of the line is refused',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, jsonb_set(jsonb_set(p.allocs, '{0,payable_minor}', '"-600"'), '{1,payable_minor}', '"1600"'), '[]'::jsonb) FROM public.chk_payload(repeat('c', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'allocation_mismatch');
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.check_eq('a label may keep part of a line: payees owed less than the line are accepted (label retains the rest)',
  (SELECT public.labelos_earnings_import(:L, :F, p.imp, p.lines, p.allocs, '[]'::jsonb) ->> 'created' FROM public.chk_payload(repeat('d1', 32), 600, 300, 600) p), 'true');
ROLLBACK;
SELECT public.check_raises('a recoupment larger than the advance is refused',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, p.allocs, jsonb_build_array(jsonb_build_object('line_no', 2, 'payee_id', %L, 'advance_id', %L, 'amount_minor', '501'))) FROM public.chk_payload(repeat('d', 64), 600, 400, 600) p$$,
    'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002', 'e2800000-0000-4000-8000-000000000001', 'e5800000-0000-4000-8000-000000000001'),
  'recoup_exceeds_advance');
SELECT public.check_raises('a recoupment larger than the earnings is refused (advance 500, payable 100)',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, p.allocs, jsonb_build_array(jsonb_build_object('line_no', 2, 'payee_id', %L, 'advance_id', %L, 'amount_minor', '200'))) FROM public.chk_payload(repeat('e', 64), 100, 900, 100) p$$,
    'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002', 'e2800000-0000-4000-8000-000000000001', 'e5800000-0000-4000-8000-000000000001'),
  'recoup_exceeds_earnings|recoup_exceeds_advance');
SELECT public.check_raises('a non-recoupable advance is never recouped',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, p.allocs, jsonb_build_array(jsonb_build_object('line_no', 2, 'payee_id', %L, 'advance_id', %L, 'amount_minor', '1'))) FROM public.chk_payload(repeat('f', 64), 600, 400, 600) p$$,
    'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002', 'e2800000-0000-4000-8000-000000000001', 'e5800000-0000-4000-8000-000000000002'),
  'live recoupable advance');
SELECT public.check_raises('a void advance is never recouped',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, p.allocs, jsonb_build_array(jsonb_build_object('line_no', 2, 'payee_id', %L, 'advance_id', %L, 'amount_minor', '1'))) FROM public.chk_payload(repeat('1', 64), 600, 400, 600) p$$,
    'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002', 'e2800000-0000-4000-8000-000000000001', 'e5800000-0000-4000-8000-000000000003'),
  'live recoupable advance');
SELECT public.check_raises('the sheet must be the song''s own (T1 line, T2 sheet)',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, jsonb_set(p.allocs, '{0,sheet_id}', '"e3800000-0000-4000-8000-000000000002"'), '[]'::jsonb) FROM public.chk_payload(repeat('2', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'not this song');
SELECT public.check_raises('currencies are never mixed: an EUR payee on a USD line',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, jsonb_set(p.allocs, '{0,payee_id}', '"e2800000-0000-4000-8000-000000000003"'), '[]'::jsonb) FROM public.chk_payload(repeat('3', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'not that party|never mixed|belongs to another');
SELECT public.check_raises('a line that waits for review cannot also be allocated',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, jsonb_set(p.lines, '{0,review_reason}', '"no_sheet"'), p.allocs, '[]'::jsonb) FROM public.chk_payload(repeat('4', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'waiting for review cannot be allocated');
SELECT public.check_raises('the header must match the lines',
  format($$SELECT public.labelos_earnings_import(%L, %L, jsonb_set(p.imp, '{total_minor}', '"1601"'), p.lines, '[]'::jsonb, '[]'::jsonb) FROM public.chk_payload(repeat('5', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'do not add up to the import header');
SELECT public.check_raises('an allocation that names no line of the import is refused, not dropped',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, p.allocs || jsonb_build_array(jsonb_build_object('line_no', 99, 'payee_id', 'e2800000-0000-4000-8000-000000000002', 'party_id', 'd1800000-0000-4000-8000-000000000002', 'song_track_id', 'e1800000-0000-4000-8000-000000000001', 'kind', 'master', 'sheet_id', 'e3800000-0000-4000-8000-000000000001', 'basis', 'split', 'units', 1, 'payable_minor', '0')), '[]'::jsonb) FROM public.chk_payload(repeat('7', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'names a line that is not in this import');
SELECT public.check_raises('a line with no review reason and no allocation is refused',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, '[]'::jsonb, '[]'::jsonb) FROM public.chk_payload(repeat('8', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'no review reason has no allocation');
SELECT public.check_raises('a closed period takes no import',
  format($$SELECT public.labelos_earnings_import(%L, %L, jsonb_set(p.imp, '{period_id}', to_jsonb(%L::text)), p.lines, p.allocs, '[]'::jsonb) FROM public.chk_payload(repeat('9', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002', 'e4800000-0000-4000-8000-000000000001'),
  'period_closed');
SELECT public.check_raises('an import into another organization''s party is refused',
  format($$SELECT public.labelos_earnings_import(%L, %L, p.imp, p.lines, jsonb_set(p.allocs, '{0,party_id}', '"d1800000-0000-4000-8000-000000000004"'), '[]'::jsonb) FROM public.chk_payload(repeat('6', 64), 600, 400, 600) p$$, 'b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002'),
  'not that party|another organization');
RESET ROLE;
SELECT public.check_eq('every refused import was rolled back whole', (SELECT count(*)::int FROM public.earnings_imports), 1);
SELECT public.check_eq('...with no stray line', (SELECT count(*)::int FROM public.earnings_lines), 3);

-- ── Fixed once written ──────────────────────────────────────────────────

SELECT public.check_raises('an allocation is never edited', $$UPDATE public.earnings_allocations SET payable_minor = 1$$, 'fixed once written');
SELECT public.check_raises('an allocation is never deleted', $$DELETE FROM public.earnings_allocations$$, 'never deleted');
SELECT public.check_raises('a recoupment is never edited', $$UPDATE public.earnings_recoupments SET amount_minor = 1$$, 'fixed once written');
SELECT public.check_raises('an earnings line''s amount is fixed', $$UPDATE public.earnings_lines SET gross_minor = 1$$, 'fixed once written');
SELECT public.check_raises('a line''s income class is fixed', $$UPDATE public.earnings_lines SET income_class = 'publishing'$$, 'fixed once written');
SELECT public.check_raises('an unknown review reason is refused',
  $$UPDATE public.earnings_lines SET review_reason = 'because' WHERE line_no = 3$$, 'review_reason_check');

-- ── Resolving a line that waited ────────────────────────────────────────

INSERT INTO public.split_sheets (id, org_id, track_id, kind, version) VALUES ('e3800000-0000-4000-8000-000000000003', :L, :T3, 'master', 1);
INSERT INTO public.split_lines (split_sheet_id, party_id, role, share, position) VALUES ('e3800000-0000-4000-8000-000000000003', :P2, 'master_owner', 100, 0);
UPDATE public.split_sheets SET status = 'circulated', circulated_at = now() WHERE id = 'e3800000-0000-4000-8000-000000000003';
SET ROLE service_role;
SELECT public.check_raises('a line that is not waiting cannot be resolved again',
  format($$SELECT public.labelos_earnings_resolve(%L, %L, jsonb_build_array(jsonb_build_object('line_id', (SELECT id FROM public.earnings_lines WHERE line_no = 2), 'track_id', NULL, 'song_track_id', NULL, 'review_reason', 'no_sheet')), '[]'::jsonb, '[]'::jsonb)$$,
    'b1800000-0000-4000-8000-000000000001', (SELECT id FROM public.earnings_imports LIMIT 1)::text)::text,
  'line_not_waiting');
SELECT public.labelos_earnings_resolve(:L, (SELECT id FROM public.earnings_imports LIMIT 1),
  jsonb_build_array(jsonb_build_object('line_id', (SELECT id FROM public.earnings_lines WHERE line_no = 3), 'track_id', :T3, 'song_track_id', :T3, 'review_reason', NULL)),
  jsonb_build_array(jsonb_build_object('line_id', (SELECT id FROM public.earnings_lines WHERE line_no = 3), 'payee_id', :PY2, 'party_id', :P2, 'song_track_id', :T3, 'kind', 'master',
    'sheet_id', 'e3800000-0000-4000-8000-000000000003', 'basis', 'split', 'units', 1000000, 'payable_minor', '600')),
  '[]'::jsonb);
RESET ROLE;
SELECT public.check_eq('the waiting line is now allocated and no longer waiting',
  (SELECT (SELECT count(*) FROM public.earnings_lines WHERE line_no = 3 AND review_reason IS NULL) + (SELECT count(*) FROM public.earnings_allocations WHERE payee_id = :PY2 AND payable_minor = 600))::int, 2);

-- ── Who can call the write functions or write rows ──────────────────────

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_raises('an authenticated caller cannot call the import function',
  $$SELECT public.labelos_earnings_import('b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000001', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)$$, 'permission denied');
SELECT public.check_raises('...nor the re-run function',
  $$SELECT public.labelos_earnings_resolve('b1800000-0000-4000-8000-000000000001', 'b1800000-0000-4000-8000-000000000001', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)$$, 'permission denied');
SELECT public.check_raises('...nor the internal writer',
  $$SELECT public.labelos_earnings_write('b1800000-0000-4000-8000-000000000001', 'b1800000-0000-4000-8000-000000000001', '[]'::jsonb, '[]'::jsonb)$$, 'permission denied');
SELECT public.check_raises('an owner cannot write an allocation directly',
  $$INSERT INTO public.earnings_allocations (org_id) VALUES ('b1800000-0000-4000-8000-000000000001')$$, 'permission denied|row-level security|service');
RESET ROLE;
SET ROLE anon;
SELECT public.check_raises('anon cannot call the import function',
  $$SELECT public.labelos_earnings_import('b1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000001', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)$$, 'permission denied');
SELECT public.check_raises('anon has no privilege on allocations at all', $$SELECT count(*) FROM public.earnings_allocations$$, 'permission denied');
RESET ROLE;

-- ── Reads ───────────────────────────────────────────────────────────────

SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('owner: allocations', public.vis('earnings_allocations'), 3);
SELECT public.check_eq('owner: recoupments', public.vis('earnings_recoupments'), 1);
SELECT public.as_user(:F);
SELECT public.check_eq('finance member: allocations', public.vis('earnings_allocations'), 3);
SELECT public.check_eq('finance member: recoupments', public.vis('earnings_recoupments'), 1);
SELECT public.as_user(:S);
SELECT public.check_eq('finance scoped to Ara: only Ara''s payee''s allocation', public.vis('earnings_allocations'), 1);
SELECT public.check_eq('finance scoped to Ara: Ara''s recoupment', public.vis('earnings_recoupments'), 1);
SELECT public.check_eq('finance scoped to Ara: no earnings lines (whole-org only)', public.vis('earnings_lines'), 0);
SELECT public.as_user(:N);
SELECT public.check_eq('marketing: no allocations', public.vis('earnings_allocations') + public.vis('earnings_recoupments'), 0);
SELECT public.as_user(:R1);
SELECT public.check_eq('roster artist: no allocations, no recoupments, no lines', public.vis('earnings_allocations') + public.vis('earnings_recoupments') + public.vis('earnings_lines'), 0);
SELECT public.as_user(:Z);
SELECT public.check_eq('a stranger''s owner reads nothing', public.vis('earnings_allocations') + public.vis('earnings_recoupments'), 0);
RESET ROLE;

INSERT INTO public.org_entitlements (org_id, modules) VALUES (:L, ARRAY['contracts']);
SET ROLE authenticated;
SELECT public.as_user(:O);
SELECT public.check_eq('module off: the owner reads no allocation', public.vis('earnings_allocations'), 0);
RESET ROLE;
DELETE FROM public.org_entitlements WHERE org_id = :L;

-- ── A deleted song nulls the match and keeps the money ──────────────────

DELETE FROM public.project_tracks WHERE track_id = :T3;
SELECT public.check_raises('a song with allocations cannot be deleted (the allocation keeps its song)',
  format($$DELETE FROM public.tracks WHERE id = %L$$, 'e1800000-0000-4000-8000-000000000003'), 'foreign key|violates');

-- ── The org's hard delete takes it all ──────────────────────────────────

DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('hard delete: nothing of the org is left',
  (SELECT (SELECT count(*) FROM public.earnings_allocations WHERE org_id = 'b1800000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.earnings_recoupments WHERE org_id = 'b1800000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.earnings_lines WHERE org_id = 'b1800000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.earnings_imports WHERE org_id = 'b1800000-0000-4000-8000-000000000001'))::int, 0);
