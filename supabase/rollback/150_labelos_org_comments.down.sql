-- Rollback for 150_labelos_org_comments.sql (LABEL-22).
--
-- Lives outside supabase/migrations/ on purpose: scripts/apply-migrations.sh
-- applies every *.sql in that folder. Run by hand only.
--
-- "Drop the columns." (docs/bstudio-label-os/14-engineering-backlog.md,
-- LABEL-22 Rollback), done safely:
--   - INTERNAL comments are deleted first. Once `visibility` is gone there is
--     nothing left to hide them, and 141's policy would show them to every
--     member who can read the project, a roster artist included;
--   - every other comment stays (an org comment with visibility 'artist' is
--     an ordinary comment on an org project), including resolved threads,
--     which merely lose their resolved mark;
--   - 141's two policies on project_comments are put back verbatim.

DELETE FROM public.project_comments WHERE visibility = 'internal';

DROP POLICY IF EXISTS org_member_read ON public.project_comments;
CREATE POLICY org_member_read ON public.project_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_comments.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_comments.track_id IS NULL OR public.can_read_org_track(p.org_id, project_comments.track_id))
        AND (project_comments.contact_id IS NULL OR public.can_see_artist(p.org_id, project_comments.contact_id))
        AND (project_comments.share_token IS NULL OR public.has_org_cap(p.org_id, 'share.external'))
    )
  );

DROP POLICY IF EXISTS org_member_guard ON public.project_comments;
CREATE POLICY org_member_guard ON public.project_comments
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT public.labelos_is_org_project(project_id)
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_comments.project_id
        AND p.org_id IS NOT NULL
        AND public.has_org_cap(p.org_id, 'catalog.read')
        AND public.can_see_org_project(p.org_id, p.id)
        AND (project_comments.track_id IS NULL OR public.can_read_org_track(p.org_id, project_comments.track_id))
        AND (project_comments.contact_id IS NULL OR public.can_see_artist(p.org_id, project_comments.contact_id))
        AND (project_comments.share_token IS NULL OR public.has_org_cap(p.org_id, 'share.external'))
    )
  );

DROP FUNCTION IF EXISTS public.labelos_can_read_internal_comments(uuid);

DROP TRIGGER IF EXISTS project_comments_org_fields ON public.project_comments;
DROP FUNCTION IF EXISTS public.project_comments_org_fields();

DROP INDEX IF EXISTS public.idx_project_comments_org_project;
ALTER TABLE public.project_comments DROP CONSTRAINT IF EXISTS project_comments_internal_private;
ALTER TABLE public.project_comments DROP CONSTRAINT IF EXISTS project_comments_visibility_check;
ALTER TABLE public.project_comments
  DROP COLUMN IF EXISTS resolved_by,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS visibility,
  DROP COLUMN IF EXISTS org_id;

NOTIFY pgrst, 'reload schema';
