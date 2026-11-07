-- Rollback for 179_labelos_finance.sql (LABEL-61).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops all eight finance tables: payees, advances, statements, payments and
-- imported earnings go with them. Export the org's data first
-- (GET /api/org/<id>/export). The `activity_events` rows (payee.*, …) stay: the
-- log is append-only. Parties, contacts and tracks are untouched.

DROP POLICY IF EXISTS payments_member_read ON public.payments;
DROP POLICY IF EXISTS statement_lines_member_read ON public.statement_lines;
DROP POLICY IF EXISTS statements_member_read ON public.statements;
DROP POLICY IF EXISTS earnings_lines_member_read ON public.earnings_lines;
DROP POLICY IF EXISTS earnings_imports_member_read ON public.earnings_imports;
DROP POLICY IF EXISTS advances_member_read ON public.advances;
DROP POLICY IF EXISTS finance_periods_member_read ON public.finance_periods;
DROP POLICY IF EXISTS payees_member_read ON public.payees;

DROP TABLE IF EXISTS public.payments;
DROP TABLE IF EXISTS public.statement_lines;
DROP TABLE IF EXISTS public.statements;
DROP TABLE IF EXISTS public.earnings_lines;
DROP TABLE IF EXISTS public.earnings_imports;
DROP TABLE IF EXISTS public.advances;
DROP TABLE IF EXISTS public.finance_periods;
DROP TABLE IF EXISTS public.payees;

DROP FUNCTION IF EXISTS public.labelos_my_payees();
DROP FUNCTION IF EXISTS public.payments_guard();
DROP FUNCTION IF EXISTS public.statement_lines_guard();
DROP FUNCTION IF EXISTS public.statements_guard();
DROP FUNCTION IF EXISTS public.earnings_lines_guard();
DROP FUNCTION IF EXISTS public.earnings_imports_guard();
DROP FUNCTION IF EXISTS public.advances_guard();
DROP FUNCTION IF EXISTS public.finance_periods_guard();
DROP FUNCTION IF EXISTS public.payees_guard();
DROP FUNCTION IF EXISTS public.labelos_finance_frozen();
DROP FUNCTION IF EXISTS public.labelos_finance_org_gone(uuid);

NOTIFY pgrst, 'reload schema';
