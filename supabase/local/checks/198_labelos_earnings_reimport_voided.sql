-- Behaviour checks for 198_labelos_earnings_reimport_voided.sql (review G15), run by
-- scripts/local-db/check.sh (npm run db:local:check). Every check RAISEs on failure.
--
-- Proven: one LIVE import per file (a second live one with the same hash is refused / answers the original);
-- once that import is voided the same bytes import fresh; the voided row is kept; the new one is again unique;
-- another org's identical hash is independent; the period-open rule still applies to the fresh import.

\set O  '''a1980000-0000-4000-8000-000000000001'''
\set L  '''b1980000-0000-4000-8000-000000000001'''
\set L2 '''b1980000-0000-4000-8000-000000000002'''
\set PER '''d1980000-0000-4000-8000-0000000000d1'''

INSERT INTO auth.users (id, email) VALUES (:O, 'o198@local.test');
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  (:L, 'Label L', 'label-l-198', 'label', :O), (:L2, 'Label L2', 'label-l2-198', 'label', :O);
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES (:L, :O, 'owner', '{}', 'org'), (:L2, :O, 'owner', '{}', 'org');

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
CREATE FUNCTION public.chk_imp(p_sha text, p_period text DEFAULT '') RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('file_sha256', p_sha, 'period_id', p_period, 'source', 'generic', 'file_name', 'r.csv', 'currency', 'USD', 'row_count', 0, 'total_minor', '0');
$$;

SELECT public.check_eq('the old constraint is gone, the partial index is there',
  (SELECT (SELECT count(*) FROM pg_constraint WHERE conname = 'earnings_imports_one_per_file')::int * 10
        + (SELECT count(*) FROM pg_indexes WHERE indexname = 'earnings_imports_one_live_per_file' AND indexdef ILIKE '%WHERE%void%')::int), 1);

CREATE TEMP TABLE r1 AS SELECT public.labelos_earnings_import(:L, :O, public.chk_imp(repeat('a', 64)), '[]', '[]', '[]') AS r;
SELECT public.check_eq('first import is created', (SELECT r ->> 'created' FROM r1), 'true');
SELECT public.check_eq('the same file again is the original, nothing written',
  (SELECT (public.labelos_earnings_import(:L, :O, public.chk_imp(repeat('a', 64)), '[]', '[]', '[]') ->> 'id')), (SELECT r ->> 'id' FROM r1));
SELECT public.check_eq('still one import', (SELECT count(*)::int FROM public.earnings_imports WHERE org_id = :L), 1);
SELECT public.check_raises('two live imports of one file are refused by the index',
  format($$INSERT INTO public.earnings_imports (org_id, source, file_sha256, currency, row_count, total_minor) VALUES (%L, 'generic', %L, 'USD', 0, 0)$$, 'b1980000-0000-4000-8000-000000000001', repeat('a', 64)),
  'earnings_imports_one_live_per_file|duplicate key');

SELECT public.labelos_audit_earnings_import_void(:L, :O, (SELECT (r ->> 'id')::uuid FROM r1), '{}');
CREATE TEMP TABLE r2 AS SELECT public.labelos_earnings_import(:L, :O, public.chk_imp(repeat('a', 64)), '[]', '[]', '[]') AS r;
SELECT public.check_eq('after the void, the same file imports fresh', (SELECT r ->> 'created' FROM r2), 'true');
SELECT public.check_eq('a new id', (SELECT (r2.r ->> 'id') <> (r1.r ->> 'id') FROM r1, r2), true);
SELECT public.check_eq('the voided import is kept', (SELECT count(*)::int FROM public.earnings_imports WHERE org_id = :L AND status = 'void'), 1);
SELECT public.check_eq('the fresh one is live', (SELECT count(*)::int FROM public.earnings_imports WHERE org_id = :L AND status = 'imported'), 1);
SELECT public.check_eq('and is the original from now on',
  (SELECT (public.labelos_earnings_import(:L, :O, public.chk_imp(repeat('a', 64)), '[]', '[]', '[]') ->> 'created')), 'false');
SELECT public.check_eq('another org with the same bytes is independent',
  (SELECT (public.labelos_earnings_import(:L2, :O, public.chk_imp(repeat('a', 64)), '[]', '[]', '[]') ->> 'created')), 'true');

INSERT INTO public.finance_periods (id, org_id, label, starts_on, ends_on) VALUES (:PER, :L, 'P', '2026-01-01', '2026-03-31');
UPDATE public.finance_periods SET status = 'closed', closed_at = now(), closed_by = :O WHERE id = :PER;
SELECT public.check_raises('a closed period still refuses a fresh import',
  format($$SELECT public.labelos_earnings_import(%L, %L, public.chk_imp(repeat('c', 64), %L), '[]', '[]', '[]')$$, 'b1980000-0000-4000-8000-000000000001', 'a1980000-0000-4000-8000-000000000001', 'd1980000-0000-4000-8000-0000000000d1'),
  'period');
