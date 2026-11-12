-- Rollback for 161_labelos_saved_views.sql (LABEL-37).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the table — every saved view, personal and shared: they are only
-- filter definitions, so nothing else is lost; the `activity_events` rows
-- (view.created / updated / deleted) stay, the log is append-only. The Music
-- and Releases filter bars keep working without it (the route answers
-- `schemaReady: false` and the menu says saving needs the migration).

DROP POLICY IF EXISTS org_saved_views_no_direct_access ON public.org_saved_views;
DROP TRIGGER IF EXISTS labelos_org_rows_service_only ON public.org_saved_views;
DROP TRIGGER IF EXISTS org_saved_views_guard ON public.org_saved_views;
DROP TABLE IF EXISTS public.org_saved_views;
DROP FUNCTION IF EXISTS public.labelos_saved_views_guard();

NOTIFY pgrst, 'reload schema';
