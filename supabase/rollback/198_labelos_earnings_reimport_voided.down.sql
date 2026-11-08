-- Rollback for 198_labelos_earnings_reimport_voided.sql (review G15).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh applies every *.sql there. Run by hand only.
--
-- Puts back 180's function word for word (a voided import is "the original" again) and 179's one-per-file constraint.
-- If a file has been imported again after a void (a voided and a live row share a hash), the constraint cannot be
-- re-created: this raises, and those rows must be dealt with by hand first.

DROP INDEX IF EXISTS public.earnings_imports_one_live_per_file;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'earnings_imports_one_per_file') THEN
    ALTER TABLE public.earnings_imports ADD CONSTRAINT earnings_imports_one_per_file UNIQUE (org_id, file_sha256);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.labelos_earnings_import(p_org uuid, p_user uuid, p_import jsonb, p_lines jsonb, p_allocs jsonb, p_recoups jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  v_total bigint;
  v_n     int;
  v_allocs  jsonb;
  v_recoups jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org AND o.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'earnings: the organization does not exist' USING ERRCODE = 'check_violation';
  END IF;
  -- One import or re-run at a time per organization: recoupment reads what earlier imports already took.
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));

  SELECT i.id INTO v_id FROM public.earnings_imports i WHERE i.org_id = p_org AND i.file_sha256 = p_import ->> 'file_sha256';
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_id, 'created', false);
  END IF;

  IF nullif(p_import ->> 'period_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.finance_periods fp WHERE fp.id = (p_import ->> 'period_id')::uuid AND fp.org_id = p_org AND fp.status = 'open') THEN
    RAISE EXCEPTION 'earnings: period_closed — that period is not open' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.earnings_imports (org_id, period_id, source, file_name, file_sha256, currency, row_count, total_minor, imported_by)
  VALUES (p_org, nullif(p_import ->> 'period_id', '')::uuid, p_import ->> 'source', nullif(p_import ->> 'file_name', ''), p_import ->> 'file_sha256',
          p_import ->> 'currency', (p_import ->> 'row_count')::int, (p_import ->> 'total_minor')::bigint, p_user)
  RETURNING id INTO v_id;

  INSERT INTO public.earnings_lines
    (org_id, import_id, line_no, isrc, upc, track_id, song_track_id, title, store, territory, units, gross_minor, currency, period_start, period_end, income_class, review_reason)
  SELECT p_org, v_id, x.line_no, x.isrc, x.upc, x.track_id, x.song_track_id, x.title, x.store, x.territory, x.units, x.gross_minor, x.currency, x.period_start, x.period_end, x.income_class, x.review_reason
  FROM jsonb_to_recordset(p_lines) AS x(
    line_no int, isrc text, upc text, track_id uuid, song_track_id uuid, title text, store text, territory text, units bigint,
    gross_minor bigint, currency text, period_start date, period_end date, income_class text, review_reason text);

  SELECT count(*), coalesce(sum(l.gross_minor), 0) INTO v_n, v_total FROM public.earnings_lines l WHERE l.import_id = v_id;
  IF v_n <> (p_import ->> 'row_count')::int OR v_total <> (p_import ->> 'total_minor')::bigint THEN
    RAISE EXCEPTION 'earnings: the lines do not add up to the import header' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(jsonb_agg(a.value || jsonb_build_object('line_id', l.id)), '[]'::jsonb) INTO v_allocs
  FROM jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) a(value)
  JOIN public.earnings_lines l ON l.import_id = v_id AND l.line_no = (a.value ->> 'line_no')::int;
  SELECT coalesce(jsonb_agg(a.value || jsonb_build_object('line_id', l.id)), '[]'::jsonb) INTO v_recoups
  FROM jsonb_array_elements(coalesce(p_recoups, '[]'::jsonb)) a(value)
  JOIN public.earnings_lines l ON l.import_id = v_id AND l.line_no = (a.value ->> 'line_no')::int;

  -- A line number that is not in the file is a caller bug: refuse it rather than drop it.
  IF jsonb_array_length(v_allocs) <> jsonb_array_length(coalesce(p_allocs, '[]'::jsonb))
     OR jsonb_array_length(v_recoups) <> jsonb_array_length(coalesce(p_recoups, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'earnings: an allocation names a line that is not in this import' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.labelos_earnings_write(p_org, v_id, v_allocs, v_recoups);
  RETURN jsonb_build_object('id', v_id, 'created', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
