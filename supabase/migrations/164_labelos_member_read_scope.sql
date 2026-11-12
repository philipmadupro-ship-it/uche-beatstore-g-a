-- 164_labelos_member_read_scope.sql
-- Label OS (LABEL-43, review G1 F1): who a member sees in their org's people,
-- on their OWN JWT, follows the same rule as GET /api/org/[orgId]/members.
--
-- LABEL OS — NOT APPLIED. Apply at the final merge of the Label OS branch
-- into main, after 139 (member_artist_scopes). Never part of
-- supabase/apply/pending.sql.
--
-- 136's `org_members_member_read` and `user_profiles_self_or_co_member_read`
-- let every member read every co-member's row and profile. The route was
-- fixed (G1, G10: `mayListMember`, lib/labelos/artist-scope.ts), but a roster
-- artist's own JWT still listed every other artist of the label, with their
-- name and `last_seen_overview_at`, straight from PostgREST. Both policies
-- now read one helper that is the SQL twin of `mayListMember`. A caller sees,
-- in each org where they hold a live membership (org not soft-deleted):
--
--   · their own row;
--   · every row whose role is not `artist` (owners, admins and staff are
--     always listed — a roster artist still sees the team);
--   · an artist's row only when the caller is staff (role is not `artist`)
--     AND either sees the whole org (`scope = 'org'`) or has, in their own
--     artist list, a contact that artist login stands for
--     (`member_artist_scopes`). Another roster artist never sees it.
--
-- A profile is visible to its user and to whoever sees one of that user's
-- membership rows.
--
-- R-08: `labelos_visible_members()` takes no argument from the row, so each
-- policy runs it ONCE per statement as a hashed subplan — no per-row
-- SECURITY DEFINER call (136's policies called `org_role(org_id)` per row).
-- It is SECURITY DEFINER because a policy on org_members cannot read
-- org_members without recursing into itself. The caller's own rows take a
-- cheaper first disjunct (`labelos_my_live_orgs()`, also one hashed subplan):
-- most Label OS policies read org_members only for the caller's own rows, and
-- OR stops there, so they never build the whole visible set.
--
-- Every other Label OS policy that reads org_members as the caller asks only
-- for the caller's own rows (`… WHERE cm.user_id = auth.uid()`), which this
-- keeps visible, so none of them changes. The routes use the service role.
-- The write policies (136) are untouched.
--
-- Idempotent: CREATE OR REPLACE, DROP POLICY IF EXISTS first.

CREATE OR REPLACE FUNCTION public.labelos_visible_members()
RETURNS TABLE (org_id uuid, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT m.org_id, m.role, m.scope
    FROM public.org_members m
    JOIN public.organizations o ON o.id = m.org_id
    WHERE m.user_id = auth.uid()
      AND o.deleted_at IS NULL
  )
  SELECT them.org_id, them.user_id
  FROM public.org_members them
  JOIN me ON me.org_id = them.org_id
  WHERE them.user_id = auth.uid()
     OR them.role <> 'artist'
     OR (me.role <> 'artist' AND me.scope = 'org')
     OR (
       me.role <> 'artist'
       AND EXISTS (
         SELECT 1
         FROM public.member_artist_scopes theirs
         JOIN public.member_artist_scopes mine
           ON mine.org_id = theirs.org_id AND mine.contact_id = theirs.contact_id
         WHERE theirs.org_id = them.org_id
           AND theirs.user_id = them.user_id
           AND mine.user_id = auth.uid()
       )
     );
$$;

-- The caller's own live memberships' orgs: the fast path for the many
-- policies that read only the caller's own org_members rows, so they never
-- need the whole visible set above.
CREATE OR REPLACE FUNCTION public.labelos_my_live_orgs()
RETURNS TABLE (org_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.org_id
  FROM public.org_members m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid()
    AND o.deleted_at IS NULL;
$$;

ALTER FUNCTION public.labelos_my_live_orgs() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_my_live_orgs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_my_live_orgs() TO authenticated, anon;

ALTER FUNCTION public.labelos_visible_members() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.labelos_visible_members() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.labelos_visible_members() TO authenticated, anon;

DROP POLICY IF EXISTS org_members_member_read ON public.org_members;
CREATE POLICY org_members_member_read ON public.org_members
  FOR SELECT
  USING (
    (user_id = (SELECT auth.uid()) AND org_id IN (SELECT lo.org_id FROM public.labelos_my_live_orgs() lo))
    OR (org_id, user_id) IN (SELECT v.org_id, v.user_id FROM public.labelos_visible_members() v)
  );

DROP POLICY IF EXISTS user_profiles_self_or_co_member_read ON public.user_profiles;
CREATE POLICY user_profiles_self_or_co_member_read ON public.user_profiles
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR user_id IN (SELECT v.user_id FROM public.labelos_visible_members() v)
  );

NOTIFY pgrst, 'reload schema';
