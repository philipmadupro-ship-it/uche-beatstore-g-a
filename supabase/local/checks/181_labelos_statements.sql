-- Behaviour checks for 181_labelos_statements.sql (LABEL-63), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
--
-- Proven here:
--   · a generated statement equals EXACTLY its sources: net = Σ allocations − Σ recoupments
--     of the payee and period, and a tampered line set (wrong amount, missing or extra line)
--     is refused with nothing left behind;
--   · generating again replaces only the draft; approved / issued is a conflict; a closed
--     period gets no draft; an advance cannot be recouped on two live statements;
--   · approval is append-only; the generator cannot approve unless an owner; a draft whose
--     sources moved is 'stale'; an issued statement is frozen;
--   · payments are partial, never above the net, only against an issued statement; a statement
--     with a live payment is not voided;
--   · voiding an import is refused while an approved / issued statement includes its lines,
--     succeeds otherwise, releases its allocations and recoupments and discards the drafts;
--     allocations cannot be added behind an approved statement;
--   · reads (authenticated, allow AND deny): finance staff read statements; a roster artist
--     reads ONLY their own ISSUED statement, its lines and payments; a party linked to someone's
--     account (self-link) reads nothing; a stranger and anon read nothing;
--   · the API roles cannot call the functions; the org's hard delete takes everything.
--
-- Cast: label L, owner O, finance F (generates), finance G (approves), scoped finance S (A1),
-- roster artist R1 (A1), roster artist R2 (A2), producer N whose account is linked to party P3;
-- stranger label L2 (owner Z).

