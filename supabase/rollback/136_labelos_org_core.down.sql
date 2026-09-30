-- Rollback for 136_labelos_org_core.sql (LABEL-03).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder, and rls-final-state.test.ts replays
-- them. Run by hand only, and only while nothing else depends on the Label OS
-- tables (true until LABEL-05+ lands). Drops the five tables, the two
-- helpers and the owner trigger function. Destroys all org data.

DROP TABLE IF EXISTS public.activity_events;
DROP TABLE IF EXISTS public.org_invitations;
DROP TABLE IF EXISTS public.user_profiles;
DROP TABLE IF EXISTS public.org_members;
DROP TABLE IF EXISTS public.organizations;

DROP FUNCTION IF EXISTS public.has_org_cap(uuid, text);
DROP FUNCTION IF EXISTS public.org_role(uuid);
DROP FUNCTION IF EXISTS public.org_members_keep_an_owner();

NOTIFY pgrst, 'reload schema';
