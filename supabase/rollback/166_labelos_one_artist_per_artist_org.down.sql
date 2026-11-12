-- Rollback for 166_labelos_one_artist_per_artist_org.sql (LABEL-44).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Drops the one-artist index, its flag column and the triggers that keep it:
-- an artist org's single artist is again only the routes' check-then-insert
-- (artistOrgRosterError), which two requests at once can both pass. The
-- routes keep answering a 23505 on the index name as ONE_ARTIST; without the
-- index that error never comes.

DROP INDEX IF EXISTS public.contacts_one_artist_per_artist_org;
DROP TRIGGER IF EXISTS organizations_kind_self_artist ON public.organizations;
DROP FUNCTION IF EXISTS public.organizations_kind_self_artist();
DROP TRIGGER IF EXISTS contacts_org_self_artist ON public.contacts;
DROP FUNCTION IF EXISTS public.contacts_org_self_artist();
ALTER TABLE public.contacts DROP COLUMN IF EXISTS org_self_artist;
DROP FUNCTION IF EXISTS public.labelos_is_artist_category(text);

NOTIFY pgrst, 'reload schema';
