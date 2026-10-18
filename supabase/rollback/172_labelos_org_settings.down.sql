-- Rollback for 172_labelos_org_settings.sql (LABEL-51).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the settings audit function. `organizations.settings` keeps whatever
-- the owner saved (release readiness and Needs attention read it unchanged);
-- `departments_off` is then ignored by no one, so remove that key by hand if
-- the rollback is meant to switch departments back on:
--   UPDATE public.organizations SET settings = settings - 'departments_off';

DROP FUNCTION IF EXISTS public.labelos_audit_org_settings(uuid, uuid, jsonb, jsonb);

NOTIFY pgrst, 'reload schema';
