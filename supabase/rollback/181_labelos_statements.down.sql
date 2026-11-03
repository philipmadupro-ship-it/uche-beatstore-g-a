-- Rollback for 181_labelos_statements.sql (LABEL-63).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the statement / payment / import-void functions and the guards 181 added, and puts
-- labelos_finance_frozen() back as 179 wrote it. No data is touched: statements, lines and
-- payments stay as they are (179's own guards still protect them).

DROP FUNCTION IF EXISTS public.labelos_audit_earnings_import_void(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_payment_void(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_payment_record(uuid, uuid, uuid, bigint, date, text, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_statement_void(uuid, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_statement_issue(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_statement_approve(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_statement_generate(uuid, uuid, uuid, uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_statement_sources_ok(uuid);
DROP FUNCTION IF EXISTS public.labelos_finance_event(uuid, uuid, text, text, uuid, uuid, jsonb);

DROP TRIGGER IF EXISTS statements_void_needs_no_payments ON public.statements;
DROP FUNCTION IF EXISTS public.statements_void_needs_no_payments();
DROP TRIGGER IF EXISTS payments_total_guard ON public.payments;
DROP FUNCTION IF EXISTS public.payments_total_guard();
DROP TRIGGER IF EXISTS earnings_allocations_statement_lock ON public.earnings_allocations;
DROP FUNCTION IF EXISTS public.earnings_allocations_statement_lock();
DROP TRIGGER IF EXISTS statement_lines_source_once ON public.statement_lines;
DROP FUNCTION IF EXISTS public.statement_lines_source_once();
DROP INDEX IF EXISTS public.idx_statement_lines_source;

-- 179's freeze: nothing is ever deleted except by the organization's purge.
CREATE OR REPLACE FUNCTION public.labelos_finance_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a jsonb;
  b jsonb;
  u text;
  i int := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT public.labelos_finance_org_gone(OLD.org_id) THEN
      RAISE EXCEPTION '%: rows are never deleted (void them instead)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  a := to_jsonb(OLD);
  b := to_jsonb(NEW);
  FOREACH u IN ARRAY ARRAY['created_by', 'imported_by', 'recorded_by', 'approved_by', 'voided_by', 'closed_by'] LOOP
    IF a ->> u IS NOT NULL AND b ? u AND b ->> u IS NULL THEN
      a := a - u;
      b := b - u;
    END IF;
  END LOOP;
  WHILE i < TG_NARGS LOOP
    a := a - TG_ARGV[i];
    b := b - TG_ARGV[i];
    i := i + 1;
  END LOOP;
  IF a <> b THEN
    RAISE EXCEPTION '%: this record is fixed once written; only % may change', TG_TABLE_NAME, array_to_string(TG_ARGV, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
