-- Rollback for 152_labelos_creative_direction.sql (LABEL-26).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops both tables (every reference and every direction document goes with
-- them) and the shared integrity function. Nothing else depends on any of it.

DROP TABLE IF EXISTS public.artist_references;
DROP TABLE IF EXISTS public.artist_direction;
DROP FUNCTION IF EXISTS public.labelos_direction_integrity();

NOTIFY pgrst, 'reload schema';
