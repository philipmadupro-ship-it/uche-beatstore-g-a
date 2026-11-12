-- Rollback for 159_labelos_org_search.sql (LABEL-36).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the generated search columns and their indexes. They hold no data of
-- their own (every value is computed from the row), so nothing is lost; the
-- search route answers an empty result set until the migration is applied again.

DROP INDEX IF EXISTS public.tracks_search_tsv_idx;
DROP INDEX IF EXISTS public.contacts_search_tsv_idx;
DROP INDEX IF EXISTS public.projects_search_tsv_idx;
DROP INDEX IF EXISTS public.project_assets_search_tsv_idx;
DROP INDEX IF EXISTS public.releases_search_tsv_idx;
DROP INDEX IF EXISTS public.parties_search_tsv_idx;
ALTER TABLE public.tracks DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE public.projects DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE public.project_assets DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE public.releases DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE public.parties DROP COLUMN IF EXISTS search_tsv;

NOTIFY pgrst, 'reload schema';
