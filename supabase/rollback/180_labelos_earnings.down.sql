-- Rollback for 180_labelos_earnings.sql (LABEL-62).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the allocations and recoupments (every royalty calculation made so far goes
-- with them) and puts earnings_lines back as 179 left it. The imported lines and
-- imports themselves stay. Export the org's data first (GET /api/org/<id>/export).

DROP FUNCTION IF EXISTS public.labelos_earnings_resolve(uuid, uuid, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_earnings_import(uuid, uuid, jsonb, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_earnings_write(uuid, uuid, jsonb, jsonb);

DROP POLICY IF EXISTS earnings_recoupments_member_read ON public.earnings_recoupments;
DROP POLICY IF EXISTS earnings_allocations_member_read ON public.earnings_allocations;
DROP TABLE IF EXISTS public.earnings_recoupments;
DROP TABLE IF EXISTS public.earnings_allocations;
DROP FUNCTION IF EXISTS public.earnings_recoupments_guard();
DROP FUNCTION IF EXISTS public.earnings_allocations_guard();

DROP INDEX IF EXISTS public.idx_earnings_lines_review;
ALTER TABLE public.earnings_lines DROP CONSTRAINT IF EXISTS earnings_lines_review_reason_check;
ALTER TABLE public.earnings_lines DROP CONSTRAINT IF EXISTS earnings_lines_income_class_check;

-- Back to 179's freeze (only the match can change) and 179's guard (no song column to check).
DROP TRIGGER IF EXISTS earnings_lines_frozen ON public.earnings_lines;
CREATE TRIGGER earnings_lines_frozen BEFORE UPDATE OR DELETE ON public.earnings_lines
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen('track_id');

ALTER TABLE public.earnings_lines DROP COLUMN IF EXISTS review_reason;
ALTER TABLE public.earnings_lines DROP COLUMN IF EXISTS income_class;
ALTER TABLE public.earnings_lines DROP COLUMN IF EXISTS song_track_id;

CREATE OR REPLACE FUNCTION public.earnings_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imp public.earnings_imports%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_imp FROM public.earnings_imports i WHERE i.id = NEW.import_id AND i.org_id = NEW.org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'earnings_lines: the import belongs to another organization' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency <> v_imp.currency THEN
      RAISE EXCEPTION 'earnings_lines: a line is in its import''s currency' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.track_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.track_id IS DISTINCT FROM OLD.track_id)
     AND NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id = NEW.track_id AND t.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'earnings_lines: the recording belongs to another organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
