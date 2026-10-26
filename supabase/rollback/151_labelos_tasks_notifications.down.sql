-- Rollback for 151_labelos_tasks_notifications.sql (LABEL-23).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the tasks table (every task goes with it), its integrity function and
-- the scoped-releases helper, and the notifications additions: the org rows
-- (a notification with an org_id exists only through this migration), the
-- policy, the trigger, the index and the column. Producer notifications (no
-- org_id) are untouched. Nothing else depends on any of it.

DROP TABLE IF EXISTS public.tasks;
DROP FUNCTION IF EXISTS public.tasks_integrity();
DROP FUNCTION IF EXISTS public.labelos_scoped_releases();

DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.notifications;
DROP POLICY IF EXISTS notifications_org_member_only ON public.notifications;
DROP INDEX IF EXISTS public.idx_notifications_user_org;
DELETE FROM public.notifications WHERE org_id IS NOT NULL;
ALTER TABLE public.notifications DROP COLUMN IF EXISTS org_id;

NOTIFY pgrst, 'reload schema';
