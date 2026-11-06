-- Behaviour checks for 182_labelos_finance_advances_close.sql (LABEL-64), run by
-- scripts/local-db/check.sh (npm run db:local:check) in its own copy of the
-- throwaway database. Every check RAISEs on failure; psql stops at the first.
-- The two-session race lives in supabase/local/races/182_period_close_race.sh.
--
-- Proven here:
--   · an advance is created / changed / voided only through the audited functions, each writing
--     its event in the same transaction (internal, audit, ids and field NAMES — never an amount);
--   · kind / amount / date change only while NOTHING references the advance; once a recoupment
--     names it they are fixed (function AND table trigger), the note is still editable, and it
--     can no longer be voided; payee, currency and organization never change; nothing is deleted;
--   · an inactive payee, another organization's payee and a missing advance are refused;
--   · a period with a draft statement does not close; a period closes under the SAME advisory lock
--     imports take (read back from pg_locks), once (already_closed), with an event;
--   · a closed period refuses a new import (function and bare INSERT) and a new statement;
--   · reopening is the owner's (a finance member is refused), audited, and the only way back:
--     a bare UPDATE of a closed period still fails; after a reopen an import is accepted again;
--   · the API roles cannot call any of the functions.
--
-- Cast: label L, owner O, finance F; stranger label L2 (owner Z).

