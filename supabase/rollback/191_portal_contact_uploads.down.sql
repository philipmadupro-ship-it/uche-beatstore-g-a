-- Rollback for 191_portal_contact_uploads.sql (PORTAL-UP).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Files a contact uploaded stay on their project as the producer's own files
-- (the attribution column goes); nobody can upload through a portal again.

DROP TRIGGER IF EXISTS project_assets_uploader_linked ON public.project_assets;
DROP FUNCTION IF EXISTS public.project_assets_uploader_linked();
DROP INDEX IF EXISTS public.idx_project_assets_uploaded_by;
ALTER TABLE public.project_assets DROP COLUMN IF EXISTS uploaded_by_contact_id;
ALTER TABLE public.project_contacts DROP COLUMN IF EXISTS can_upload;

NOTIFY pgrst, 'reload schema';
