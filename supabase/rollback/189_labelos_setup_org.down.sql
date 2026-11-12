-- Rollback for 189_labelos_setup_org.sql (LABEL-48, first slice).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the function only. Organizations already created through /setup stay
-- (they are ordinary orgs); POST /api/org/setup then answers 503.

DROP FUNCTION IF EXISTS public.labelos_setup_org(uuid, text, text);

NOTIFY pgrst, 'reload schema';
