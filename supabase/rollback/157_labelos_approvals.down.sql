-- Rollback for 157_labelos_approvals.sql (LABEL-30).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only, after the rollbacks
-- of every later migration (LABEL-31 and LABEL-32 read approvals).
--
-- Drops the table — every request and decision ever recorded, with its
-- snapshot: this is the approval history, export it first — its policy,
-- triggers and functions. The append-only guard refuses a DELETE while the
-- organization and release still exist, but DROP TABLE is not a DELETE, so
-- nothing needs to be switched off. The `activity_events` rows stay: the log
-- is append-only.

DROP FUNCTION IF EXISTS public.labelos_audit_approval_decide(uuid, uuid, text, uuid, text, text, text, jsonb, boolean, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_audit_approval_request(uuid, uuid, text, uuid, text, uuid, text, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.labelos_approval_check_payload(jsonb);

DROP POLICY IF EXISTS approvals_member_read ON public.approvals;
DROP TRIGGER IF EXISTS approvals_no_truncate ON public.approvals;
DROP TRIGGER IF EXISTS approvals_guard ON public.approvals;

DROP TABLE IF EXISTS public.approvals;

DROP FUNCTION IF EXISTS public.approvals_no_truncate();
DROP FUNCTION IF EXISTS public.approvals_guard();

NOTIFY pgrst, 'reload schema';
