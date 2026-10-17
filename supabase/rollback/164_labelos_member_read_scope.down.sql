-- Rollback for 164_labelos_member_read_scope.sql (LABEL-43).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- Puts back 136's two read policies, word for word: every member reads every
-- co-member's row and profile again (a roster artist's own JWT lists the
-- label's other artists — review G1 F1), with a per-row org_role call.
-- GET /api/org/[orgId]/members keeps filtering (mayListMember) either way.

DROP POLICY IF EXISTS org_members_member_read ON public.org_members;
CREATE POLICY org_members_member_read ON public.org_members
  FOR SELECT
  USING ((SELECT public.org_role(org_id)) IS NOT NULL);

DROP POLICY IF EXISTS user_profiles_self_or_co_member_read ON public.user_profiles;
CREATE POLICY user_profiles_self_or_co_member_read ON public.user_profiles
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.org_members them
      WHERE them.user_id = user_profiles.user_id
        AND (SELECT public.org_role(them.org_id)) IS NOT NULL
    )
  );

DROP FUNCTION IF EXISTS public.labelos_visible_members();
DROP FUNCTION IF EXISTS public.labelos_my_live_orgs();

NOTIFY pgrst, 'reload schema';
