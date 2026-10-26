-- Rollback for 136_labelos_org_core.sql (LABEL-03).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder, and rls-final-state.test.ts replays
-- them. Run by hand only, after the later Label OS migrations' own
-- rollbacks (139's dependents are unwound below in case they were not).
-- Drops the five tables, the two helpers and the owner trigger function.
-- Destroys all org data.

-- Later Label OS migrations hang off these tables; unwind them first. 139
-- (LABEL-10) adds contacts.org_id → organizations and member_artist_scopes
-- → org_members. Same steps and reasons as 139_labelos_org_contacts.down.sql
-- (org contacts are deleted, never left ownerless in the producer's table).
DROP POLICY IF EXISTS org_member_read ON public.contacts;
DROP TABLE IF EXISTS public.member_artist_scopes;
DROP FUNCTION IF EXISTS public.member_artist_scopes_same_org();
DROP FUNCTION IF EXISTS public.can_see_artist(uuid, uuid);
DROP FUNCTION IF EXISTS public.labelos_artist_org_self_contact() CASCADE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'org_id') THEN
    DELETE FROM public.contacts WHERE org_id IS NOT NULL;
  END IF;
END $$;
DROP TRIGGER IF EXISTS contacts_org_is_fixed ON public.contacts;
DROP FUNCTION IF EXISTS public.contacts_org_is_fixed();
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_org_or_owner;
DROP INDEX IF EXISTS public.contacts_org_email_uniq;
DROP INDEX IF EXISTS public.idx_contacts_org;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS org_id;

DROP TABLE IF EXISTS public.activity_events;
DROP TABLE IF EXISTS public.org_invitations;
DROP TABLE IF EXISTS public.user_profiles;
DROP TABLE IF EXISTS public.org_members;
DROP TABLE IF EXISTS public.organizations;

DROP FUNCTION IF EXISTS public.has_org_cap(uuid, text);
DROP FUNCTION IF EXISTS public.org_role(uuid);
DROP FUNCTION IF EXISTS public.org_members_keep_an_owner();

NOTIFY pgrst, 'reload schema';
