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
