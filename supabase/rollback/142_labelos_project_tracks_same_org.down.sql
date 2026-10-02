-- Rollback for 142_labelos_project_tracks_same_org.sql (LABEL-14).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the trigger and its function. project_tracks goes back to having no
-- parent check (as before 142); no row is touched.

DROP TRIGGER IF EXISTS project_tracks_same_owner ON public.project_tracks;
DROP FUNCTION IF EXISTS public.project_tracks_same_owner();

NOTIFY pgrst, 'reload schema';