\set O  '''a1820000-0000-4000-8000-000000000001'''
\set F  '''a1820000-0000-4000-8000-000000000002'''
\set Z  '''a1820000-0000-4000-8000-000000000008'''
\set L  '''b1820000-0000-4000-8000-000000000001'''
\set L2 '''b1820000-0000-4000-8000-000000000002'''
\set A1 '''c1820000-0000-4000-8000-0000000000a1'''
\set A2 '''c1820000-0000-4000-8000-0000000000a2'''
\set P1 '''d1820000-0000-4000-8000-000000000001'''
\set P2 '''d1820000-0000-4000-8000-000000000002'''
\set P9 '''d1820000-0000-4000-8000-000000000009'''
\set PY1 '''e2820000-0000-4000-8000-000000000001'''
\set PY2 '''e2820000-0000-4000-8000-000000000002'''
\set PY9 '''e2820000-0000-4000-8000-000000000009'''
\set PJ1 '''e1820000-0000-4000-8000-0000000000b1'''
\set T1 '''e1820000-0000-4000-8000-000000000001'''
\set SH1 '''e3820000-0000-4000-8000-000000000001'''
\set PER '''e4820000-0000-4000-8000-000000000001'''
\set PER2 '''e4820000-0000-4000-8000-000000000002'''
\set PER3 '''e4820000-0000-4000-8000-000000000003'''
\set PER4 '''e4820000-0000-4000-8000-000000000004'''
\set IMP4 '''e6820000-0000-4000-8000-000000000004'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o182@local.test'), (:F, 'f182@local.test'), (:Z, 'z182@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-182', 'label', :O),
  (:L2, 'Label L2', 'label-l2-182', 'label', :Z);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  (:L, :O, 'owner', '{}', 'org'), (:L, :F, 'member', '{finance}', 'org'), (:L2, :Z, 'owner', '{}', 'org');
INSERT INTO public.contacts (id, user_id, org_id, name, email, category) VALUES
  (:A1, NULL, :L, 'Ara', 'ara182@local.test', 'artist'), (:A2, NULL, :L2, 'Zed', 'zed182@local.test', 'artist');
INSERT INTO public.projects (id, user_id, org_id, name) VALUES (:PJ1, NULL, :L, 'Ara EP');
INSERT INTO public.tracks (id, user_id, org_id, created_by, title, type, audio_url, song_stage) VALUES
  (:T1, NULL, :L, :O, 'Night Shift', 'song', 'r2://private/orgs/l/t1', 'inbox');
INSERT INTO public.project_tracks (project_id, track_id, position) VALUES (:PJ1, :T1, 0);
INSERT INTO public.parties (id, org_id, kind, display_name, contact_id, user_id) VALUES
  (:P1, :L, 'person', 'Ara', :A1, NULL), (:P2, :L, 'person', 'Pat', NULL, NULL), (:P9, :L2, 'person', 'Zed', :A2, NULL);
INSERT INTO public.payees (id, org_id, party_id, artist_contact_id, currency, created_by) VALUES
  (:PY1, :L, :P1, :A1, 'USD', :F), (:PY9, :L2, :P9, :A2, 'USD', :Z);
INSERT INTO public.payees (id, org_id, party_id, artist_contact_id, currency, status, created_by) VALUES
  (:PY2, :L, :P2, NULL, 'USD', 'inactive', :F);
INSERT INTO public.split_sheets (id, org_id, track_id, kind, version) VALUES (:SH1, :L, :T1, 'master', 1);
INSERT INTO public.split_lines (split_sheet_id, party_id, role, share, position) VALUES (:SH1, :P1, 'master_owner', 100, 0);
UPDATE public.split_sheets SET status = 'circulated', circulated_at = now() WHERE id = :SH1;
INSERT INTO public.finance_periods (id, org_id, label, starts_on, ends_on) VALUES
  (:PER, :L, 'Q3', '2026-07-01', '2026-09-30'), (:PER2, :L, 'Q4', '2026-10-01', '2026-12-31'), (:PER3, :L, 'Q1', '2026-01-01', '2026-03-31');

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
GRANT EXECUTE ON FUNCTION public.check_eq(text, anyelement, anyelement), public.check_raises(text, text, text) TO anon, authenticated;

-- A one-line import (1000 gross) into a period, allocated 100 % to Ara's payee, recouping `p_recoup` of `p_advance`.
CREATE FUNCTION public.chk_import(p_sha text, p_period uuid, p_advance uuid, p_recoup text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.labelos_earnings_import(
    'b1820000-0000-4000-8000-000000000001'::uuid, 'a1820000-0000-4000-8000-000000000002'::uuid,
    jsonb_build_object('period_id', p_period, 'source', 'generic', 'file_name', 'f.csv', 'file_sha256', p_sha, 'currency', 'USD', 'row_count', 1, 'total_minor', '1000'),
    jsonb_build_array(jsonb_build_object('line_no', 1, 'isrc', 'USABC2600001', 'track_id', 'e1820000-0000-4000-8000-000000000001', 'song_track_id', 'e1820000-0000-4000-8000-000000000001', 'gross_minor', '1000', 'currency', 'USD', 'income_class', 'master')),
    jsonb_build_array(jsonb_build_object('line_no', 1, 'payee_id', 'e2820000-0000-4000-8000-000000000001', 'party_id', 'd1820000-0000-4000-8000-000000000001', 'song_track_id', 'e1820000-0000-4000-8000-000000000001', 'kind', 'master',
      'sheet_id', 'e3820000-0000-4000-8000-000000000001', 'basis', 'split', 'units', 1000000, 'payable_minor', '1000')),
    CASE WHEN p_advance IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('line_no', 1, 'payee_id', 'e2820000-0000-4000-8000-000000000001', 'advance_id', p_advance, 'amount_minor', p_recoup)) END);
$$;

-- ── Advances: create ─────────────────────────────────────────────────────

SELECT public.check_raises('the API roles cannot call the advance functions',
  format($$SET LOCAL ROLE authenticated; SELECT public.labelos_audit_advance_create(%L, %L, %L, 'recoupable', 100, NULL, NULL, '{}'::jsonb)$$, 'b1820000-0000-4000-8000-000000000001', 'a1820000-0000-4000-8000-000000000002', 'e2820000-0000-4000-8000-000000000001'),
  'permission denied');
SELECT public.check_raises('the API roles cannot call the period functions',
  format($$SET LOCAL ROLE authenticated; SELECT public.labelos_audit_period_close(%L, %L, %L, '{}'::jsonb)$$, 'b1820000-0000-4000-8000-000000000001', 'a1820000-0000-4000-8000-000000000002', 'e4820000-0000-4000-8000-000000000003'),
  'permission denied');

SET ROLE service_role;
SELECT (public.labelos_audit_advance_create(:L, :F, :PY1, 'recoupable', 5000, '2026-08-01', 'signing', '{"hasDate": true}'::jsonb) ->> 'id') AS adv1 \gset
SELECT (public.labelos_audit_advance_create(:L, :F, :PY1, 'non_recoupable', 700, NULL, NULL, '{}'::jsonb) ->> 'id') AS adv2 \gset
SELECT public.check_eq('an inactive payee takes no advance', public.labelos_audit_advance_create(:L, :F, :PY2, 'recoupable', 100, NULL, NULL, '{}'::jsonb) ->> 'error', 'payee_inactive');
SELECT public.check_eq('another organization''s payee is not found', public.labelos_audit_advance_create(:L, :F, :PY9, 'recoupable', 100, NULL, NULL, '{}'::jsonb) ->> 'error', 'not_found');
SELECT public.check_raises('a zero advance is refused by the table', format($$SELECT public.labelos_audit_advance_create(%L, %L, %L, 'recoupable', 0, NULL, NULL, '{}'::jsonb)$$, 'b1820000-0000-4000-8000-000000000001', 'a1820000-0000-4000-8000-000000000002', 'e2820000-0000-4000-8000-000000000001'), 'advances_amount_check');
RESET ROLE;
SELECT public.check_eq('created: in the payee''s currency, with the payee''s artist', (SELECT currency || ':' || (artist_contact_id = :A1)::text || ':' || kind FROM public.advances WHERE id = :'adv1'), 'USD:true:recoupable');
SELECT public.check_eq('created: an internal audit event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'advance.created' AND subject_id = :'adv1'::uuid AND audit AND visibility = 'internal'), 1);
SELECT public.check_eq('created: no amount in any advance event', (SELECT count(*)::int FROM public.activity_events WHERE verb LIKE 'advance.%' AND (payload::text ~* '"[a-z_]*(amount|minor)[a-z_]*"' OR payload::text ~ ':\s*(5000|700)[,}]')), 0);

-- ── Advances: update while unreferenced ──────────────────────────────────

SET ROLE service_role;
SELECT public.check_eq('no change is no_change', public.labelos_audit_advance_update(:L, :F, :'adv1', '{"note": "signing"}'::jsonb, '{}'::jsonb) ->> 'error', 'no_change');
SELECT public.check_eq('an unreferenced advance changes kind, amount, date and note',
  public.labelos_audit_advance_update(:L, :F, :'adv1', '{"kind": "recoupable", "amount_minor": "6000", "paid_on": "2026-08-02", "note": "signing, revised"}'::jsonb, '{}'::jsonb) -> 'fields', '["amount", "paid_on", "note"]'::jsonb);
SELECT public.check_eq('...and clears the date with null', public.labelos_audit_advance_update(:L, :F, :'adv1', '{"paid_on": null}'::jsonb, '{}'::jsonb) ->> 'updated', 'true');
RESET ROLE;
SELECT public.check_eq('updated: stored', (SELECT amount_minor::int::text || ':' || coalesce(paid_on::text, 'none') || ':' || note FROM public.advances WHERE id = :'adv1'), '6000:none:signing, revised');
SELECT public.check_eq('updated: an event names the fields, not the amounts', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'advance.updated' AND subject_id = :'adv1'::uuid AND audit AND payload -> 'fields' @> '"amount"'), 1);

-- ── Advances: referenced → fixed ─────────────────────────────────────────

SET ROLE service_role;
SELECT public.chk_import(repeat('a', 64), :PER, :'adv1'::uuid, '1000');
RESET ROLE;
SELECT public.check_eq('a recoupment now names the advance', (SELECT count(*)::int FROM public.earnings_recoupments WHERE advance_id = :'adv1'::uuid), 1);
SET ROLE service_role;
SELECT public.check_eq('referenced: the amount is fixed', public.labelos_audit_advance_update(:L, :F, :'adv1', '{"amount_minor": "9000"}'::jsonb, '{}'::jsonb) ->> 'error', 'advance_referenced');
SELECT public.check_eq('referenced: the kind is fixed', public.labelos_audit_advance_update(:L, :F, :'adv1', '{"kind": "non_recoupable"}'::jsonb, '{}'::jsonb) ->> 'error', 'advance_referenced');
SELECT public.check_eq('referenced: the date is fixed', public.labelos_audit_advance_update(:L, :F, :'adv1', '{"paid_on": "2026-01-01"}'::jsonb, '{}'::jsonb) ->> 'error', 'advance_referenced');
SELECT public.check_eq('referenced: the note still changes', public.labelos_audit_advance_update(:L, :F, :'adv1', '{"note": "recouped in part"}'::jsonb, '{}'::jsonb) ->> 'updated', 'true');
SELECT public.check_eq('referenced: it cannot be voided', public.labelos_audit_advance_void(:L, :F, :'adv1', '{}'::jsonb) ->> 'error', 'advance_referenced');
SELECT public.check_raises('referenced: a bare UPDATE of the amount meets the same rule',
  format($$UPDATE public.advances SET amount_minor = 9000 WHERE id = %L$$, :'adv1'), 'advance_referenced');
SELECT public.check_raises('referenced: a bare UPDATE of the kind meets the same rule',
  format($$UPDATE public.advances SET kind = 'non_recoupable' WHERE id = %L$$, :'adv1'), 'advance_referenced');
SELECT public.check_raises('referenced: a bare void meets the same rule',
  format($$UPDATE public.advances SET voided_at = now() WHERE id = %L$$, :'adv1'), 'advance_referenced');
SELECT public.check_raises('the payee of an advance never changes', format($$UPDATE public.advances SET payee_id = %L WHERE id = %L$$, :PY2, :'adv2'), 'never change');
SELECT public.check_raises('the currency of an advance never changes', format($$UPDATE public.advances SET currency = 'EUR' WHERE id = %L$$, :'adv2'), 'never change');
SELECT public.check_raises('an advance is never deleted', format($$DELETE FROM public.advances WHERE id = %L$$, :'adv2'), 'never deleted');
SELECT public.check_eq('a missing advance is not found', public.labelos_audit_advance_update(:L, :F, 'ffffffff-0000-4000-8000-000000000000', '{"note": "x"}'::jsonb, '{}'::jsonb) ->> 'error', 'not_found');
SELECT public.check_eq('another organization''s advance is not found', public.labelos_audit_advance_void(:L2, :Z, :'adv2', '{}'::jsonb) ->> 'error', 'not_found');

-- ── Advances: void while unreferenced ────────────────────────────────────

SELECT public.check_eq('an unreferenced advance is voided', public.labelos_audit_advance_void(:L, :F, :'adv2', '{}'::jsonb) ->> 'voided', 'true');
SELECT public.check_eq('...once', public.labelos_audit_advance_void(:L, :F, :'adv2', '{}'::jsonb) ->> 'error', 'already_void');
SELECT public.check_eq('a void advance takes no change', public.labelos_audit_advance_update(:L, :F, :'adv2', '{"note": "x"}'::jsonb, '{}'::jsonb) ->> 'error', 'advance_void');
RESET ROLE;
SELECT public.check_eq('voided: an event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'advance.voided' AND subject_id = :'adv2'::uuid AND audit), 1);
SELECT public.check_raises('a void advance is final', format($$UPDATE public.advances SET voided_at = NULL WHERE id = %L$$, :'adv2'), 'final');

-- ── Period close ─────────────────────────────────────────────────────────

SET ROLE service_role;
-- A draft statement blocks the close: PER holds the import above; make Ara's draft.
SELECT (public.labelos_audit_statement_generate(:L, :F, :PY1, :PER,
  jsonb_build_array(
    jsonb_build_object('kind', 'earning', 'earnings_line_id', (SELECT a.line_id FROM public.earnings_allocations a WHERE a.payee_id = :PY1 LIMIT 1), 'track_id', :T1, 'description', 'x', 'share_units', 1000000, 'amount_minor', '1000', 'position', 1),
    jsonb_build_object('kind', 'recoupment', 'earnings_line_id', (SELECT a.line_id FROM public.earnings_allocations a WHERE a.payee_id = :PY1 LIMIT 1), 'advance_id', :'adv1'::uuid, 'description', 'adv', 'amount_minor', '-1000', 'position', 2)),
  '{}'::jsonb) ->> 'id') AS st1 \gset
SELECT public.check_eq('a period with a draft statement does not close', public.labelos_audit_period_close(:L, :O, :PER, '{}'::jsonb) ->> 'error', 'drafts_open');
SELECT public.check_eq('another organization''s period is not found', public.labelos_audit_period_close(:L2, :Z, :PER, '{}'::jsonb) ->> 'error', 'not_found');
RESET ROLE;
SELECT public.check_eq('the refused close left it open', (SELECT status FROM public.finance_periods WHERE id = :PER), 'open');

-- The close takes the SAME advisory lock imports do (labelos.earnings:<org>): read back from pg_locks inside one transaction.
DO $$
DECLARE
  v_key bigint := hashtextextended('labelos.earnings:' || 'b1820000-0000-4000-8000-000000000001', 0);
  v_held int;
BEGIN
  PERFORM set_config('role', 'service_role', true);
  PERFORM public.labelos_audit_period_close('b1820000-0000-4000-8000-000000000001', 'a1820000-0000-4000-8000-000000000001', 'e4820000-0000-4000-8000-000000000003', '{}'::jsonb);
  SELECT count(*) INTO v_held FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND ((classid::bigint << 32) | objid::bigint) = v_key;
  IF v_held <> 1 THEN RAISE EXCEPTION 'CHECK FAILED: close did not hold the earnings advisory lock (held %)', v_held; END IF;
  PERFORM set_config('role', 'postgres', true);
END $$;
SELECT public.check_eq('closed: status, closer and moment', (SELECT status || ':' || (closed_by = :O)::text || ':' || (closed_at IS NOT NULL)::text FROM public.finance_periods WHERE id = :PER3), 'closed:true:true');
SELECT public.check_eq('closed: an internal audit event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'period.closed' AND subject_id = :PER3 AND audit AND visibility = 'internal'), 1);
SET ROLE service_role;
SELECT public.check_eq('closing twice is already_closed', public.labelos_audit_period_close(:L, :O, :PER3, '{}'::jsonb) ->> 'error', 'already_closed');
SELECT public.check_raises('a closed period takes no import (function)', format($$SELECT public.chk_import(repeat('c', 64), %L, NULL, NULL)$$, :PER3), 'period_closed');
RESET ROLE;
SELECT public.check_raises('a closed period takes no import (bare INSERT, row lock)',
  format($$INSERT INTO public.earnings_imports (org_id, period_id, source, file_sha256, currency, row_count, total_minor, imported_by) VALUES (%L, %L, 'generic', repeat('d', 64), 'USD', 0, 0, %L)$$, :L, :PER3, :F),
  'period_closed');
SELECT public.check_raises('a closed period takes no statement (bare INSERT, row lock)',
  format($$INSERT INTO public.statements (org_id, payee_id, period_id, currency, created_by) VALUES (%L, %L, %L, 'USD', %L)$$, :L, :PY1, :PER3, :F),
  'period_closed|not one of this organization');
SELECT public.check_eq('an import with no period is unaffected', (SELECT (public.chk_import(repeat('e', 64), NULL, NULL, NULL) ->> 'created')), 'true');
SELECT public.check_raises('a bare UPDATE cannot reopen a closed period', format($$UPDATE public.finance_periods SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = %L$$, :PER3), 'stays closed');
SELECT public.check_raises('a period''s dates never move', format($$UPDATE public.finance_periods SET ends_on = '2026-04-30' WHERE id = %L$$, :PER3), 'fixed once written');

-- ── Reopen: the owner's, audited ─────────────────────────────────────────

SET ROLE service_role;
SELECT public.check_eq('a finance member cannot reopen', public.labelos_audit_period_reopen(:L, :F, :PER3, '{}'::jsonb) ->> 'error', 'not_owner');
SELECT public.check_eq('an open period is not_closed', public.labelos_audit_period_reopen(:L, :O, :PER2, '{}'::jsonb) ->> 'error', 'not_closed');
SELECT public.check_eq('the owner reopens', public.labelos_audit_period_reopen(:L, :O, :PER3, '{}'::jsonb) ->> 'reopened', 'true');
RESET ROLE;
SELECT public.check_eq('reopened: open again, close fields cleared', (SELECT status || ':' || (closed_at IS NULL)::text || ':' || (closed_by IS NULL)::text FROM public.finance_periods WHERE id = :PER3), 'open:true:true');
SELECT public.check_eq('reopened: an internal audit event', (SELECT count(*)::int FROM public.activity_events WHERE verb = 'period.reopened' AND subject_id = :PER3 AND audit AND visibility = 'internal'), 1);
SET ROLE service_role;
SELECT public.check_eq('after a reopen an import is accepted again', (SELECT (public.chk_import(repeat('f', 64), :PER3, NULL, NULL) ->> 'created')), 'true');
RESET ROLE;
SELECT public.check_raises('the reopen flag does not outlive its transaction: a bare reopen still fails',
  format($$UPDATE public.finance_periods SET status = 'closed', closed_at = now() WHERE id = %L; UPDATE public.finance_periods SET status = 'open', closed_at = NULL WHERE id = %L$$, :PER2, :PER2), 'stays closed');

-- ── A line waiting for review blocks the close (180 would refuse to allocate it afterwards) ──

INSERT INTO public.finance_periods (id, org_id, label, starts_on, ends_on) VALUES (:PER4, :L, 'Q5', '2027-01-01', '2027-03-31');
INSERT INTO public.earnings_imports (id, org_id, period_id, source, file_sha256, currency, row_count, total_minor, imported_by)
  VALUES (:IMP4, :L, :PER4, 'generic', repeat('9', 64), 'USD', 1, 100, :F);
INSERT INTO public.earnings_lines (org_id, import_id, line_no, gross_minor, currency, review_reason) VALUES (:L, :IMP4, 1, 100, 'USD', 'no_match');
SET ROLE service_role;
SELECT public.check_eq('a period with a line waiting for review does not close', public.labelos_audit_period_close(:L, :O, :PER4, '{}'::jsonb) ->> 'error', 'lines_waiting');
RESET ROLE;
SELECT public.check_eq('...and stays open', (SELECT status FROM public.finance_periods WHERE id = :PER4), 'open');

-- ── The org's hard delete takes everything ───────────────────────────────

DELETE FROM public.organizations WHERE id = :L;
SELECT public.check_eq('hard delete: no advance of the org remains', (SELECT count(*)::int FROM public.advances WHERE org_id = :L), 0);
SELECT public.check_eq('hard delete: the other organization''s advances are untouched', (SELECT count(*)::int FROM public.payees WHERE org_id = :L2), 1);
