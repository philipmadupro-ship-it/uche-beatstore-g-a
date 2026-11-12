-- Rollback for 175_labelos_release_metadata.sql (LABEL-55).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the constraint and the three columns. The values typed into them
-- (planned distributor, territories, language) are LOST; every other release
-- column is untouched. The release routes then fail to read the new columns
-- until 175 is applied again.

ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_metadata_format;
ALTER TABLE public.releases DROP COLUMN IF EXISTS language;
ALTER TABLE public.releases DROP COLUMN IF EXISTS territories;
ALTER TABLE public.releases DROP COLUMN IF EXISTS distributor;
DROP FUNCTION IF EXISTS public.labelos_territories_ok(text[]);

NOTIFY pgrst, 'reload schema';