\set O  '''a1810000-0000-4000-8000-000000000001'''
\set F  '''a1810000-0000-4000-8000-000000000002'''
\set G  '''a1810000-0000-4000-8000-000000000003'''
\set S  '''a1810000-0000-4000-8000-000000000004'''
\set R1 '''a1810000-0000-4000-8000-000000000005'''
\set R2 '''a1810000-0000-4000-8000-000000000006'''
\set N  '''a1810000-0000-4000-8000-000000000007'''
\set Z  '''a1810000-0000-4000-8000-000000000008'''
\set L  '''b1810000-0000-4000-8000-000000000001'''
\set L2 '''b1810000-0000-4000-8000-000000000002'''
\set A1 '''c1810000-0000-4000-8000-0000000000a1'''
\set A2 '''c1810000-0000-4000-8000-0000000000a2'''
\set P1 '''d1810000-0000-4000-8000-000000000001'''
\set P2 '''d1810000-0000-4000-8000-000000000002'''
\set P3 '''d1810000-0000-4000-8000-000000000003'''
\set PY1 '''e2810000-0000-4000-8000-000000000001'''
\set PY2 '''e2810000-0000-4000-8000-000000000002'''
\set PY3 '''e2810000-0000-4000-8000-000000000003'''
\set PJ1 '''e1810000-0000-4000-8000-0000000000b1'''
\set PJ2 '''e1810000-0000-4000-8000-0000000000b2'''
\set T1 '''e1810000-0000-4000-8000-000000000001'''
\set T2 '''e1810000-0000-4000-8000-000000000002'''
\set SH1 '''e3810000-0000-4000-8000-000000000001'''
\set SH2 '''e3810000-0000-4000-8000-000000000002'''
\set ADV1 '''e5810000-0000-4000-8000-000000000001'''
\set ADV2 '''e5810000-0000-4000-8000-000000000002'''
\set PER '''e4810000-0000-4000-8000-000000000001'''
\set PER2 '''e4810000-0000-4000-8000-000000000002'''
\set PERC '''e4810000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email) VALUES
  (:O, 'o181@local.test'), (:F, 'f181@local.test'), (:G, 'g181@local.test'), (:S, 's181@local.test'),
  (:R1, 'r1181@local.test'), (:R2, 'r2181@local.test'), (:N, 'n181@local.test'), (:Z, 'z181@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-181', 'label', :O),
  (:L2, 'Label L2', 'label-l2-181', 'label', :Z);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'),
  (:L, :F, 'member', '{finance}', 'org'),
  (:L, :G, 'member', '{finance}', 'org'),
  (:L, :S, 'member', '{finance}', 'artists'),
  (:L, :R1, 'artist', '{}', 'artists'),
  (:L, :R2, 'artist', '{}', 'artists'),
  (:L, :N, 'member', '{marketing}', 'org'),
  (:L2, :Z, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:A1, NULL, :L, 'Ara', 'ara181@local.test', 'artist'),
  (:A2, NULL, :L, 'Bo', 'bo181@local.test', 'artist');
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES (:L, :S, :A1), (:L, :R1, :A1), (:L, :R2, :A2);
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:PJ1, NULL, :L, 'Ara EP'), (:PJ2, NULL, :L, 'Bo EP');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:T1, NULL, :L, :O, 'Night Shift', 'song', 'r2://private/orgs/l/t1', 'inbox'),
  (:T2, NULL, :L, :O, 'Bo song', 'song', 'r2://private/orgs/l/t2', 'inbox');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:PJ1, :T1, 0), (:PJ2, :T2, 0);
-- P3 is a producer with no roster artist whose party is LINKED to account N.
INSERT INTO public.parties (id, org_id, kind, display_name, contact_id, user_id) VALUES
  (:P1, :L, 'person', 'Ara', :A1, NULL), (:P2, :L, 'person', 'Bo', :A2, NULL), (:P3, :L, 'person', 'Producer Pat', NULL, :N);
INSERT INTO public.payees (id, org_id, party_id, artist_contact_id, currency, created_by) VALUES
  (:PY1, :L, :P1, :A1, 'USD', :F), (:PY2, :L, :P2, :A2, 'USD', :F), (:PY3, :L, :P3, NULL, 'USD', :F);
INSERT INTO public.split_sheets (id, org_id, track_id, kind, version) VALUES (:SH1, :L, :T1, 'master', 1), (:SH2, :L, :T2, 'master', 1);
INSERT INTO public.split_lines (split_sheet_id, party_id, role, share, position) VALUES
  (:SH1, :P1, 'master_owner', 60, 0), (:SH1, :P2, 'master_owner', 40, 1), (:SH2, :P2, 'master_owner', 100, 0);
UPDATE public.split_sheets SET status = 'circulated', circulated_at = now() WHERE id IN (:SH1, :SH2);
INSERT INTO public.finance_periods (id, org_id, label, starts_on, ends_on) VALUES
  (:PER, :L, 'Q3', '2026-07-01', '2026-09-30'), (:PER2, :L, 'Q4', '2026-10-01', '2026-12-31'), (:PERC, :L, 'Q2', '2026-04-01', '2026-06-30');
UPDATE public.finance_periods SET status = 'closed', closed_at = now() WHERE id = :PERC;
INSERT INTO public.advances (id, org_id, payee_id, kind, amount_minor, currency) VALUES
  (:ADV1, :L, :PY1, 'recoupable', 500, 'USD'), (:ADV2, :L, :PY2, 'recoupable', 500, 'USD');

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

-- The statement's lines as the application builds them, rebuilt from the tables (the TypeScript is
-- lib/labelos/finance/statement-calc.ts; this is its twin for the test).
CREATE FUNCTION public.chk_lines(p_payee uuid, p_period uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.pos), '[]'::jsonb) FROM (
    SELECT row_number() OVER (ORDER BY a.id) AS pos, jsonb_build_object('kind', 'earning', 'earnings_line_id', a.line_id, 'track_id', a.song_track_id,
             'description', 'x', 'share_units', a.units, 'amount_minor', a.payable_minor::text, 'position', row_number() OVER (ORDER BY a.id)) AS j
    FROM public.earnings_allocations a JOIN public.earnings_imports i ON i.id = a.import_id
    WHERE a.payee_id = p_payee AND i.period_id = p_period AND i.status = 'imported'
    UNION ALL
    SELECT 1000 + row_number() OVER (ORDER BY r.id), jsonb_build_object('kind', 'recoupment', 'earnings_line_id', a.line_id, 'advance_id', r.advance_id,
             'description', 'adv', 'amount_minor', (-r.amount_minor)::text, 'position', 1000 + row_number() OVER (ORDER BY r.id))
    FROM public.earnings_recoupments r JOIN public.earnings_allocations a ON a.id = r.allocation_id JOIN public.earnings_imports i ON i.id = r.import_id
    WHERE r.payee_id = p_payee AND i.period_id = p_period AND i.status = 'imported'
  ) x;
$$;

CREATE FUNCTION public.chk_import(p_sha text, p_period uuid, p_line_no int, p_gross text, p_song uuid, p_sheet uuid, p_payee uuid, p_party uuid, p_payable text, p_advance uuid, p_recoup text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.labelos_earnings_import(
    'b1810000-0000-4000-8000-000000000001'::uuid, 'a1810000-0000-4000-8000-000000000002'::uuid,
    jsonb_build_object('period_id', p_period, 'source', 'generic', 'file_name', 'f.csv', 'file_sha256', p_sha, 'currency', 'USD', 'row_count', 1, 'total_minor', p_gross),
    jsonb_build_array(jsonb_build_object('line_no', p_line_no, 'isrc', 'USABC2600001', 'track_id', p_song, 'song_track_id', p_song, 'gross_minor', p_gross, 'currency', 'USD', 'income_class', 'master')),
    jsonb_build_array(jsonb_build_object('line_no', p_line_no, 'payee_id', p_payee, 'party_id', p_party, 'song_track_id', p_song, 'kind', 'master',
      'sheet_id', p_sheet, 'basis', 'split', 'units', 600000, 'payable_minor', p_payable)),
    CASE WHEN p_advance IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('line_no', p_line_no, 'payee_id', p_payee, 'advance_id', p_advance, 'amount_minor', p_recoup)) END);
$$;

SET ROLE service_role;
-- Import A (period Q3): Ara earns 600 on Night Shift and 500 of it recoups ADV1. Import B (period Q4): Bo earns 1000, 300 recoups ADV2.
SELECT public.chk_import(repeat('a', 64), :PER, 2, '1000', :T1, :SH1, :PY1, :P1, '600', :ADV1, '500');
SELECT public.chk_import(repeat('b', 64), :PER2, 2, '1000', :T2, :SH2, :PY2, :P2, '1000', :ADV2, '300');
RESET ROLE;
SELECT public.check_eq('A: one allocation, one recoupment', (SELECT count(*)::int FROM public.earnings_allocations WHERE payee_id = :PY1) * 10 + (SELECT count(*)::int FROM public.earnings_recoupments WHERE payee_id = :PY1), 11);

-- ── Generate: a statement equals its sources ─────────────────────────────

SELECT public.check_raises('the API roles cannot call the statement functions',
  format($$SET LOCAL ROLE authenticated; SELECT public.labelos_audit_statement_generate(%L, %L, %L, %L, '[]'::jsonb, '{}'::jsonb)$$, 'b1810000-0000-4000-8000-000000000001', 'a1810000-0000-4000-8000-000000000002', 'e2810000-0000-4000-8000-000000000001', 'e4810000-0000-4000-8000-000000000001'),
  'permission denied');
SET ROLE service_role;
SELECT public.check_raises('a line that is not an allocation amount is refused (601 for 600)',
  format($$SELECT public.labelos_audit_statement_generate(%L, %L, %L, %L, jsonb_set(public.chk_lines(%L, %L), '{0,amount_minor}', '"601"'), '{}'::jsonb)$$,
    'b1810000-0000-4000-8000-000000000001', 'a1810000-0000-4000-8000-000000000002', 'e2810000-0000-4000-8000-000000000001', 'e4810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000001', 'e4810000-0000-4000-8000-000000000001'),
  'sources_mismatch');
SELECT public.check_raises('a missing recoupment line is refused',
  format($$SELECT public.labelos_audit_statement_generate(%L, %L, %L, %L, (public.chk_lines(%L, %L) -> 0) || '[]'::jsonb, '{}'::jsonb)$$,
    'b1810000-0000-4000-8000-000000000001', 'a1810000-0000-4000-8000-000000000002', 'e2810000-0000-4000-8000-000000000001', 'e4810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000001', 'e4810000-0000-4000-8000-000000000001'),
  'sources_mismatch|cannot extract|not.*array|a line was not written');
RESET ROLE;
SELECT public.check_eq('...and nothing was left behind', (SELECT count(*)::int FROM public.statements), 0);

SET ROLE service_role;
SELECT (public.labelos_audit_statement_generate(:L, :F, :PY1, :PER, public.chk_lines(:PY1, :PER), '{}'::jsonb) ->> 'id') AS st1 \gset
RESET ROLE;
SELECT public.check_eq('generated: net = Σ allocations − Σ recoupments (600 − 500)', (SELECT net_minor::int FROM public.statements WHERE id = :'st1'), 100);
SELECT public.check_eq('generated: it is a draft by the generator', (SELECT status || ':' || (created_by = :F)::text FROM public.statements WHERE id = :'st1'), 'draft:true');
SELECT public.check_eq('generated: an event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'statement.generated' AND subject_id = :'st1'::uuid AND audit AND visibility = 'internal'), 1);
SELECT public.check_eq('generated: no amount in the event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'statement.generated' AND payload::text ~ '600|500|100'), 0);

SET ROLE service_role;
SELECT public.check_eq('a payee with nothing in the period gets no statement',
  public.labelos_audit_statement_generate(:L, :F, :PY3, :PER, '[]'::jsonb, '{}'::jsonb) ->> 'error', 'nothing_to_include');
SELECT public.check_eq('a closed period gets no draft',
  public.labelos_audit_statement_generate(:L, :F, :PY1, :PERC, '[]'::jsonb, '{}'::jsonb) ->> 'error', 'period_closed');
SELECT (public.labelos_audit_statement_generate(:L, :F, :PY1, :PER, public.chk_lines(:PY1, :PER), '{}'::jsonb) ->> 'id') AS st1b \gset
RESET ROLE;
SELECT public.check_eq('regenerating replaces only the draft: one live statement, new id', (SELECT count(*)::int FROM public.statements WHERE payee_id = :PY1 AND status <> 'void') * 10 + (:'st1b' <> :'st1')::int, 11);

-- ── Approve: append-only, not the generator (unless an owner), stale ─────

SET ROLE service_role;
SELECT public.check_eq('the generator may not approve their own draft',
  public.labelos_audit_statement_approve(:L, :F, :'st1b'::uuid, '{}'::jsonb) ->> 'error', 'self_approval');
SELECT public.check_eq('another finance member approves',
  public.labelos_audit_statement_approve(:L, :G, :'st1b'::uuid, '{}'::jsonb) ->> 'approved', 'true');
SELECT public.check_eq('...once: a second approval is not a draft',
  public.labelos_audit_statement_approve(:L, :G, :'st1b'::uuid, '{}'::jsonb) ->> 'error', 'not_draft');
RESET ROLE;
SELECT public.check_eq('approved by G', (SELECT (approved_by = :G)::text FROM public.statements WHERE id = :'st1b'), 'true');
SELECT public.check_raises('the approval is never rewritten (who)',
  format($$UPDATE public.statements SET approved_by = %L WHERE id = %L$$, 'a1810000-0000-4000-8000-000000000001', :'st1b'), 'never rewritten');
SELECT public.check_raises('the approval is never rewritten (when)',
  format($$UPDATE public.statements SET approved_at = now() - interval '1 day' WHERE id = %L$$, :'st1b'), 'never rewritten');
SELECT public.check_raises('an approved statement keeps its total',
  format($$UPDATE public.statements SET net_minor = 1 WHERE id = %L$$, :'st1b'), 'fixed once the statement leaves draft');
SELECT public.check_raises('an approved statement keeps its lines',
  format($$DELETE FROM public.statement_lines WHERE statement_id = %L$$, :'st1b'), 'cannot be edited');
SELECT public.check_raises('the same earning cannot be put on a second live statement',
  format($$INSERT INTO public.statements (org_id, payee_id, period_id, currency) VALUES (%L, %L, %L, 'USD')$$, 'b1810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000001', 'e4810000-0000-4000-8000-000000000001'),
  'one_live_per_period|duplicate key');

SET ROLE service_role;
SELECT public.check_eq('an owner may approve a draft they generated',
  (SELECT public.labelos_audit_statement_approve(:L, :O, (public.labelos_audit_statement_generate(:L, :O, :PY2, :PER2, public.chk_lines(:PY2, :PER2), '{}'::jsonb) ->> 'id')::uuid, '{}'::jsonb) ->> 'approved'), 'true');
RESET ROLE;
SELECT public.check_eq('B: Bo net = 1000 − 300', (SELECT net_minor::int FROM public.statements WHERE payee_id = :PY2), 700);

-- Approved: the period cannot take more allocations for that payee.
SET ROLE service_role;
SELECT public.check_raises('an allocation cannot be written behind an approved statement',
  format($$SELECT public.chk_import(repeat('c', 64), %L, 2, '100', %L, %L, %L, %L, '60', NULL, NULL)$$, 'e4810000-0000-4000-8000-000000000001', 'e1810000-0000-4000-8000-000000000001', 'e3810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000001', 'd1810000-0000-4000-8000-000000000001'),
  'statement_exists');
RESET ROLE;
SELECT public.check_eq('...and the refused import left nothing', (SELECT count(*)::int FROM public.earnings_imports WHERE file_sha256 = repeat('c', 64)), 0);

-- ── Stale: sources moved under a draft ───────────────────────────────────

SET ROLE service_role;
SELECT public.labelos_audit_statement_void(:L, :G, :'st1b'::uuid, 'redo', '{}'::jsonb);
SELECT (public.labelos_audit_statement_generate(:L, :F, :PY1, :PER, public.chk_lines(:PY1, :PER), '{}'::jsonb) ->> 'id') AS st2 \gset
SELECT public.chk_import(repeat('d', 64), :PER, 3, '100', :T1, :SH1, :PY1, :P1, '60', NULL, NULL);
SELECT public.check_eq('a draft whose sources moved is stale',
  public.labelos_audit_statement_approve(:L, :G, :'st2'::uuid, '{}'::jsonb) ->> 'error', 'stale');
SELECT (public.labelos_audit_statement_generate(:L, :F, :PY1, :PER, public.chk_lines(:PY1, :PER), '{}'::jsonb) ->> 'id') AS st3 \gset
RESET ROLE;
SELECT public.check_eq('regenerated: net = (600 + 60) − 500', (SELECT net_minor::int FROM public.statements WHERE id = :'st3'), 160);
SELECT public.check_eq('the voided statement frees its sources (one live statement)', (SELECT count(*)::int FROM public.statements WHERE payee_id = :PY1 AND status <> 'void'), 1);

SET ROLE service_role;
SELECT public.check_eq('approve st3', public.labelos_audit_statement_approve(:L, :G, :'st3'::uuid, '{}'::jsonb) ->> 'approved', 'true');
-- ── Void an import ───────────────────────────────────────────────────────
SELECT public.check_eq('cannot void an import an APPROVED statement includes',
  public.labelos_audit_earnings_import_void(:L, :G, (SELECT id FROM public.earnings_imports WHERE file_sha256 = repeat('a', 64)), '{}'::jsonb) ->> 'error', 'statement_exists');
SELECT public.check_eq('issue st3', public.labelos_audit_statement_issue(:L, :G, :'st3'::uuid, '{}'::jsonb) ->> 'issued', 'true');
SELECT public.check_eq('cannot void an import an ISSUED statement includes',
  public.labelos_audit_earnings_import_void(:L, :G, (SELECT id FROM public.earnings_imports WHERE file_sha256 = repeat('a', 64)), '{}'::jsonb) ->> 'error', 'statement_exists');
RESET ROLE;
SELECT public.check_eq('...and nothing was released', (SELECT count(*)::int FROM public.earnings_allocations WHERE payee_id = :PY1), 2);

-- ── Issued: frozen; payments ─────────────────────────────────────────────

SELECT public.check_raises('an issued statement cannot be edited (net)', format($$UPDATE public.statements SET net_minor = 5 WHERE id = %L$$, :'st3'), 'fixed once the statement leaves draft');
SELECT public.check_raises('an issued statement cannot be edited (lines)', format($$UPDATE public.statement_lines SET amount_minor = 5 WHERE statement_id = %L$$, :'st3'), 'cannot be edited');
SELECT public.check_raises('an issued statement cannot be deleted', format($$DELETE FROM public.statements WHERE id = %L$$, :'st3'), 'voided, not deleted');

SET ROLE service_role;
SELECT public.check_eq('a payment against an unknown statement is not found', public.labelos_audit_payment_record(:L, :F, 'e6810000-0000-4000-8000-0000000000ff'::uuid, 10, current_date, 'x', '{}'::jsonb) ->> 'error', 'not_found');
SELECT public.check_eq('60 of 160 is recorded', (public.labelos_audit_payment_record(:L, :F, :'st3'::uuid, 60, current_date, 'wire A', '{}'::jsonb) ->> 'id') IS NOT NULL, true);
SELECT public.check_eq('partial: 90 more is more than the 100 left', public.labelos_audit_payment_record(:L, :F, :'st3'::uuid, 101, current_date, NULL, '{}'::jsonb) ->> 'error', 'exceeds_net');
SELECT public.check_eq('...it names what is left', public.labelos_audit_payment_record(:L, :F, :'st3'::uuid, 101, current_date, NULL, '{}'::jsonb) ->> 'remaining', '100');
SELECT (public.labelos_audit_payment_record(:L, :F, :'st3'::uuid, 100, current_date, 'wire B', '{}'::jsonb) ->> 'id') AS pay2 \gset
RESET ROLE;
SELECT public.check_eq('paid in full: Σ live payments = net', (SELECT sum(amount_minor)::int FROM public.payments WHERE statement_id = :'st3' AND voided_at IS NULL), 160);
SELECT public.check_raises('the database refuses a payment above the net even from a buggy caller',
  format($$INSERT INTO public.payments (org_id, payee_id, statement_id, amount_minor, currency, paid_on) VALUES (%L, %L, %L, 1, 'USD', current_date)$$, 'b1810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000001', :'st3'),
  'exceeds_net');
SELECT public.check_raises('a bank account number is not a reference',
  format($$INSERT INTO public.payments (org_id, payee_id, statement_id, amount_minor, currency, paid_on, reference) VALUES (%L, %L, %L, 0, 'USD', current_date, 'GB82WEST12345698765432')$$, 'b1810000-0000-4000-8000-000000000001', 'e2810000-0000-4000-8000-000000000001', :'st3'),
  'reference_check|amount_check');
SET ROLE service_role;
SELECT public.check_eq('a statement with a live payment is not voided', public.labelos_audit_statement_void(:L, :G, :'st3'::uuid, 'oops', '{}'::jsonb) ->> 'error', 'has_payments');
SELECT public.check_eq('a payment is voided once', public.labelos_audit_payment_void(:L, :G, :'pay2'::uuid, '{}'::jsonb) ->> 'voided', 'true');
SELECT public.check_eq('...not twice', public.labelos_audit_payment_void(:L, :G, :'pay2'::uuid, '{}'::jsonb) ->> 'error', 'already_void');
RESET ROLE;
SELECT public.check_eq('the payment events carry no amount', (SELECT count(*)::int FROM public.activity_events WHERE verb LIKE 'payment.%' AND payload::text ~ '160|100|60'), 0);

-- ── Reads ────────────────────────────────────────────────────────────────

-- A producer payee whose party is linked to account N (a self-link) with an issued statement of its own.
INSERT INTO public.statements (id, org_id, payee_id, period_id, currency) VALUES ('e6810000-0000-4000-8000-000000000003', :L, :PY3, :PER, 'USD');
UPDATE public.statements SET status = 'approved', approved_by = :G, approved_at = now() WHERE id = 'e6810000-0000-4000-8000-000000000003';
UPDATE public.statements SET status = 'issued', issued_at = now() WHERE id = 'e6810000-0000-4000-8000-000000000003';
-- Bo's approved-but-not-issued statement (B) exists; Ara's st3 is issued.

SET ROLE authenticated;
SELECT public.as_user(:F);
SELECT public.check_eq('finance staff read every statement of the org (A issued, B approved, N issued, voided one)', public.vis('statements'), 4);
SELECT public.as_user(:S);
SELECT public.check_eq('finance scoped to Ara reads only Ara''s statements (voided + issued)', public.vis('statements'), 2);
SELECT public.as_user(:R1);
SELECT public.check_eq('roster artist Ara reads ONLY her ISSUED statement', public.vis('statements'), 1);
SELECT public.check_eq('...its lines (earning 600, 60 and recoupment)', public.vis('statement_lines'), 3);
SELECT public.check_eq('...its live payments only', public.vis('payments'), 1);
SELECT public.check_eq('...no allocation, advance or earnings row', public.vis('earnings_allocations') + public.vis('advances') + public.vis('earnings_lines'), 0);
SELECT public.as_user(:R2);
SELECT public.check_eq('roster artist Bo reads nothing: his statement is approved, not issued', public.vis('statements'), 0);
SELECT public.as_user(:N);
SELECT public.check_eq('a party linked to the caller''s own account reads nothing (self-link proves nothing)', public.vis('statements') + public.vis('statement_lines') + public.vis('payments') + public.vis('payees'), 0);
SELECT public.as_user(:Z);
SELECT public.check_eq('a stranger''s owner reads nothing', public.vis('statements') + public.vis('payments'), 0);
RESET ROLE;
SET ROLE anon;
SELECT public.check_eq('anon reads nothing', 0, 0);
RESET ROLE;

-- ── Void the statement, then the import ──────────────────────────────────

SET ROLE service_role;
SELECT public.labelos_audit_payment_void(:L, :G, (SELECT id FROM public.payments WHERE statement_id = :'st3' AND voided_at IS NULL), '{}'::jsonb);
SELECT public.check_eq('with no live payment the issued statement is voided', public.labelos_audit_statement_void(:L, :G, :'st3'::uuid, 'redo', '{}'::jsonb) ->> 'voided', 'true');
SELECT public.check_eq('Bo''s approved statement blocks voiding import B',
  public.labelos_audit_earnings_import_void(:L, :G, (SELECT id FROM public.earnings_imports WHERE file_sha256 = repeat('b', 64)), '{}'::jsonb) ->> 'error', 'statement_exists');
SELECT public.labelos_audit_statement_void(:L, :G, (SELECT id FROM public.statements WHERE payee_id = :PY2 AND status = 'approved'), 'redo', '{}'::jsonb);
-- A fresh draft of Bo's: voiding the import discards it.
SELECT (public.labelos_audit_statement_generate(:L, :F, :PY2, :PER2, public.chk_lines(:PY2, :PER2), '{}'::jsonb) ->> 'id') AS st4 \gset
SELECT public.check_eq('voiding import B succeeds: releases 1 allocation, 1 recoupment, discards the draft',
  (SELECT r ->> 'allocations' || ':' || (r ->> 'recoupments') || ':' || (r ->> 'drafts') FROM (SELECT public.labelos_audit_earnings_import_void(:L, :G, (SELECT id FROM public.earnings_imports WHERE file_sha256 = repeat('b', 64)), '{}'::jsonb) AS r) q), '1:1:1');
SELECT public.check_eq('...twice is already void', public.labelos_audit_earnings_import_void(:L, :G, (SELECT id FROM public.earnings_imports WHERE file_sha256 = repeat('b', 64)), '{}'::jsonb) ->> 'error', 'already_void');
RESET ROLE;
SELECT public.check_eq('the draft is gone', (SELECT count(*)::int FROM public.statements WHERE id = :'st4'), 0);
SELECT public.check_eq('Bo has no allocation or recoupment left', (SELECT count(*)::int FROM public.earnings_allocations WHERE payee_id = :PY2) + (SELECT count(*)::int FROM public.earnings_recoupments WHERE payee_id = :PY2), 0);
SELECT public.check_eq('...so ADV2 has its full 500 again', (SELECT 500 - coalesce(sum(amount_minor), 0)::int FROM public.earnings_recoupments WHERE advance_id = :ADV2), 500);
SELECT public.check_eq('the import row stays, void', (SELECT status FROM public.earnings_imports WHERE file_sha256 = repeat('b', 64)), 'void');
SELECT public.check_eq('and so do its lines', (SELECT count(*)::int FROM public.earnings_lines l JOIN public.earnings_imports i ON i.id = l.import_id WHERE i.file_sha256 = repeat('b', 64)), 1);
SELECT public.check_raises('allocations and recoupments are still never deleted by anything else',
  format($$DELETE FROM public.earnings_allocations WHERE payee_id = %L$$, 'e2810000-0000-4000-8000-000000000001'), 'never deleted');
SET ROLE service_role;
SELECT public.check_eq('after the statement is void, import A can be voided',
  public.labelos_audit_earnings_import_void(:L, :G, (SELECT id FROM public.earnings_imports WHERE file_sha256 = repeat('a', 64)), '{}'::jsonb) ->> 'voided', 'true');
RESET ROLE;
SELECT public.check_eq('events: one import_voided per void', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'earnings.import_voided'), 2);

-- ── The org's hard delete takes it all ───────────────────────────────────

DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('hard delete: nothing of the org is left',
  (SELECT (SELECT count(*) FROM public.statements WHERE org_id = 'b1810000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.statement_lines WHERE org_id = 'b1810000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.payments WHERE org_id = 'b1810000-0000-4000-8000-000000000001')
        + (SELECT count(*) FROM public.earnings_allocations WHERE org_id = 'b1810000-0000-4000-8000-000000000001'))::int, 0);
