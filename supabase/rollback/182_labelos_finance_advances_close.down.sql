-- Rollback for 182_labelos_finance_advances_close.sql (LABEL-64).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the advance and period-close functions and the two period-open triggers, and puts the
-- two guards 182 replaced back as 179 wrote them (an advance's kind / amount / date are fixed from
-- the day it is made; a closed period stays closed). No data is touched: advances, periods and
-- their events stay as they are.

DROP FUNCTION IF EXISTS public.labelos_audit_period_reopen(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_period_close(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_advance_void(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_advance_update(uuid, uuid, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_advance_create(uuid, uuid, uuid, text, bigint, date, text, jsonb);

DROP TRIGGER IF EXISTS statements_period_open ON public.statements;
DROP TRIGGER IF EXISTS earnings_imports_period_open ON public.earnings_imports;
DROP FUNCTION IF EXISTS public.finance_period_open_lock();

-- 179's guard: a closed period stays closed.
CREATE OR REPLACE FUNCTION public.finance_periods_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'finance_periods: a period starts open' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    RAISE EXCEPTION 'finance_periods: a closed period stays closed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.finance_periods_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finance_periods_guard() FROM PUBLIC;

-- 179's freeze on advances: only the note and the void change.
DROP TRIGGER IF EXISTS advances_frozen ON public.advances;
CREATE TRIGGER advances_frozen BEFORE UPDATE OR DELETE ON public.advances
  FOR EACH ROW EXECUTE FUNCTION public.labelos_finance_frozen('note', 'voided_at', 'voided_by');
DROP FUNCTION IF EXISTS public.advances_edit_frozen();
DROP FUNCTION IF EXISTS public.labelos_advance_referenced(uuid);

-- 181's import void (without the closed-period refusal).
CREATE OR REPLACE FUNCTION public.labelos_audit_earnings_import_void(p_org uuid, p_actor uuid, p_import uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i public.earnings_imports%ROWTYPE;
  v_allocs int;
  v_recoups int;
  v_drafts int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('labelos.earnings:' || p_org::text, 0));
  SELECT * INTO i FROM public.earnings_imports WHERE id = p_import AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF i.status = 'void' THEN RETURN jsonb_build_object('error', 'already_void'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.statement_lines l
    JOIN public.statements s ON s.id = l.statement_id
    JOIN public.earnings_lines el ON el.id = l.earnings_line_id
    WHERE el.import_id = i.id AND s.status IN ('approved', 'issued')
  ) THEN
    RETURN jsonb_build_object('error', 'statement_exists');
  END IF;

  DELETE FROM public.statements s
  WHERE s.org_id = p_org AND s.status = 'draft'
    AND EXISTS (SELECT 1 FROM public.statement_lines l JOIN public.earnings_lines el ON el.id = l.earnings_line_id WHERE l.statement_id = s.id AND el.import_id = i.id);
  GET DIAGNOSTICS v_drafts = ROW_COUNT;

  PERFORM set_config('labelos.voiding_import', i.id::text, true);
  DELETE FROM public.earnings_recoupments WHERE import_id = i.id;
  GET DIAGNOSTICS v_recoups = ROW_COUNT;
  DELETE FROM public.earnings_allocations WHERE import_id = i.id;
  GET DIAGNOSTICS v_allocs = ROW_COUNT;
  PERFORM set_config('labelos.voiding_import', '', true);

  UPDATE public.earnings_imports SET status = 'void' WHERE id = i.id;

  PERFORM public.labelos_finance_event(p_org, p_actor, 'earnings.import_voided', 'earnings_import', i.id, NULL,
    p_payload || jsonb_build_object('importId', i.id, 'allocations', v_allocs, 'recoupments', v_recoups, 'draftsDiscarded', v_drafts));
  RETURN jsonb_build_object('voided', true, 'allocations', v_allocs, 'recoupments', v_recoups, 'drafts', v_drafts);
END;
$$;

ALTER FUNCTION public.labelos_audit_earnings_import_void(uuid, uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_audit_earnings_import_void(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labelos_audit_earnings_import_void(uuid, uuid, uuid, jsonb) TO service_role;
