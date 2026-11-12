-- Rollback for 163_labelos_audit_events_immutable.sql (LABEL-43).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the trigger: audit events are again protected from the API roles
-- only (136: no UPDATE/DELETE policy or grant), and the service role could
-- rewrite or delete one. No row changes.

DROP TRIGGER IF EXISTS activity_events_audit_immutable ON public.activity_events;
DROP FUNCTION IF EXISTS public.activity_events_audit_immutable();

NOTIFY pgrst, 'reload schema';
