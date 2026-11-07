-- Rollback for 195_labelos_lifecycle_guards.sql (LABEL-75).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh applies every *.sql in that folder. Run by
-- hand only. Puts back 147's per-row policy and 155's table-wide SELECT on split_lines (162 changed split_sheets only).

DROP TRIGGER IF EXISTS organizations_delete_after_grace ON public.organizations;
DROP FUNCTION IF EXISTS public.organizations_delete_after_grace();

DROP POLICY IF EXISTS activity_events_member_read ON public.activity_events;
CREATE POLICY activity_events_member_read ON public.activity_events
  FOR SELECT
  USING (
    (SELECT public.has_org_cap(org_id, 'catalog.read'))
    AND (visibility = 'artist' OR (SELECT public.has_org_cap(org_id, 'business.read.internal')))
    AND (
      org_id IN (
        SELECT om.org_id
        FROM public.org_members om
        WHERE om.user_id = (SELECT auth.uid())
          AND om.scope = 'org'
          AND om.role <> 'artist'
      )
      OR (
        artist_id IS NOT NULL
        AND (org_id, artist_id) IN (
          SELECT s.org_id, s.contact_id
          FROM public.member_artist_scopes s
          WHERE s.user_id = (SELECT auth.uid())
        )
      )
      OR (
        artist_id IS NULL
        AND project_id IS NOT NULL
        AND (org_id, project_id) IN (SELECT sp.org_id, sp.project_id FROM public.labelos_scoped_projects() sp)
      )
    )
  );

DROP TRIGGER IF EXISTS activity_events_no_truncate ON public.activity_events;
DROP FUNCTION IF EXISTS public.activity_events_no_truncate();

GRANT SELECT ON public.split_lines TO authenticated, anon;

DROP TRIGGER IF EXISTS labelos_block_sole_owner_account_delete ON auth.users;
DROP FUNCTION IF EXISTS public.labelos_block_sole_owner_account_delete();

NOTIFY pgrst, 'reload schema';
